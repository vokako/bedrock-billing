"""Call the backend the way the Kiro Crew gateway proxy does (HMAC-signed), for a standalone smoke test.

  BB_PORT=9177 BB_SECRET=... python3 tests/signed_client.py GET '/api/data?period=month'
The secret is read from the environment, never printed.
"""
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request


def call(method: str, target: str, body: bytes = b"", sign: bool = True) -> tuple[int, dict]:
    port, secret = os.environ["BB_PORT"], os.environ["BB_SECRET"]
    headers = {}
    if sign:
        ts = str(int(time.time()))
        msg = f"{ts}:{method}:{target}:{hashlib.sha256(body).hexdigest()}"
        headers["X-KiroCrew-Proxy"] = f"{ts}:{hmac.new(secret.encode(), msg.encode(), hashlib.sha256).hexdigest()}"
    req = urllib.request.Request(f"http://127.0.0.1:{port}{target}", data=body or None, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


if __name__ == "__main__":
    code, payload = call(sys.argv[1], sys.argv[2], b"{}" if sys.argv[1] == "POST" else b"")
    if "data" in payload:  # keep the output short: summary only
        d = payload["data"]
        payload = {**payload, "data": {k: d[k] for k in ("period", "start", "last_day_included", "fetched_at", "ce_total", "items_total", "cache")} | {"items": len(d["items"])}}
    print(code, json.dumps(payload)[:600])
