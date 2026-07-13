"""Vibe-Research 后端 —— A股数据层 HTTP 接口（FastAPI）。

端点全部在 /api 下，前端 vite 代理 /api → localhost:8900。
只读、无状态、按用户传入代码返回客观数据。不预置标的、不建议。

启动：
    uvicorn app:app --host 127.0.0.1 --port 8900
"""

from __future__ import annotations

import json
import re
import os

from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import astock
import chat as chat_layer
import cli_runtime
import gstock
import newsradar
import portfolio as pf
import market
import myreports as mr
import wstock
import theses
import quant
import backtest
import agent as agent_mod
import notify

app = FastAPI(title="Vibe-Research API", version="0.1.1")

# 每半小时后台刷新持仓数据
pf.start_scheduler(1800)

# CORS：默认放开（本地自托管友好）；公网部署时用 VR_ALLOW_ORIGINS 收紧成白名单。
#   例：VR_ALLOW_ORIGINS="https://myhost"  （逗号分隔多个）
_ORIGINS = [o.strip() for o in os.environ.get("VR_ALLOW_ORIGINS", "*").split(",") if o.strip()] or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ORIGINS,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# 可选鉴权：设了 VR_API_KEY 就要求所有 /api/* 带 `Authorization: Bearer <key>`
#   （本地自托管不设=开放；公网部署务必设，否则别人能读你的持仓/调你的后端）。
_API_KEY = os.environ.get("VR_API_KEY", "").strip()


@app.middleware("http")
async def _require_api_key(request: Request, call_next):
    if (
        _API_KEY
        and request.method != "OPTIONS"
        and request.url.path.startswith("/api/")
        and request.url.path != "/api/health"
    ):
        if request.headers.get("authorization", "") != f"Bearer {_API_KEY}":
            return JSONResponse({"detail": "未授权：缺少或错误的 API Key（VR_API_KEY）"}, status_code=401)
    return await call_next(request)

_CODE_RE = r"^\d{6}$"
# Yahoo-Symbol: AAPL, SAP.DE, 0700.HK, BRK-B, ^GDAXI
_SYMBOL_RE = re.compile(r"^[A-Z0-9^][A-Z0-9.\-]{0,11}$")


def _validate(code: str) -> str:
    code = (code or "").strip()
    if not code.isdigit() or len(code) != 6:
        raise HTTPException(400, "代码必须是 6 位数字")
    return code


@app.get("/api/health")
def health():
    return {"ok": True, "service": "vibe-research-api", "version": "0.1.1"}


class LLMConfig(BaseModel):
    provider: str = ""       # cli-* = 订阅接入（调本机 CLI）；其余 = API 接入
    baseURL: str = ""        # 订阅接入时留空
    apiKey: str = ""         # 订阅接入时留空
    model: str


class ChatReq(BaseModel):
    messages: list[dict]
    context: str = ""
    llm: LLMConfig


@app.post("/api/chat")
def chat(req: ChatReq):
    """系统 AI 对话，**流式** NDJSON（每行一个事件 {type: tool|delta|done|error}）。

    - API 接入：OpenAI 兼容 function-calling，边流答案边推工具调用事件。
    - 订阅接入（provider=cli-*）：调本机已登录的 CLI，stdout 边出边流（数据靠 context）。
    配置错误（缺 key / 未装 CLI）走 HTTP 400；运行时错误走流内 error 事件。用户配置随请求传入，后端不持久化。
    """
    if not req.messages:
        raise HTTPException(400, "messages 不能为空")
    if not req.llm.model:
        raise HTTPException(400, "缺少模型配置，请先在「接入 AI」里选择")

    is_cli = req.llm.provider.startswith("cli-")
    if is_cli:
        kind = req.llm.provider[4:]
        if not cli_runtime.detect_cli(kind):
            raise HTTPException(400, f"未检测到「{kind}」对应的本机命令。请先安装并登录该 CLI，或改用「API 接入」。")
    elif not req.llm.apiKey or not req.llm.baseURL:
        raise HTTPException(400, "缺少 Base URL 或 API Key，请先在「接入 AI」里填写")

    cfg = req.llm.model_dump()

    def gen():
        try:
            events = (chat_layer.run_chat_cli_stream if is_cli else chat_layer.run_chat_stream)(cfg, req.messages, req.context)
            for ev in events:
                yield json.dumps(ev, ensure_ascii=False) + "\n"
        except Exception as e:  # noqa: BLE001 — 运行时错误以流内事件上报，不中断连接
            yield json.dumps({"type": "error", "message": f"对话失败：{e}"}, ensure_ascii=False) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson")


