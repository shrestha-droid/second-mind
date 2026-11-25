"""Secret redaction and the token estimate used for context packs."""
import re
from math import ceil

SECRET_RES = [re.compile(p) for p in (
    r"(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}",
    r"(?<![A-Za-z0-9])ghp_[A-Za-z0-9]{36}",
    r"(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}",
    r"(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}",
    r"(?<![A-Za-z0-9])xox[abprs]-[A-Za-z0-9-]{10,}",
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----",
)]


def redact(text: str) -> str:
    for r in SECRET_RES:
        text = r.sub("[REDACTED]", text)
    return text


def estimate_tokens(text: str) -> int:
    return ceil(len(text) / 4)
