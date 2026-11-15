package io.github.mauriciotorrez1.pos.core.catalog;

import io.github.mauriciotorrez1.pos.core.reporting.AuditEntry;
import io.github.mauriciotorrez1.pos.core.reporting.AuditLog;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import io.github.mauriciotorrez1.pos.money.MoneyException;
import io.github.mauriciotorrez1.pos.money.TaxRate;
import io.github.mauriciotorrez1.pos.money.Unit;
import io.github.mauriciotorrez1.pos.money.UnitPrice;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Loads products from a CSV file, such as the one Eleventa exports (RF-005, ADR 0062). Each row is checked and saved
 * on its own, so two bad rows out of a thousand leave 998 products and a report of the two. A product is known by its
 * code: loading the same file again creates nothing new.
 */
@Service
public class CatalogImport {

    /** A file with more rows than this is not a catalog of a store, and is refused before anything is read. */
    static final int MAX_ROWS = 20_000;

    private static final Map<String, List<String>> TITLES = Map.of(
            "code", List.of("codigo", "codigo del producto", "codigo de producto", "codigo de barras", "clave", "sku",
                    "barcode", "codigo barras"),
            "name", List.of("descripcion", "producto", "nombre", "nombre del producto", "articulo",
                    "descripcion del producto"),
            "price", List.of("precio venta", "precio de venta", "precio publico", "precio 1", "precio"),
            "unit", List.of("unidad", "tipo de venta", "unidad de medida", "u/m"),
            "tax", List.of("iva", "impuesto", "tasa de iva"),
            "satProductKey", List.of("clave sat", "clave producto sat", "claveprodserv", "clave sat del producto"),
            "satUnitKey", List.of("clave unidad sat", "clave de unidad sat", "claveunidad", "unidad sat"));

    /** Columns that belong to the ledger of the register, not to the catalog of the server: read, and left out. */
    private static final Set<String> NOT_LOADED = Set.of("costo con iva", "costo sin iva", "costo", "precio costo",
            "precio de costo", "existencia", "existencias", "inventario", "cantidad", "stock");

    private static final Map<String, Unit> UNITS = Map.ofEntries(
            Map.entry("pieza", Unit.PIECE), Map.entry("piezas", Unit.PIECE), Map.entry("pza", Unit.PIECE),
            Map.entry("pz", Unit.PIECE), Map.entry("unidad", Unit.PIECE), Map.entry("unitario", Unit.PIECE),
            Map.entry("kg", Unit.KILOGRAM), Map.entry("kilo", Unit.KILOGRAM), Map.entry("kilos", Unit.KILOGRAM),
            Map.entry("kilogramo", Unit.KILOGRAM), Map.entry("granel", Unit.KILOGRAM),
            Map.entry("m", Unit.METER), Map.entry("mt", Unit.METER), Map.entry("mts", Unit.METER),
            Map.entry("metro", Unit.METER), Map.entry("metros", Unit.METER),
            Map.entry("l", Unit.LITER), Map.entry("lt", Unit.LITER), Map.entry("lts", Unit.LITER),
            Map.entry("litro", Unit.LITER), Map.entry("litros", Unit.LITER));

    private final ProductCatalog catalog;
    private final SatCatalog sat;
    private final AuditLog auditLog;
    private final TransactionTemplate transaction;

    CatalogImport(ProductCatalog catalog, SatCatalog sat, AuditLog auditLog, TransactionTemplate transaction) {
        this.catalog = catalog;
        this.sat = sat;
        this.auditLog = auditLog;
        this.transaction = transaction;
    }

    /** A row that was not loaded, with the line of the file and why, in Spanish for the owner. */
    public record RowError(int line, String reason) {
    }

    /**
     * What an import did.
     *
     * @param rowsRead       the rows of the file, without the titles
     * @param created        the products that were created, or that would be on a dry run
     * @param alreadyThere   the rows whose code already belongs to a product, which were left as they are
     * @param pricesSkipped  the products created without their price, because who imported may not set prices
     * @param invalid        the rows that were not loaded
     * @param ignoredColumns the titles of the file that the catalog of the server does not keep
     * @param dryRun         whether nothing was saved
     */
    public record Report(int rowsRead, int created, int alreadyThere, int pricesSkipped, List<RowError> invalid,
                         List<String> ignoredColumns, boolean dryRun) {
    }

    /** Thrown when the file cannot be read at all: it is empty, too long, or lacks a required column. */
    public static final class UnreadableFileException extends RuntimeException {
        /** @param message why the file cannot be read, in Spanish for the owner */
        public UnreadableFileException(String message) {
            super(message);
        }
    }