class HoldingIn(BaseModel):
    code: str
    shares: float
    cost: float


@app.get("/api/portfolio")
def portfolio_get():
    """持仓 + 实时盈亏（浮动盈亏红涨绿跌）。"""
    try:
        return {"data": pf.get_portfolio()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"持仓读取异常：{e}") from e


@app.post("/api/portfolio/holding")
def portfolio_add(h: HoldingIn):
    """加一笔持仓（同代码按加权平均成本合并）。存本地，不上传。"""
    code = (h.code or "").strip().upper()
    if not _SYMBOL_RE.match(code):
        raise HTTPException(400, "Ungültiges Symbol (z.B. AAPL, SAP.DE, 0700.HK)")
    if h.shares <= 0:
        raise HTTPException(400, "Stückzahl muss größer 0 sein")
    return {"data": pf.add_holding(code, h.shares, h.cost)}


@app.delete("/api/portfolio/holding")
def portfolio_remove(code: str = Query(...)):
    return {"data": pf.remove_holding(code.strip())}


# ---- 我的研报（用户上传自己的研报，存本地、不上传、不进开源仓库）----

class ReportIn(BaseModel):
    name: str
    content_b64: str


@app.get("/api/myreports")
def myreports_list():
    return {"data": mr.list_reports()}


@app.post("/api/myreports")
def myreports_upload(r: ReportIn):
    """上传一份研报（base64）→ 存本地 + 按文件名自动打行业标签。"""
    try:
        return {"data": mr.save_report(r.name, r.content_b64)}
    except mr.ReportError as e:
        raise HTTPException(400, str(e)) from e


@app.get("/api/myreports/file/{rid}")
def myreports_file(rid: str):
    """下载/预览某份研报原文件。"""
    hit = mr.report_path(rid)
    if not hit:
        raise HTTPException(404, "研报不存在")
    path, name = hit
    return FileResponse(str(path), filename=name)


@app.delete("/api/myreports/{rid}")
def myreports_delete(rid: str):
    return {"data": {"ok": mr.delete_report(rid)}}


class CloseIn(BaseModel):
    code: str
    date: str
    price: float
    shares: float
    cost: float


@app.post("/api/portfolio/close")
def portfolio_close(c: CloseIn):
    """记一笔已清仓（已实现盈亏）。存本地。"""
    code = (c.code or "").strip().upper()
    if not _SYMBOL_RE.match(code):
        raise HTTPException(400, "Ungültiges Symbol (z.B. AAPL, SAP.DE, 0700.HK)")
    if c.price <= 0 or c.shares <= 0:
        raise HTTPException(400, "Schließungspreis und Stückzahl müssen größer 0 sein")
    # 买入成本不限正负（同持仓录入）：按 (清仓价 - 成本) × 股数 的结果计算已实现盈亏。
    date = (c.date or "").strip()
    if not date:
        raise HTTPException(400, "请填清仓日期")
    from datetime import datetime
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "清仓日期格式应为 YYYY-MM-DD") from None
    return {"data": pf.close_position(code, date, c.price, c.shares, c.cost)}


@app.delete("/api/portfolio/close")
def portfolio_close_remove(index: int = Query(...)):
    return {"data": pf.remove_closed(index)}


@app.post("/api/portfolio/refresh")
def portfolio_refresh():
    """手动刷新：立即重拉行情算盈亏。"""
    try:
        return {"data": pf.get_portfolio()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"刷新失败：{e}") from e


@app.get("/api/radar")
def radar():
    """资讯雷达：12 赛道公开 RSS 资讯（读缓存，无缓存返回赛道骨架）。"""
    try:
        return {"data": newsradar.get_radar(force=False)}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"资讯雷达异常：{e}") from e


