package io.github.mauriciotorrez1.pos.core.catalog.labels;

import io.github.mauriciotorrez1.pos.core.catalog.CodeKind;
import io.github.mauriciotorrez1.pos.core.catalog.InvalidProductException;
import io.github.mauriciotorrez1.pos.core.catalog.Product;
import io.github.mauriciotorrez1.pos.core.catalog.ProductCatalog;
import io.github.mauriciotorrez1.pos.core.catalog.ProductCode;
import io.github.mauriciotorrez1.pos.core.catalog.ProductPage;
import io.github.mauriciotorrez1.pos.money.LineAmount;
import io.github.mauriciotorrez1.pos.money.Quantity;
import io.github.mauriciotorrez1.pos.money.Unit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Prints shelf labels of the catalog (RF-007): it reads the products, works out what each label says, and hands the
 * labels to the layout that was asked for.
 */
@Service
public class ShelfLabels {

    /** One file holds at most this many labels (ten letter sheets), so a request cannot build a huge file. */
    public static final int MAX_LABELS = 240;
    /** The most copies of each label in one file. */
    public static final int MAX_COPIES = 24;

    private static final int SEARCH_PAGE_SIZE = 100;
    private static final long ONE_UNIT_MILLI = 1_000L;
    private static final Map<Unit, String> UNIT_SUFFIX = Map.of(Unit.PIECE, "", Unit.METER, " / m",
            Unit.KILOGRAM, " / kg", Unit.LITER, " / L");

    private final ProductCatalog catalog;
    private final Map<String, LabelLayout> layouts;
    private final String defaultLayout;

    ShelfLabels(ProductCatalog catalog, List<LabelLayout> layouts) {
        this.catalog = catalog;
        this.layouts = layouts.stream().collect(Collectors.toUnmodifiableMap(LabelLayout::id, Function.identity()));
        this.defaultLayout = LetterSheetPdfLayout.ID;
    }

    /**
     * What to print: either some products or the products that a search finds.
     *
     * @param productIds the products, in the order to print them; {@code null} or empty to use the search
     * @param search     words of the name or an exact code, used when there are no ids
     * @param copies     how many labels of each product, from 1 to {@link #MAX_COPIES}; {@code null} means 1
     * @param layout     the id of the layout; {@code null} means letter paper
     */
    public record Request(List<UUID> productIds, String search, Integer copies, String layout) {
    }

    /**
     * A finished file.
     *
     * @param content     the bytes
     * @param contentType the media type, such as {@code application/pdf}
     * @param fileName    a name to save it with
     * @param labels      how many labels it holds
     */
    public record LabelFile(byte[] content, String contentType, String fileName, int labels) {
    }

    /**
     * Builds the file of labels.
     *
     * @param request what to print
     * @return the file
     * @throws InvalidProductException if nothing was chosen, the layout is unknown, the copies are out of range, or
     *                                 there would be more than {@link #MAX_LABELS} labels
     * @throws io.github.mauriciotorrez1.pos.core.catalog.ProductNotFoundException if an id is not a live product
     */
    @Transactional(readOnly = true)
    public LabelFile print(Request request) {
        LabelLayout layout = layoutOf(request.layout());
        int copies = copiesOf(request.copies());
        List<Product> products = productsOf(request, copies);
        if (products.isEmpty()) {
            throw new InvalidProductException("No hay productos que coincidan con la búsqueda");
        }
        List<ShelfLabel> labels = new ArrayList<>(products.size() * copies);
        for (Product product : products) {
            labels.addAll(Collections.nCopies(copies, labelOf(product)));
        }
        return new LabelFile(layout.render(labels), layout.contentType(), "etiquetas." + layout.fileExtension(),
                labels.size());
    }

    /**
     * Works out what the label of a product says.
     *
     * @param product a live product
     * @return its label: the name, the price of one base unit with VAT, and its barcode, or its first code if it has
     *         no barcode
     */
    static ShelfLabel labelOf(Product product) {
        String code = product.codes().stream().filter(c -> c.kind() == CodeKind.BARCODE).findFirst()
                .or(() -> product.codes().stream().findFirst()).map(ProductCode::code).orElse(null);
        return ShelfLabel.of(product.name(), priceOf(product), code);
    }

    /** The price of one base unit, rounded to the cent as a sale line would be. */
    private static String priceOf(Product product) {
        if (product.unitPrice() == null || product.unitPrice().e4() == 0) {
            return "Sin precio";
        }
        long cents = LineAmount.of(product.unitPrice(), new Quantity(ONE_UNIT_MILLI, product.unit())).cents();
        return String.format(Locale.ROOT, "$%,d.%02d", cents / 100, cents % 100) + UNIT_SUFFIX.get(product.unit());
    }

    private List<Product> productsOf(Request request, int copies) {
        if (request.productIds() != null && !request.productIds().isEmpty()) {
            List<UUID> ids = List.copyOf(new LinkedHashSet<>(request.productIds()));
            requireWithinLimit(ids.size(), copies);
            return ids.stream().map(catalog::get).toList();
        }
        if (request.search() == null || request.search().isBlank()) {
            throw new InvalidProductException("Elige productos o escribe una búsqueda");
        }
        ProductPage first = catalog.search(request.search(), 0, SEARCH_PAGE_SIZE);
        requireWithinLimit(first.total(), copies);
        List<Product> found = new ArrayList<>(first.items());
        for (int page = 1; found.size() < first.total(); page++) {
            List<Product> next = catalog.search(request.search(), page, SEARCH_PAGE_SIZE).items();
            if (next.isEmpty()) {
                break;
            }
            found.addAll(next);
        }
        return found;
    }

    private static void requireWithinLimit(long products, int copies) {
        long labels = products * copies;
        if (labels > MAX_LABELS) {
            throw new InvalidProductException("Serían %d etiquetas y un archivo lleva %d como máximo: elige menos productos"
                    .formatted(labels, MAX_LABELS));
        }
    }

    private LabelLayout layoutOf(String id) {
        LabelLayout layout = layouts.get(id == null || id.isBlank() ? defaultLayout : id);
        if (layout == null) {
            throw new InvalidProductException("layout must be one of " + layouts.keySet().stream().sorted().toList());
        }
        return layout;
    }

    private static int copiesOf(Integer copies) {
        int value = copies == null ? 1 : copies;
        if (value < 1 || value > MAX_COPIES) {
            throw new InvalidProductException("copies must be from 1 to " + MAX_COPIES);
        }
        return value;
    }
}
