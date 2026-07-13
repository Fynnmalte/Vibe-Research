"""系统 AI 对话层 —— function calling 循环（OpenAI 兼容）。

让网页内置 AI 在回答时自己调 astock 数据工具（查行情/估值/研报/新闻），
拿到客观数据再作答。兼容豆包 / DeepSeek / 任意 OpenAI 兼容端点。

合规：工具只返回客观数据；system prompt 强制中立——不荐股、不预测涨跌、
不给买卖时机，只做信息整理与多视角分析。结论由用户配置的模型给出。
"""

from __future__ import annotations

import ipaddress
import json
import os
import socket
from urllib.parse import urlparse

import requests

import cli_runtime
import wstock

MAX_ROUNDS = 6  # 工具调用最大轮数，防死循环
_TOOL_RESULT_CAP = 6000  # 单次工具结果注入上限（控 token）

# 投研分析框架：用户要「分析个股 / 给判断 / 下结论」时，AI 一律按这五维组织，
# 让弱模型也能输出结构化、覆盖全、不漏项的专业解读。焊进 SYSTEM_PROMPT，不做成 UI 选项——
# 用户就问，给出的就是这套框架的结论。合规：框架只规定「怎么读数据」，每维只陈述事实与相对位置，
# 最后不给买卖结论。
ANALYSIS_FRAMEWORK = """[Analyse-Rahmen] Wenn der Nutzer eine Aktie analysieren oder einordnen lassen will, gliedere die Analyse nach diesen Dimensionen — je ein bis zwei Sätze mit Datenfakten und relativer Einordnung, am Ende nur objektive Zusammenfassung, keine Kauf/Verkauf-Schlussfolgerung:
1. Bewertung: KGV (trailing + forward), EPS, Marktkapitalisierung, Position innerhalb der 52-Wochen-Spanne, Vergleich zur Branche.
2. Kursverhalten: Tagesveränderung, Verhältnis zum Vortagesschluss, Nähe zu 52-Wochen-Hoch/-Tief, Handelsvolumen relativ zum Schnitt.
3. Markt- und Sektorumfeld: Wie laufen die Indizes (S&P, DAX, Hang Seng) und der zugehörige Sektor heute? Relative Stärke/Schwäche.
4. Nachrichtenlage: relevante aktuelle Meldungen/Themen aus dem Nachrichten-Radar, objektiv als Katalysatoren vs. Risiken getrennt.

Ausgabe (wie eine professionelle Kurzanalyse, aber nur objektive Fakten, kein Rating/Kursziel/Timing):
- Fazit zuerst: ein Satz zum aktuellen Zustand (Bewertung/Kurs/Umfeld), dann „Kennzahlen-Schnellübersicht".
- Jede Dimension als **fette Zwischenüberschrift** + kurzer Absatz, keine Zahlenwüste.
- Bei Vergleichen eine kleine Tabelle.
- Am Ende zwei Spalten: „Wichtige Beobachtungen" und „Risiken".
(Einfache Faktenfragen — z.B. „wie hoch ist der Kurs" — direkt beantworten, ohne den ganzen Rahmen.)"""

