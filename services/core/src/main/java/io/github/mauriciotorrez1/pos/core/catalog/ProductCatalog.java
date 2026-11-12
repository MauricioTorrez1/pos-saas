package io.github.mauriciotorrez1.pos.core.catalog;

import io.github.mauriciotorrez1.pos.core.reporting.AuditEntry;
import io.github.mauriciotorrez1.pos.core.reporting.AuditLog;
import io.github.mauriciotorrez1.pos.feed.ChangePublisher;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import io.github.mauriciotorrez1.pos.money.Quantity;
import io.github.mauriciotorrez1.pos.money.TaxFactor;
import io.github.mauriciotorrez1.pos.money.TaxRate;
import io.github.mauriciotorrez1.pos.money.Unit;
import io.github.mauriciotorrez1.pos.money.UnitPrice;
import io.github.mauriciotorrez1.pos.tenant.TenantContext;
import java.sql.Array;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Creates, edits, deletes and searches the products of the current business (RF-001, RF-002). Every method runs in
 * a transaction pinned to the business (ADR 0035). Each change leaves, in that same transaction, its audit entry
 * (ADR 0038), the new state of the product in the change feed that registers download (ADR 0048), and a domain event
 * for the outbox (ADR 0036). A product has a price with VAT included, a tax rate and the two SAT keys (ADR 0056).
 */
@Service
public class ProductCatalog {

    static final int MAX_PAGE_SIZE = 100;
    private static final int EVENT_SCHEMA_VERSION = 2;

    private static final String PRODUCT_COLUMNS = """
            p.id, p.name, p.status, p.unit, p.deleted_at, p.unit_price_e4, p.tax_factor, p.tax_rate_bp,
            p.sat_product_key, p.sat_unit_key, p.created_at, p.updated_at
            """;

    private final JdbcTemplate jdbc;
    private final AuditLog auditLog;
    private final ApplicationEventPublisher events;
    private final JsonMapper json;
    private final ChangePublisher feed;
    private final SatCatalog sat;

    ProductCatalog(JdbcTemplate jdbc, AuditLog auditLog, ApplicationEventPublisher events, JsonMapper json,
                   ChangePublisher feed, SatCatalog sat) {
        this.jdbc = jdbc;
        this.auditLog = auditLog;
        this.events = events;
        this.json = json;
        this.feed = feed;
        this.sat = sat;
    }

    /** The result of {@link #create}: the product, and whether this call made it or only found it again. */
    public record Created(Product product, boolean replayed) {
    }

    /**
     * Creates a product. Repeating the same idempotency key returns the product the first call made, so a retry
     * after a timeout never creates a second one.
     *
     * @param actorId the user who creates it, for the audit entry
     * @param request what to create
     * @return the product, and whether it already existed for that key
     * @throws InvalidProductException if the data breaks a rule of the catalog
     * @throws DuplicateCodeException  if a code already belongs to another product of the business
     */
    @Transactional
    public Created create(UUID actorId, NewProduct request) {
        String name = ProductRules.name(request.name());
        List<ProductCode> codes = ProductRules.codes(request.codes());
        List<Presentation> presentations = ProductRules.presentations(request.presentations(), request.unit());
        ProductStatus status = request.status() == null ? ProductStatus.ACTIVE : request.status();
        TaxRate tax = ProductRules.tax(request.tax() == null ? TaxRate.of(ProductRules.STANDARD_RATE_BP) : request.tax());
        String satProductKey = request.satProductKey() == null ? null : sat.requireProductKey(request.satProductKey());
        String satUnitKey = request.satUnitKey() == null ? null : sat.requireUnitKey(request.satUnitKey());
        long price = request.unitPrice() == null ? 0 : request.unitPrice().e4();

        Optional<Product> earlier = findByIdempotencyKey(request.idempotencyKey());
        if (earlier.isPresent()) {
            return new Created(earlier.get(), true);
        }
        UUID id = Uuid7.next();
        int inserted = jdbc.update("""
                INSERT INTO product (id, name, status, unit, idempotency_key, unit_price_e4, tax_factor, tax_rate_bp,
                                     sat_product_key, sat_unit_key)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
                """, id, name, status.code(), request.unit().code(), request.idempotencyKey(), price,
                tax.factor().code(), tax.bp(), satProductKey, satUnitKey);
        if (inserted == 0) {
            // A concurrent call with the same key won the race. Nothing of ours is kept: the rollback undoes it.
            Product winner = findByIdempotencyKey(request.idempotencyKey())
                    .orElseThrow(() -> new IllegalStateException("Idempotency key conflict without a product"));
            markRollbackOnly();
            return new Created(winner, true);
        }
        codes.forEach(code -> insertCode(id, code));
        presentations.forEach(presentation -> insertPresentation(id, presentation));
        if (request.unitPrice() != null) {
            insertPriceHistory(id, null, price, actorId, "created");
        }

        Product product = require(id);
        auditLog.record(new AuditEntry(actorId, "product.created", "product", id, null, snapshot(product)));
        events.publishEvent(new ProductCreated(Uuid7.next(), tenant(), EVENT_SCHEMA_VERSION, id, product.name(),
                product.status().code(), product.unit().code(), codeTexts(product), product.unitPrice().e4(),
                product.tax().factor().code(), product.tax().bp(), Instant.now()));
        publishToFeed(product);
        return new Created(product, false);
    }

