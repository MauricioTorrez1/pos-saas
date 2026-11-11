package io.github.mauriciotorrez1.pos.core.catalog.web;

import io.github.mauriciotorrez1.pos.core.catalog.CodeKind;
import io.github.mauriciotorrez1.pos.core.catalog.InvalidProductException;
import io.github.mauriciotorrez1.pos.core.catalog.NewProduct;
import io.github.mauriciotorrez1.pos.core.catalog.PresentationDraft;
import io.github.mauriciotorrez1.pos.core.catalog.Product;
import io.github.mauriciotorrez1.pos.core.catalog.ProductCatalog;
import io.github.mauriciotorrez1.pos.core.catalog.ProductChanges;
import io.github.mauriciotorrez1.pos.core.catalog.ProductCode;
import io.github.mauriciotorrez1.pos.core.catalog.ProductPage;
import io.github.mauriciotorrez1.pos.core.catalog.ProductStatus;
import io.github.mauriciotorrez1.pos.core.identity.UserDirectory;
import io.github.mauriciotorrez1.pos.core.identity.AppUser;
import io.github.mauriciotorrez1.pos.money.MoneyException;
import io.github.mauriciotorrez1.pos.money.TaxFactor;
import io.github.mauriciotorrez1.pos.money.TaxRate;
import io.github.mauriciotorrez1.pos.money.Unit;
import io.github.mauriciotorrez1.pos.money.UnitPrice;
import io.github.mauriciotorrez1.pos.security.Permission;
import java.net.URI;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * The products of the catalog (RF-001, RF-002). Who may call each endpoint is decided by the permission table
 * (ADR 0042): everyone reads, the owner and the manager write. Prices and taxes are not here (F0-17).
 */
@RestController
@RequestMapping("/products")
class ProductsController {

    private static final String IDEMPOTENCY_KEY = "Idempotency-Key";

    private final ProductCatalog catalog;
    private final UserDirectory directory;

    ProductsController(ProductCatalog catalog, UserDirectory directory) {
        this.catalog = catalog;
        this.directory = directory;
    }

    /**
     * Creates a product. The {@code Idempotency-Key} header makes a retry safe: the same key returns the product of
     * the first call, with 200 instead of 201.
     *
     * @param key     a UUID chosen by the caller for this creation
     * @param request the product
     * @param jwt     the token of the caller
     * @return 201 with the product, or 200 if the key was already used
     */
    @PostMapping
    ResponseEntity<ProductView> create(@RequestHeader(name = IDEMPOTENCY_KEY, required = false) String key,
                                       @RequestBody ProductRequest request, @AuthenticationPrincipal Jwt jwt) {
        AppUser actor = actorOf(jwt);
        if (request.unitPrice() != null && !Permission.PRICE_CHANGE.grantedTo(actor.role())) {
            // Setting a price is a price change (RF-008): only who may change prices may create a product with one.
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only the owner sets a price");
        }
        ProductCatalog.Created created = catalog.create(actor.id(), new NewProduct(idempotencyKey(key),
                request.name(), status(request.status()), unit(request.unit()), codes(request.codes()),
                drafts(request.presentations()), request.unitPrice() == null ? null : price(request.unitPrice()),
                tax(request.taxFactor(), request.taxRateBp()), request.satProductKey(), request.satUnitKey()));
        ProductView view = ProductView.of(created.product());
        if (created.replayed()) {
            return ResponseEntity.ok(view);
        }
        return ResponseEntity.created(URI.create("/products/" + view.id())).body(view);
    }

    /**
     * Searches products by name or by exact code, ordered by name.
     *
     * @param q    words of the name (any case, any accent) or an exact code; omitted for every product
     * @param page the page number, from 0
     * @param size products per page, from 1 to 100
     * @return the page
     */
    @GetMapping
    PageView list(@RequestParam(required = false) String q, @RequestParam(defaultValue = "0") int page,
                  @RequestParam(defaultValue = "20") int size) {
        ProductPage result = catalog.search(q, page, size);
        return new PageView(result.items().stream().map(ProductView::of).toList(), result.page(), result.size(),
                result.total());
    }

    /**
     * Reads one product.
     *
     * @param id the product
     * @return the product, or 404 if it does not exist or was deleted
     */
    @GetMapping("/{id}")
    ProductView get(@PathVariable UUID id) {
        return ProductView.of(catalog.get(id));
    }

