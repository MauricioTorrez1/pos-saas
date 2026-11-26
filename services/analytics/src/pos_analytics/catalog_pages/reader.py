"""Reads the rows of one photographed supplier catalog page with the Claude API (ADR 0069).

Claude copies what is printed and says what it could not read; this module turns the copy into integers and adds
the flags. Nothing here is stored: the photo and the rows live only for the request.
"""

import base64
import json
from typing import Any, Literal, Protocol

import anthropic
from pydantic import BaseModel, ValidationError, field_serializer

from .prices import parse_pieces, parse_price_e6

DEFAULT_MODEL = "claude-opus-5-5"
MAX_OUTPUT_TOKENS = 16000
FALLBACK_BETA = "server-side-fallback-2026-07-01"

type Confidence = Literal["high", "medium", "low"]
type VatStatement = Literal["excludes_vat", "includes_vat", "not_stated"]
type IssueCode = Literal[
    "price_unreadable",
    "price_format_unclear",
    "price_includes_vat",
    "vat_unclear",
    "multiple_prices",
    "merged_lines",
    "text_unclear",
    "code_missing",
    "pieces_missing",
    "low_confidence",
]

_MODEL_PROBLEMS = ["merged_lines", "text_unclear", "price_unreadable", "multiple_prices", "vat_unclear"]


def _nullable_string() -> dict[str, Any]:
    return {"anyOf": [{"type": "string"}, {"type": "null"}]}


OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "vat_statement": {"type": "string", "enum": ["excludes_vat", "includes_vat", "not_stated"]},
        "lines": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "supplier_code": _nullable_string(),
                    "description": {"type": "string"},
                    "purchase_unit": _nullable_string(),
                    "pieces_per_unit": _nullable_string(),
                    "price_text": _nullable_string(),
                    "price_vat": {"type": "string", "enum": ["as_page", "excludes_vat", "includes_vat", "unclear"]},
                    "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                    "problems": {"type": "array", "items": {"type": "string", "enum": _MODEL_PROBLEMS}},
                },
                "required": [
                    "supplier_code",
                    "description",
                    "purchase_unit",
                    "pieces_per_unit",
                    "price_text",
                    "price_vat",
                    "confidence",
                    "problems",
                ],
                "additionalProperties": False,
            },
        },
    },
    "required": ["vat_statement", "lines"],
    "additionalProperties": False,
}

INSTRUCTIONS = """You read a printed supplier catalog for a hardware store in Mexico: one photographed page, or a PDF
of up to a few scanned pages. Return one entry per product line printed on the pages, in reading order, page after page.
Skip headings, totals and ads.

Copy, never compute:
- supplier_code: the supplier's code, model or part number exactly as printed; null if the line has none.
- description: the product text as printed.
- purchase_unit: how the supplier sells it as printed (pieza, caja, rollo, bolsa, juego...); null if not stated.
- pieces_per_unit: digits only, how many pieces that unit holds; "1" when it is sold by the single piece;
  null when the page does not say.
- price_text: the unit price exactly as printed, with its $ sign, commas and decimals; null if missing.
- price_vat: "as_page" unless the line itself says its price includes or excludes VAT (IVA); "unclear" if the line
  shows prices with and without VAT and you cannot tell which is the list price.
- vat_statement: what the page as a whole says about VAT ("precios más IVA" means excludes_vat).

Flag instead of guessing. Add to problems:
- price_unreadable when the price is blurred, cut off, covered or handwritten over;
- multiple_prices when the line shows more than one price (for example mayoreo and menudeo);
- merged_lines when you are not sure where one line ends and the next begins, or a price may belong to another line;
- text_unclear when the code or description is partly unreadable;
- vat_unclear when you cannot tell whether this price includes VAT.
Use confidence "low" whenever a human should look twice. Never invent a value that is not printed."""


class ProposedRow(BaseModel):
    """A line of the page as the owner will review it. `cost_e6` is millionths of a peso, sent as digit text."""

    supplier_code: str | None
    description: str
    purchase_unit: str | None
    pieces_per_unit: int | None
    cost_e6: int | None
    price_text: str | None
    confidence: Confidence
    issues: list[IssueCode]

    @field_serializer("cost_e6")
    def _cost_as_text(self, cost_e6: int | None) -> str | None:
        # JavaScript reads JSON numbers as doubles; digit text keeps the amount exact in the panel.
        return None if cost_e6 is None else str(cost_e6)


class TokenUsage(BaseModel):
    """Tokens billed for the page, so the owner can see the real cost."""

    input_tokens: int
    output_tokens: int


class PageReading(BaseModel):
    """What the endpoint answers for one page."""

    model: str
    vat_statement: VatStatement
    rows: list[ProposedRow]
    usage: TokenUsage


class _ExtractedLine(BaseModel):
    supplier_code: str | None
    description: str
    purchase_unit: str | None
    pieces_per_unit: str | None
    price_text: str | None
    price_vat: Literal["as_page", "excludes_vat", "includes_vat", "unclear"]
    confidence: Confidence
    problems: list[str]


class _Extraction(BaseModel):
    vat_statement: VatStatement
    lines: list[_ExtractedLine]


