"""Authenticate the official SDK without leaking credentials into workflow logs."""
import os

_authenticated = False


def require_ci_key() -> None:
    if os.getenv("GITHUB_ACTIONS") == "true" and not os.getenv("VNSTOCK_API_KEY", "").strip():
        raise RuntimeError("VNSTOCK_API_KEY is required in GitHub Actions; configure the repository Actions secret")


def authenticate() -> None:
    global _authenticated
    require_ci_key()
    key = os.getenv("VNSTOCK_API_KEY", "").strip()
    if _authenticated or not key:
        return
    import vnstock
    try:
        vnstock.login(key)
    except Exception:
        raise RuntimeError("VNSTOCK_AUTH_FAILED: official API key login failed; check account/device entitlement") from None
    _authenticated = True
