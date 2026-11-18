package io.github.mauriciotorrez1.pos.core.catalog.web;

import io.github.mauriciotorrez1.pos.core.catalog.labels.ShelfLabels;
import java.util.List;
import java.util.UUID;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Shelf labels of the catalog (RF-007). Anyone who may read the products may print them, because a label shows only
 * what the shelf already shows: the name, the price and the barcode (ADR 0065).
 */
@RestController
class LabelsController {

    private final ShelfLabels shelfLabels;

    LabelsController(ShelfLabels shelfLabels) {
        this.shelfLabels = shelfLabels;
    }

    /**
     * What to print.
     *
     * @param productIds the chosen products, in the order to print them; omitted to print what a search finds
     * @param search     words of the name or an exact code, used when there are no ids
     * @param copies     labels of each product, from 1 to 24; omitted means 1
     * @param layout     the printer format; omitted means {@code letter-24}, labels on letter paper
     */
    record LabelsRequest(List<UUID> productIds, String search, Integer copies, String layout) {
    }

    /**
     * Builds the labels as a file to download, a PDF for the letter layout.
     *
     * @param request what to print
     * @return the file, with the number of labels in the {@code X-Label-Count} header
     */
    @PostMapping("/labels")
    ResponseEntity<byte[]> print(@RequestBody LabelsRequest request) {
        ShelfLabels.LabelFile file = shelfLabels.print(new ShelfLabels.Request(request.productIds(), request.search(),
                request.copies(), request.layout()));
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(file.contentType()))
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(file.fileName()).build()
                        .toString())
                .header("X-Label-Count", String.valueOf(file.labels()))
                .body(file.content());
    }
}
