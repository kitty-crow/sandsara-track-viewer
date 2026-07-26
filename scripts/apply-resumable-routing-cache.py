from __future__ import annotations

import base64
import hashlib
from pathlib import Path

root = Path(__file__).resolve().parent
part_names = ["00a", "00b", "01", "02", "03", "04", "05", "06a", "06b", "07"]
parts = [
    (root / f".apply-resumable-routing-cache.part{name}").read_text(encoding="utf-8")
    for name in part_names
]
for name, part in zip(part_names, parts, strict=True):
    print(f"part{name}: {len(part)} characters")
payload = "".join(parts)
print(f"payload: {len(payload)} characters")
source_bytes = base64.b64decode(payload, validate=True)
digest = hashlib.sha256(source_bytes).hexdigest()
print(f"decoded: {len(source_bytes)} bytes")
print(f"sha256: {digest}")
expected = "73ed1a46ad0034e2b54d4590f9af815c24b47589ff8db2b4d186a272269eeb7b"
if digest != expected:
    raise RuntimeError(f"Payload checksum mismatch: expected {expected}, received {digest}")
source = source_bytes.decode("utf-8")
exec(compile(source, "apply-resumable-routing-cache.payload.py", "exec"))