    /**
     * Edits a product. Fields left out stay as they are; a list sent replaces the old one.
     *
     * @param id      the product
     * @param request the changes
     * @param jwt     the token of the caller
     * @return the product after the change
     */
    @PatchMapping("/{id}")
    ProductView update(@PathVariable UUID id, @RequestBody ProductRequest request, @AuthenticationPrincipal Jwt jwt) {
        if (request.unitPrice() != null) {
            throw new InvalidProductException("the price changes with PATCH /products/{id}/price");
        }
        ProductChanges changes = new ProductChanges(request.name(),
                request.status() == null ? null : status(request.status()),
                request.unit() == null ? null : unit(request.unit()),
                request.codes() == null ? null : codes(request.codes()),
                request.presentations() == null ? null : drafts(request.presentations()),
                tax(request.taxFactor(), request.taxRateBp()), request.satProductKey(), request.satUnitKey());
        return ProductView.of(catalog.update(actorOf(jwt).id(), id, changes));
    }

    /**
     * Changes the price of a product, VAT included. Only who holds {@code price.change} gets here (RF-008); the
     * old and the new price are audited (RF-040) and the registers receive the product with the new price.
     *
     * @param id      the product
     * @param request the new price
     * @param jwt     the token of the caller
     * @return the product after the change
     */
    @PatchMapping("/{id}/price")
    ProductView changePrice(@PathVariable UUID id, @RequestBody PriceRequest request, @AuthenticationPrincipal Jwt jwt) {
        if (request.unitPrice() == null) {
            throw new InvalidProductException("unitPrice is required");
        }
        return ProductView.of(catalog.changePrice(actorOf(jwt).id(), id, price(request.unitPrice())));
    }

