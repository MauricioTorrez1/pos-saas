"""Asks Claude which items of different supplier catalogs are the same product (E1-63, ADR 0079).

The register sends only what its own rules could not group: descriptions, units and pieces, with each supplier as a
letter. No costs and no supplier names travel. Claude proposes groups with a reason; this module keeps only the groups
that are possible (known items, one per supplier, each item in one group) and the owner approves every one in the register.
"""

import json
from typing import Any, Literal, Protocol

import anthropic
from pydantic import BaseModel, Field, ValidationError

DEFAULT_MODEL = "claude-opus-5-5"
MAX_OUTPUT_TOKENS = 16000
FALLBACK_BETA = "server-side-fallback-2026-07-01"
MAX_ITEMS = 200

type Confidence = Literal["high", "medium", "low"]

OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "groups": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "item_ids": {"type": "array", "items": {"type": "string"}},
                    "reason": {"type": "string"},
                    "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                },
                "required": ["item_ids", "reason", "confidence"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["groups"],
    "additionalProperties": False,
}

INSTRUCTIONS = """You compare the price lists of several suppliers of a hardware store (tlapalería) in Mexico.
Each supplier writes the same product differently: "BROCA HSS 1/4" and "Broca de alta velocidad 6.35 mm" are the
same drill bit; "taquete 5/16" and "ancla de plástico 8 mm" are the same anchor. The owner wants to compare their prices.

Group the items below that are the same product sold by different suppliers. Rules:
- Put at most one item of each supplier in a group, and every item in at most one group.
- Only group items with the same size, gauge, capacity, material and use. 1/4" is 6.35 mm and 5/16" is 7.94 mm (8 mm
  is fine), but 1/4" and 6 mm are different drill bits. HSS and cobalt are different. A box of 100 and a single piece of
  the same product are the same product; the register compares them per piece.
- Leave out any item you are not sure about. A wrong group costs the owner more than a missing one.
- reason: one short sentence in Mexican Spanish saying why they are the same, for example
  "Ambas son broca HSS (alta velocidad) de 1/4 pulgada = 6.35 mm."
- confidence: "high" only when the descriptions leave no doubt; "low" when a human should look twice.
Return only groups of two or more items.

The items, one JSON object per line (supplier is a letter, not a name):
"""


class MatchItem(BaseModel):
    """An item as the register sends it."""

    id: str = Field(min_length=1, max_length=64)
    supplier: str = Field(min_length=1, max_length=8)
    description: str = Field(min_length=1, max_length=200)
    purchase_unit: str | None = Field(default=None, max_length=60)
    pieces_per_unit: str = Field(default="1", max_length=12)


class GroupingRequest(BaseModel):
    """What the register asks."""

    items: list[MatchItem] = Field(min_length=2, max_length=MAX_ITEMS)


class ProposedGroup(BaseModel):
    """A group Claude proposed, already checked."""

    item_ids: list[str]
    reason: str
    confidence: Confidence


class TokenUsage(BaseModel):
    """Tokens billed for the request."""

    input_tokens: int
    output_tokens: int


class GroupingResult(BaseModel):
    """What the endpoint answers."""

    model: str
    groups: list[ProposedGroup]
    usage: TokenUsage


class _Extraction(BaseModel):
    groups: list[ProposedGroup]


class MatchingError(Exception):
    """The items could not be grouped. `code` is stable text the register translates."""

    def __init__(self, code: str, *, retryable: bool) -> None:
        """Create the error.

        Args:
            code: Machine-readable reason, such as `model_refused` or `matcher_busy`.
            retryable: Whether sending the same items later may work.
        """
        super().__init__(code)
        self.code = code
        self.retryable = retryable


class MessagesClient(Protocol):
    """The part of `anthropic.Anthropic` the matcher uses; tests pass a fake."""

    @property
    def beta(self) -> Any:
        """The beta namespace, whose `messages.create` sends the request."""
        ...


def keep_possible_groups(groups: list[ProposedGroup], items: list[MatchItem]) -> list[ProposedGroup]:
    """Drop what cannot be a group: unknown items, two items of one supplier, an item already grouped, or fewer than two.

    Args:
        groups: What Claude proposed, in its order.
        items: What the register sent.

    Returns:
        The groups that are possible, with a reason of at most 300 characters.
    """
    supplier_of = {item.id: item.supplier for item in items}
    used: set[str] = set()
    kept: list[ProposedGroup] = []
    for group in groups:
        ids = [item_id for item_id in dict.fromkeys(group.item_ids) if item_id in supplier_of and item_id not in used]
        suppliers = [supplier_of[item_id] for item_id in ids]
        if len(ids) < 2 or len(set(suppliers)) != len(suppliers):
            continue
        used.update(ids)
        kept.append(ProposedGroup(item_ids=ids, reason=group.reason.strip()[:300], confidence=group.confidence))
    return kept


class CatalogMatcher:
    """Sends the items to Claude and returns the possible groups."""

    def __init__(self, client: MessagesClient, model: str = DEFAULT_MODEL) -> None:
        """Create a matcher.

        Args:
            client: An `anthropic.Anthropic` client, or a fake in tests.
            model: Model id, from `CATALOG_MATCHER_MODEL`.
        """
        self._client = client
        self._model = model

    def group(self, request: GroupingRequest) -> GroupingResult:
        """Propose groups of equivalent items.

        Args:
            request: The items the register could not group with its rules.

        Returns:
            The possible groups and the tokens billed.

        Raises:
            MatchingError: When the API fails, refuses, or the answer is cut or malformed.
        """
        response = self._send(request.items)
        if response.stop_reason == "refusal":
            raise MatchingError("model_refused", retryable=False)
        if response.stop_reason == "max_tokens":
            raise MatchingError("answer_too_long", retryable=False)
        text = next((block.text for block in response.content if block.type == "text"), None)
        try:
            extraction = _Extraction.model_validate(json.loads(text or ""))
        except (json.JSONDecodeError, ValidationError) as error:
            raise MatchingError("malformed_answer", retryable=True) from error
        return GroupingResult(
            model=response.model,
            groups=keep_possible_groups(extraction.groups, request.items),
            usage=TokenUsage(input_tokens=response.usage.input_tokens, output_tokens=response.usage.output_tokens),
        )

    def _send(self, items: list[MatchItem]) -> Any:
        lines = "\n".join(json.dumps(item.model_dump(), ensure_ascii=False) for item in items)
        try:
            return self._client.beta.messages.create(
                model=self._model,
                max_tokens=MAX_OUTPUT_TOKENS,
                betas=[FALLBACK_BETA],
                fallbacks="default",
                output_config={"effort": "medium", "format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}},
                messages=[{"role": "user", "content": INSTRUCTIONS + lines}],
            )
        except anthropic.AuthenticationError as error:
            raise MatchingError("matcher_not_configured", retryable=False) from error
        except anthropic.RateLimitError as error:
            raise MatchingError("matcher_busy", retryable=True) from error
        except anthropic.BadRequestError as error:
            raise MatchingError("matcher_rejected", retryable=False) from error
        except anthropic.APIStatusError as error:
            raise MatchingError("matcher_failed", retryable=error.status_code >= 500) from error
        except anthropic.APIConnectionError as error:
            raise MatchingError("matcher_unreachable", retryable=True) from error