class CatalogReadingError(Exception):
    """The page could not be read. `code` is stable text the panel translates; `retryable` says if trying again helps."""

    def __init__(self, code: str, *, retryable: bool) -> None:
        """Create the error.

        Args:
            code: Machine-readable reason, such as `model_refused` or `reader_busy`.
            retryable: Whether sending the same photo later may work.
        """
        super().__init__(code)
        self.code = code
        self.retryable = retryable


class MessagesClient(Protocol):
    """The part of `anthropic.Anthropic` the reader uses; tests pass a fake."""

    @property
    def beta(self) -> Any:
        """The beta namespace, whose `messages.create` sends the request."""
        ...


def _blank_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def build_row(line: _ExtractedLine, page_vat: VatStatement) -> ProposedRow:
    """Turn one copied line into a reviewable row with its flags.

    Args:
        line: What the model copied.
        page_vat: What the page says about VAT, used when the line says nothing of its own.

    Returns:
        The row, with `cost_e6` only when the printed price is exactly one amount.
    """
    issues: list[IssueCode] = [problem for problem in line.problems if problem in _MODEL_PROBLEMS]  # type: ignore[misc]
    price_text = _blank_to_none(line.price_text)
    cost_e6 = None if "price_unreadable" in issues else parse_price_e6(price_text)
    if price_text is None and "price_unreadable" not in issues:
        issues.append("price_unreadable")
    elif cost_e6 is None and "price_unreadable" not in issues:
        issues.append("price_format_unclear")
    vat = page_vat if line.price_vat == "as_page" else line.price_vat
    if vat == "includes_vat":
        issues.append("price_includes_vat")
    elif vat == "unclear":
        issues.append("vat_unclear")
    supplier_code = _blank_to_none(line.supplier_code)
    if supplier_code is None:
        issues.append("code_missing")
    pieces = parse_pieces(line.pieces_per_unit)
    if pieces is None:
        issues.append("pieces_missing")
    if line.confidence == "low":
        issues.append("low_confidence")
    return ProposedRow(
        supplier_code=supplier_code,
        description=line.description.strip(),
        purchase_unit=_blank_to_none(line.purchase_unit),
        pieces_per_unit=pieces,
        cost_e6=cost_e6,
        price_text=price_text,
        confidence=line.confidence,
        issues=list(dict.fromkeys(issues)),
    )


class CatalogPageReader:
    """Sends one page photo to Claude and returns the proposed rows."""

    def __init__(self, client: MessagesClient, model: str = DEFAULT_MODEL) -> None:
        """Create a reader.

        Args:
            client: An `anthropic.Anthropic` client, or a fake in tests.
            model: Model id, from `CATALOG_READER_MODEL`.
        """
        self._client = client
        self._model = model

    def read(self, photo: bytes, media_type: Literal["image/jpeg", "image/png", "application/pdf"]) -> PageReading:
        """Read the product lines of one page, or of every page of a short PDF.

        Args:
            photo: The image or PDF bytes, already checked for type and size.
            media_type: Its type.

        Returns:
            The rows, the page VAT statement and the tokens billed.

        Raises:
            CatalogReadingError: When the API fails, refuses, or the answer is cut or malformed.
        """
        response = self._send(photo, media_type)
        if response.stop_reason == "refusal":
            raise CatalogReadingError("model_refused", retryable=False)
        if response.stop_reason == "max_tokens":
            raise CatalogReadingError("page_too_long", retryable=False)
        text = next((block.text for block in response.content if block.type == "text"), None)
        try:
            extraction = _Extraction.model_validate(json.loads(text or ""))
        except (json.JSONDecodeError, ValidationError) as error:
            raise CatalogReadingError("malformed_answer", retryable=True) from error
        return PageReading(
            model=response.model,
            vat_statement=extraction.vat_statement,
            rows=[build_row(line, extraction.vat_statement) for line in extraction.lines],
            usage=TokenUsage(
                input_tokens=response.usage.input_tokens,
                output_tokens=response.usage.output_tokens,
            ),
        )

    def _send(self, photo: bytes, media_type: str) -> Any:
        # A PDF goes as a document block and an image as an image block; Claude reads the pages of both the same way.
        image = {
            "type": "document" if media_type == "application/pdf" else "image",
            "source": {"type": "base64", "media_type": media_type, "data": base64.standard_b64encode(photo).decode()},
        }
        try:
            return self._client.beta.messages.create(
                model=self._model,
                max_tokens=MAX_OUTPUT_TOKENS,
                betas=[FALLBACK_BETA],
                fallbacks="default",
                output_config={"effort": "medium", "format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}},
                messages=[{"role": "user", "content": [image, {"type": "text", "text": INSTRUCTIONS}]}],
            )
        except anthropic.AuthenticationError as error:
            raise CatalogReadingError("reader_not_configured", retryable=False) from error
        except anthropic.RateLimitError as error:
            raise CatalogReadingError("reader_busy", retryable=True) from error
        except anthropic.BadRequestError as error:
            raise CatalogReadingError("photo_rejected", retryable=False) from error
        except anthropic.APIStatusError as error:
            raise CatalogReadingError("reader_failed", retryable=error.status_code >= 500) from error
        except anthropic.APIConnectionError as error:
            raise CatalogReadingError("reader_unreachable", retryable=True) from error
