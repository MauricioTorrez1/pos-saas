package io.github.mauriciotorrez1.pos.core.catalog;

/**
 * A code that identifies a product when it is scanned or typed.
 *
 * @param code the code, without spaces and up to 64 characters
 * @param kind whether it is the printed barcode or an alternate code
 */
public record ProductCode(String code, CodeKind kind) {
}
