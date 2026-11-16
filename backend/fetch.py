"""Fetch Bedrock cost/usage from Cost Explorer (+ CloudWatch cross-check) via the `aws` CLI.

Read-only: only ce:GetCostAndUsage, cloudwatch:ListMetrics and cloudwatch:GetMetricData are called.
Why the aws CLI and not boto3: it is already installed and configured (profile / credential_process),
so the project needs zero dependencies and never touches credential files itself.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

PROFILE = "default"  # fixed on purpose: this app never reads any other AWS profile
APP_NAME = os.environ.get("KIROCREW_APP_NAME", "bedrock-billing")
# App data dir as Kiro Crew lays it out; survives `kirocrew app update`.
CACHE_DIR = Path(os.environ.get("KIROCREW_HOME", os.path.expanduser("~/.kiro/crew"))) / "apps" / APP_NAME / "data" / "cache"
CACHE_TTL_S = 900  # 15 min: each CE call costs ~$0.01, a fetch makes 3
MIN_REFRESH_S = 60  # a forced refresh is ignored when the cache is younger than this
# The gateway starts backends with a minimal PATH, so fall back to the usual install location.
AWS_BIN = shutil.which("aws") or "/opt/homebrew/bin/aws"
CE_REGION = "us-east-1"  # Cost Explorer endpoint

# CE usage-type prefix -> region code. Unknown prefixes are shown raw, never guessed.
REGION_PREFIX = {
    "USE1": "us-east-1", "USE2": "us-east-2", "USW1": "us-west-1", "USW2": "us-west-2",
    "APN1": "ap-northeast-1", "APN2": "ap-northeast-2", "APN3": "ap-northeast-3",
    "APS1": "ap-southeast-1", "APS2": "ap-southeast-2", "APS3": "ap-south-1",
    "CAN1": "ca-central-1", "EUC1": "eu-central-1", "EUW1": "eu-west-1", "EU": "eu-west-1",
    "EUW2": "eu-west-2", "EUW3": "eu-west-3", "EUN1": "eu-north-1", "EUS1": "eu-south-1",
    "SAE1": "sa-east-1", "AFS1": "af-south-1", "MES1": "me-south-1", "UGW1": "us-gov-west-1",
}

# CE labels some per-1K-token quantities as "1M tokens". Cross-checked against CloudWatch (see README):
# the numbers are really thousands of tokens. Kept as one explicit override; the CloudWatch table on the
# page re-checks it on every fetch, so a future AWS fix shows up as a ~1/1000 ratio.
UNIT_TOKENS = {"1k tokens": 1e3, "1m tokens": 1e6, "tokens": 1.0}
UNIT_OVERRIDE = {"1m tokens": 1e3}

CATEGORIES = ("input", "output", "cache_read", "cache_write")
_TOKEN_RE = re.compile(
    r"^(?P<pfx>[A-Z]{2,4}\d?)-(?P<model>.+?)-(?:mantle-)?"
    r"(?P<cat>cache-read-input-token-count|cache-write-input-token-count|cache-read-tokens|"
    r"cache-write-tokens|input-token-count|output-token-count|input-tokens|output-tokens)"
    r"(?P<rest>(?:-.*)?)$"
)
_CAT_MAP = {
    "cache-read-input-token-count": "cache_read", "cache-read-tokens": "cache_read",
    "cache-write-input-token-count": "cache_write", "cache-write-tokens": "cache_write",
    "input-token-count": "input", "input-tokens": "input",
    "output-token-count": "output", "output-tokens": "output",
}
_PFX_RE = re.compile(r"^(?P<pfx>[A-Z]{2,4}\d?)-(?P<rest>.+)$")
_IMG_RE = re.compile(r"^(?P<model>.+?)-created[-_]image")


class AwsError(RuntimeError):
    pass


def aws(*args: str, region: str | None = None) -> dict:
    cmd = [AWS_BIN, "--profile", PROFILE, "--output", "json", *args]
    if region:
        cmd += ["--region", region]
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if p.returncode != 0:
        raise AwsError(f"aws {' '.join(args[:2])} failed: {p.stderr.strip()[:300]}")
    return json.loads(p.stdout) if p.stdout.strip() else {}


def parse_usage_type(usage_type: str, service: str) -> dict:
    """Split a CE usage type into region / model / category / tags. Unparseable -> category 'other'."""
    m = _PFX_RE.match(usage_type)
    pfx = m["pfx"] if m else ""
    region = REGION_PREFIX.get(pfx, pfx or "无区域前缀")
    t = _TOKEN_RE.match(usage_type)
    if t:
        rest = t["rest"].lower()
        tags = [x for x in ("long-ctx", "global", "cross-region", "flex", "standard", "30m", "1h") if x in rest]
        return {"region": region, "model": t["model"], "category": _CAT_MAP[t["cat"]], "tags": tags}
    body = m["rest"] if m else usage_type
    if service not in ("Amazon Bedrock", "Amazon Bedrock Service"):
        model = service  # AgentCore / Knowledge Base: infrastructure, not a model
    elif (i := _IMG_RE.match(body)):
        model = i["model"]
    else:
        model = body
    return {"region": region, "model": model, "category": "other", "tags": []}


def tokens_of(quantity: float, unit: str) -> tuple[float | None, bool]:
    """-> (token count or None if the unit is not a token unit, whether the unit label was overridden)."""
    u = unit.strip().lower()
    if u not in UNIT_TOKENS:
        return None, False
    if u in UNIT_OVERRIDE:
        return quantity * UNIT_OVERRIDE[u], True
    return quantity * UNIT_TOKENS[u], False


def period_range(period: str, today: date | None = None) -> tuple[date, date]:
    """[start, end) in UTC dates, as CE expects. End is exclusive, so 'today' is included via tomorrow."""
    today = today or datetime.now(timezone.utc).date()
    if period == "month":
        return today.replace(day=1), today + timedelta(days=1)
    if period == "last_month":
        first = today.replace(day=1)
        return (first - timedelta(days=1)).replace(day=1), first
    if period == "last30":
        return today - timedelta(days=29), today + timedelta(days=1)
    raise ValueError(f"unknown period {period!r}")


def _ce(start: date, end: date, group_by: list[str], flt: dict | None, metrics: list[str]) -> list[dict]:
    """One logical CE query, following NextPageToken; returns Groups merged across time buckets."""
    acc: dict[tuple, dict] = {}
    token = None
    while True:
        args = ["ce", "get-cost-and-usage", "--time-period", f"Start={start},End={end}",
                "--granularity", "MONTHLY", "--metrics", *metrics]
        args += ["--group-by", *[f"Type=DIMENSION,Key={g}" for g in group_by]]  # one flag, several values
        tmp = None
        if flt:
            tmp = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
            json.dump(flt, tmp)
            tmp.close()
            args += ["--filter", f"file://{tmp.name}"]
        if token:
            args += ["--next-page-token", token]
        try:
            d = aws(*args, region=CE_REGION)
        finally:
            if tmp:
                os.unlink(tmp.name)
        for r in d.get("ResultsByTime", []):
            for g in r.get("Groups", []):
                key = tuple(g["Keys"])
                slot = acc.setdefault(key, {"keys": key, "metrics": {}})
                for name, v in g["Metrics"].items():
                    cur = slot["metrics"].setdefault(name, {"amount": 0.0, "unit": v.get("Unit", "")})
                    cur["amount"] += float(v["Amount"])
        token = d.get("NextPageToken")
        if not token:
            return list(acc.values())


# Bedrock-named services that are not part of the model bill (a separate product, not model usage).
EXCLUDED_SERVICES = frozenset({"Amazon Bedrock AgentCore", "Amazon Bedrock Managed Knowledge Base"})


def bedrock_services(names) -> list[str]:
    """Every service whose name contains 'bedrock' (found at run time), minus EXCLUDED_SERVICES."""
    return sorted(n for n in names if "bedrock" in n.lower() and n not in EXCLUDED_SERVICES)


def _norm_model(name: str) -> str:
    """Canonical key so CE names (Claude4.5Haiku, anthropic.claude-opus-5-5) match CW ModelIds."""
    s = re.sub(r"^(global|us|eu|apac|jp|au)\.", "", name.lower())
    s = re.sub(r"-\d{8}(-v\d+(:\d+)?)?$", "", s)
    s = re.sub(r"-v\d+(:\d+)?$", "", s)
    s = s.replace("-mantle", "")
    parts = re.findall(r"[a-z]+|\d+", s)
    vendors = {"anthropic", "openai", "xai", "moonshotai", "zai", "qwen", "deepseek", "stability", "cohere", "meta", "amazon"}
    return "".join(sorted(p for p in parts if p not in vendors))


CW_METRICS = {"input": "InputTokenCount", "output": "OutputTokenCount",
              "cache_read": "CacheReadInputTokenCount", "cache_write": "CacheWriteInputTokenCount"}


def _cloudwatch(regions: list[str], start: date, end: date) -> dict:
    """{region: {model_id: {category: tokens}}} from AWS/Bedrock, ModelId-only series. Errors are per-region."""
    out: dict = {}
    errors: dict = {}
    for region in regions:
        try:
            ms = aws("cloudwatch", "list-metrics", "--namespace", "AWS/Bedrock", region=region).get("Metrics", [])
            series = []
            for m in ms:
                if m["MetricName"] in CW_METRICS.values() and [d["Name"] for d in m["Dimensions"]] == ["ModelId"]:
                    series.append((m["Dimensions"][0]["Value"], m["MetricName"]))
            res: dict = defaultdict(lambda: defaultdict(float))
            for i in range(0, len(series), 400):
                batch = series[i:i + 400]
                queries = [{"Id": f"q{j}", "MetricStat": {"Metric": {"Namespace": "AWS/Bedrock", "MetricName": mn,
                            "Dimensions": [{"Name": "ModelId", "Value": mid}]}, "Period": 86400, "Stat": "Sum"},
                            "ReturnData": True} for j, (mid, mn) in enumerate(batch)]
                with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
                    json.dump(queries, f)
                try:
                    d = aws("cloudwatch", "get-metric-data", "--start-time", f"{start}T00:00:00Z",
                            "--end-time", f"{end}T00:00:00Z", "--metric-data-queries", f"file://{f.name}", region=region)
                finally:
                    os.unlink(f.name)
                inv = {v: k for k, v in CW_METRICS.items()}
                for r in d.get("MetricDataResults", []):
                    mid, mn = batch[int(r["Id"][1:])]
                    res[mid][inv[mn]] += sum(r.get("Values", []))
            out[region] = {k: dict(v) for k, v in res.items()}
        except (AwsError, subprocess.TimeoutExpired) as e:
            errors[region] = str(e)[:300]
    return {"by_region": out, "errors": errors}


def build(period: str) -> dict:
    start, end = period_range(period)
    # 1) all services, to discover every Bedrock-related service name (third-party models may have their own)
    svc_all = _ce(start, end, ["SERVICE"], None, ["UnblendedCost"])
    services = bedrock_services(k["keys"][0] for k in svc_all)
    svc_total = {k["keys"][0]: k["metrics"]["UnblendedCost"]["amount"] for k in svc_all if k["keys"][0] in services}
    if not services:
        return _empty(period, start, end)
    flt = {"Dimensions": {"Key": "SERVICE", "Values": services}}
    # 2) detail: service x usage type with quantity; 3) CE's own region grouping as an independent check
    ut = _ce(start, end, ["SERVICE", "USAGE_TYPE"], flt, ["UnblendedCost", "UsageQuantity"])
    reg = _ce(start, end, ["REGION", "SERVICE"], flt, ["UnblendedCost"])

    items = []
    for k in ut:
        service, usage_type = k["keys"]
        cost = k["metrics"]["UnblendedCost"]["amount"]
        q = k["metrics"]["UsageQuantity"]
        p = parse_usage_type(usage_type, service)
        toks, overridden = (tokens_of(q["amount"], q["unit"]) if p["category"] != "other" else (None, False))
        if p["category"] != "other" and toks is None:  # token-looking usage type with a non-token unit: don't guess
            p["category"], p["tags"] = "other", p["tags"] + ["unrecognised-unit"]
        items.append({"service": service, "usage_type": usage_type, "cost": cost, "quantity": q["amount"],
                      "unit": q["unit"], "tokens": toks, "unit_overridden": overridden, **p})
    items.sort(key=lambda x: -x["cost"])

    regions_ce = {}
    for k in reg:
        regions_ce[k["keys"][0]] = regions_ce.get(k["keys"][0], 0.0) + k["metrics"]["UnblendedCost"]["amount"]
    regions_parsed: dict = defaultdict(float)
    for it in items:
        regions_parsed[it["region"]] += it["cost"]

    token_regions = sorted({it["region"] for it in items if it["category"] != "other" and it["region"] in REGION_PREFIX.values()})
    cw = _cloudwatch(token_regions, start, end)

    return {
        "period": period, "start": str(start), "end_exclusive": str(end),
        "last_day_included": str(end - timedelta(days=1)),
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "profile": PROFILE, "services": services, "service_totals": svc_total,
        "ce_total": sum(svc_total.values()),
        "items_total": sum(i["cost"] for i in items),
        "regions_ce": regions_ce, "regions_parsed": dict(regions_parsed),
        "items": items, "cloudwatch": cw,
        "cw_model_keys": {mid: _norm_model(mid) for r in cw["by_region"].values() for mid in r},
        "ce_model_keys": {m: _norm_model(m) for m in {i["model"] for i in items if i["category"] != "other"}},
        "ce_calls": 3,
    }


def _empty(period: str, start: date, end: date) -> dict:
    return {"period": period, "start": str(start), "end_exclusive": str(end), "last_day_included": str(end - timedelta(days=1)),
            "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "profile": PROFILE, "services": [],
            "service_totals": {}, "ce_total": 0.0, "items_total": 0.0, "regions_ce": {}, "regions_parsed": {}, "items": [],
            "cloudwatch": {"by_region": {}, "errors": {}}, "cw_model_keys": {}, "ce_model_keys": {}, "ce_calls": 1}


def read_cache(period: str) -> dict | None:
    """The cached payload for a period (any age) with its age in seconds, or None."""
    path = CACHE_DIR / f"{period}.json"
    try:
        data = json.loads(path.read_text())
        age = int(time.time() - path.stat().st_mtime)
    except (OSError, ValueError):
        return None
    if EXCLUDED_SERVICES & set(data.get("services", [])):
        return None  # cached before a service was excluded from the bill: do not show it, refetch
    return {**data, "cache": {"age_s": age, "ttl_s": CACHE_TTL_S}}


def refresh(period: str) -> None:
    """Fetch from AWS (about 40 s, 3 CE calls) and replace the cache atomically. Raises AwsError."""
    data = build(period)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = CACHE_DIR / f"{period}.json.tmp"
    tmp.write_text(json.dumps(data))
    tmp.replace(CACHE_DIR / f"{period}.json")
