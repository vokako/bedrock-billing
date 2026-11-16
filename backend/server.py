"""Backend of the Bedrock Billing app (Kiro Crew App Kit).

Kiro Crew proxies /apps/bedrock-billing/api/* to this process and signs every request
(X-KiroCrew-Proxy HMAC); unsigned or stale requests get 401. Listens on 127.0.0.1 only.

The AWS fetch takes ~40 s but the gateway proxy gives up after 30 s, so a fetch runs in a
background thread: GET /api/data returns the cache (or "pending") immediately and the page
polls until the job finishes.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

import fetch

APP_NAME = os.environ.get("KIROCREW_APP_NAME", "bedrock-billing")
PORT = int(os.environ.get("PORT", 9100))
SECRET = os.environ.get("KIROCREW_PROXY_SECRET", "")
PERIODS = {"month", "last_month", "last30"}
ERROR_BACKOFF_S = 60  # after a failed fetch, do not start another one (each costs ~$0.03) for this long

_lock = threading.Lock()
_running: set[str] = set()
_errors: dict[str, tuple[float, str]] = {}  # period -> (time, message)


def start_job(period: str) -> bool:
    """Start a background fetch unless one is already running. Returns True if one was started."""
    with _lock:
        if period in _running:
            return False
        _running.add(period)
    threading.Thread(target=_job, args=(period,), daemon=True).start()
    return True


def _job(period: str) -> None:
    try:
        fetch.refresh(period)
        _errors.pop(period, None)
    except Exception as exc:  # noqa: BLE001 - shown on the page; message is aws CLI stderr, never credentials
        _errors[period] = (time.time(), f"{type(exc).__name__}: {exc}"[:400])
    finally:
        with _lock:
            _running.discard(period)


def data_payload(period: str, force: bool) -> dict:
    cached = fetch.read_cache(period)
    err = _errors.get(period)
    recent_err = err if err and time.time() - err[0] < ERROR_BACKOFF_S else None
    age = cached["cache"]["age_s"] if cached else None
    throttled = bool(force and age is not None and age < fetch.MIN_REFRESH_S)
    stale = age is None or age >= (fetch.MIN_REFRESH_S if force else fetch.CACHE_TTL_S)
    if stale and not throttled and not recent_err:
        start_job(period)
    refreshing = period in _running
    if cached:
        cached["cache"].update(refreshing=refreshing, refresh_throttled=throttled)
        return {"state": "ready", "data": cached, "error": err[1] if err else None}
    if recent_err and not refreshing:
        return {"state": "error", "error": recent_err[1]}
    return {"state": "pending"}


def verify(header: str, method: str, target: str, body: bytes) -> bool:
    """Check the gateway's X-KiroCrew-Proxy header: '<ts>:<hmac-sha256 hex>' over 'ts:method:target:sha256(body)'."""
    if not SECRET or ":" not in header:
        return False
    stamp, _, signature = header.partition(":")
    try:
        if abs(time.time() - float(stamp)) > 60:
            return False
    except ValueError:
        return False
    message = f"{stamp}:{method}:{target}:{hashlib.sha256(body).hexdigest()}"
    expected = hmac.new(SECRET.encode(), message.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, data: dict) -> None:
        payload = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def _handle(self, method: str) -> None:
        parts = urlsplit(self.path)
        if parts.path == "/health":
            return self._send(200, {"status": "ok", "app": APP_NAME})
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        if not verify(self.headers.get("X-KiroCrew-Proxy", ""), method, self.path, body):
            return self._send(401, {"error": "unauthorized"})
        period = parse_qs(parts.query).get("period", ["month"])[0]
        if period not in PERIODS:
            return self._send(400, {"error": f"period must be one of {sorted(PERIODS)}"})
        if method == "GET" and parts.path == "/api/data":
            return self._send(200, data_payload(period, force=False))
        if method == "POST" and parts.path == "/api/refresh":
            return self._send(200, data_payload(period, force=True))
        self._send(404, {"error": "not found"})

    def do_GET(self) -> None:  # noqa: N802
        self._handle("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._handle("POST")

    def log_message(self, *args) -> None:  # request lines carry no secrets, but keep the log quiet
        pass


if __name__ == "__main__":
    print(f"{APP_NAME} backend on 127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