# f-string schweißt den Rahmen ein; nur {{context}} bleibt für .format() zur Laufzeit.
SYSTEM_PROMPT = f"""Du bist der Research-Assistent in Vibe-Research (Fokus: US-, EU- und Hongkong-Aktien).
Du kannst Werkzeuge aufrufen, um objektive Live-Daten zu holen, bevor du antwortest:
- search_stock: Name / ISIN / Ticker → passende Yahoo-Symbole (z.B. „Siemens" → SIE.DE).
- query_stock: vollständige Einzelaktien-Daten zu einem Symbol (Kurs, KGV, EPS, Marktkap., 52-Wochen).
- query_quotes: mehrere Symbole auf einmal (Kurs + Tagesveränderung).
- query_indices: Marktindizes (S&P 500, Nasdaq, Dow, DAX, Euro Stoxx, Hang Seng).
- query_movers: größte Tagesgewinner/-verlierer aus DAX 40 + US-Large-Caps.
Yahoo-Schreibweise: US-Ticker direkt (AAPL), Xetra mit .DE (SAP.DE), Hongkong mit .HK (0700.HK), Index mit ^ (^GDAXI).

Harte Regeln (unbedingt einhalten):
- Nur Informationsaufbereitung, Datendeutung und Analyse aus mehreren Blickwinkeln; keine konkreten Kauf/Verkauf-Empfehlungen, keine Kurs-/Preisprognosen, kein Timing, keine Renditeversprechen, keine Ratings.
- Wenn Daten nötig sind, erst das passende Werkzeug aufrufen, dann auf Basis der echten Daten antworten — keine Zahlen erfinden.
- Bei Einzelaktien immer die per Werkzeug geholten echten Daten nutzen; beide Seiten (Chancen/Risiken) darlegen, Urteil dem Nutzer überlassen.
- Antworte auf Deutsch, knapp und klar.

{ANALYSIS_FRAMEWORK}

Aktueller Seitenkontext:
{{context}}"""

# CLI-Abo (Claude Code / Qwen …) kann KEIN Function-Calling — die CLI ist Text rein/raus.
# Darum: keine Werkzeug-Aufforderung (die CLI würde sonst nach Tools suchen), stattdessen
# arbeitet sie ausschließlich mit den Daten, die die App vorab in den Kontext geladen hat.
SYSTEM_PROMPT_CLI = f"""Du bist der Research-Assistent in Vibe-Research (Fokus: US-, EU- und Hongkong-Aktien).

Wichtig: Du kannst KEINE Werkzeuge aufrufen. Alle verfügbaren Live-Daten stehen bereits im
Seitenkontext unten. Nutze ausschließlich diese Daten. Fehlt eine benötigte Zahl, sage das
offen — erfinde niemals Kurse, Kennzahlen oder Fakten.

Harte Regeln (unbedingt einhalten):
- Nur Informationsaufbereitung, Datendeutung und Analyse aus mehreren Blickwinkeln; keine konkreten Kauf/Verkauf-Empfehlungen, keine Kurs-/Preisprognosen, kein Timing, keine Renditeversprechen, keine Ratings.
- Beide Seiten (Chancen/Risiken) darlegen, das Urteil dem Nutzer überlassen.
- Antworte auf Deutsch, knapp und klar.

{ANALYSIS_FRAMEWORK}

Aktueller Seitenkontext (enthält die Live-Daten):
{{context}}"""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_stock",
            "description": "Aktie über Name, Ticker oder ISIN finden → passende Yahoo-Symbole. Bei unklarer Eingabe (Firmenname/ISIN) zuerst das aufrufen, dann mit dem Symbol weiter.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "Firmenname, Ticker oder ISIN, z.B. 'Siemens', 'AAPL', 'DE0007164600'"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_stock",
            "description": "Vollständige Einzelaktien-Daten: Kurs, Tagesveränderung, Vortagesschluss, OHLC, Volumen, Marktkapitalisierung, KGV (trailing+forward), EPS, 52-Wochen-Hoch/-Tief, Währung, Börse.",
            "parameters": {
                "type": "object",
                "properties": {"symbol": {"type": "string", "description": "Yahoo-Symbol, z.B. AAPL / SAP.DE / 0700.HK"}},
                "required": ["symbol"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_quotes",
            "description": "Kurse mehrerer Symbole auf einmal (Name, Kurs, Tagesveränderung, Währung). Für Vergleiche / Watchlists.",
            "parameters": {
                "type": "object",
                "properties": {"symbols": {"type": "array", "items": {"type": "string"}, "description": "Liste von Yahoo-Symbolen, z.B. ['AAPL','MSFT','SAP.DE']"}},
                "required": ["symbols"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_indices",
            "description": "Aktuelle Marktindizes: S&P 500, Nasdaq, Dow Jones, DAX, Euro Stoxx 50, Hang Seng (Stand + Tagesveränderung).",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_movers",
            "description": "Größte Tagesgewinner und -verlierer aus DAX 40 + US-Large-Caps (objektive Rangliste).",
            "parameters": {
                "type": "object",
                "properties": {"limit": {"type": "integer", "description": "Anzahl je Seite (Standard 8)"}},
            },
        },
    },
]


def _exec_tool(name: str, args: dict):
    """Werkzeug ausführen, serialisierbares Ergebnis zurück (bei Fehler error-Feld, kein Wurf)."""
    try:
        if name == "search_stock":
            return wstock.search(str(args.get("query", "")))
        if name == "query_stock":
            data = wstock.stock(str(args.get("symbol", "")))
            return data or {"error": f"Symbol '{args.get('symbol')}' nicht gefunden"}
        if name == "query_quotes":
            syms = [str(s).strip().upper() for s in args.get("symbols", []) if str(s).strip()]
            return list(wstock.quotes(syms).values())
        if name == "query_indices":
            return wstock.indices()
        if name == "query_movers":
            return wstock.movers(int(args.get("limit", 8)))
        return {"error": f"Unbekanntes Werkzeug {name}"}
    except Exception as e:  # noqa: BLE001 — Werkzeugfehler zurück ans Modell, Schleife läuft weiter
        return {"error": f"{name} fehlgeschlagen: {e}"}


# —— 防 SSRF：用户可自带 OpenAI 兼容端点，但后端替其发请求前要挡住指向云元数据/内网的地址 ——
_PUBLIC_MODE = bool(os.environ.get("VR_API_KEY", "").strip())  # 设了鉴权≈公网部署姿态
_METADATA_NETS = [ipaddress.ip_network("169.254.0.0/16"), ipaddress.ip_network("fe80::/10")]
_PRIVATE_NETS = [ipaddress.ip_network(n) for n in
                 ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "::1/128", "fc00::/7")]


