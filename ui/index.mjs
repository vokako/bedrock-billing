// Bedrock Billing - Kiro Crew app page. Plain ESM, no build step: React, the JSX runtime and the App SDK come from the
// host import map. The dashboard itself is DOM code mounted into one div; recorded values only ever reach the page via
// textContent (h() never uses innerHTML).
import { useEffect, useRef } from "react";
import { jsx } from "react/jsx-runtime";
import { useAppApi } from "@kirocrew/app-sdk";

const CSS = `
.bb-root{box-sizing:border-box;padding:16px 24px 32px;color:var(--text);font-size:14px;line-height:1.5;
  --c-input:#3b82f6;--c-output:#f59e0b;--c-cache_read:#10b981;--c-cache_write:#8b5cf6;--c-other:#94a3b8}
.bb-root *{box-sizing:border-box}
.bb-root h1{font-size:20px;margin:0;color:var(--text-strong)}.bb-root h2{font-size:15px;margin:0 0 8px;color:var(--text-strong)}
.bb-root .top{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:6px}
.bb-root .sub{font-weight:400;color:var(--muted);font-size:13px}
.bb-root .meta{color:var(--muted);font-size:12.5px;margin-bottom:12px}
.bb-root .tabs{display:flex;gap:6px;flex-wrap:wrap}
.bb-root button{font:inherit;background:var(--card);color:var(--card-fg);border:1px solid var(--border);border-radius:6px;padding:5px 12px;cursor:pointer}
.bb-root button.on{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}
.bb-root button:disabled{opacity:.55;cursor:wait}
.bb-root .card{background:var(--card);color:var(--card-fg);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:14px;overflow-x:auto}
.bb-root .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:14px}
.bb-root .kpi{background:var(--card);color:var(--card-fg);border:1px solid var(--border);border-radius:8px;padding:10px 14px}
.bb-root .kpi b{display:block;font-size:22px;font-variant-numeric:tabular-nums}.bb-root .kpi span{color:var(--muted);font-size:12px}
.bb-root .note{border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:13px}
.bb-root .note.warn{background:var(--warn-subtle);color:var(--warn)}.bb-root .note.bad{background:var(--danger-subtle);color:var(--danger)}.bb-root .note.ok{background:var(--ok-subtle);color:var(--ok)}
.bb-root table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
.bb-root th,.bb-root td{padding:5px 8px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap}
.bb-root th:first-child,.bb-root td:first-child,.bb-root th.l,.bb-root td.l{text-align:left}
.bb-root th{color:var(--muted);font-weight:600;font-size:12.5px;user-select:none}.bb-root th.s{cursor:pointer}.bb-root th.s:hover{color:var(--text-strong)}
.bb-root tfoot td{font-weight:700;border-top:2px solid var(--border);border-bottom:0}
.bb-root td small{display:block;color:var(--muted);font-size:11px}
.bb-root .nd{color:var(--muted);font-style:italic}
.bb-root .leg{display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;margin-bottom:8px}
.bb-root .sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px}
.bb-root .bar{display:grid;grid-template-columns:minmax(120px,240px) 1fr 90px;gap:8px;align-items:center;margin:3px 0;font-size:12.5px}
.bb-root .bar .lab{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bb-root .bar .track{display:flex;height:16px;background:var(--bg-hover);border-radius:3px;overflow:hidden}
.bb-root .bar .track i{display:block;height:100%}
.bb-root .bar .val{text-align:right;font-variant-numeric:tabular-nums}
.bb-root .chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.bb-root .chip{border:1px solid var(--border);border-radius:14px;padding:2px 10px;font-size:12.5px}
.bb-root .ck{display:grid;grid-template-columns:24px 1fr auto auto;gap:4px 10px;font-size:13px;align-items:baseline}
.bb-root .pass{color:var(--ok)}.bb-root .fail{color:var(--danger)}
.bb-root details summary{cursor:pointer;font-weight:600;margin-bottom:8px}
@media (max-width:640px){.bb-root{padding:12px}.bb-root .bar{grid-template-columns:90px 1fr 70px}}
`;


