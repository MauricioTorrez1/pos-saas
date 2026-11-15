package io.github.mauriciotorrez1.pos.core.catalog.web;

import io.github.mauriciotorrez1.pos.core.catalog.BulkPriceChange;
import io.github.mauriciotorrez1.pos.core.catalog.CatalogImport;
import io.github.mauriciotorrez1.pos.core.catalog.InvalidProductException;
import io.github.mauriciotorrez1.pos.core.identity.AppUser;
import io.github.mauriciotorrez1.pos.core.identity.UserDirectory;
import io.github.mauriciotorrez1.pos.security.Permission;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * The two operations that touch many products at once: loading the catalog from a file (RF-005) and changing prices
 * in bulk (RF-006). Who may call each one is decided by the permission table (ADR 0042).
 */
@RestController
class CatalogToolsController {

    /** A preview or a result lists at most this many products; the count is always the real one. */
    private static final int MAX_LINES_SHOWN = 500;
    private static final int MAX_FILE_CHARACTERS = 8_000_000;

    private final CatalogImport catalogImport;
    private final BulkPriceChange bulkPriceChange;
    private final UserDirectory directory;

    CatalogToolsController(CatalogImport catalogImport, BulkPriceChange bulkPriceChange, UserDirectory directory) {
        this.catalogImport = catalogImport;
        this.bulkPriceChange = bulkPriceChange;
        this.directory = directory;
    }

    /**
     * Loads products from a CSV file. The rows that cannot be loaded come back with their line and the reason, and
     * the rest are saved. With {@code report=csv} the answer is that list as a CSV file, ready to fix and load again.
     *
     * @param csv    the text of the file, with the titles in its first row
     * @param dryRun whether to only check the file
     * @param report {@code csv} to get the rows that failed as a file instead of JSON
     * @param jwt    the token of the caller
     * @return what was loaded and what was not
     */
    @PostMapping(path = "/imports/catalog", consumes = {"text/csv", MediaType.TEXT_PLAIN_VALUE})
    ResponseEntity<?> importCatalog(@RequestBody String csv, @RequestParam(defaultValue = "false") boolean dryRun,
                                    @RequestParam(required = false) String report, @AuthenticationPrincipal Jwt jwt) {
        if (csv.length() > MAX_FILE_CHARACTERS) {
            throw new CatalogImport.UnreadableFileException("El archivo es demasiado grande para ser una lista de productos.");
        }
        AppUser actor = actorOf(jwt);
        CatalogImport.Report result = catalogImport.load(actor.id(), Permission.PRICE_CHANGE.grantedTo(actor.role()), csv, dryRun);
        if ("csv".equals(report)) {
            StringBuilder file = new StringBuilder("linea,motivo\n");
            result.invalid().forEach(row -> file.append(row.line()).append(",\"").append(row.reason().replace("\"", "\"\""))
                    .append("\"\n"));
            return ResponseEntity.ok().contentType(MediaType.parseMediaType("text/csv;charset=UTF-8"))
                    .header("Content-Disposition", "attachment; filename=\"filas-no-cargadas.csv\"").body(file.toString());
        }
        return ResponseEntity.ok(result);
    }

    /**
     * What a bulk price change asks for.
     *
     * @param search        words that the name of the products contains; omitted for every product with a price
     * @param percent       the change as text, such as {@code "5"} or {@code "-2.5"}, with two decimals at most
     * @param rounding      {@code cent}, {@code half_peso} or {@code peso}; omitted means to the cent
     * @param preview       {@code true} to only see what would change; anything else applies it
     * @param expectedCount how many products the preview showed; required to apply
     */
    record PriceChangeRequest(String search, String percent, String rounding, Boolean preview, Integer expectedCount) {
    }

    /** One product of the answer, with prices as text in pesos. */
    record PriceLine(UUID productId, String name, String currentPrice, String newPrice) {
    }

    /**
     * The answer of a bulk change.
     *
     * @param applied whether the prices changed
     * @param count   how many products change
     * @param lines   the first products, ordered by name
     */
    record PriceChangeView(boolean applied, int count, List<PriceLine> lines) {
    }

    /**
     * Shows or applies a change of prices by a percentage (RF-006). To apply, the caller sends the count the preview
     * showed: if the catalog moved in between, nothing changes and the answer is 409.
     *
     * @param request what to change
     * @param jwt     the token of the caller
     * @return the products that change
     */
    @PostMapping("/price-changes")
    PriceChangeView changePrices(@RequestBody PriceChangeRequest request, @AuthenticationPrincipal Jwt jwt) {
        BulkPriceChange.Request change = new BulkPriceChange.Request(request.search(), percentOf(request.percent()),
                BulkPriceChange.Rounding.fromCode(request.rounding()));
        BulkPriceChange.Outcome outcome;
        if (Boolean.TRUE.equals(request.preview())) {
            outcome = bulkPriceChange.preview(change);
        } else {
            if (request.expectedCount() == null) {
                throw new InvalidProductException("expectedCount is required to apply: send the count of the preview");
            }
            outcome = bulkPriceChange.apply(actorOf(jwt).id(), change, request.expectedCount());
        }
        return new PriceChangeView(outcome.applied(), outcome.lines().size(), outcome.lines().stream().limit(MAX_LINES_SHOWN)
                .map(line -> new PriceLine(line.productId(), line.name(), pesos(line.currentPriceE4()), pesos(line.newPriceE4())))
                .toList());
    }

    @ExceptionHandler(CatalogImport.UnreadableFileException.class)
    ProblemDetail unreadable(CatalogImport.UnreadableFileException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, e.getMessage());
    }

    @ExceptionHandler(BulkPriceChange.StalePreviewException.class)
    ProblemDetail stale(BulkPriceChange.StalePreviewException e) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT,
                "The catalog changed since the preview; ask for the preview again");
        problem.setProperty("expectedCount", e.expected());
        problem.setProperty("actualCount", e.actual());
        return problem;
    }

    private AppUser actorOf(Jwt jwt) {
        return directory.findActiveBySubject(jwt.getSubject())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.FORBIDDEN));
    }

    /** Reads a percentage with two decimals at most into hundredths of a percent. */
    private static long percentOf(String text) {
        try {
            return new BigDecimal(text.strip()).movePointRight(2).longValueExact();
        } catch (ArithmeticException | NumberFormatException | NullPointerException e) {
            throw new InvalidProductException("percent must be a number with up to 2 decimals, such as 5 or -2.5");
        }
    }

    private static String pesos(long e4) {
        return BigDecimal.valueOf(e4, 4).toPlainString();
    }
}