    /**
     * Edits a product. Only the fields present change; a list of codes or presentations replaces the old list.
     *
     * @param actorId the user who edits it
     * @param id      the product
     * @param changes what to change
     * @return the product after the change
     * @throws ProductNotFoundException if it does not exist or was deleted
     * @throws InvalidProductException  if the data breaks a rule, or asks to change the base unit
     * @throws DuplicateCodeException   if a code already belongs to another product of the business
     */
    @Transactional
    public Product update(UUID actorId, UUID id, ProductChanges changes) {
        Product before = lockLive(id);
        if (changes.unit() != null && changes.unit() != before.unit()) {
            throw new InvalidProductException("the base unit of a product cannot change (it is "
                    + before.unit().code() + ")");
        }
        String name = changes.name() == null ? before.name() : ProductRules.name(changes.name());
        ProductStatus status = changes.status() == null ? before.status() : changes.status();
        List<ProductCode> codes = changes.codes() == null ? null : ProductRules.codes(changes.codes());
        List<Presentation> presentations = changes.presentations() == null ? null
                : ProductRules.presentations(changes.presentations(), before.unit());
        TaxRate tax = changes.tax() == null ? before.tax() : ProductRules.tax(changes.tax());
        String satProductKey = keyChange(changes.satProductKey(), before.satProductKey(), sat::requireProductKey);
        String satUnitKey = keyChange(changes.satUnitKey(), before.satUnitKey(), sat::requireUnitKey);

        if (codes != null) {
            replaceCodes(id, codes);
        }
        if (presentations != null) {
            jdbc.update("DELETE FROM product_presentation WHERE product_id = ?", id);
            presentations.forEach(presentation -> insertPresentation(id, presentation));
        }
        Product listsApplied = require(id);
        boolean changed = !name.equals(before.name()) || status != before.status() || !tax.equals(before.tax())
                || !java.util.Objects.equals(satProductKey, before.satProductKey())
                || !java.util.Objects.equals(satUnitKey, before.satUnitKey())
                || !Set.copyOf(listsApplied.codes()).equals(Set.copyOf(before.codes()))
                || !Set.copyOf(listsApplied.presentations()).equals(Set.copyOf(before.presentations()));
        if (!changed) {
            // An edit that changes nothing leaves no feed entry, no audit entry and no event.
            return before;
        }
        touch(id, name, status, tax, satProductKey, satUnitKey, false);

        Product after = require(id);
        auditLog.record(new AuditEntry(actorId, "product.updated", "product", id, snapshot(before), snapshot(after)));
        publishUpdated(after);
        publishToFeed(after);
        return after;
    }

    /**
     * Deletes a product logically: it stops appearing in searches, but the row and its codes stay so sales keep
     * pointing at it and the registers learn of the removal through the change feed. Deleting twice is allowed.
     *
     * @param actorId the user who deletes it
     * @param id      the product
     * @throws ProductNotFoundException if it never existed in the business
     */
    @Transactional
    public void delete(UUID actorId, UUID id) {
        Optional<Product> current = lock(id);
        if (current.isEmpty()) {
            throw new ProductNotFoundException(id);
        }
        Product before = current.get();
        if (before.deleted()) {
            return;
        }
        touch(id, before.name(), before.status(), before.tax(), before.satProductKey(), before.satUnitKey(), true);
        Product after = require(id);
        auditLog.record(new AuditEntry(actorId, "product.deleted", "product", id, snapshot(before), snapshot(after)));
        publishUpdated(after);
        publishToFeed(after);
    }

