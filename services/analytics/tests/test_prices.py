import pytest

from pos_analytics.catalog_pages.prices import format_cost_e6, parse_pieces, parse_price_e6


@pytest.mark.parametrize(
    ("printed", "expected"),
    [
        ("$1,234.50", 1_234_500_000),
        ("12.345", 12_345_000),
        ("$ 8", 8_000_000),
        ("150.00 MXN", 150_000_000),
        ("0.123456", 123_456),
    ],
)
def test_reads_mexican_prices_as_millionths(printed: str, expected: int) -> None:
    assert parse_price_e6(printed) == expected


@pytest.mark.parametrize("printed", [None, "", "12,50", "1.234,50", "0", "1.1234567", "N/D", "12-15"])
def test_ambiguous_or_missing_prices_give_none(printed: str | None) -> None:
    assert parse_price_e6(printed) is None


def test_reads_whole_piece_counts_only() -> None:
    assert parse_pieces("12") == 12
    assert parse_pieces("0") is None
    assert parse_pieces("12 pzas") is None
    assert parse_pieces(None) is None


def test_formats_cost_with_two_to_six_decimals() -> None:
    assert format_cost_e6(1_234_500_000) == "1234.50"
    assert format_cost_e6(12_345_000) == "12.345"
    assert format_cost_e6(123_456) == "0.123456"