    /**
     * Loads the products of a CSV file.
     *
     * @param actorId      who imports, for the audit entries
     * @param maySetPrices whether that person may set prices (RF-008); if not, the products are created without one
     * @param csv          the text of the file, with the titles in its first row
     * @param dryRun       whether to only check the file and say what would happen
     * @return what was loaded and what was not
     * @throws UnreadableFileException if the file is empty, too long, or lacks the code, the name or the price
     */
    public Report load(UUID actorId, boolean maySetPrices, String csv, boolean dryRun) {
        List<List<String>> table = CsvTable.parse(csv);
        if (table.isEmpty()) {
            throw new UnreadableFileException("El archivo está vacío.");
        }
        if (table.size() - 1 > MAX_ROWS) {
            throw new UnreadableFileException("El archivo trae más de " + MAX_ROWS + " filas. Divídelo en partes.");
        }
        List<String> header = table.get(0).stream().map(CatalogImport::normalize).toList();
        Map<String, Integer> columns = new HashMap<>();
        TITLES.forEach((field, aliases) -> {
            for (int index = 0; index < header.size(); index++) {
                if (aliases.contains(header.get(index))) {
                    columns.putIfAbsent(field, index);
                }
            }
        });
        if (!columns.containsKey("code") || !columns.containsKey("name") || !columns.containsKey("price")) {
            throw new UnreadableFileException("Faltan columnas en la primera fila. Escribe los títulos así: "
                    + "Código del producto, Nombre del producto, Precio de venta.");
        }
        List<String> ignored = table.get(0).stream().filter(title -> NOT_LOADED.contains(normalize(title))).toList();

        int created = 0;
        int alreadyThere = 0;
        int pricesSkipped = 0;
        List<RowError> invalid = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (int index = 1; index < table.size(); index++) {
            int line = index + 1;
            List<String> row = table.get(index);
            String code = cell(row, columns.get("code"));
            try {
                NewProduct product = read(row, columns, maySetPrices);
                if (!seen.add(code)) {
                    invalid.add(new RowError(line, "El código " + code + " está repetido en el archivo. Solo se carga la primera vez."));
                } else if (catalog.findByCode(code).isPresent()) {
                    alreadyThere++;
                } else {
                    if (!dryRun && catalog.create(actorId, product).replayed()) {
                        alreadyThere++;
                        continue;
                    }
                    created++;
                    if (!maySetPrices) {
                        pricesSkipped++;
                    }
                }
            } catch (InvalidProductException | MoneyException | IllegalArgumentException e) {
                invalid.add(new RowError(line, describe(e)));
            } catch (DuplicateCodeException e) {
                alreadyThere++;
            }
        }
        Report report = new Report(table.size() - 1, created, alreadyThere, pricesSkipped, List.copyOf(invalid), ignored,
                dryRun);
        if (!dryRun && created > 0) {
            transaction.executeWithoutResult(status -> auditLog.record(new AuditEntry(actorId, "catalog.imported",
                    "catalog_import", Uuid7.next(), null, "{\"rows\":" + report.rowsRead() + ",\"created\":"
                    + report.created() + ",\"alreadyThere\":" + report.alreadyThere() + ",\"invalid\":"
                    + report.invalid().size() + "}")));
        }
        return report;
    }

    private NewProduct read(List<String> row, Map<String, Integer> columns, boolean maySetPrices) {
        String code = cell(row, columns.get("code"));
        if (code.isEmpty()) {
            throw new IllegalArgumentException("El código está vacío.");
        }
        String name = ProductRules.name(cell(row, columns.get("name")));
        String unitText = normalize(cell(row, columns.get("unit")));
        Unit unit = unitText.isEmpty() ? Unit.PIECE : UNITS.get(unitText);
        if (unit == null) {
            throw new IllegalArgumentException("No se entiende la unidad «" + cell(row, columns.get("unit")) + "».");
        }
        String priceText = cell(row, columns.get("price")).replaceAll("[\\s$,]", "");
        UnitPrice price = UnitPrice.parse(priceText);
        if (price.e4() <= 0) {
            throw new IllegalArgumentException("El precio de venta debe ser mayor que cero.");
        }
        TaxRate tax = ProductRules.tax(readTax(cell(row, columns.get("tax"))));
        String satProductKey = cell(row, columns.get("satProductKey"));
        String satUnitKey = cell(row, columns.get("satUnitKey"));
        List<ProductCode> codes = ProductRules.codes(List.of(new ProductCode(code, CodeKind.BARCODE)));
        return new NewProduct(idempotencyKeyOf(code), name, ProductStatus.ACTIVE, unit, codes, List.of(),
                maySetPrices ? price : null, tax,
                satProductKey.isEmpty() ? null : sat.requireProductKey(satProductKey),
                satUnitKey.isEmpty() ? null : sat.requireUnitKey(satUnitKey));
    }

    /** The same code always gives the same key, so a file loaded twice at the same time creates each product once. */
    private static UUID idempotencyKeyOf(String code) {
        return UUID.nameUUIDFromBytes(("catalog-import:" + code).getBytes(StandardCharsets.UTF_8));
    }

    private static TaxRate readTax(String text) {
        String value = normalize(text).replace("%", "").strip();
        if (value.isEmpty()) {
            return TaxRate.of(ProductRules.STANDARD_RATE_BP);
        }
        if (value.equals("exento")) {
            return TaxRate.EXEMPT;
        }
        try {
            return TaxRate.of(new java.math.BigDecimal(value).movePointRight(2).intValueExact());
        } catch (ArithmeticException | NumberFormatException e) {
            throw new IllegalArgumentException("No se entiende el IVA «" + text + "». Usa 16, 8, 0 o exento.");
        }
    }

    private static String describe(RuntimeException e) {
        if (e instanceof MoneyException) {
            return "El precio de venta no es un número válido: usa hasta 4 decimales, sin letras.";
        }
        return e.getMessage() == null ? "La fila no es válida." : e.getMessage();
    }

    private static String cell(List<String> row, Integer column) {
        return column == null || column >= row.size() ? "" : row.get(column).strip();
    }

    private static String normalize(String text) {
        return Normalizer.normalize(text, Normalizer.Form.NFD).replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT)
                .replaceAll("\\s+", " ").strip();
    }
}
