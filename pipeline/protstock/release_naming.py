"""Current release labels for Core rules; historical identifiers stay immutable."""

import re


CORE_RELEASE_VERSION = "v0.0.0"
CORE_ENGINE_NAMES = {
    "Prot Core Engine v0.0": "Prot Core Engine · Mẫu hình",
    "Prot Core Engine v1.0": "Prot Core Engine · Nền tảng",
    "Prot Core Engine v2.0": "Prot Core Engine · Đa khung",
}


def release_core_rule_name(name: str) -> str:
    base = CORE_ENGINE_NAMES.get(name, re.sub(r"\s+v\d+(?:\.\d+){1,2}$", "", name))
    return f"{base} {CORE_RELEASE_VERSION}"
