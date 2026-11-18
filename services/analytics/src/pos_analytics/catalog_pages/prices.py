"""Turns the printed text of a price or a count into integers, without floats (ADR 0011).

The model copies what is printed and never does arithmetic; this module decides what the text means. Anything that
is not clearly one amount returns `None`, and the caller flags the row instead of guessing.
"""

import re

COST_SCALE_DIGITS = 6
_COST_SCALE = 10**COST_SCALE_DIGITS
_MAX_PIECES = 1_000_000

# Currency marks a supplier prints around a price. They carry no value.
_CURRENCY_MARKS = re.compile(r"\$|\bm\.?\s?n\.?(?=\s|$)|\bmxn\b|\bpesos?\b", re.IGNORECASE)
# Either plain digits with an optional decimal point, or groups of three separated by commas.
_PLAIN_AMOUNT = re.compile(r"^(\d{1,9})(?:\.(\d{1,6}))?$")
_GROUPED_AMOUNT = re.compile(r"^(\d{1,3}(?:,\d{3}){1,2})(?:\.(\d{1,6}))?$")
_PIECES = re.compile(r"^\d{1,7}$")


def parse_price_e6(printed: str | None) -> int | None:
    """Read a printed price as millionths of a peso.

    Mexican catalogs use a decimal point and thousands commas: `"$1,234.50"` gives `1234500000`. A comma used as the
    decimal mark (`"12,50"`), a European format (`"1.234,50"`) or more than six decimals is ambiguous and gives
    `None`.

    Args:
        printed: The price as the model copied it from the page.

    Returns:
        The price in millionths of a peso, or `None` when the text is not exactly one positive amount.
    """
    if printed is None:
        return None
    cleaned = _CURRENCY_MARKS.sub("", printed).replace(" ", "").strip()
    match = _PLAIN_AMOUNT.fullmatch(cleaned) or _GROUPED_AMOUNT.fullmatch(cleaned)
    if match is None:
        return None
    whole_text, fraction_text = match.group(1), match.group(2) or ""
    whole = int(whole_text.replace(",", ""))
    fraction = int(fraction_text.ljust(COST_SCALE_DIGITS, "0"))
    amount = whole * _COST_SCALE + fraction
    return amount if amount > 0 else None


def parse_pieces(printed: str | None) -> int | None:
    """Read how many pieces a purchase unit holds.

    Args:
        printed: The count as the model copied it, digits only (`"12"`).

    Returns:
        The count, or `None` when it is missing, zero, not a whole number or absurdly large.
    """
    if printed is None:
        return None
    cleaned = printed.strip()
    if not _PIECES.fullmatch(cleaned):
        return None
    pieces = int(cleaned)
    return pieces if 0 < pieces <= _MAX_PIECES else None


def format_cost_e6(cost_e6: int) -> str:
    """Write millionths of a peso as pesos with at least two and at most six decimals.

    Args:
        cost_e6: A non-negative amount in millionths of a peso.

    Returns:
        Text such as `"1234.5"` → `"1234.50"`, `"12.345"`.
    """
    whole, fraction = divmod(cost_e6, _COST_SCALE)
    fraction_text = str(fraction).rjust(COST_SCALE_DIGITS, "0").rstrip("0").ljust(2, "0")
    return f"{whole}.{fraction_text}"