// ---- UI language: follows the dashboard's own language (<html lang>, set by Kiro Crew). zh* -> Chinese, anything else -> English.
function detectLang() { return String(document.documentElement.lang || navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en"; }
let lang = "en";
const T = {
  zh: {
    catOther: "其他（非 token）", periodMonth: "本月", periodLastMonth: "上月", periodLast30: "最近 30 天", noData: "无数据",
    title: "Bedrock 账单", sub: "只读 · Cost Explorer（USD, UnblendedCost）", refresh: "刷新（重新抓取）",
    restModels: (n) => `其余 ${n} 个模型/项目`, chartTitle: "各模型费用（按分项堆叠，前 12 名）",
    t1Title: "表一：每个模型 × 每个 Region 的开销", subtotal: (r, c) => `${r} 小计 ${c}`,
    colModel: "模型 / 项目", colCost: "费用 (USD)", colTokens: "Token 数", colShare: "占总费用", total: "合计",
    t2Title: "表二：按模型合并（跨 Region），分项费用 / token", colTotalUsd: "合计 (USD)", colPct: "占比",
    t3Title: "表三：每个分项的 token 数量与美元成本", colCategory: "分项", colAvg: "均价 ($ / 1M tokens)", colTypes: "usage type 条数",
    tokenSubtotal: "token 类合计", grandTotal: "总计（含非 token）",
    avgNote: "均价 = 该分项费用 ÷ token 数，仅用于发现异常；Anthropic / OpenAI 等 Mantle 计费项的 usage type 含 long-ctx、30m 等档位，混合后均价无单价含义。",
    checks: "核对", ck1: (s) => `CE：Bedrock 相关服务（${s}）按服务汇总`, ck2: "CE：同一筛选下 SERVICE × USAGE_TYPE 明细合计", ck3: "CE：REGION × SERVICE 分组合计",
    ck4: "页面表一合计", ck5: "页面表二合计", ck6: "页面表三合计", baseline: "基准", match: "一致", diff: (x) => "差 " + x,
    colCeRegion: "CE REGION 维度", colPrefix: "usage type 前缀推断", colDiff: "差异", sep: "：", listSep: "；",
    cwTitle: (n, g) => `交叉验证：CE token 数 vs CloudWatch AWS/Bedrock（${n} 项，${g} 项差异 ≤5%）`, cwFail: "CloudWatch 读取失败：",
    cwNote: "CloudWatch 按调用所在 Region 与 ModelId 统计，CE 按计费 usage type 统计，二者分组口径不同；模型名只能做近似匹配。CE 未出现的模型 / CW 没有的指标显示“无数据”。",
    colCeModel: "模型（CE 名称）", unmatchedCE: "CE 有、CW 未匹配到的模型：", unmatchedCW: "CW 有 token、CE 未匹配到的模型：",
    rawTitle: (n) => `usage type 明细（${n} 条，原始数量 / 单位与换算后的 token）`,
    rawCols: ["服务", "usage type", "Region", "模型", "分项", "CE 数量", "CE 单位", "换算 tokens", "费用"], converted: " ⚠已按 1K 换算",
    emptyRange: (a, b) => `该时间范围（${a} ～ ${b}）内 Bedrock 相关服务没有费用记录。请切换到“上月”或“最近 30 天”。`,
    todayNote: (d) => `范围含今天（${d}，UTC）：Cost Explorer 当天数据通常延迟、可能不完整。`,
    unitNote: (n, c) => `${n} 个 usage type（费用 ${c}）在 CE 里的单位标成“1M tokens”，与 CloudWatch 对照后实际是“1K tokens”，页面已按 1K 换算。如 AWS 修正了标签，请看下方交叉验证里这些模型的比值是否变成约 0.001。`,
    kpiTotal: (a, b) => `Bedrock 总费用（${a} ～ ${b}）`, kpiTokens: (n) => `总 token 数（input+output+cache，${n}）`,
    kpiTokenCost: "其中 token 计费", kpiOther: "其中非 token（图像、存储等）", kpiModels: "有 token 用量的模型数 / Region 数",
    ago: (s) => s < 90 ? `${s} 秒前` : s < 5400 ? `${Math.round(s / 60)} 分钟前` : `${(s / 3600).toFixed(1)} 小时前`,
    meta: (a, b, when, ago, ttl, prof, thr) => `范围：${a} ～ ${b}（UTC，含两端）　抓取时间：${when}（${ago}，缓存 ${ttl} 分钟）　profile：${prof}` + (thr ? "　距上次抓取不足 60 秒，已沿用缓存" : ""),
    refreshingBg: "后台正在从线上抓取最新数据（Cost Explorer + CloudWatch，约 40–60 秒），当前显示的是缓存。", lastFailed: (e) => "最近一次抓取失败：" + e,
    pending: "正在从线上抓取（Cost Explorer + CloudWatch），首次约 40–60 秒…", fetchFailed: (e) => `抓取失败：${e}（60 秒后可重试）`, unknownError: "未知错误",
    readFailed: (e) => "读取失败：" + e, dateLocale: "zh-CN",
  },
  en: {
    catOther: "Other (non-token)", periodMonth: "This month", periodLastMonth: "Last month", periodLast30: "Last 30 days", noData: "No data",
    title: "Bedrock Billing", sub: "Read-only · Cost Explorer (USD, UnblendedCost)", refresh: "Refresh (re-fetch)",
    restModels: (n) => `${n} other models/items`, chartTitle: "Cost per model (stacked by category, top 12)",
    t1Title: "Table 1: cost per model × Region", subtotal: (r, c) => `${r} subtotal ${c}`,
    colModel: "Model / item", colCost: "Cost (USD)", colTokens: "Tokens", colShare: "% of total", total: "Total",
    t2Title: "Table 2: per model across Regions, cost / tokens by category", colTotalUsd: "Total (USD)", colPct: "Share",
    t3Title: "Table 3: tokens and USD per category", colCategory: "Category", colAvg: "Avg ($ / 1M tokens)", colTypes: "Usage types",
    tokenSubtotal: "Token categories subtotal", grandTotal: "Grand total (incl. non-token)",
    avgNote: "Average = category cost ÷ tokens. Use it only to spot anomalies: Mantle usage types mix tiers (long-ctx, 30m, …), so the blended figure is not a unit price.",
    checks: "Reconciliation", ck1: (s) => `CE: Bedrock-related services (${s}), by service`, ck2: "CE: SERVICE × USAGE_TYPE detail, same filter", ck3: "CE: REGION × SERVICE grouping",
    ck4: "Page: Table 1 total", ck5: "Page: Table 2 total", ck6: "Page: Table 3 total", baseline: "Baseline", match: "Match", diff: (x) => "Diff " + x,
    colCeRegion: "CE REGION dimension", colPrefix: "Inferred from usage type prefix", colDiff: "Difference", sep: ": ", listSep: "; ",
    cwTitle: (n, g) => `Cross-check: CE tokens vs CloudWatch AWS/Bedrock (${n} rows, ${g} within 5%)`, cwFail: "CloudWatch read failed: ",
    cwNote: "CloudWatch counts by invocation Region and ModelId; CE counts by billed usage type. The groupings differ and model names can only be matched approximately. A model missing from CE / a metric missing from CloudWatch shows “No data”.",
    colCeModel: "Model (CE name)", unmatchedCE: "In CE but not matched in CloudWatch: ", unmatchedCW: "In CloudWatch with tokens but not matched in CE: ",
    rawTitle: (n) => `Usage type detail (${n} rows: raw quantity / unit, and converted tokens)`,
    rawCols: ["Service", "Usage type", "Region", "Model", "Category", "CE quantity", "CE unit", "Converted tokens", "Cost"], converted: " ⚠ converted as 1K",
    emptyRange: (a, b) => `No Bedrock-related charges in this range (${a} – ${b}). Try “Last month” or “Last 30 days”.`,
    todayNote: (d) => `The range includes today (${d}, UTC): Cost Explorer data for the current day is usually delayed and may be incomplete.`,
    unitNote: (n, c) => `${n} usage types (cost ${c}) are labelled “1M tokens” in CE, but cross-checking with CloudWatch shows they are really “1K tokens”; the page converts them as 1K. If AWS fixes the label, the CE ÷ CW ratio of these models in the cross-check below will drop to about 0.001.`,
    kpiTotal: (a, b) => `Total Bedrock cost (${a} – ${b})`, kpiTokens: (n) => `Total tokens (input+output+cache, ${n})`,
    kpiTokenCost: "of which token-billed", kpiOther: "of which non-token (images, storage, …)", kpiModels: "Models with token usage / Regions",
    ago: (s) => s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${(s / 3600).toFixed(1)} h ago`,
    meta: (a, b, when, ago, ttl, prof, thr) => `Range: ${a} – ${b} (UTC, inclusive)   Fetched: ${when} (${ago}, cache ${ttl} min)   Profile: ${prof}` + (thr ? "   Last fetch was under 60 s ago; using the cache" : ""),
    refreshingBg: "Fetching the latest data in the background (Cost Explorer + CloudWatch, about 40–60 s). The cached data is shown meanwhile.", lastFailed: (e) => "The last fetch failed: " + e,
    pending: "Fetching from AWS (Cost Explorer + CloudWatch). The first fetch takes about 40–60 s…", fetchFailed: (e) => `Fetch failed: ${e} (can retry in 60 s)`, unknownError: "unknown error",
    readFailed: (e) => "Request failed: " + e, dateLocale: "en-US",
  },
};
const t = (key, ...args) => { const v = (T[lang] || T.en)[key]; return typeof v === "function" ? v(...args) : v; };

function mount(root, api) {
  ensureStyle();
  lang = detectLang();
  const BASE = "/apps/bedrock-billing/api";
  const CATS = ["input", "output", "cache_read", "cache_write", "other"];
  const CAT_LABEL = {input: "Input", output: "Output", cache_read: "Cache read", cache_write: "Cache write", get other() { return t("catOther"); }};
  const PERIODS = [["month", "periodMonth"], ["last_month", "periodLastMonth"], ["last30", "periodLast30"]];
  const POLL_MS = 2500;
  let period = "month", data = null, sort = {key: "cost", dir: -1};
  let gen = 0, timer = null, destroyed = false, busy = false, lastError = null, shownKey = "";
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") e.className = v; else if (k === "style") e.style.cssText = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  }
  const usd = (x) => x === 0 ? "$0.00" : Math.abs(x) < 0.01 ? "<$0.01" : "$" + x.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const int = (x) => Math.round(x).toLocaleString("en-US");
  function compact(x) {
    const a = Math.abs(x);
    if (a >= 1e9) return (x / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return (x / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return (x / 1e3).toFixed(1) + "K";
    return String(Math.round(x));
  }
  const nd = () => h("span", {class: "nd"}, t("noData"));
  const tokCell = (t) => t === null ? nd() : h("span", {title: int(t) + " tokens"}, compact(t));

  function aggregate(items) {
    const mr = new Map(), mo = new Map(), ca = {};
    for (const c of CATS) ca[c] = {cost: 0, tokens: c === "other" ? null : 0, n: 0};
    for (const it of items) {
      const isTok = it.category !== "other", t = isTok ? it.tokens : null;
      const k = it.model + "\u0000" + it.region;
      const r = mr.get(k) || {model: it.model, region: it.region, cost: 0, tokens: null};
      r.cost += it.cost; if (isTok) r.tokens = (r.tokens || 0) + t; mr.set(k, r);
      const m = mo.get(it.model) || {model: it.model, cost: 0, tokens: null, cat: {}};
      m.cost += it.cost; if (isTok) m.tokens = (m.tokens || 0) + t;
      const c = m.cat[it.category] || {cost: 0, tokens: isTok ? 0 : null, n: 0};
      c.cost += it.cost; if (isTok) c.tokens += t; c.n++; m.cat[it.category] = c; mo.set(it.model, m);
      ca[it.category].cost += it.cost; if (isTok) ca[it.category].tokens += t; ca[it.category].n++;
    }
    return {mr: [...mr.values()], mo: [...mo.values()].sort((a, b) => b.cost - a.cost), ca};
  }

  function renderChart(a) {
    const top = a.mo.slice(0, 12), rest = a.mo.slice(12);
    const rows = top.map((m) => ({label: m.model, cat: m.cat, cost: m.cost}));
    if (rest.length) {
      const cat = {};
      for (const m of rest) for (const [c, v] of Object.entries(m.cat)) cat[c] = {cost: (cat[c]?.cost || 0) + v.cost};
      rows.push({label: t("restModels", rest.length), cat, cost: rest.reduce((s, m) => s + m.cost, 0)});
    }
    const max = Math.max(...rows.map((r) => r.cost), 1e-9);
    const leg = h("div", {class: "leg"}, CATS.map((c) => h("span", {}, h("i", {class: "sw", style: `background:var(--c-${c})`}), CAT_LABEL[c])));
    const bars = rows.map((r) => h("div", {class: "bar"},
      h("div", {class: "lab", title: r.label}, r.label),
      h("div", {class: "track"}, CATS.filter((c) => r.cat[c] && r.cat[c].cost > 0).map((c) =>
        h("i", {style: `width:${(r.cat[c].cost / max) * 100}%;background:var(--c-${c})`, title: `${CAT_LABEL[c]} ${usd(r.cat[c].cost)}`}))),
      h("div", {class: "val"}, usd(r.cost))));
    return h("div", {class: "card"}, h("h2", {}, t("chartTitle")), leg, bars);
  }

  function renderT1(a, total) {
    const rows = a.mr.slice().sort((x, y) => {
      const k = sort.key, vx = k === "tokens" ? (x.tokens ?? -1) : x[k], vy = k === "tokens" ? (y.tokens ?? -1) : y[k];
      return (typeof vx === "string" ? vx.localeCompare(vy) : vx - vy) * sort.dir;
    });
    const reg = new Map();
    for (const r of a.mr) reg.set(r.region, (reg.get(r.region) || 0) + r.cost);
    const th = (key, label, left) => h("th", {class: "s" + (left ? " l" : ""), onclick: () => { sort = {key, dir: sort.key === key ? -sort.dir : -1}; draw(); }},
      label + (sort.key === key ? (sort.dir < 0 ? " ▼" : " ▲") : ""));
    return h("div", {class: "card"}, h("h2", {}, t("t1Title")),
      h("div", {class: "chips"}, [...reg.entries()].sort((x, y) => y[1] - x[1]).map(([r, c]) => h("span", {class: "chip"}, t("subtotal", r, usd(c))))),
      h("table", {},
        h("thead", {}, h("tr", {}, th("model", t("colModel"), true), th("region", "Region", true), th("cost", t("colCost")), th("tokens", t("colTokens")), h("th", {}, t("colShare")))),
        h("tbody", {}, rows.map((r) => h("tr", {}, h("td", {}, r.model), h("td", {class: "l"}, r.region), h("td", {}, usd(r.cost)), h("td", {}, tokCell(r.tokens)),
          h("td", {}, total > 0 ? (r.cost / total * 100).toFixed(1) + "%" : nd())))),
        h("tfoot", {}, h("tr", {}, h("td", {}, t("total")), h("td", {}), h("td", {}, usd(a.mr.reduce((s, r) => s + r.cost, 0))),
          h("td", {}, compact(a.ca.input.tokens + a.ca.output.tokens + a.ca.cache_read.tokens + a.ca.cache_write.tokens)), h("td", {}, "100%")))));
  }

  function renderT2(a, total) {
    const cell = (m, c) => { const v = m.cat[c]; return v ? h("td", {}, usd(v.cost), v.tokens === null ? null : h("small", {}, compact(v.tokens) + " tok")) : h("td", {}, nd()); };
    return h("div", {class: "card"}, h("h2", {}, t("t2Title")),
      h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, t("colModel")), CATS.map((c) => h("th", {}, CAT_LABEL[c])), h("th", {}, t("colTotalUsd")), h("th", {}, t("colPct")))),
        h("tbody", {}, a.mo.map((m) => h("tr", {}, h("td", {}, m.model), CATS.map((c) => cell(m, c)), h("td", {}, usd(m.cost)), h("td", {}, total > 0 ? (m.cost / total * 100).toFixed(1) + "%" : nd())))),
        h("tfoot", {}, h("tr", {}, h("td", {}, t("total")), CATS.map((c) => h("td", {}, usd(a.ca[c].cost))), h("td", {}, usd(a.mo.reduce((s, m) => s + m.cost, 0))), h("td", {}, "100%")))));
  }

  function renderT3(a, total) {
    const tt = a.ca.input.tokens + a.ca.output.tokens + a.ca.cache_read.tokens + a.ca.cache_write.tokens;
    const tokCost = CATS.filter((c) => c !== "other").reduce((s, c) => s + a.ca[c].cost, 0);
    return h("div", {class: "card"}, h("h2", {}, t("t3Title")),
      h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, t("colCategory")), h("th", {}, t("colTokens")), h("th", {}, t("colCost")), h("th", {}, t("colPct")), h("th", {}, t("colAvg")), h("th", {}, t("colTypes")))),
        h("tbody", {}, CATS.map((c) => { const v = a.ca[c];
          return h("tr", {}, h("td", {}, CAT_LABEL[c]), h("td", {}, v.tokens === null ? nd() : int(v.tokens)), h("td", {}, usd(v.cost)),
            h("td", {}, total > 0 ? (v.cost / total * 100).toFixed(1) + "%" : nd()),
            h("td", {}, v.tokens === null ? nd() : v.tokens > 0 ? "$" + (v.cost / v.tokens * 1e6).toFixed(3) : nd()), h("td", {}, v.n)); })),
        h("tfoot", {},
          h("tr", {}, h("td", {}, t("tokenSubtotal")), h("td", {}, int(tt)), h("td", {}, usd(tokCost)), h("td", {}, total > 0 ? (tokCost / total * 100).toFixed(1) + "%" : nd()), h("td", {}, tt > 0 ? "$" + (tokCost / tt * 1e6).toFixed(3) : nd()), h("td", {})),
          h("tr", {}, h("td", {}, t("grandTotal")), h("td", {}, int(tt)), h("td", {}, usd(total)), h("td", {}, "100%"), h("td", {}), h("td", {}, a.ca.input.n + a.ca.output.n + a.ca.cache_read.n + a.ca.cache_write.n + a.ca.other.n)))),
      h("div", {class: "meta", style: "margin:6px 0 0"}, t("avgNote")));
  }

  function renderChecks(a, total) {
    const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
    const ce = data.ce_total;
    const lines = [
      [t("ck1", data.services.join(" / ")), ce, t("baseline")],
      [t("ck2"), data.items_total],
      [t("ck3"), sum(Object.values(data.regions_ce), (x) => x)],
      [t("ck4"), sum(a.mr, (r) => r.cost)],
      [t("ck5"), sum(a.mo, (m) => m.cost)],
      [t("ck6"), sum(CATS, (c) => a.ca[c].cost)],
    ];
    const ok = (x) => Math.abs(x - ce) < 0.005;
    const rows = lines.map(([label, v, tag]) => [h("span", {class: ok(v) ? "pass" : "fail"}, ok(v) ? "✓" : "✗"), h("span", {}, label), h("span", {}, usd(v)),
      h("span", {class: ok(v) ? "" : "fail"}, tag || (ok(v) ? t("match") : t("diff", (v - ce).toFixed(4))))]);
    const regs = [...new Set([...Object.keys(data.regions_ce), ...Object.keys(data.regions_parsed)])];
    const regRows = regs.map((r) => { const c = data.regions_ce[r], p = data.regions_parsed[r]; const d = (c ?? 0) - (p ?? 0);
      return h("tr", {}, h("td", {}, r), h("td", {}, c === undefined ? nd() : usd(c)), h("td", {}, p === undefined ? nd() : usd(p)), h("td", {class: Math.abs(d) < 0.005 ? "pass" : "fail"}, Math.abs(d) < 0.005 ? t("match") : d.toFixed(4))); });
    const svc = Object.entries(data.service_totals).map(([k, v]) => h("span", {class: "chip"}, `${k}${t("sep")}${usd(v)}`));
    return h("div", {class: "card"}, h("h2", {}, t("checks")), h("div", {class: "ck"}, rows.flat()),
      h("div", {class: "chips", style: "margin-top:10px"}, svc),
      h("table", {style: "margin-top:6px"}, h("thead", {}, h("tr", {}, h("th", {}, "Region"), h("th", {}, t("colCeRegion")), h("th", {}, t("colPrefix")), h("th", {}, t("colDiff")))), h("tbody", {}, regRows)));
  }

  function renderCW(a) {
    const ceM = new Map(), cwM = new Map();
    for (const it of data.items) {
      if (it.category === "other") continue;
      const key = it.region + "|" + data.ce_model_keys[it.model];
      const e = ceM.get(key) || {region: it.region, model: it.model, cat: {}}; e.cat[it.category] = (e.cat[it.category] || 0) + it.tokens; ceM.set(key, e);
    }
    for (const [region, models] of Object.entries(data.cloudwatch.by_region)) for (const [mid, cats] of Object.entries(models)) {
      const key = region + "|" + data.cw_model_keys[mid];
      const e = cwM.get(key) || {region, ids: [], cat: {}}; e.ids.push(mid);
      for (const [c, v] of Object.entries(cats)) e.cat[c] = (e.cat[c] || 0) + v; cwM.set(key, e);
    }
    const rows = [], unmatchedCW = [];
    for (const key of new Set([...ceM.keys(), ...cwM.keys()])) {
      const ce = ceM.get(key), cw = cwM.get(key);
      if (!ce) { if (Object.values(cw.cat).some((v) => v > 0)) unmatchedCW.push(`${cw.region} ${cw.ids.join(",")}`); continue; }
      for (const c of ["input", "output", "cache_read", "cache_write"]) {
        const x = ce.cat[c], y = cw ? cw.cat[c] : undefined;
        if (!x && !y) continue;
        rows.push({region: ce.region, model: ce.model, c, x, y, ratio: x && y ? x / y : null});
      }
    }
    const cls = (r) => r.ratio === null ? "warn" : Math.abs(r.ratio - 1) <= 0.05 ? "ok" : "bad";
    rows.sort((p, q) => Math.max(q.x || 0, q.y || 0) - Math.max(p.x || 0, p.y || 0));
    const good = rows.filter((r) => cls(r) === "ok").length;
    const errs = Object.entries(data.cloudwatch.errors);
    const sumCE = (c) => rows.filter((r) => r.c === c).reduce((s, r) => s + (r.x || 0), 0), sumCW = (c) => rows.filter((r) => r.c === c).reduce((s, r) => s + (r.y || 0), 0);
    const unmatchedCE = [...ceM.values()].filter((e) => ![...cwM.keys()].includes(e.region + "|" + data.ce_model_keys[e.model])).map((e) => `${e.region} ${e.model}`);
    return h("details", {class: "card"}, h("summary", {}, t("cwTitle", rows.length, good)),
      errs.length ? h("div", {class: "note bad"}, t("cwFail") + errs.map(([r, m]) => `${r}: ${m}`).join(t("listSep"))) : null,
      h("div", {class: "note warn"}, t("cwNote")),
      h("div", {class: "meta"}, ["input", "output", "cache_read", "cache_write"].map((c) => `${CAT_LABEL[c]}${t("sep")}CE ${compact(sumCE(c))} / CW ${compact(sumCW(c))}`).join("  |  ")),
      h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Region"), h("th", {}, t("colCeModel")), h("th", {}, t("colCategory")), h("th", {}, "CE tokens"), h("th", {}, "CW tokens"), h("th", {}, "CE ÷ CW"))),
        h("tbody", {}, rows.map((r) => h("tr", {}, h("td", {}, r.region), h("td", {class: "l"}, r.model), h("td", {class: "l"}, CAT_LABEL[r.c]),
          h("td", {}, r.x === undefined ? nd() : int(r.x)), h("td", {}, r.y === undefined ? nd() : int(r.y)),
          h("td", {class: cls(r) === "ok" ? "pass" : cls(r) === "bad" ? "fail" : ""}, r.ratio === null ? "—" : r.ratio.toFixed(3)))))),
      unmatchedCE.length ? h("div", {class: "meta"}, t("unmatchedCE") + unmatchedCE.join(t("listSep"))) : null,
      unmatchedCW.length ? h("div", {class: "meta"}, t("unmatchedCW") + unmatchedCW.join(t("listSep"))) : null);
  }

  function renderRaw() {
    return h("details", {class: "card"}, h("summary", {}, t("rawTitle", data.items.length)),
      h("table", {}, h("thead", {}, h("tr", {}, t("rawCols").map((col, i) => h("th", {class: i < 5 ? "l" : ""}, col)))),
        h("tbody", {}, data.items.map((i) => h("tr", {}, h("td", {}, i.service), h("td", {class: "l"}, i.usage_type), h("td", {class: "l"}, i.region), h("td", {class: "l"}, i.model), h("td", {class: "l"}, CAT_LABEL[i.category]),
          h("td", {}, i.quantity.toLocaleString("en-US", {maximumSignificantDigits: 6})), h("td", {class: i.unit_overridden ? "fail" : ""}, i.unit + (i.unit_overridden ? t("converted") : "")),
          h("td", {}, i.tokens === null ? nd() : int(i.tokens)), h("td", {}, usd(i.cost)))))));
  }

  function draw() {
    const app = ui.app; app.replaceChildren();
    if (!data) return;
    const items = data.items;
    if (!items.length) {
      app.append(h("div", {class: "note warn"}, t("emptyRange", data.start, data.last_day_included)));
      return;
    }
    const a = aggregate(items), total = data.ce_total;
    const tokens = a.ca.input.tokens + a.ca.output.tokens + a.ca.cache_read.tokens + a.ca.cache_write.tokens;
    const models = new Set(items.filter((i) => i.category !== "other").map((i) => i.model)), regions = new Set(items.map((i) => i.region));
    const overridden = items.filter((i) => i.unit_overridden);
    const notes = [];
    if (data.fetched_at.slice(0, 10) === data.last_day_included) notes.push(h("div", {class: "note warn"}, t("todayNote", data.last_day_included)));
    if (overridden.length) notes.push(h("div", {class: "note warn"}, t("unitNote", overridden.length, usd(overridden.reduce((s, i) => s + i.cost, 0)))));
    const othersCost = a.ca.other.cost;
    const tokenCost = total - othersCost;
    app.append(
      h("div", {class: "kpis"},
        h("div", {class: "kpi"}, h("b", {}, usd(total)), h("span", {}, t("kpiTotal", data.start, data.last_day_included))),
        h("div", {class: "kpi"}, h("b", {}, compact(tokens)), h("span", {title: int(tokens)}, t("kpiTokens", int(tokens)))),
        h("div", {class: "kpi"}, h("b", {}, usd(tokenCost)), h("span", {}, t("kpiTokenCost"))),
        h("div", {class: "kpi"}, h("b", {}, usd(othersCost)), h("span", {}, t("kpiOther"))),
        h("div", {class: "kpi"}, h("b", {}, `${models.size} / ${regions.size}`), h("span", {}, t("kpiModels")))),
      ...notes, renderChart(a), renderT1(a, total), renderT2(a, total), renderT3(a, total), renderChecks(a, total), renderCW(a), renderRaw());
  }

  const ui = {};
  function build() {
    ui.tabs = h("div", {class: "tabs"});
    ui.refresh = h("button", {onclick: () => load(true), disabled: busy}, t("refresh"));
    ui.meta = h("div", {class: "meta"});
    ui.msg = h("div", {});
    ui.app = h("div", {});
    root.append(
      h("div", {class: "top"},
        h("h1", {}, t("title") + " ", h("span", {class: "sub"}, t("sub"))),
        h("div", {style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center"}, ui.tabs, ui.refresh)),
      ui.meta, ui.msg, ui.app);
    drawTabs();
  }
  function drawTabs() {
    ui.tabs.replaceChildren(...PERIODS.map(([k, key]) => h("button", {class: k === period ? "on" : "", onclick: () => { if (k !== period) { period = k; data = null; shownKey = ""; lastError = null; drawTabs(); drawMeta(); draw(); load(false); } }}, t(key))));
  }
  let msg = null;  // {kind, fn}: kept as a function so it can be re-rendered when the UI language changes
  function say(kind, fn) { msg = fn ? {kind, fn} : null; drawMsg(); }
  function drawMsg() { ui.msg.replaceChildren(msg ? h("div", {class: "note " + msg.kind}, msg.fn()) : ""); }
    function drawMeta() {
    if (!data) { ui.meta.textContent = ""; return; }
    const c = data.cache, when = new Date(data.fetched_at).toLocaleString(t("dateLocale"), {hour12: false});
    ui.meta.textContent = t("meta", data.start, data.last_day_included, when, t("ago", c.age_s), c.ttl_s / 60, data.profile, c.refresh_throttled);
  }
  function handle(r, myGen) {
    if (destroyed || myGen !== gen) return;
    clearTimeout(timer);
    lastError = r.error || null;
    if (r.state === "ready") {
      const key = r.data.period + "|" + r.data.fetched_at;
      data = r.data;
      if (key !== shownKey) { shownKey = key; draw(); }
      drawMeta();
      busy = !!r.data.cache.refreshing;
      if (busy) { say("ok", () => t("refreshingBg")); poll(myGen); }
      else { const e = lastError; say(e ? "bad" : "", e ? () => t("lastFailed", e) : null); }
    } else if (r.state === "pending") {
      busy = true; say("ok", () => t("pending")); poll(myGen);
    } else {
      busy = false; { const e = r.error; say("bad", () => t("fetchFailed", e || t("unknownError"))); };
    }
    ui.refresh.disabled = busy;
  }
  function poll(myGen) { timer = setTimeout(() => load(false, myGen), POLL_MS); }
  async function load(refresh, keepGen) {
    const myGen = keepGen ?? ++gen;
    if (keepGen === undefined) clearTimeout(timer);
    try {
      const r = refresh ? await api.post(`${BASE}/refresh?period=${period}`, {}) : await api.get(`${BASE}/data?period=${period}`);
      handle(r, myGen);
    } catch (e) {
      if (destroyed || myGen !== gen) return;
      busy = false; ui.refresh.disabled = false; { const m = String(e && e.message || e); say("bad", () => t("readFailed", m)); };
    }
  }

  function relayout() {  // language changed: rebuild the static parts and redraw the data in place (no refetch)
    root.replaceChildren();
    build(); drawMeta(); drawMsg(); draw();
    ui.refresh.disabled = busy;
  }
  const langWatch = new MutationObserver(() => { const next = detectLang(); if (next !== lang) { lang = next; relayout(); } });
  langWatch.observe(document.documentElement, {attributes: true, attributeFilter: ["lang"]});

  build();
  load(false);
  return () => { destroyed = true; clearTimeout(timer); langWatch.disconnect(); root.replaceChildren(); };
}

let styleEl = null;
function ensureStyle() {
  if (styleEl && styleEl.isConnected) return;
  styleEl = document.createElement("style");
  styleEl.textContent = CSS;
  document.head.append(styleEl);
}

export { mount }; // also exported so the page can be exercised without the host (tests)

export default function BedrockBilling() {
  const api = useAppApi();
  const apiRef = useRef(api);
  apiRef.current = api;
  const ref = useRef(null);
  useEffect(() => {
    return mount(ref.current, apiRef.current);
  }, []);
  return jsx("div", {ref, className: "bb-root", style: {flex: 1, minHeight: 0, overflowY: "auto"}});
}
