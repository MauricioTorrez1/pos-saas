import json
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from pos_analytics.catalog_matching.api import get_matcher
from pos_analytics.catalog_matching.matcher import CatalogMatcher, MatchItem, ProposedGroup, keep_possible_groups
from pos_analytics.main import app
from pos_analytics.owner_auth import CallerCheck
from pos_analytics.register_auth import REGISTER_TOKEN_VARIABLE, optional_identity_verifier

ITEMS = [
    {"id": "a1", "supplier": "P1", "description": 'BROCAS HSS 1/4" P/METAL', "purchase_unit": None, "pieces_per_unit": "1"},
    {"id": "b1", "supplier": "P2", "description": "Broca de alta velocidad 6.35 mm", "purchase_unit": "Pieza", "pieces_per_unit": "1"},
    {"id": "b2", "supplier": "P2", "description": "Broca de alta velocidad 9.53 mm", "purchase_unit": "Pieza", "pieces_per_unit": "1"},
]


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
            usage=SimpleNamespace(input_tokens=700, output_tokens=300),
        )


class FakeVerifier:
    def __init__(self, status: str) -> None:
        self.status = status

    def check(self, access_token: str) -> CallerCheck:
        return CallerCheck(self.status, "tenant")  # type: ignore[arg-type]


def fake_matcher(answer: dict[str, Any] | str, stop_reason: str = "end_turn") -> tuple[CatalogMatcher, FakeMessages]:
    messages = FakeMessages(answer, stop_reason)
    return CatalogMatcher(SimpleNamespace(beta=SimpleNamespace(messages=messages))), messages


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setenv(REGISTER_TOKEN_VARIABLE, "register-secret")
    yield TestClient(app)
    app.dependency_overrides.clear()


def use(matcher: CatalogMatcher, verifier: FakeVerifier | None = None) -> None:
    app.dependency_overrides[get_matcher] = lambda: matcher
    app.dependency_overrides[optional_identity_verifier] = lambda: verifier


def post(client: TestClient, authorization: str | None = "Device register-secret", items: list[dict[str, Any]] = ITEMS) -> Any:
    headers = {} if authorization is None else {"Authorization": authorization}
    return client.post("/catalog-matching/group", json={"items": items}, headers=headers)


def test_the_register_gets_the_hss_drill_bit_grouped_with_its_reason(client: TestClient) -> None:
    matcher, messages = fake_matcher(
        {"groups": [{"item_ids": ["a1", "b1"], "reason": "Ambas son broca HSS de 1/4 = 6.35 mm.", "confidence": "high"}]}
    )
    use(matcher)

    response = post(client)

    assert response.status_code == 200
    assert response.json() == {
        "model": "claude-opus-5-5",
        "groups": [{"item_ids": ["a1", "b1"], "reason": "Ambas son broca HSS de 1/4 = 6.35 mm.", "confidence": "high"}],
        "usage": {"input_tokens": 700, "output_tokens": 300},
    }
    call = messages.calls[0]
    assert call["fallbacks"] == "default"
    assert call["output_config"]["format"]["type"] == "json_schema"
    prompt = call["messages"][0]["content"]
    assert "Broca de alta velocidad 6.35 mm" in prompt
    assert all(json.loads(line).keys() == ITEMS[0].keys() for line in prompt.splitlines()[-3:])


def test_impossible_groups_are_dropped() -> None:
    items = [MatchItem.model_validate(item) for item in ITEMS]
    groups = [
        ProposedGroup(item_ids=["b1", "b2"], reason="Mismo proveedor.", confidence="high"),
        ProposedGroup(item_ids=["a1", "zz"], reason="Uno no existe.", confidence="low"),
        ProposedGroup(item_ids=["a1", "b1", "a1"], reason="Bien.", confidence="medium"),
        ProposedGroup(item_ids=["a1", "b2"], reason="a1 ya está en otro grupo.", confidence="low"),
    ]

    assert keep_possible_groups(groups, items) == [ProposedGroup(item_ids=["a1", "b1"], reason="Bien.", confidence="medium")]


def test_the_owner_of_the_panel_may_call_it_too(client: TestClient) -> None:
    use(fake_matcher({"groups": []})[0], FakeVerifier("owner"))

    assert post(client, "Bearer panel-token").status_code == 200


@pytest.mark.parametrize(
    ("authorization", "verifier", "status", "detail"),
    [
        ("Device wrong", None, 401, "register_not_allowed"),
        ("Device ", None, 401, "register_not_allowed"),
        (None, None, 503, "identity_not_configured"),
        ("Bearer t", FakeVerifier("not_owner"), 403, "owner_only"),
        ("Bearer t", FakeVerifier("unauthorized"), 401, "invalid_token"),
    ],
)
def test_anyone_else_is_refused(client: TestClient, authorization: str | None, verifier: FakeVerifier | None, status: int, detail: str) -> None:
    matcher, messages = fake_matcher({"groups": []})
    use(matcher, verifier)

    response = post(client, authorization)

    assert (response.status_code, response.json()["detail"]) == (status, detail)
    assert messages.calls == []


def test_without_a_register_token_in_the_service_it_fails_closed(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(REGISTER_TOKEN_VARIABLE)
    use(fake_matcher({"groups": []})[0])

    response = post(client)

    assert (response.status_code, response.json()["detail"]) == (503, "register_not_configured")


def test_too_many_or_too_long_items_are_refused_before_calling_claude(client: TestClient) -> None:
    matcher, messages = fake_matcher({"groups": []})
    use(matcher)
    many = [{"id": str(index), "supplier": "P1", "description": "Broca"} for index in range(201)]
    long_text = [{**ITEMS[0], "description": "x" * 201}, ITEMS[1]]

    assert post(client, items=many).status_code == 422
    assert post(client, items=long_text).status_code == 422
    assert post(client, items=ITEMS[:1]).status_code == 422
    assert messages.calls == []


@pytest.mark.parametrize(
    ("answer", "stop_reason", "status", "detail"),
    [
        ({"groups": []}, "refusal", 502, "model_refused"),
        ({"groups": []}, "max_tokens", 502, "answer_too_long"),
        ("not json", "end_turn", 503, "malformed_answer"),
    ],
)
def test_failures_have_stable_codes(client: TestClient, answer: dict[str, Any] | str, stop_reason: str, status: int, detail: str) -> None:
    use(fake_matcher(answer, stop_reason)[0])

    response = post(client)

    assert (response.status_code, response.json()["detail"]) == (status, detail)


def test_without_an_api_key_it_says_so(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    app.dependency_overrides[optional_identity_verifier] = lambda: None

    response = post(client)

    assert (response.status_code, response.json()["detail"]) == (503, "matcher_not_configured")
