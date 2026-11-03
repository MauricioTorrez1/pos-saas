"""Temporary module that gives CI something real to install and test.

The minimal FastAPI service (task F0-06) replaces it.
"""


def service_name() -> str:
    """Return the name of this service.

    Returns:
        The service name.
    """
    return "analytics"