def _ip_blocked(host: str) -> bool:
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False  # 非字面 IP（域名）——交给 _check_base_url 决定是否解析核对
    if any(ip in n for n in _METADATA_NETS):  # 云元数据 / 链路本地：SSRF 头号目标，始终禁
        return True
    if _PUBLIC_MODE and any(ip in n for n in _PRIVATE_NETS):  # 公网姿态再禁内网 / 本机
        return True
    return False


def _check_base_url(url: str) -> None:
    """挡住把用户自带 baseURL 指向云元数据 / 内网的 SSRF。
    本地单用户（未设 VR_API_KEY）放行 127.0.0.1 等本机地址（方便接本机 Ollama / 网关），只挡 169.254 元数据；
    公网部署（设了 VR_API_KEY）额外禁内网，并解析域名核对，防 DNS 指向内网。"""
    p = urlparse(url or "")
    if p.scheme not in ("http", "https"):
        raise RuntimeError("Base URL 必须以 http:// 或 https:// 开头")
    host = p.hostname or ""
    if not host:
        raise RuntimeError("Base URL 缺少主机名")
    if _ip_blocked(host):
        raise RuntimeError("Base URL 指向了不允许的地址（云元数据 / 内网）")
    if _PUBLIC_MODE:  # 公网姿态：域名也解析核对，防 DNS rebinding 指向内网
        try:
            infos = socket.getaddrinfo(host, None)
        except socket.gaierror as e:
            raise RuntimeError("Base URL 域名无法解析") from e
        for info in infos:
            if _ip_blocked(info[4][0]):
                raise RuntimeError("Base URL 解析到了不允许的内网地址")


def _call_llm(cfg: dict, messages: list, use_tools: bool) -> dict:
    _check_base_url(cfg.get("baseURL", ""))
    base = cfg["baseURL"].rstrip("/")
    if not base.endswith(("/v1", "/v3", "/api/v3")):
        # 多数 OpenAI 兼容端点需要 /v1；已带版本段则不动。
        base = base + "/v1"
    payload = {"model": cfg["model"], "messages": messages, "temperature": 0.3}
    if use_tools:
        payload["tools"] = TOOLS
        payload["tool_choice"] = "auto"
    r = requests.post(
        f"{base}/chat/completions",
        headers={"Authorization": f"Bearer {cfg['apiKey']}", "Content-Type": "application/json"},
        json=payload,
        timeout=90,
    )
    if r.status_code != 200:
        raise RuntimeError(f"模型接口 HTTP {r.status_code}: {r.text[:300]}")
    return r.json()


