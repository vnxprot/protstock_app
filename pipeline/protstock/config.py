from __future__ import annotations

from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    service_role_key: str
    timeout_seconds: float = 30.0

    @classmethod
    def from_env(cls) -> "Settings":
        url = os.getenv("SUPABASE_URL", "").rstrip("/")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
        if not url:
            raise ValueError("SUPABASE_URL is required")
        if not key:
            raise ValueError("SUPABASE_SERVICE_ROLE_KEY is required")
        return cls(supabase_url=url, service_role_key=key)
