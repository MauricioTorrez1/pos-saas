package io.github.mauriciotorrez1.pos.core.catalog.labels;

import java.util.List;

/**
 * One way to turn shelf labels into a file a printer takes. Each layout is a Spring bean: a new printer format, such
 * as a roll of a thermal label printer, is a new class that implements this interface, and nothing else changes
 * (open-closed principle, ADR 0065).
 */
public interface LabelLayout {

    /**
     * Returns the name the API uses to ask for this layout.
     *
     * @return a stable lower case id, such as {@code letter-24}
     */
    String id();

    /**
     * Returns the media type of the file.
     *
     * @return such as {@code application/pdf}
     */
    String contentType();

    /**
     * Returns the extension of the file, without the dot.
     *
     * @return such as {@code pdf}
     */
    String fileExtension();

    /**
     * Draws the labels in order.
     *
     * @param labels the labels, at least one
     * @return the bytes of the file
     */
    byte[] render(List<ShelfLabel> labels);
}