    /**
     * Changes the price of a product (RF-006, RF-008, RF-040). The old and the new price go to the audit log and to
     * the append-only price history, and registers receive the product with its new price. A price equal to the
     * current one changes nothing.
     *
     * @param actorId the user who changes it
     * @param id      the product
     * @param price   the new price per base unit, VAT included
     * @return the product after the change
     * @throws ProductNotFoundException if it does not exist or was deleted
     */
    @Transactional
    public Product changePrice(UUID actorId, UUID id, UnitPrice price) {
        Product before = lockLive(id);
        if (before.unitPrice().e4() == price.e4()) {
            return before;
        }
        setPrice(id, before.unitPrice().e4(), price.e4(), actorId, "panel");
        Product after = require(id);
        auditLog.record(new AuditEntry(actorId, "product.price_change", "product", id,
                priceValue(before.unitPrice().e4()), priceValue(price.e4())));
        publishUpdated(after);
        publishToFeed(after);
        return after;
    }

    /**
     * Gives the price the catalog holds for a live product, so a price change from a register is compared with it
     * (RF-022, ADR 0053). Runs in the transaction of the caller.
     *
     * @param id the product
     * @return the price in ten-thousandths of a peso, or empty if the product does not exist or was deleted
     */
    Optional<Long> livePrice(UUID id) {
        return jdbc.query("SELECT unit_price_e4 FROM product WHERE id = ? AND deleted_at IS NULL",
                (rs, n) -> rs.getLong(1), id).stream().findFirst();
    }

    /**
     * Applies to the catalog a price that a register charged (E1-40) and republishes the product, so the other
     * registers learn it. The audit entry is written by the recorder of the operation. Does nothing when the product
     * is not in the catalog or was deleted: the change stays in its own log.
     *
     * @param id        the product
     * @param price     the price the register set
     * @param changedBy the user of the register who changed it
     */
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    void applyRegisterPrice(UUID id, long price, UUID changedBy) {
        Optional<Product> locked = lock(id);
        if (locked.isEmpty() || locked.get().deleted() || locked.get().unitPrice().e4() == price) {
            return;
        }
        setPrice(id, locked.get().unitPrice().e4(), price, changedBy, "register");
        Product after = require(id);
        publishUpdated(after);
        publishToFeed(after);
    }

    /**
     * Finds a live product.
     *
     * @param id the product
     * @return the product with its codes and presentations
     * @throws ProductNotFoundException if it does not exist in the business or was deleted
     */
    @Transactional(readOnly = true)
    public Product get(UUID id) {
        Product product = require(id);
        if (product.deleted()) {
            throw new ProductNotFoundException(id);
        }
        return product;
    }