@app.post("/api/radar/refresh")
def radar_refresh():
    """强制重抓全部 RSS 源（耗时约 20-40s），更新缓存。"""
    try:
        return {"data": newsradar.fetch_radar()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"资讯雷达刷新失败：{e}") from e


@app.get("/api/market/overview")
def market_overview():
    """市场情绪 + 板块资金流（板块/大盘级，全站共享缓存 5 分钟）。"""
    try:
        return {"data": market.get_overview()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"市场总览异常：{e}") from e


@app.get("/api/market/emotion")
def market_emotion():
    """短线情绪：连板梯队 / 最高连板 / 炸板率 / 封板率 / 晋级率 / 涨跌停家数。

    含连板梯队个股清单（code/name/连板数等）——2026-07-05 起如实展示客观公开榜单（东财同款），
    只呈现事实，不附推荐/评分/预测/买卖时机。全站共享缓存 5 分钟。
    """
    try:
        return {"data": market.get_short_term_emotion()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"短线情绪异常：{e}") from e


@app.get("/api/market/turnover-top")
def market_turnover_top():
    """全市场成交额榜 Top20（客观公开榜单数据，非推荐/非预测/不评分）。全站共享缓存 5 分钟。"""
    try:
        return {"data": market.get_turnover_top()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"成交额榜异常：{e}") from e


@app.get("/api/global/indices")
def global_indices():
    """全球指数快照（道指 / 标普500 / 纳斯达克 / 恒生 / 恒生科技）—— A 股看隔夜外围脸色。缓存 5 分钟。"""
    try:
        return {"data": market.get_global_indices()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"全球指数异常：{e}") from e


@app.get("/api/global/stock")
def global_stock(symbol: str = Query(..., min_length=1, max_length=16)):
    """美股 / 港股个股聚合：行情 + 关键财务指标（东财域内源）。symbol 如 AAPL / BABA / 00700。"""
    try:
        data = gstock.us_hk_stock(symbol.strip())
        if not data:
            raise HTTPException(404, f"未找到美股/港股代码「{symbol}」")
        return {"data": data}
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"美港股查询异常：{e}") from e


# ---- Westliche Märkte (Yahoo): USA / Europa / Hongkong ----------------------
# Eigener /api/w/*-Namensraum; die A-Aktien-Routen darüber bleiben unverändert.

