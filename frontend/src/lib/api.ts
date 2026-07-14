// Vibe-Research Backend-API-Client. /api wird von Vite auf das lokale FastAPI (Standard 8900) geproxied.
// Wirft ApiError, wenn das Backend nicht läuft oder eine Datenquelle Fehler hat; die Seite degradiert dann elegant.

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

// Backend-Zugriffsschlüssel (entspricht VR_API_KEY beim Deployment, Schutz im öffentlichen Netz). Nur im lokalen Browser.
const ACCESS_KEY = "vr-access-key";

export function loadAccessKey(): string {
  try {
    return localStorage.getItem(ACCESS_KEY) || "";
  } catch {
    return "";
  }
}

export function saveAccessKey(key: string) {
  try {
    if (key) localStorage.setItem(ACCESS_KEY, key);
    else localStorage.removeItem(ACCESS_KEY);
  } catch {
    /* localStorage nicht verfügbar, z.B. im Privat-Modus */
  }
}

export function authHeaders(): Record<string, string> {
  const k = loadAccessKey();
  return k ? { Authorization: `Bearer ${k}` } : {};
}

export interface MyReport {
  id: string; name: string; industry: string; size: number; ext: string; ts: number;
}

// Analyse herunterladen/vorschauen: fetch mit Auth-Header, dann blob, löst Browser-Download aus (<a download> kann kein Authorization mitschicken, daher über blob).
export async function downloadReport(id: string, name: string): Promise<void> {
  const resp = await fetch(`/api/myreports/file/${id}`, { headers: authHeaders() });
  if (!resp.ok) throw new ApiError(`Download fehlgeschlagen HTTP ${resp.status}`, resp.status);
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function request<T>(path: string, method: "GET" | "POST" | "DELETE" = "GET", body?: unknown): Promise<T> {
  let resp: Response;
  const headers: Record<string, string> = { ...authHeaders() };
  const opts: RequestInit = { method };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  if (Object.keys(headers).length > 0) opts.headers = headers;
  try {
    resp = await fetch(`/api${path}`, opts);
  } catch {
    throw new ApiError("Keine Verbindung zum Backend, bitte zuerst das Backend starten (uvicorn app:app --port 8900)", 0);
  }
  let payload: any = null;
  try {
    payload = await resp.json();
  } catch {
    /* Nicht-JSON-Antwort */
  }
  if (!resp.ok) {
    if (resp.status === 401) {
      throw new ApiError("Das Backend hat Zugriffs-Auth aktiviert (VR_API_KEY): bitte unten auf der Seite »KI verbinden« den Backend-Zugriffsschlüssel eintragen", 401);
    }
    throw new ApiError(payload?.detail || `HTTP ${resp.status}`, resp.status);
  }
  return (payload?.data ?? payload) as T;
}

const get = <T>(path: string) => request<T>(path, "GET");

export interface Quote {
  name: string; price: number; last_close: number; change_pct: number;
  pe_ttm: number; pb: number; mcap_yi: number; turnover_pct: number;
  limit_up: number; limit_down: number;
}

export interface Valuation {
  name: string; code: string; price: number; mcap_yi: number;
  pe_ttm: number; pb: number;
  eps_26e: number | null; eps_27e: number | null; pe_26e: number | null;
  cagr_pct: number | null; peg: number | null; digest_years: number | null;
  analyst_count: number; forecast_note?: string;
}

export interface Report {
  title: string; publishDate: string; orgSName: string;
  emRatingName?: string; indvInduName?: string; pdfUrl?: string | null;
}

export interface ValMetric {
  current: number; percentile: number; min: number; max: number;
  p20: number; p50: number; p80: number; n: number;
}
export interface ValPercentile {
  period: string; metrics: { pe_ttm?: ValMetric; pb?: ValMetric };
}

export interface Announcement {
  date: string; title: string; type: string; url: string;
}

export interface Financials {
  period: string | null;
  revenue: string | null; revenue_yoy: string | null;
  net_profit: string | null; net_profit_yoy: string | null;
  eps: string | null; bvps: string | null; roe: string | null;
  gross_margin: string | null; net_margin: string | null; op_cf_ps: string | null;
}

export interface NewsItem {
  // Feldnamen stammen 1:1 aus der chinesischen Datenquelle (akshare) — nicht umbenennen, sonst bricht das Mapping.
  新闻标题?: string; 发布时间?: string; 文章来源?: string; 新闻链接?: string;
}

export interface IndexQuote {
  name: string; price: number; change_pct: number; change_amt: number;
}

export interface MarketSentiment {
  up: number; down: number; flat: number; zt: number; zt_real: number; dt: number; dt_real: number;
  active: string; breadth: string; speculation: string; date: string;
}
export interface SectorFlow {
  name: string; pct: number; net: number; inflow: number; outflow: number; firms: number;
}
export interface MarketOverview {
  sentiment: MarketSentiment; sectors: SectorFlow[]; updated: string;
}

// Kurzfrist-Sentiment: Limit-up-Serien / höchste Serie / Abriss-Quote / Halte-Quote / Fortsetzungsquote / Anzahl Limit-up/-down + Serien-Liste (objektive öffentliche Rangliste)
export interface EmotionTier { boards: number; count: number; plus: boolean }
export interface LianbanStock {
  code: string; name: string; boards: number;
  price: number; pct: number; amount: number | null; float_cap: number | null; industry: string;
}
export interface ShortTermEmotion {
  date: string;
  zt_count: number; dt_count: number; zb_count: number;
  max_boards: number; lianban_count: number;
  ladder: EmotionTier[];
  lianban_stocks: LianbanStock[];
  seal_rate: number | null; break_rate: number | null; promotion_rate: number | null;
  yzt_count: number;
}

// Umsatz-Rangliste des Gesamtmarkts (objektive öffentliche Rangliste)
export interface TurnoverStock {
  code: string; name: string;
  price: number | null; pct: number | null;
  amount: number | null; mcap: number | null; float_cap: number | null; industry: string;
}
export interface TurnoverTop { stocks: TurnoverStock[]; updated: string }

export interface RadarItem {
  title: string; url: string; time: string; source: string; summary?: string; zh?: string;
}
export interface Industry {
  key: string; name: string; accent: string; total: number; items: RadarItem[];
}
export interface RadarData {
  generated_at: string | null; recent_days: number; industries: Industry[];
  stats: { industries: number; total_sources: number; failed_sources?: number };
}

export interface Holding {
  code: string; name: string; price: number; shares: number; cost: number;
  market_value: number; pnl: number; pnl_pct: number;
}
export interface ClosedPosition {
  code: string; name: string; date: string; price: number; shares: number; cost: number;
  pnl: number; pnl_pct: number;
}
export interface PortfolioData {
  holdings: Holding[];
  totals: { market_value: number; cost: number; pnl: number; pnl_pct: number };
  closed: ClosedPosition[];
  realized_pnl: number;
  updated: string; last_refresh: string | null;
}

// Kapitalfluss / Anteilseigner / Signale (v3.3, alles öffentliche Daten der »vom Nutzer abgefragten Aktie«)
export interface MarginRow { date: string; rzye: number; rzmre: number; rzche: number; rqye: number; rqmcl: number; rzrqye: number }
export interface BlockTradeRow { date: string; price: number; close: number; premium_pct: number; vol: number; amount: number; buyer: string; seller: string }
export interface HolderRow { date: string; holder_num: number; change_ratio: number; avg_shares: number }
export interface DividendRow { date: string; bonus_rmb: number; transfer_ratio: number; bonus_ratio: number | null; plan: string }
export interface FundFlowRow { date: string; main_net: number; small_net: number; mid_net: number; large_net: number; super_net: number }
export interface DtSeat { name: string; buy_amt: number; sell_amt: number; net: number }
export interface DragonTiger {
  records: { date: string; reason: string; net_buy: number; turnover: number }[];
  seats: { buy: DtSeat[]; sell: DtSeat[] };
  institution: { buy_amt: number; sell_amt: number; net_amt: number };
}
export interface LockupRow { date: string; type: string; shares: number; ratio: number }
export interface Lockup { history: LockupRow[]; upcoming: LockupRow[] }
export interface Board { name: string; code: string; change_pct: number | string; lead_stock: string }
export interface Blocks { total: number; boards: Board[]; concept_tags: string[] }
export interface HotConcept { concept: string; bk: string; hit: number }
export interface QaRow { company: string; question: string; answer: string | null; answerer: string; ask_time: string }
export interface IndustryRow { rank: number; name: string; change_pct: number; code: string; up_count: number; down_count: number }
export interface IndustryData { top: IndustryRow[]; bottom: IndustryRow[]; total: number }

// Globale Märkte (US / HK, portiert aus global-stock-data · Eastmoney-Quelle)
export interface GlobalIndex {
  key: string; name: string; region: string;
  price: number | null; change_pct: number | null;
}
export interface GlobalQuote {
  code: string; name: string;
  price: number | null; open: number | null; high: number | null; low: number | null;
  prev_close: number | null; amount: number | null; mcap: number | null; change_pct: number | null;
}
export interface GlobalMetrics {
  report_date: string;
  revenue: number | null; revenue_yoy: number | null; net_profit: number | null;
  eps: number | null; roe: number | null; gross_margin: number | null;
  net_margin: number | null; debt_ratio: number | null;
}
export interface GlobalStock {
  code: string; name: string; market: string;
  quote: GlobalQuote; metrics: GlobalMetrics | null;
}

// Westliche Märkte (USA / Europa / Hongkong, Quelle: Yahoo · /api/w/*)
export interface WQuote {
  symbol: string; name: string;
  price: number | null; prev_close: number | null; change_pct: number | null;
  currency: string | null; exchange: string | null;
}
export interface WIndex {
  key: string; name: string; region: string;
  price: number | null; change_pct: number | null;
}
export interface WSector {
  symbol: string; name: string; price: number | null; change_pct: number;
}
export interface WMovers {
  universe: number; gainers: WQuote[]; losers: WQuote[];
}
export interface WMarket {
  key: string; name: string; open: boolean; local_time: string; hours: string;
}
export interface WStatus {
  markets: WMarket[]; stale_sec: number | null;
}
export interface WSearchHit {
  symbol: string; name: string; exchange: string | null; type: string | null;
}
export interface WQuantFactor { score: number | null; driver: string }
export interface WQuant {
  available: boolean;
  symbol?: string; points?: number;
  indicators?: {
    rsi14: number | null; rsi_state: string;
    macd: number | null; macd_signal: number | null; macd_hist: number | null;
    sma20: number | null; sma50: number | null; sma200: number | null;
    ret_1m: number | null; ret_3m: number | null; ret_6m: number | null;
    volatility: number | null;
  };
  factors?: {
    momentum: WQuantFactor; trend: WQuantFactor; value: WQuantFactor;
    overall: number | null;
  };
  disclaimer?: string;
}
export interface SectorNewsItem { time?: string; source?: string; title?: string; zh?: string; url?: string }
export interface SectorOverview {
  overview: { title: string; extract: string; url: string | null; thumbnail: string | null } | null;
  news: SectorNewsItem[];
}
export interface WRiskFlag { severity: "warn" | "high"; text: string }
export interface WFundamentals {
  available: boolean; symbol?: string;
  valuation?: { pe: number | null; forward_pe: number | null; peg: number | null; price_to_book: number | null; ev_ebitda: number | null };
  profitability?: { roe: number | null; roa: number | null; gross_margin: number | null; operating_margin: number | null; profit_margin: number | null; revenue_growth: number | null; earnings_growth: number | null };
  balance?: { debt_to_equity: number | null; current_ratio: number | null; total_cash: number | null; free_cashflow: number | null };
  analyst?: { recommendation: string | null; count: number | null; target_mean: number | null; target_high: number | null; target_low: number | null; price: number | null };
  dividend?: { yield: number | null; payout: number | null };
  risk?: { beta: number | null; flags: WRiskFlag[] };
  next_earnings?: string | null;
}
export interface WStrategyFactor { key: string; label: string; score: number | null; drivers: string[] }
export interface WStrategy {
  available: boolean; symbol?: string;
  signal?: "long" | "short" | "neutral";
  stance?: string; archetype?: string;
  conviction?: number; composite?: number | null;
  factors?: WStrategyFactor[];
  bull_points?: string[]; bear_points?: string[];
  disclaimer?: string;
}
export interface WScores {
  available: boolean; symbol?: string; reason?: string;
  piotroski?: { score: number; max: number; tests: { name: string; pass: boolean | null; detail: string }[] };
  altman?: { available: boolean; z?: number; zone?: string; components?: Record<string, number> };
  disclaimer?: string;
}
export interface WAltData {
  available: boolean; symbol?: string; reason?: string;
  insider?: { available: boolean; buy_count?: number; sell_count?: number; buy_value?: number; sell_value?: number; net_value?: number;
    recent?: { date: string; owner: string; code: string; shares: number; value: number }[] };
  short?: { available: boolean; date?: string; short_volume?: number; total_volume?: number; short_ratio?: number | null };
  options?: { available: boolean; pc_oi_ratio?: number | null; pc_vol_ratio?: number | null; call_oi?: number; put_oi?: number; avg_iv?: number | null };
  notes?: { sev: string; text: string }[];
  disclaimer?: string;
}
export interface WScreenerRow {
  symbol: string; name: string;
  price: number | null; change_pct: number | null; currency: string | null;
  signal: "long" | "short" | "neutral" | null;
  composite: number | null; conviction: number | null; archetype: string | null;
  factors: Record<string, number | null>;
}
export interface WScreener {
  universe: string; name: string; rows: WScreenerRow[];
  computing: boolean; done: number; total: number;
  computed_at: string | null; disclaimer: string;
}
export interface BacktestStrategy { key: string; name: string; params: Record<string, number>; desc: string }
export interface BacktestResult {
  available: boolean; error?: string;
  symbol?: string; strategy_name?: string; params?: Record<string, number>;
  from?: string; to?: string;
  return_pct?: number | null; buyhold_pct?: number | null; cagr_pct?: number | null;
  sharpe?: number | null; max_drawdown_pct?: number | null; win_rate_pct?: number | null;
  trades?: number; exposure_pct?: number | null;
  equity_curve?: number[]; buyhold_curve?: number[];
}
export interface ThesisCond { metric: string; op: string; value: number }
export interface ThesisJournalEntry { ts: string; kind: string; content: string }
export interface Thesis {
  symbol: string; text: string; conditions: ThesisCond[];
  created: string; updated: string; journal: ThesisJournalEntry[];
}
export interface ThesisCheck {
  metric: string; label: string; op: string; value: number;
  actual: number | null; ok: boolean | null;
}
export interface ThesisEval {
  exists: boolean; checks?: ThesisCheck[]; held?: number; total?: number;
  all_ok?: boolean; price?: number | null; currency?: string | null; as_of?: string;
}
export interface WStockDetail {
  symbol: string; name: string;
  price: number | null; prev_close: number | null; change_pct: number | null;
  open?: number | null; high?: number | null; low?: number | null; volume?: number | null;
  mcap?: number | null; pe?: number | null; forward_pe?: number | null; eps?: number | null;
  week52_high?: number | null; week52_low?: number | null;
  currency: string | null; exchange: string | null; quote_type?: string | null;
}

export const api = {
  health: () => get<{ ok: boolean }>("/health"),

  // US / EU / HK
  wIndices: () => get<WIndex[]>("/w/indices"),
  wSectors: () => get<WSector[]>("/w/sectors"),
  wMovers: (limit = 10) => get<WMovers>(`/w/movers?limit=${limit}`),
  wStatus: () => get<WStatus>("/w/status"),
  wQuote: (symbols: string) => get<Record<string, WQuote>>(`/w/quote?symbols=${encodeURIComponent(symbols)}`),
  wStock: (symbol: string) => get<WStockDetail>(`/w/stock?symbol=${encodeURIComponent(symbol)}`),
  wSearch: (q: string) => get<WSearchHit[]>(`/w/search?q=${encodeURIComponent(q)}`),
  wQuant: (symbol: string) => get<WQuant>(`/w/quant?symbol=${encodeURIComponent(symbol)}`),
  wStrategy: (symbol: string) => get<WStrategy>(`/w/strategy?symbol=${encodeURIComponent(symbol)}`),
  wScreener: (universe: string, force = false) => get<WScreener>(`/w/screener?universe=${universe}${force ? "&force=true" : ""}`),
  wAltData: (symbol: string) => get<WAltData>(`/w/altdata?symbol=${encodeURIComponent(symbol)}`),
  wScores: (symbol: string) => get<WScores>(`/w/scores?symbol=${encodeURIComponent(symbol)}`),
  wFundamentals: (symbol: string) => get<WFundamentals>(`/w/fundamentals?symbol=${encodeURIComponent(symbol)}`),
  sectorOverview: (wiki: string, radar: string) =>
    get<SectorOverview>(`/sector?wiki=${encodeURIComponent(wiki)}&radar=${encodeURIComponent(radar)}`),
  backtestCatalog: () => get<BacktestStrategy[]>("/w/backtest/catalog"),
  backtest: (symbol: string, strategy: string, params: Record<string, number>) => {
    const qs = new URLSearchParams({ symbol, strategy });
    for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
    return get<BacktestResult>(`/w/backtest?${qs.toString()}`);
  },

  // Thesis-Tracking + Journal
  thesisGet: (symbol: string) => get<{ thesis: Thesis | null; evaluation: ThesisEval }>(`/thesis?symbol=${encodeURIComponent(symbol)}`),
  thesisSave: (symbol: string, text: string, conditions: ThesisCond[]) =>
    request<Thesis>("/thesis", "POST", { symbol, text, conditions }),
  thesisDelete: (symbol: string) => request<{ ok: boolean }>(`/thesis?symbol=${encodeURIComponent(symbol)}`, "DELETE"),
  thesisJournal: (symbol: string, kind: string, content: string) =>
    request<Thesis>("/thesis/journal", "POST", { symbol, kind, content }),
  thesisCatalog: () => get<{ metrics: Record<string, string>; ops: string[] }>("/thesis/catalog"),
  radar: () => get<RadarData>("/radar"),
  radarRefresh: () => request<RadarData>("/radar/refresh", "POST"),
  portfolio: () => get<PortfolioData>("/portfolio"),
  addHolding: (code: string, shares: number, cost: number) => request<PortfolioData>("/portfolio/holding", "POST", { code, shares, cost }),
  removeHolding: (code: string) => request<PortfolioData>(`/portfolio/holding?code=${code}`, "DELETE"),
  refreshPortfolio: () => request<PortfolioData>("/portfolio/refresh", "POST"),
  closePosition: (code: string, date: string, price: number, shares: number, cost: number) =>
    request<PortfolioData>("/portfolio/close", "POST", { code, date, price, shares, cost }),
  removeClosed: (index: number) => request<PortfolioData>(`/portfolio/close?index=${index}`, "DELETE"),
  sellPosition: (code: string) => request<PortfolioData>(`/portfolio/sell?code=${encodeURIComponent(code)}`, "POST"),
  myReports: () => get<MyReport[]>("/myreports"),
  uploadReport: (name: string, contentB64: string) =>
    request<MyReport>("/myreports", "POST", { name, content_b64: contentB64 }),
  deleteReport: (id: string) => request<{ ok: boolean }>(`/myreports/${id}`, "DELETE"),
};
