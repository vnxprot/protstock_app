import sys
from types import SimpleNamespace

import pytest

from protstock import vnstock_auth as auth


def test_ci_without_key_fails_before_sdk(monkeypatch):
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.delenv("VNSTOCK_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="VNSTOCK_API_KEY"):
        auth.authenticate()


def test_login_once_per_worker(monkeypatch):
    calls = []
    monkeypatch.setattr(auth, "_authenticated", False)
    monkeypatch.setenv("VNSTOCK_API_KEY", "test-private-key")
    monkeypatch.setitem(sys.modules, "vnstock", SimpleNamespace(login=calls.append))
    auth.authenticate()
    auth.authenticate()
    assert calls == ["test-private-key"]


def test_auth_failure_never_exposes_key(monkeypatch):
    def login(key):
        raise ValueError(key)
    monkeypatch.setattr(auth, "_authenticated", False)
    monkeypatch.setenv("VNSTOCK_API_KEY", "test-private-key")
    monkeypatch.setitem(sys.modules, "vnstock", SimpleNamespace(login=login))
    with pytest.raises(RuntimeError, match="VNSTOCK_AUTH_FAILED") as error:
        auth.authenticate()
    assert "test-private-key" not in str(error.value)