@app.get("/api/w/indices")
def w_indices():
    """Indizes USA / Deutschland / Europa / Hongkong (S&P 500, Nasdaq, Dow, DAX, Euro Stoxx 50, Hang Seng)."""
    try:
        return {"data": wstock.indices(), "stale_sec": wstock.stale_age()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Indexdaten nicht verfügbar: {e}") from e


@app.get("/api/w/sectors")
def w_sectors():
    """Sektor-Tagesperformance über Select-Sector-ETFs, absteigend sortiert."""
    try:
        return {"data": wstock.sectors(), "stale_sec": wstock.stale_age()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Sektordaten nicht verfügbar: {e}") from e


@app.get("/api/w/movers")
def w_movers(limit: int = Query(10, ge=1, le=25)):
    """Größte Tagesgewinner/-verlierer aus DAX 40 + US-Large-Caps. Objektive Rangliste, keine Empfehlung."""
    try:
        return {"data": wstock.movers(limit), "stale_sec": wstock.stale_age()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Bewegungsdaten nicht verfügbar: {e}") from e


@app.get("/api/w/status")
def w_status():
    """Börsen-Handelszeit (USA/Xetra/HK) + Alter der zwischengespeicherten Kursdaten.
    Für den Frische-/Handelszeit-Hinweis im Tagesrückblick."""
    return {"markets": wstock.market_status(), "stale_sec": wstock.stale_age()}


# ---- Thesis-Tracking + Research-Journal (lokal, privat) ----

class ThesisIn(BaseModel):
    symbol: str
    text: str = ""
    conditions: list[dict] = []


class JournalIn(BaseModel):
    symbol: str
    kind: str = "Notiz"
    content: str


@app.get("/api/thesis")
def thesis_get(symbol: str = Query(..., min_length=1, max_length=16)):
    """These + Live-Auswertung der Bedingungen zu einer Aktie."""
    sym = symbol.strip().upper()
    return {"data": {"thesis": theses.get_thesis(sym), "evaluation": theses.evaluate(sym)}}


@app.post("/api/thesis")
def thesis_save(t: ThesisIn):
    code = (t.symbol or "").strip().upper()
    if not _SYMBOL_RE.match(code):
        raise HTTPException(400, "Ungültiges Symbol")
    return {"data": theses.save_thesis(code, t.text, t.conditions)}


@app.delete("/api/thesis")
def thesis_delete(symbol: str = Query(...)):
    return {"data": {"ok": theses.delete_thesis(symbol)}}


@app.post("/api/thesis/journal")
def thesis_journal(j: JournalIn):
    code = (j.symbol or "").strip().upper()
    if not j.content.strip():
        raise HTTPException(400, "Journal-Eintrag darf nicht leer sein")
    t = theses.add_journal(code, j.kind, j.content)
    if t is None:
        raise HTTPException(404, "Keine These zu diesem Symbol — erst These anlegen")
    return {"data": t}


@app.get("/api/thesis/catalog")
def thesis_catalog():
    """Wählbare Kennzahlen + Operatoren für den Bedingungs-Editor."""
    return {"data": theses.metrics_catalog()}


@app.get("/api/w/backtest/catalog")
def w_backtest_catalog():
    """Verfügbare Backtest-Strategien + Default-Parameter."""
    return {"data": backtest.strategies_catalog()}


@app.get("/api/w/backtest")
def w_backtest(
    symbol: str = Query(..., min_length=1, max_length=16),
    strategy: str = Query("sma_cross"),
    fast: int | None = None, slow: int | None = None,
    window: int | None = None, low: int | None = None, high: int | None = None,
):
    """Regel-Strategie historisch backtesten (immer mit Buy&Hold-Referenz)."""
    params = {k: v for k, v in
              {"fast": fast, "slow": slow, "window": window, "low": low, "high": high}.items()
              if v is not None}
    try:
        return {"data": backtest.run(symbol, strategy, params)}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Backtest nicht verfügbar: {e}") from e


@app.get("/api/w/quant")
def w_quant(symbol: str = Query(..., min_length=1, max_length=16)):
    """Quant-Analyse: technische Indikatoren (RSI/MACD/SMA/Momentum/Volatilität) + Faktor-Scorecard."""
    try:
        return {"data": quant.analyze(symbol)}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Quant-Analyse nicht verfügbar: {e}") from e


@app.get("/api/sector")
def sector_overview(
    wiki: str = Query("", max_length=80),
    radar: str = Query("", max_length=20),
    limit: int = Query(8, ge=1, le=20),
):
    """Sektor-Kontext: Wikipedia-Kurzüberblick (de) + passende Nachrichten aus dem Radar."""
    import requests as _rq
    overview = None
    if wiki.strip():
        try:
            r = _rq.get(
                f"https://de.wikipedia.org/api/rest_v1/page/summary/{wiki.strip().replace(' ', '_')}",
                headers={"User-Agent": "Vibe-Research/1.0"}, timeout=10,
            )
            if r.status_code == 200:
                d = r.json()
                if d.get("type") != "disambiguation" and d.get("extract"):
                    overview = {
                        "title": d.get("title"),
                        "extract": d.get("extract"),
                        "url": (d.get("content_urls", {}).get("desktop", {}) or {}).get("page"),
                        "thumbnail": (d.get("thumbnail") or {}).get("source"),
                    }
        except Exception:  # noqa: BLE001
            overview = None

    news = []
    if radar.strip():
        try:
            data = newsradar.get_radar(force=False)
            for ind in data.get("industries", []):
                if ind.get("key") == radar.strip():
                    news = (ind.get("items") or [])[:limit]
                    break
        except Exception:  # noqa: BLE001
            news = []

    return {"data": {"overview": overview, "news": news}}


@app.post("/api/agent/run")
def agent_run():
    """Einen Überwachungslauf über alle Thesen starten (Scheduler ruft das periodisch)."""
    try:
        return {"data": agent_mod.run_once()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Agent-Lauf fehlgeschlagen: {e}") from e


@app.get("/api/agent/status")
def agent_status():
    return {"data": {"telegram_configured": notify.configured()}}


@app.post("/api/agent/test-telegram")
def agent_test_telegram():
    """Test-Nachricht an Telegram senden (prüft Token + Chat-ID)."""
    if not notify.configured():
        raise HTTPException(400, "Telegram nicht konfiguriert (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in .env)")
    ok = notify.send("✅ Vibe-Research: Telegram verbunden. Ab jetzt kommen hier deine Hinweise.")
    if not ok:
        raise HTTPException(502, "Senden fehlgeschlagen — Token/Chat-ID prüfen")
    return {"data": {"sent": True}}


@app.get("/api/w/fundamentals")
def w_fundamentals(symbol: str = Query(..., min_length=1, max_length=16)):
    """Fundamental- + Risikodaten (Bewertung, Profitabilität, Bilanz, Analysten, Risiko-Ampel)."""
    try:
        return {"data": wstock.fundamentals(symbol)}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Fundamentaldaten nicht verfügbar: {e}") from e


@app.get("/api/w/search")
def w_search(q: str = Query(..., min_length=1, max_length=40)):
    """Aktiensuche (Name / Ticker / ISIN) → Yahoo-Symbole. Für die Suchleiste + Klick-zu-Detail."""
    try:
        return {"data": wstock.search(q)}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Suche nicht verfügbar: {e}") from e


@app.get("/api/w/quote")
def w_quote(symbols: str = Query(..., description="Kommagetrennte Symbole, z.B. AAPL,SAP.DE,0700.HK")):
    """Kurse für beliebige US-/EU-/HK-Symbole (Yahoo-Schreibweise: SAP.DE, 0700.HK, ^GDAXI)."""
    lst = [s.strip().upper() for s in symbols.split(",") if s.strip()][:60]
    if not lst:
        raise HTTPException(400, "symbols darf nicht leer sein")
    try:
        return {"data": wstock.quotes(lst)}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Kursquelle nicht verfügbar: {e}") from e


@app.get("/api/w/stock")
def w_stock(symbol: str = Query(..., min_length=1, max_length=16)):
    """Einzelkurs US/EU/HK. 404, wenn Yahoo das Symbol nicht kennt."""
    try:
        data = wstock.stock(symbol)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Kursquelle nicht verfügbar: {e}") from e
    if not data:
        raise HTTPException(404, f"Symbol «{symbol}» nicht gefunden")
    return {"data": data}


@app.get("/api/indices")
def indices():
    """A股大盘指数实时行情（上证/深证成指/创业板指/沪深300）。仅标准库。"""
    try:
        return {"data": astock.index_quote()}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"指数行情异常：{e}") from e


@app.get("/api/quote")
def quote(codes: str = Query(..., description="逗号分隔的 6 位代码")):
    """实时行情：现价/涨跌/PE/PB/市值/换手/涨跌停。仅标准库，永远可用。"""
    lst = [c.strip() for c in codes.split(",") if c.strip()]
    if not lst or any(not c.isdigit() or len(c) != 6 for c in lst):
        raise HTTPException(400, "codes 必须是逗号分隔的 6 位数字")
    try:
        return {"data": astock.tencent_quote(lst)}
    except Exception as e:  # noqa: BLE001 — 边界统一兜底
        raise HTTPException(502, f"行情源异常：{e}") from e


import time as _time
_PCT_CACHE: dict = {}


@app.get("/api/valuation/percentile")
def valuation_percentile(code: str = Query(...)):
    """PE-TTM / PB 历史分位（近5年）。全站缓存 30 分钟/代码（历史序列日频、变化慢）。"""
    code = _validate(code)
    hit = _PCT_CACHE.get(code)
    if hit and _time.time() - hit[0] < 1800:
        return {"data": hit[1]}
    try:
        data = astock.valuation_percentile(code)
        _PCT_CACHE[code] = (_time.time(), data)
        return {"data": data}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"估值分位异常：{e}") from e


_ANN_CACHE: dict = {}


@app.get("/api/announcements")
def announcements(code: str = Query(...)):
    """个股近期公告（东财，仅 requests）。缓存 15 分钟/代码。"""
    code = _validate(code)
    hit = _ANN_CACHE.get(code)
    if hit and _time.time() - hit[0] < 900:
        return {"data": hit[1]}
    try:
        data = astock.announcements(code)
        _ANN_CACHE[code] = (_time.time(), data)
        return {"data": data}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"公告源异常：{e}") from e


_FIN_CACHE: dict = {}


@app.get("/api/financials")
def financials(code: str = Query(...)):
    """财务关键指标（同花顺财务摘要，最新报告期）。缓存 30 分钟/代码。"""
    code = _validate(code)
    hit = _FIN_CACHE.get(code)
    if hit and _time.time() - hit[0] < 1800:
        return {"data": hit[1]}
    try:
        data = astock.financials(code)
        _FIN_CACHE[code] = (_time.time(), data)
        return {"data": data}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"财务摘要异常：{e}") from e


