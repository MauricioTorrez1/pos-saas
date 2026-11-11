package io.github.mauriciotorrez1.pos.core.invoicing;

/**
 * One invalid field. It names the field and the rule, never the value, so it is safe to log and to return.
 *
 * @param field the field, such as {@code receiver.taxId}
 * @param code the broken rule, such as {@code invalid_format}
 */
public record FieldError(String field, String code) {
}
