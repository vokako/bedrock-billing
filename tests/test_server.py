import hashlib
import hmac
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))
import server  # noqa: E402


def sign(ts, method, target, body=b"", secret="s3cret"):
    msg = f"{ts}:{method}:{target}:{hashlib.sha256(body).hexdigest()}"
    return f"{ts}:{hmac.new(secret.encode(), msg.encode(), hashlib.sha256).hexdigest()}"


def test_verify(monkeypatch):
    monkeypatch.setattr(server, "SECRET", "s3cret")
    now = int(time.time())
    assert server.verify(sign(now, "GET", "/api/data?period=month"), "GET", "/api/data?period=month", b"")
    assert not server.verify(sign(now, "GET", "/api/data?period=month"), "GET", "/api/data?period=last30", b"")  # target bound
    assert not server.verify(sign(now, "POST", "/api/refresh", b"{}"), "POST", "/api/refresh", b"x")  # body bound
    assert not server.verify(sign(now - 120, "GET", "/x"), "GET", "/x", b"")  # stale
    assert not server.verify(sign(now, "GET", "/x", secret="other"), "GET", "/x", b"")
    assert not server.verify("", "GET", "/x", b"")


def test_unconfigured_secret_rejects_everything(monkeypatch):
    monkeypatch.setattr(server, "SECRET", "")
    assert not server.verify(sign(int(time.time()), "GET", "/x", secret=""), "GET", "/x", b"")


def test_fresh_cache_does_not_start_a_fetch(monkeypatch):
    started = []
    monkeypatch.setattr(server, "start_job", lambda p: started.append(p) or True)
    monkeypatch.setattr(server.fetch, "read_cache", lambda p: {"cache": {"age_s": 10, "ttl_s": 900}})
    assert server.data_payload("month", force=False)["state"] == "ready"
    assert server.data_payload("month", force=True)["data"]["cache"]["refresh_throttled"] is True  # <60 s: ignored
    assert started == []


def test_stale_cache_and_missing_cache_start_one_fetch(monkeypatch):
    started = []
    monkeypatch.setattr(server, "start_job", lambda p: started.append(p) or True)
    monkeypatch.setattr(server.fetch, "read_cache", lambda p: {"cache": {"age_s": 2000, "ttl_s": 900}})
    server.data_payload("month", force=False)
    assert started == ["month"]
    monkeypatch.setattr(server.fetch, "read_cache", lambda p: None)
    assert server.data_payload("last30", force=False)["state"] == "pending"
    assert started == ["month", "last30"]


def test_failed_fetch_backs_off(monkeypatch):
    started = []
    monkeypatch.setattr(server, "start_job", lambda p: started.append(p) or True)
    monkeypatch.setattr(server.fetch, "read_cache", lambda p: None)
    monkeypatch.setitem(server._errors, "month", (time.time(), "boom"))
    out = server.data_payload("month", force=False)
    assert out == {"state": "error", "error": "boom"} and started == []