@app.get("/api/valuation")
def valuation(code: str = Query(...)):
    """完整估值：行情 + 一致预期 + 前向PE/PEG/消化年数。"""
    code = _validate(code)
    try:
        return {"data": astock.full_valuation(code)}
    except ValueError as e:
        raise HTTPException(404, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"估值计算异常：{e}") from e


@app.get("/api/reports")
def reports(code: str = Query(...), pages: int = Query(2, ge=1, le=5)):
    """个股研报列表（东财，含 PDF 链接）。仅需 requests。"""
    code = _validate(code)
    try:
        rows = astock.eastmoney_reports(code, max_pages=pages)
        for r in rows:
            r["pdfUrl"] = astock.pdf_url(r.get("infoCode", "")) if r.get("infoCode") else None
        return {"data": rows}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"研报源异常：{e}") from e


@app.get("/api/news")
def news(code: str = Query(...), limit: int = Query(20, ge=1, le=50)):
    """个股新闻（东财，需 akshare）。"""
    code = _validate(code)
    try:
        return {"data": astock.stock_news(code, limit=limit)}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"新闻源异常：{e}") from e


@app.get("/api/info")
def info(code: str = Query(...)):
    """个股基本面：行业/股本/上市时间（需 akshare）。"""
    code = _validate(code)
    try:
        return {"data": astock.individual_info(code)}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"基本面源异常：{e}") from e