    /**
     * Searches the products of the business, ordered by name.
     *
     * @param text  words that the name contains (ignoring case and accents) or an exact code; {@code null} for all
     * @param page  the page number, starting at 0
     * @param size  products per page, from 1 to 100
     * @return the page and the total of matches
     * @throws InvalidProductException if the page or the size are out of range
     */
    @Transactional(readOnly = true)
    public ProductPage search(String text, int page, int size) {
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE) {
            throw new InvalidProductException("page must be 0 or more and size from 1 to " + MAX_PAGE_SIZE);
        }
        String term = text == null ? "" : text.strip();
        List<Object> filters = new ArrayList<>();
        String where = "p.tenant_id = current_tenant_id() AND p.deleted_at IS NULL";
        if (!term.isEmpty()) {
            where += " " + """
                    AND (p.search_text LIKE '%' || catalog_search_key(?) || '%' ESCAPE '\\'
                          OR EXISTS (SELECT 1 FROM product_code c
                                     WHERE c.tenant_id = p.tenant_id AND c.product_id = p.id AND c.code = ?))
                    """;
            filters.add(escapeLike(term));
            filters.add(term);
        }
        return pageOf(where, filters, page, size);
    }

    /**
     * Lists the live products that cannot be invoiced yet because a SAT key is missing (RF-004), ordered by name.
     *
     * @param page the page number, starting at 0
     * @param size products per page, from 1 to 100
     * @return the page and the total of products pending
     * @throws InvalidProductException if the page or the size are out of range
     */
    @Transactional(readOnly = true)
    public ProductPage fiscalPending(int page, int size) {
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE) {
            throw new InvalidProductException("page must be 0 or more and size from 1 to " + MAX_PAGE_SIZE);
        }
        return pageOf("p.tenant_id = current_tenant_id() AND p.deleted_at IS NULL"
                + " AND (p.sat_product_key IS NULL OR p.sat_unit_key IS NULL)", List.of(), page, size);
    }

    private ProductPage pageOf(String where, List<Object> filters, int page, int size) {
        Long total = jdbc.queryForObject("SELECT count(*) FROM product p WHERE " + where, Long.class, filters.toArray());
        List<Object> pageArguments = new ArrayList<>(filters);
        pageArguments.add(size);
        pageArguments.add((long) page * size);
        List<ProductRow> rows = jdbc.query("SELECT " + PRODUCT_COLUMNS + " FROM product p WHERE " + where
                + " ORDER BY p.search_text, p.id LIMIT ? OFFSET ?", (rs, n) -> readRow(rs), pageArguments.toArray());
        return new ProductPage(assemble(rows), page, size, total == null ? 0 : total);
    }

    /**
     * Finds the live product that a code points at.
     *
     * @param code the exact code
     * @return the product, or empty when no live product of the business has it
     */
    @Transactional(readOnly = true)
    public Optional<Product> findByCode(String code) {
        List<ProductRow> rows = jdbc.query("""
                SELECT %s FROM product p JOIN product_code c ON c.tenant_id = p.tenant_id AND c.product_id = p.id
                WHERE c.code = ? AND p.deleted_at IS NULL
                """.formatted(PRODUCT_COLUMNS), (rs, n) -> readRow(rs), code);
        return assemble(rows).stream().findFirst();
    }

    // -- writes ------------------------------------------------------------------------------------------------

    private void touch(UUID id, String name, ProductStatus status, TaxRate tax, String satProductKey,
                       String satUnitKey, boolean delete) {
        jdbc.update("""
                UPDATE product SET name = ?, status = ?, tax_factor = ?, tax_rate_bp = ?, sat_product_key = ?,
                                   sat_unit_key = ?, updated_at = now(),
                                   deleted_at = CASE WHEN ? THEN now() ELSE deleted_at END
                WHERE id = ?
                """, name, status.code(), tax.factor().code(), tax.bp(), satProductKey, satUnitKey, delete, id);
    }

    private void setPrice(UUID id, long previous, long current, UUID actorId, String source) {
        jdbc.update("UPDATE product SET unit_price_e4 = ?, updated_at = now() WHERE id = ?", current, id);
        insertPriceHistory(id, previous, current, actorId, source);
    }

    private void insertPriceHistory(UUID id, Long previous, long current, UUID actorId, String source) {
        jdbc.update("""
                INSERT INTO product_price_history (id, product_id, previous_unit_price_e4, new_unit_price_e4, changed_by, source)
                VALUES (?, ?, ?, ?, ?, ?)
                """, Uuid7.next(), id, previous, current, actorId, source);
    }

    /** A key left as it is ({@code null}), cleared ({@code ""}), or checked against the reviewed SAT file. */
    private static String keyChange(String requested, String current, java.util.function.UnaryOperator<String> check) {
        if (requested == null) {
            return current;
        }
        return requested.isEmpty() ? null : check.apply(requested);
    }

    private void insertCode(UUID productId, ProductCode code) {
        int written = jdbc.update("""
                INSERT INTO product_code (code, product_id, kind) VALUES (?, ?, ?)
                ON CONFLICT (tenant_id, code) DO UPDATE SET kind = EXCLUDED.kind
                WHERE product_code.product_id = EXCLUDED.product_id
                """, code.code(), productId, code.kind().code());
        if (written == 0) {
            UUID owner = jdbc.query("SELECT product_id FROM product_code WHERE code = ?",
                    (rs, n) -> rs.getObject("product_id", UUID.class), code.code()).stream().findFirst().orElse(null);
            throw new DuplicateCodeException(code.code(), owner);
        }
    }

    private void replaceCodes(UUID productId, List<ProductCode> codes) {
        String[] kept = codes.stream().map(ProductCode::code).toArray(String[]::new);
        jdbc.update(connection -> {
            var statement = connection.prepareStatement(
                    "DELETE FROM product_code WHERE product_id = ? AND NOT (code = ANY (?))");
            statement.setObject(1, productId);
            statement.setArray(2, connection.createArrayOf("text", kept));
            return statement;
        });
        codes.forEach(code -> insertCode(productId, code));
    }

    private void insertPresentation(UUID productId, Presentation presentation) {
        jdbc.update("INSERT INTO product_presentation (id, product_id, name, base_quantity_milli) VALUES (?, ?, ?, ?)",
                Uuid7.next(), productId, presentation.name(), presentation.baseQuantity().milli());
    }

    private void markRollbackOnly() {
        org.springframework.transaction.interceptor.TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();
    }

    private void publishUpdated(Product product) {
        events.publishEvent(new ProductUpdated(Uuid7.next(), tenant(), EVENT_SCHEMA_VERSION, product.id(), product.name(),
                product.status().code(), product.unit().code(), codeTexts(product), product.deleted(),
                product.unitPrice().e4(), product.tax().factor().code(), product.tax().bp(), Instant.now()));
    }

    /**
     * Announces the product to the registers in the transaction that changed it (ADR 0048). A deleted or inactive
     * product leaves the register as a tombstone, because the contract has no status: the register sells what it has.
     */
    private void publishToFeed(Product product) {
        if (product.deleted() || product.status() == ProductStatus.INACTIVE) {
            feed.publishDeletion(ChangePublisher.PRODUCT, product.id());
            return;
        }
        ObjectNode payload = json.createObjectNode();
        payload.put("name", product.name());
        payload.put("baseUnit", product.unit().code());
        payload.put("unitPriceE4", product.unitPrice().e4());
        payload.put("taxFactor", product.tax().factor().code());
        payload.put("taxRateBp", product.tax().bp());
        var barcodes = payload.putArray("barcodes");
        product.codes().forEach(code -> barcodes.add(code.code()));
        feed.publish(ChangePublisher.PRODUCT, product.id(), payload);
    }

    // -- reads -------------------------------------------------------------------------------------------------

    /** A product row before its codes and presentations are attached. */
    private record ProductRow(UUID id, String name, ProductStatus status, Unit unit, Instant deletedAt,
                              UnitPrice unitPrice, TaxRate tax, String satProductKey, String satUnitKey,
                              Instant createdAt, Instant updatedAt) {
    }

    private ProductRow readRow(java.sql.ResultSet rs) throws java.sql.SQLException {
        Timestamp deleted = rs.getTimestamp("deleted_at");
        return new ProductRow(rs.getObject("id", UUID.class), rs.getString("name"),
                ProductStatus.fromCode(rs.getString("status")).orElseThrow(), Unit.fromCode(rs.getString("unit")),
                deleted == null ? null : deleted.toInstant(), new UnitPrice(rs.getLong("unit_price_e4")),
                new TaxRate(TaxFactor.fromCode(rs.getString("tax_factor")), rs.getInt("tax_rate_bp")),
                rs.getString("sat_product_key"), rs.getString("sat_unit_key"),
                rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant());
    }

    private Product require(UUID id) {
        List<ProductRow> rows = jdbc.query("SELECT " + PRODUCT_COLUMNS + " FROM product p WHERE p.id = ?",
                (rs, n) -> readRow(rs), id);
        return assemble(rows).stream().findFirst().orElseThrow(() -> new ProductNotFoundException(id));
    }

    private Optional<Product> findByIdempotencyKey(UUID key) {
        List<ProductRow> rows = jdbc.query("SELECT " + PRODUCT_COLUMNS + " FROM product p WHERE p.idempotency_key = ?",
                (rs, n) -> readRow(rs), key);
        return assemble(rows).stream().findFirst();
    }

    private Optional<Product> lock(UUID id) {
        // The row lock serializes two edits of the same product, so each audit entry shows a consistent "before".
        jdbc.query("SELECT 1 FROM product WHERE id = ? FOR UPDATE", (rs, n) -> 1, id);
        return jdbc.query("SELECT " + PRODUCT_COLUMNS + " FROM product p WHERE p.id = ?", (rs, n) -> readRow(rs), id)
                .stream().findFirst().map(row -> assemble(List.of(row)).get(0));
    }

    private Product lockLive(UUID id) {
        Product product = lock(id).orElseThrow(() -> new ProductNotFoundException(id));
        if (product.deleted()) {
            throw new ProductNotFoundException(id);
        }
        return product;
    }

    /** Attaches the codes and presentations of all the rows with one query each, never one per product. */
    private List<Product> assemble(List<ProductRow> rows) {
        if (rows.isEmpty()) {
            return List.of();
        }
        UUID[] ids = rows.stream().map(ProductRow::id).toArray(UUID[]::new);
        Map<UUID, List<ProductCode>> codes = new HashMap<>();
        jdbc.query(connection -> {
            var statement = connection.prepareStatement(
                    "SELECT product_id, code, kind FROM product_code WHERE product_id = ANY (?) ORDER BY created_at, code");
            statement.setArray(1, uuidArray(connection, ids));
            return statement;
        }, rs -> {
            codes.computeIfAbsent(rs.getObject("product_id", UUID.class), key -> new ArrayList<>())
                    .add(new ProductCode(rs.getString("code"), CodeKind.fromCode(rs.getString("kind")).orElseThrow()));
        });
        Map<UUID, List<Presentation>> presentations = new HashMap<>();
        jdbc.query(connection -> {
            var statement = connection.prepareStatement("""
                    SELECT product_id, name, base_quantity_milli FROM product_presentation
                    WHERE product_id = ANY (?) ORDER BY base_quantity_milli, name
                    """);
            statement.setArray(1, uuidArray(connection, ids));
            return statement;
        }, rs -> {
            UUID productId = rs.getObject("product_id", UUID.class);
            Unit unit = rows.stream().filter(row -> row.id().equals(productId)).findFirst().orElseThrow().unit();
            presentations.computeIfAbsent(productId, key -> new ArrayList<>())
                    .add(new Presentation(rs.getString("name"), new Quantity(rs.getLong("base_quantity_milli"), unit)));
        });
        return rows.stream().map(row -> new Product(row.id(), row.name(), row.status(), row.unit(),
                codes.getOrDefault(row.id(), List.of()), presentations.getOrDefault(row.id(), List.of()),
                row.deletedAt(), row.unitPrice(), row.tax(), row.satProductKey(), row.satUnitKey(),
                row.createdAt(), row.updatedAt())).toList();
    }

    private static Array uuidArray(java.sql.Connection connection, UUID[] ids) throws java.sql.SQLException {
        return connection.createArrayOf("uuid", ids);
    }

    // -- helpers -----------------------------------------------------------------------------------------------

    private static UUID tenant() {
        return TenantContext.current().orElseThrow(() -> new IllegalStateException("No business is pinned"));
    }

    private static List<String> codeTexts(Product product) {
        return product.codes().stream().map(ProductCode::code).toList();
    }

    /** The audit value of a product: ids and business values only, no personal data. */
    private String snapshot(Product product) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("name", product.name());
        value.put("status", product.status().code());
        value.put("unit", product.unit().code());
        value.put("deleted", product.deleted());
        value.put("unitPriceE4", product.unitPrice().e4());
        value.put("taxFactor", product.tax().factor().code());
        value.put("taxRateBp", product.tax().bp());
        value.put("satProductKey", product.satProductKey());
        value.put("satUnitKey", product.satUnitKey());
        value.put("codes", product.codes().stream().map(code -> code.kind().code() + ":" + code.code()).toList());
        value.put("presentations", product.presentations().stream()
                .collect(Collectors.toMap(Presentation::name, p -> p.baseQuantity().milli(), (a, b) -> a, LinkedHashMap::new)));
        return json.writeValueAsString(value);
    }

    /** Ids and prices only, as the audit log asks. */
    private String priceValue(long unitPriceE4) {
        return json.writeValueAsString(Map.of("unitPriceE4", unitPriceE4));
    }

    private static String escapeLike(String term) {
        return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }
}
