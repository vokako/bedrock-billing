# Bedrock Billing (Kiro Crew app)

A read-only Bedrock bill for the AWS account behind profile `default`: cost per model x Region, the
input / output / cache read / cache write split, tokens and USD, a reconciliation block and a CloudWatch token
cross-check. Page route: `/apps/bedrock-billing`.

## Install (from a local clone; nothing is published)

    git clone https://github.com/vokako/bedrock-billing.git
    kirocrew app install ./bedrock-billing
    kirocrew app enable bedrock-billing     # a local app is third-party: Kiro Crew asks you to trust it first

There is no build step: `ui/index.mjs` is plain ESM (React, the JSX runtime and the App SDK come from the host).
After pulling changes: `kirocrew app update bedrock-billing --source ./bedrock-billing`.

Requires the `aws` CLI with a profile named `default`.

## Scope
- **Scope**: the bill covers every service whose name contains "bedrock" (found at run time) except `Amazon Bedrock AgentCore` and `Amazon Bedrock Managed Knowledge Base`, which are excluded on purpose (`EXCLUDED_SERVICES` in `backend/fetch.py`). Cache files written before a service was excluded are ignored and refetched.

## Language
The page follows Kiro Crew's UI language (`<html lang>`): `zh*` shows Chinese, every other language shows English. It switches live when the language is changed in Settings, without refetching. Strings are in the `T` table at the top of `ui/index.mjs`; backend and AWS error text stays English.

## Layout
- `app.json` - manifest. `backend/` - Python (stdlib only). `ui/index.mjs` - the page. `tests/` - unit tests.
- Cache and data live in `~/.kiro/crew/apps/bedrock-billing/data/cache/` (cost numbers only, no credentials).

## What the backend runs, and with which rights
- Started by the gateway as `sys.executable backend/server.py` under the standard OS sandbox, with a minimal environment
  (PATH, HOME, ...; no AWS_* variables). Same privileges as Kiro Crew itself; app code is not isolated further.
- Listens on `127.0.0.1:<port auto>` only. Every request must carry the gateway's `X-KiroCrew-Proxy` HMAC
  (body- and path-bound, +-60 s); anything else gets 401.
- Subprocess calls, all through `aws --profile default`, all read-only:
  `ce get-cost-and-usage` (3 calls per fetch, about $0.03), `cloudwatch list-metrics`, `cloudwatch get-metric-data`.
  The profile is a constant in `backend/fetch.py`; no other profile is read, and no file under `~/.aws` is opened by app code.
- IAM needed by the `default` identity: `ce:GetCostAndUsage`, `cloudwatch:ListMetrics`, `cloudwatch:GetMetricData`.

## Fetching and cache
A fetch takes 30-60 s but the gateway proxy gives up after 30 s, so the backend fetches in a background thread and the
page polls every 2.5 s. Cache TTL 15 min (stale data is shown while a refresh runs); the Refresh button is ignored if the
cache is younger than 60 s; after a failed fetch no new one starts for 60 s. One fetch at a time per period.

## Data notes
- **Services**: found at run time by name (contains "bedrock"), so third-party models billed under their own service name are included.
- **Region**: taken from the usage-type prefix (USW2 -> us-west-2) and cross-checked against Cost Explorer's REGION dimension on the page.
- **Categories**: parsed from the usage-type name (input / output / cache read / cache write; 30m / 1h cache-write tiers are merged).
  Anything that does not parse (images, storage, ...) goes to "Other (non-token)"; it is never dropped.
- **Unit override**: Cost Explorer labels some per-1K-token quantities "1M tokens" (seen on OpenAI Mantle usage types). Cross-checked against
  CloudWatch they are really thousands of tokens, so `UNIT_OVERRIDE` in `backend/fetch.py` converts them as 1K. The CloudWatch table
  re-checks this on every fetch; if AWS fixes the label the CE / CloudWatch ratio of those rows becomes about 0.001 and the override should go.
- **CloudWatch vs Cost Explorer**: CloudWatch counts by invocation Region and ModelId, Cost Explorer by billed usage type, and model names are matched
  approximately, so small differences and some unmatched rows are expected.
- **Freshness**: Cost Explorer data for the current UTC day is delayed and may be incomplete. Ranges are UTC dates.

## Tests
    uv run --no-project --with pytest pytest -q tests
    <python shipped inside KiroCrew.app> tests/validate_manifest.py     # validates app.json with Kiro Crew's own parser