@app.get("/api/disclosure")
def disclosure(code: str = Query(...)):
    """巨潮公告列表（需 akshare）。"""
    code = _validate(code)
    try:
        return {"data": astock.disclosure(code)}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"公告源异常：{e}") from e


@app.get("/api/kline")
def kline(code: str = Query(...), category: int = Query(4), offset: int = Query(60, ge=1, le=800)):
    """K线（需 mootdx）。category 4=日 5=周 6=月 11=60分钟。"""
    code = _validate(code)
    try:
        return {"data": astock.kline(code, category=category, offset=offset)}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"K线源异常：{e}") from e


@app.get("/api/finance")
def finance(code: str = Query(...)):
    """季报财务快照（需 mootdx）。"""
    code = _validate(code)
    try:
        return {"data": astock.finance(code)}
    except astock.DependencyMissing as e:
        raise HTTPException(501, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"财务源异常：{e}") from e


# ---------------------------------------------------------------------------
# 资金面 / 筹码 / 信号（东财数据中心，v3.3 并入）—— 均为「用户查的那只股」的公开数据。
# 东财有 1s 限流，这些多为日/季级静态数据，统一走 30 分钟缓存，进一步降低被封风险。
# ---------------------------------------------------------------------------

_DC_CACHE: dict = {}  # key=(endpoint, code) -> (ts, data)


def _cached(endpoint: str, code: str, ttl: int, fetch):
    key = (endpoint, code)
    hit = _DC_CACHE.get(key)
    if hit and _time.time() - hit[0] < ttl:
        return hit[1]
    data = fetch()
    _DC_CACHE[key] = (_time.time(), data)
    return data


