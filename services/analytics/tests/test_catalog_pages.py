import json
from types import SimpleNamespace
from typing import Any

import httpx2
import pytest
from fastapi.testclient import TestClient

from pos_analytics.catalog_pages.api import get_reader
from pos_analytics.catalog_pages.reader import CatalogPageReader, CatalogReadingError
from pos_analytics.main import app
from pos_analytics.owner_auth import CallerCheck, CoreIdentityVerifier, get_identity_verifier

JPEG = b"\xff\xd8\xff\xe0" + b"0" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


def line(**overrides: Any) -> dict[str, Any]:
    base = {
        "supplier_code": "TB-12",
        "description": "Tubo PVC 1/2 in",
        "purchase_unit": "caja",
        "pieces_per_unit": "12",
        "price_text": "$1,234.50",
        "price_vat": "as_page",
        "confidence": "high",
        "problems": [],
    }
    return base | overrides


class FakeMessages:
    def __init__(self, answer: dict[str, Any] | str, stop_reason: str = "end_turn") -> None:
        self.answer = answer
        self.stop_reason = stop_reason
        self.calls: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> SimpleNamespace:
        self.calls.append(kwargs)
        text = self.answer if isinstance(self.answer, str) else json.dumps(self.answer)
        return SimpleNamespace(
            stop_reason=self.stop_reason,
            model=kwargs["model"],
            content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=text)],
            usage=SimpleNamespace(input_tokens=1800, output_tokens=900),
        )


def fake_reader(answer: dict[str, Any] | str, stop_reason: str = "end_turn") -> tuple[CatalogPageReader, FakeMessages]:
    messages = FakeMessages(answer, stop_reason)
    return CatalogPageReader(SimpleNamespace(beta=SimpleNamespace(messages=messages))), messages


class FakeVerifier:
    def __init__(self, status: str) -> None:
        self.status = status

    def check(self, access_token: str) -> CallerCheck:
        return CallerCheck(self.status, "tenant")  # type: ignore[arg-type]


@pytest.fixture
def client() -> Any:
    yield TestClient(app)
    app.dependency_overrides.clear()


def use(reader: CatalogPageReader, role: str = "owner") -> None:
    app.dependency_overrides[get_reader] = lambda: reader
    app.dependency_overrides[get_identity_verifier] = lambda: FakeVerifier(role)


def post(client: TestClient, body: bytes = JPEG, media_type: str = "image/jpeg", token: str | None = "t") -> Any:
    headers = {"Content-Type": media_type}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return client.post("/catalog-pages/read", content=body, headers=headers)


def test_clean_line_becomes_an_unflagged_row_with_integer_cost(client: TestClient) -> None:
    reader, messages = fake_reader({"vat_statement": "excludes_vat", "lines": [line()]})
    use(reader)

    response = post(client)

    assert response.status_code == 200
    body = response.json()
    assert body["rows"] == [
        {
            "supplier_code": "TB-12",
            "description": "Tubo PVC 1/2 in",
            "purchase_unit": "caja",
            "pieces_per_unit": 12,
            "cost_e6": "1234500000",
            "price_text": "$1,234.50",
            "confidence": "high",
            "issues": [],
        }
    ]
    assert body["usage"] == {"input_tokens": 1800, "output_tokens": 900}
    sent = messages.calls[0]
    assert sent["model"] == "claude-opus-5-5"
    assert sent["fallbacks"] == "default"
    assert sent["output_config"]["format"]["type"] == "json_schema"
    assert sent["messages"][0]["content"][0]["source"]["media_type"] == "image/jpeg"


def test_doubtful_lines_are_flagged_instead_of_guessed(client: TestClient) -> None:
    lines = [
        line(price_text=None, problems=["price_unreadable"]),
        line(price_text="12,50"),
        line(price_vat="includes_vat"),
        line(problems=["merged_lines"], confidence="low"),
        line(supplier_code=" ", pieces_per_unit=None),
    ]
    reader, _ = fake_reader({"vat_statement": "not_stated", "lines": lines})
    use(reader)

    rows = post(client).json()["rows"]

    assert [row["issues"] for row in rows] == [
        ["price_unreadable"],
        ["price_format_unclear"],
        ["price_includes_vat"],
        ["merged_lines", "low_confidence"],
        ["code_missing", "pieces_missing"],
    ]
    assert rows[0]["cost_e6"] is None
    assert rows[1]["cost_e6"] is None


def test_page_that_includes_vat_flags_every_row_that_follows_it() -> None:
    reader, _ = fake_reader({"vat_statement": "includes_vat", "lines": [line(), line(price_vat="excludes_vat")]})

    rows = reader.read(JPEG, "image/jpeg").rows

    assert [row.issues for row in rows] == [["price_includes_vat"], []]


@pytest.mark.parametrize(
    ("answer", "stop_reason", "code"),
    [("{}", "refusal", "model_refused"), ("{", "max_tokens", "page_too_long"), ("not json", "end_turn", "malformed_answer")],
)
def test_unusable_answers_raise_a_reading_error(answer: str, stop_reason: str, code: str) -> None:
    reader, _ = fake_reader(answer, stop_reason)

    with pytest.raises(CatalogReadingError) as error:
        reader.read(PNG, "image/png")

    assert error.value.code == code


def test_reading_errors_map_to_gateway_statuses(client: TestClient) -> None:
    use(fake_reader("{}", "refusal")[0])
    assert post(client).status_code == 502
    use(fake_reader("nope")[0])
    assert post(client).status_code == 503


@pytest.mark.parametrize(
    ("body", "media_type", "status"),
    [
        (JPEG, "image/gif", 415),
        (PNG, "image/jpeg", 415),
        (b"\xff\xd8\xff" + b"0" * (5 * 1024 * 1024), "image/jpeg", 413),
    ],
)
def test_only_small_jpeg_or_png_photos_are_read(client: TestClient, body: bytes, media_type: str, status: int) -> None:
    reader, messages = fake_reader({"vat_statement": "not_stated", "lines": []})
    use(reader)

    assert post(client, body, media_type).status_code == status
    assert messages.calls == []


@pytest.mark.parametrize(("role", "token", "status"), [("owner", None, 401), ("not_owner", "t", 403), ("unavailable", "t", 503)])
def test_only_the_owner_spends_on_the_reader(client: TestClient, role: str, token: str | None, status: int) -> None:
    reader, messages = fake_reader({"vat_statement": "not_stated", "lines": []})
    use(reader, role)

    assert post(client, token=token).status_code == status
    assert messages.calls == []


def core_answering(status: int, body: Any = None) -> CoreIdentityVerifier:
    def handler(request: httpx2.Request) -> httpx2.Response:
        assert request.headers["authorization"] == "Bearer abc"
        return httpx2.Response(status, json=body)

    return CoreIdentityVerifier("http://core", httpx2.Client(transport=httpx2.MockTransport(handler)))


@pytest.mark.parametrize(
    ("status", "body", "expected"),
    [
        (200, {"tenantId": "t1", "role": "owner"}, "owner"),
        (200, {"tenantId": "t1", "role": "manager"}, "not_owner"),
        (401, None, "unauthorized"),
        (403, None, "not_owner"),
        (500, None, "unavailable"),
        (200, {"role": "owner"}, "unavailable"),
    ],
)
def test_core_verifier_trusts_only_an_owner_answer(status: int, body: Any, expected: str) -> None:
    assert core_answering(status, body).check("abc").status == expected
