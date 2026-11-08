/**
 * Why a money or quantity value was rejected. Java uses the same codes, so a shared case can name the error it
 * expects. Only `not_an_integer` is TypeScript's own, because a Java `long` cannot hold decimals.
 */
export type MoneyErrorCode =
  | "not_an_integer"
  | "negative_input"
  | "unknown_unit"
  | "fractional_piece"
  | "overflow"
  | "invalid_format"
  | "too_many_decimals";

/** Tells why a money or quantity value could not be used. */
export class MoneyError extends RangeError {
  readonly code: MoneyErrorCode;

  /**
   * @param code - The reason, as the shared cases name it.
   * @param message - A description for logs, with the rejected value.
   */
  constructor(code: MoneyErrorCode, message: string) {
    super(message);
    this.name = "MoneyError";
    this.code = code;
  }
}
