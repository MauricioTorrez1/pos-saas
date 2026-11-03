from pos_analytics.ci_smoke import service_name


def test_returns_service_name() -> None:
    assert service_name() == "analytics"