def run_chat(cfg: dict, user_messages: list, context: str = "") -> dict:
    """跑一轮完整对话（含 function calling 循环）。

    cfg: {baseURL, apiKey, model}
    user_messages: [{role, content}, ...]
    返回: {content, trace:[{tool,args}], rounds}
    """
    messages = [{"role": "system", "content": SYSTEM_PROMPT.format(context=context or "（无）")}]
    messages.extend(user_messages)
    trace: list[dict] = []

    for rnd in range(1, MAX_ROUNDS + 1):
        data = _call_llm(cfg, messages, use_tools=True)
        choice = data["choices"][0]["message"]
        messages.append(choice)
        tool_calls = choice.get("tool_calls") or []
        if not tool_calls:
            return {"content": choice.get("content") or "", "trace": trace, "rounds": rnd}

        for tc in tool_calls:
            fn = tc["function"]
            name = fn["name"]
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            result = _exec_tool(name, args)
            trace.append({"tool": name, "args": args})
            messages.append({
                "role": "tool",
                "tool_call_id": tc.get("id", ""),
                "content": json.dumps(result, ensure_ascii=False)[:_TOOL_RESULT_CAP],
            })

    # 超过最大轮数，最后再要一次不带工具的收尾回答
    data = _call_llm(cfg, messages, use_tools=False)
    return {"content": data["choices"][0]["message"].get("content") or "", "trace": trace, "rounds": MAX_ROUNDS}


def run_chat_cli(cfg: dict, user_messages: list, context: str = "") -> dict:
    """订阅接入：用本机已登录的 CLI 一次性作答（无 function-calling）。

    CLI 不能像 API 那条自己调数据工具，所以数据必须已在 context 里（每日复盘 / 今日要点 /
    个股页问 AI 等场景，前端已把当页数据塞进 context）。
    """
    provider = str(cfg.get("provider", ""))
    kind = provider[4:] if provider.startswith("cli-") else provider
    system = SYSTEM_PROMPT_CLI.format(context=context or "(keine)")
    user = "\n\n".join(m.get("content", "") for m in user_messages if m.get("content")) or "（无问题）"
    content = cli_runtime.run_cli(kind, system, user)
    return {"content": content, "trace": [], "rounds": 1}


# ---------------------------------------------------------------------------
# 流式版：yield 事件字典 {type: tool|delta|done|error}，供 /api/chat 以 NDJSON 推给前端
# ---------------------------------------------------------------------------

def _resolve_base(cfg: dict) -> str:
    base = cfg["baseURL"].rstrip("/")
    if not base.endswith(("/v1", "/v3", "/api/v3")):
        base = base + "/v1"
    return base


def _call_llm_stream(cfg: dict, messages: list, use_tools: bool):
    _check_base_url(cfg.get("baseURL", ""))
    payload = {"model": cfg["model"], "messages": messages, "temperature": 0.3, "stream": True}
    if use_tools:
        payload["tools"] = TOOLS
        payload["tool_choice"] = "auto"
    r = requests.post(
        f"{_resolve_base(cfg)}/chat/completions",
        headers={"Authorization": f"Bearer {cfg['apiKey']}", "Content-Type": "application/json"},
        json=payload, timeout=120, stream=True,
    )
    if r.status_code != 200:
        raise RuntimeError(f"模型接口 HTTP {r.status_code}: {r.text[:300]}")
    return r