@app.get("/api/margin")
def margin(code: str = Query(...)):
    """融资融券明细（东财，日级）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("margin", code, 1800, lambda: astock.margin_trading(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"融资融券异常：{e}") from e


@app.get("/api/block-trade")
def block_trade(code: str = Query(...)):
    """大宗交易（东财）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("block", code, 1800, lambda: astock.block_trade(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"大宗交易异常：{e}") from e


@app.get("/api/holders")
def holders(code: str = Query(...)):
    """股东户数变化（东财，季度级）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("holders", code, 1800, lambda: astock.holder_num_change(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"股东户数异常：{e}") from e


@app.get("/api/dividend")
def dividend(code: str = Query(...)):
    """分红送转历史（东财）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("dividend", code, 1800, lambda: astock.dividend_history(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"分红送转异常：{e}") from e


@app.get("/api/fund-flow")
def fund_flow(code: str = Query(...)):
    """个股资金流（东财 push2his，120 日主力净流入）。缓存 15 分钟。
    注：push2his 对部分大陆住宅 IP 有间歇风控，可能返回空（非代码问题）。"""
    code = _validate(code)
    try:
        return {"data": _cached("fundflow", code, 900, lambda: astock.stock_fund_flow_120d(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"资金流异常：{e}") from e


@app.get("/api/dragon-tiger")
def dragon_tiger(code: str = Query(...)):
    """龙虎榜：该股近期上榜记录 + 买卖席位 + 机构净买（东财）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("dt", code, 1800, lambda: astock.dragon_tiger_board(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"龙虎榜异常：{e}") from e


@app.get("/api/lockup")
def lockup(code: str = Query(...)):
    """限售解禁日历：历史解禁 + 未来 90 天待解禁（东财）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("lockup", code, 1800, lambda: astock.lockup_expiry(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"解禁日历异常：{e}") from e


@app.get("/api/blocks")
def blocks(code: str = Query(...)):
    """个股所属板块/概念归属（东财 slist）。缓存 30 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("blocks", code, 1800, lambda: astock.concept_blocks(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"板块归属异常：{e}") from e


@app.get("/api/hot-concepts")
def hot_concepts(code: str = Query(...)):
    """个股当下被市场归到哪些概念在炒（东财热门概念命中）。缓存 15 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("hotcon", code, 900, lambda: astock.hot_concepts(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"热门概念异常：{e}") from e


@app.get("/api/investor-qa")
def investor_qa(code: str = Query(...)):
    """互动易问答（巨潮）：投资者提问 + 公司回复。缓存 15 分钟。"""
    code = _validate(code)
    try:
        return {"data": _cached("irm", code, 900, lambda: astock.investor_qa(code))}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"互动易异常：{e}") from e


@app.get("/api/industry")
def industry(top: int = Query(20, ge=5, le=50)):
    """全行业涨跌幅排名（东财行业板块，板块级、零个股名单）。缓存 5 分钟。"""
    key = ("industry", str(top))
    hit = _DC_CACHE.get(key)
    if hit and _time.time() - hit[0] < 300:
        return {"data": hit[1]}
    try:
        data = astock.industry_comparison(top_n=top)
        _DC_CACHE[key] = (_time.time(), data)
        return {"data": data}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"行业排名异常：{e}") from e


# ---------------------------------------------------------------------------
# 生产模式：存在 frontend/dist（npm run build）时由后端直接托管前端 —— 单进程，
# 打开 http://127.0.0.1:8900 即可。没有 dist 则一切照旧（开发用 vite :5899 代理 /api）。
# 必须注册在所有 /api 路由之后，否则 catch-all 会吞掉它们。
_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    # index.html darf NIE gecacht werden: sie verweist auf die gehashten Bundles.
    # Sonst hält der Browser nach einem Update (autostart.sh update) die alte
    # index.html und lädt weiter das alte Bundle, bis manuell hart neu geladen wird.
    _NO_CACHE = {"Cache-Control": "no-cache, no-store, must-revalidate"}

    @app.get("/{full_path:path}", include_in_schema=False)
    def _spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(404, "未知的 API 路径")
        f = (_DIST / full_path).resolve()
        if full_path and f.is_file() and f.is_relative_to(_DIST):
            # gehashte Assets (/assets/*) sind unveränderlich; index.html-Name ist stabil
            # → nur echte Dateien mit Hash lange cachen, den Rest (inkl. index.html) nicht.
            if full_path.startswith("assets/"):
                return FileResponse(f, headers={"Cache-Control": "public, max-age=31536000, immutable"})
            return FileResponse(f, headers=_NO_CACHE)
        # React-Router 的客户端路由（/watchlist 等）统一回退到 index.html
        return FileResponse(_DIST / "index.html", headers=_NO_CACHE)