    /**
     * Deletes a product logically. Repeating the call is harmless.
     *
     * @param id  the product
     * @param jwt the token of the caller
     */
    @DeleteMapping("/{id}")
    @org.springframework.web.bind.annotation.ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        catalog.delete(actorOf(jwt).id(), id);
    }

    private AppUser actorOf(Jwt jwt) {
        return directory.findActiveBySubject(jwt.getSubject())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.FORBIDDEN));
    }

    private static UnitPrice price(String text) {
        try {
            return UnitPrice.parse(text);
        } catch (MoneyException e) {
            throw new InvalidProductException("unitPrice must be digits with up to 4 decimals: " + e.getMessage());
        }
    }

    /** The tax of a request: nothing sent means nothing changes (or 16% on creation, decided by the catalog). */
    private static TaxRate tax(String factor, Integer rateBp) {
        if (factor == null && rateBp == null) {
            return null;
        }
        try {
            TaxFactor parsed = factor == null ? TaxFactor.RATE : TaxFactor.fromCode(factor);
            return new TaxRate(parsed, rateBp == null ? (parsed == TaxFactor.RATE ? 1600 : 0) : rateBp);
        } catch (MoneyException e) {
            throw new InvalidProductException("tax must be a rate of 16%, 8% or 0%, or exempt without a rate");
        }
    }

    private static UUID idempotencyKey(String key) {
        if (key == null || key.isBlank()) {
            throw new InvalidProductException("the " + IDEMPOTENCY_KEY + " header is required");
        }
        try {
            return UUID.fromString(key.strip());
        } catch (IllegalArgumentException e) {
            throw new InvalidProductException("the " + IDEMPOTENCY_KEY + " header must be a UUID");
        }
    }

    private static Unit unit(String code) {
        try {
            return Unit.fromCode(code == null ? "" : code);
        } catch (MoneyException e) {
            throw new InvalidProductException("unit must be piece, meter, kilogram or liter");
        }
    }

    private static ProductStatus status(String code) {
        if (code == null) {
            return null;
        }
        return ProductStatus.fromCode(code).orElseThrow(() -> new InvalidProductException("status must be active or inactive"));
    }

    private static List<ProductCode> codes(List<CodeRequest> codes) {
        if (codes == null) {
            return null;
        }
        return codes.stream().map(code -> new ProductCode(code.code(),
                code.kind() == null ? CodeKind.BARCODE : CodeKind.fromCode(code.kind())
                        .orElseThrow(() -> new InvalidProductException("code kind must be barcode or alternate")))).toList();
    }

    private static List<PresentationDraft> drafts(List<PresentationRequest> presentations) {
        if (presentations == null) {
            return null;
        }
        return presentations.stream().map(p -> new PresentationDraft(p.name(), p.baseQuantity())).toList();
    }

    /**
     * Body of {@code POST /products} and {@code PATCH /products/{id}}.
     *
     * @param name          the name
     * @param unit          {@code piece}, {@code meter}, {@code kilogram} or {@code liter}; required on creation
     * @param status        {@code active} (default) or {@code inactive}
     * @param codes         the codes; on PATCH it replaces the whole list
     * @param presentations the bulk presentations; on PATCH it replaces the whole list
     * @param unitPrice     the price with VAT included, such as {@code "116.0000"}; only on creation and only for
     *                      who may change prices (later changes use {@code PATCH /products/{id}/price})
     * @param taxFactor     {@code rate} (default) or {@code exempt}
     * @param taxRateBp     the rate in basis points: 1600 (default), 800 or 0
     * @param satProductKey the SAT {@code c_ClaveProdServ} key; {@code ""} on PATCH clears it
     * @param satUnitKey    the SAT {@code c_ClaveUnidad} key; {@code ""} on PATCH clears it
     */
    record ProductRequest(String name, String unit, String status, List<CodeRequest> codes,
                          List<PresentationRequest> presentations, String unitPrice, String taxFactor,
                          Integer taxRateBp, String satProductKey, String satUnitKey) {
    }

    /**
     * Body of {@code PATCH /products/{id}/price}.
     *
     * @param unitPrice the new price per base unit with VAT included, with up to 4 decimals
     */
    record PriceRequest(String unitPrice) {
    }

    /**
     * A code in a request.
     *
     * @param code the code
     * @param kind {@code barcode} (default) or {@code alternate}
     */
    record CodeRequest(String code, String kind) {
    }

    /**
     * A presentation in a request.
     *
     * @param name         its name, such as {@code roll}
     * @param baseQuantity base unit it holds, as text with up to 3 decimals: {@code "100.000"}
     */
    record PresentationRequest(String name, String baseQuantity) {
    }

    /**
     * A product in an answer. Quantities are text with 3 decimals so no client rounds them.
     *
     * @param id            the product id
     * @param name          the name
     * @param status        {@code active} or {@code inactive}
     * @param unit          the base unit
     * @param unitKind      what the unit measures: count, weight, length or volume
     * @param codes         the codes
     * @param presentations the bulk presentations
     * @param unitPrice     the price per base unit with VAT included, with 4 decimals
     * @param taxFactor     {@code rate} or {@code exempt}
     * @param taxRateBp     the VAT rate in basis points
     * @param satProductKey the SAT product key, or {@code null}
     * @param satUnitKey    the SAT unit key, or {@code null}
     * @param invoiceable   whether both SAT keys are set, so an invoice can be issued (RF-004)
     * @param createdAt     when it was created
     * @param updatedAt     when it last changed
     */
    record ProductView(UUID id, String name, String status, String unit, String unitKind, List<CodeView> codes,
                       List<PresentationView> presentations, String unitPrice, String taxFactor, int taxRateBp,
                       String satProductKey, String satUnitKey, boolean invoiceable, Instant createdAt,
                       Instant updatedAt) {

        static ProductView of(Product product) {
            return new ProductView(product.id(), product.name(), product.status().code(), product.unit().code(),
                    product.unitKind().code(),
                    product.codes().stream().map(code -> new CodeView(code.code(), code.kind().code())).toList(),
                    product.presentations().stream()
                            .map(p -> new PresentationView(p.name(), milliText(p.baseQuantity().milli()))).toList(),
                    priceText(product.unitPrice().e4()), product.tax().factor().code(), product.tax().bp(),
                    product.satProductKey(), product.satUnitKey(), product.invoiceable(), product.createdAt(),
                    product.updatedAt());
        }

        private static String priceText(long e4) {
            return "%d.%04d".formatted(e4 / 10_000, e4 % 10_000);
        }

        private static String milliText(long milli) {
            return "%d.%03d".formatted(milli / 1000, milli % 1000);
        }
    }

    /**
     * A code in an answer.
     *
     * @param code the code
     * @param kind {@code barcode} or {@code alternate}
     */
    record CodeView(String code, String kind) {
    }

    /**
     * A presentation in an answer.
     *
     * @param name         its name
     * @param baseQuantity base unit it holds, with 3 decimals
     */
    record PresentationView(String name, String baseQuantity) {
    }

    /**
     * A page of products.
     *
     * @param items the products
     * @param page  the page number, from 0
     * @param size  the page size
     * @param total how many products match in all pages
     */
    record PageView(List<ProductView> items, int page, int size, long total) {
    }
}
