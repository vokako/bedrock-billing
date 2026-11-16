import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))
import fetch  # noqa: E402

B, S = "Amazon Bedrock", "Amazon Bedrock Service"


def p(u, s=B):
    r = fetch.parse_usage_type(u, s)
    return r["region"], r["model"], r["category"]


def test_mantle_variants():
    assert p("USW2-openai.gpt-6-astra-mantle-cache-read-tokens-long-ctx-global-standard") == ("us-west-2", "openai.gpt-6-astra", "cache_read")
    assert p("USW2-openai.gpt-6-astra-mantle-cache-write-tokens-30m-global-standard")[2] == "cache_write"
    assert p("USE2-xai.grok-4.7-mantle-output-tokens-global-standard") == ("us-east-2", "xai.grok-4.7", "output")


def test_legacy_names():
    assert p("USW2-Claude4.6Opus-cache-write-input-token-count-cross-region-global", S) == ("us-west-2", "Claude4.6Opus", "cache_write")
    assert p("USW2-Claude4.5Haiku-input-tokens-cross-region-global", S)[1:] == ("Claude4.5Haiku", "input")
    assert p("USW2-deepseek.v3.2-output-tokens")[1:] == ("deepseek.v3.2", "output")


def test_non_token_goes_to_other():
    assert p("USW2-SI-Ultra-V1-created_image", S) == ("us-west-2", "SI-Ultra-V1", "other")
    assert p("USE1-NovaCanvas-Customization-Storage")[2] == "other"
    assert p("USE2-Runtime:Consumption-based:Memory", "Amazon Bedrock AgentCore")[1:] == ("Amazon Bedrock AgentCore", "other")
    assert p("Weird")[0] == "无区域前缀"


def test_units():
    assert fetch.tokens_of(2, "1K tokens") == (2000, False)
    assert fetch.tokens_of(2, "1K Tokens") == (2000, False)
    assert fetch.tokens_of(2, "1M tokens") == (2000, True)  # CE label is wrong, see fetch.UNIT_OVERRIDE
    assert fetch.tokens_of(2, "Requests") == (None, False)


def test_periods():
    t = date(2026, 11, 15)
    assert fetch.period_range("month", t) == (date(2026, 11, 1), date(2026, 11, 16))
    assert fetch.period_range("last_month", t) == (date(2026, 10, 1), date(2026, 11, 1))
    assert fetch.period_range("last30", t) == (date(2026, 10, 17), date(2026, 11, 16))


def test_model_key_matches_cw():
    assert fetch._norm_model("Claude4.5Haiku") == fetch._norm_model("global.anthropic.claude-haiku-4-5-20251001-v1:0")
    assert fetch._norm_model("openai.gpt-6-astra") == fetch._norm_model("global.openai.gpt-6-astra")
    assert fetch._norm_model("openai.gpt-6-astra") != fetch._norm_model("openai.gpt-6.1-sol")


def test_agentcore_is_not_part_of_the_bill():
    names = ["Amazon Bedrock", "Amazon Bedrock Service", "Amazon Bedrock AgentCore", "Amazon Bedrock Managed Knowledge Base",
             "Claude Sonnet 4 (Amazon Bedrock Edition)", "Amazon S3"]
    assert fetch.bedrock_services(names) == ["Amazon Bedrock", "Amazon Bedrock Service",
                                             "Claude Sonnet 4 (Amazon Bedrock Edition)"]


def test_cache_written_before_the_exclusion_is_ignored(tmp_path, monkeypatch):
    import json
    monkeypatch.setattr(fetch, "CACHE_DIR", tmp_path)
    (tmp_path / "month.json").write_text(json.dumps({"services": ["Amazon Bedrock", "Amazon Bedrock AgentCore"]}))
    assert fetch.read_cache("month") is None
    (tmp_path / "month.json").write_text(json.dumps({"services": ["Amazon Bedrock"]}))
    assert fetch.read_cache("month")["services"] == ["Amazon Bedrock"]