def _iter_sse_deltas(resp):
    """解析上游 SSE 流，逐个 yield choices[0].delta。

    按字节缓冲、只解码「完整行」——`\\n` 是 ASCII(0x0A)不会落在多字节 UTF-8 字符内部，
    故按 `\\n` 切分再解码，避免 iter_lines(decode_unicode=True) 在网络分块处切断中文导致乱码。
    """
    buf = b""
    for chunk in resp.iter_content(chunk_size=None):
        if not chunk:
            continue
        buf += chunk
        while b"\n" in buf:
            raw, buf = buf.split(b"\n", 1)
            line = raw.decode("utf-8", errors="replace").strip()
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                return
            try:
                j = json.loads(data)
            except json.JSONDecodeError:
                continue
            choices = j.get("choices") or []
            if choices:
                yield choices[0].get("delta") or {}


def run_chat_stream(cfg: dict, user_messages: list, context: str = ""):
    """API 接入流式：function-calling 循环，边流答案边推工具调用事件。"""
    messages = [{"role": "system", "content": SYSTEM_PROMPT.format(context=context or "（无）")}]
    messages.extend(user_messages)
    trace: list[dict] = []

    for rnd in range(1, MAX_ROUNDS + 1):
        resp = _call_llm_stream(cfg, messages, use_tools=True)
        content_parts: list[str] = []
        tool_acc: dict[int, dict] = {}
        for delta in _iter_sse_deltas(resp):
            if delta.get("content"):
                content_parts.append(delta["content"])
                yield {"type": "delta", "text": delta["content"]}
            for tc in (delta.get("tool_calls") or []):
                idx = tc.get("index")
                if idx is None:
                    # 非标「OpenAI 兼容」网关可能不带 index：有 id 按 id 归位（新 id 开新槽），
                    # 无 id 则续拼最后一个调用，避免多个调用的 arguments 串到一起
                    tc_id = tc.get("id") or ""
                    idx = next((k for k, v in tool_acc.items() if tc_id and v["id"] == tc_id), None)
                    if idx is None:
                        idx = len(tool_acc) if (tc_id or not tool_acc) else max(tool_acc)
                acc = tool_acc.setdefault(idx, {"id": "", "name": "", "arguments": ""})
                if tc.get("id"):
                    acc["id"] = tc["id"]
                fn = tc.get("function") or {}
                if fn.get("name"):
                    acc["name"] = fn["name"]
                if fn.get("arguments"):
                    acc["arguments"] += fn["arguments"]

        if not tool_acc:  # 本轮是纯答案（已流完）→ 结束
            yield {"type": "done", "trace": trace, "rounds": rnd}
            return

        # 有工具调用：回填 assistant 消息 + 执行工具 + 推事件
        messages.append({
            "role": "assistant",
            "content": "".join(content_parts) or None,
            "tool_calls": [{
                "id": tool_acc[i]["id"], "type": "function",
                "function": {"name": tool_acc[i]["name"], "arguments": tool_acc[i]["arguments"]},
            } for i in sorted(tool_acc)],
        })
        for i in sorted(tool_acc):
            a = tool_acc[i]
            try:
                args = json.loads(a["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {}
            yield {"type": "tool", "tool": a["name"], "args": args}
            result = _exec_tool(a["name"], args)
            trace.append({"tool": a["name"], "args": args})
            messages.append({
                "role": "tool", "tool_call_id": a["id"],
                "content": json.dumps(result, ensure_ascii=False)[:_TOOL_RESULT_CAP],
            })

    # 超过最大轮数：不带工具收尾（非流式一次拿完再吐）
    data = _call_llm(cfg, messages, use_tools=False)
    yield {"type": "delta", "text": data["choices"][0]["message"].get("content") or ""}
    yield {"type": "done", "trace": trace, "rounds": MAX_ROUNDS}


def run_chat_cli_stream(cfg: dict, user_messages: list, context: str = ""):
    """订阅接入流式：CLI stdout 边出边推 delta。"""
    provider = str(cfg.get("provider", ""))
    kind = provider[4:] if provider.startswith("cli-") else provider
    system = SYSTEM_PROMPT_CLI.format(context=context or "(keine)")
    user = "\n\n".join(m.get("content", "") for m in user_messages if m.get("content")) or "（无问题）"
    for chunk in cli_runtime.run_cli_stream(kind, system, user):
        yield {"type": "delta", "text": chunk}
    yield {"type": "done", "trace": [], "rounds": 1}
