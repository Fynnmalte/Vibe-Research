# Vibe-Research · Persönliches KI-Investment-Research (US / EU / HK)

[![License: MIT + PolyForm-NC](https://img.shields.io/badge/License-MIT%20%2B%20PolyForm--NC-yellow.svg)](LICENSING.md)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)

**[Funktionen](#-funktionen) · [Schnellstart](#-schnellstart) · [Datenquellen](#-datenquellen) · [KI verbinden](#-ki-verbinden) · [Architektur](#-architektur) · [Compliance](#-compliance) · [Danksagung](#-danksagung)**

> **Vibe-Research — dein persönlicher Investment-Research-Agent.** Ein sauberes Dashboard für
> US- / EU- / HK-Aktien, angetrieben von **deiner eigenen KI**.

Vibe-Research legt Kurse, Fundamentaldaten, Bewertung, technische Indikatoren, Backtests,
Sektoren und Nachrichten in ein aufgeräumtes Dashboard — und lässt dich **dein eigenes
KI-Modell** anschließen (Abo-CLI ohne Key, oder API-Key). Das Produkt **empfiehlt keine
Aktien und prognostiziert keine Kurse** — es liefert nur objektive Daten. Richtung und
Schlussfolgerung kommen von deinem Modell.

**Läuft ohne jeden API-Key.** Die Kursdaten kommen standardmäßig über kostenlose öffentliche
Quellen (CNBC / Nasdaq); eigene Keys (RapidAPI, FMP) sind optional für Zusatzfelder.

## ✨ Funktionen

| Seite | Module / Fähigkeiten |
|---|---|
| 📊&nbsp;**Tagesrückblick** | Indizes (S&P 500 / Nasdaq / Dow / DAX / Euro&nbsp;Stoxx&nbsp;50 / Hang&nbsp;Seng) · **Börsen-Handelszeit** (offen/zu je Markt) + Datenfrische · beobachtete Aktien (Live-Kurse) · Sektor-Tagesperformance (Select-Sector-ETFs) · stärkste/schwächste Werte (DAX 40 + US-Large-Caps) · KI-Tagesrückblick |
| 📡&nbsp;**Nachrichten-Radar** | 12 Branchen, 108 öffentliche RSS-Quellen · KI fasst die „Kernpunkte heute" zusammen |
| 🔍&nbsp;**Aktiendaten** | Suche (Name / Ticker / ISIN) → Kurs, OHLC, Volumen, Marktkap. · **Kennzahlen** (KGV / Forward-KGV / EPS / 52-Wochen-Spanne) · **Quant-Analyse** (RSI / MACD / SMA / Momentum-Trend-Value-Score) · **Backtesting-Lab** (Regel-Strategien vs. Buy&Hold, 2 Jahre Historie) · **Meine These** (Annahmen gegen Live-Daten prüfen) · **Fundamental & Risiko** (Bewertung / Profitabilität / Verschuldung / Risiko-Ampel) · **Analysten-Runde** (5 KI-Perspektiven debattieren) |
| ⭐&nbsp;**Watchlist** | Symbole im Stapel einfügen (Komma / Leerzeichen / Zeilenumbruch) · Tabellen-Übersicht · nur lokal gespeichert |
| 🧩&nbsp;**Sektoren** | Sektor- und Wertschöpfungsketten-Übersicht |
| 💼&nbsp;**Musterdepot** | Aktien zum Live-Kurs kaufen (Button „Ins Depot" auf der Aktienseite) · Verkauf zum aktuellen Kurs · Live-G/V + **App-Signal je Position** (Faktor-Modell) · realisierter G/V (nur lokal, kein Upload) |
| 📄&nbsp;**Meine Analysen** | eigene Research-Dateien hochladen (PDF / Word / txt / Tabellen / Bilder), automatisch nach Branche abgelegt (**nur lokal, kein Upload, nicht im Repository**) |
| 📝&nbsp;**Notizen** | Rückblicke / Kernpunkte / KI-Antworten lokal ablegen |
| 🔌&nbsp;**KI verbinden** | Abo (lokale CLI, kein Key) · API (Multi-Modell, baseURL wird automatisch gefüllt) · MCP (an Claude Code o.ä. anbinden) |

> Ranglisten (stärkste/schwächste Werte, Sektor-Performance …) sind **objektive öffentliche
> Daten** — Vibe-Research zeigt nur Fakten, empfiehlt keine Einzelaktien und prognostiziert
> keine Kurse. Alle Analyserichtungen kommen von deiner selbst konfigurierten KI.

## 🚀 Schnellstart

**Dieser Fork läuft als ein Hintergrunddienst und braucht keinen API-Key.** Die Kursdaten
kommen über eine Fallback-Kette (CNBC gratis → Yahoo); eigene Keys sind optional.

### Docker (jedes OS — nichts außer Docker nötig)

Kein Python, kein Node lokal installieren — ein Container bündelt alles:

```bash
cp .env.example .env      # einmalig; leere Keys sind ok (App läuft über CNBC)
docker compose up -d      # baut + startet → http://localhost:8900
docker compose down       # stoppen
```

Deine Daten (Portfolio / Notizen / Analysen) liegen im Ordner `./data` und überleben
Neustarts. **Hinweis:** Im Container geht nur die **API-Verbindung** für die KI (eigener Key
in „KI verbinden") — die Abo-CLI (lokales `claude`) sieht der Container nicht. Für den
Abo-Modus nativ per `./autostart.sh` laufen.

### macOS — Dauerbetrieb (empfohlen)

```bash
# Einmalig: Abhängigkeiten
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && cd ..
cd frontend && npm install && cd ..

# Als Hintergrunddienst einrichten (baut das Frontend + startet bei jedem Login)
./autostart.sh install
# → läuft dauerhaft auf http://127.0.0.1:8900
```

Danach `http://127.0.0.1:8900` im Browser öffnen und über **„Zum Dock hinzufügen"**
(Safari: Ablage · Chrome: Installieren-Symbol in der Adressleiste) als App installieren —
eigenes Fenster, Dock-Icon, kein Terminal mehr nötig.

| Befehl | Zweck |
|---|---|
| `./autostart.sh install` | Dienst einrichten (Autostart bei Login) |
| `./autostart.sh update` | nach `git pull` / Codeänderung: neu bauen + neu starten |
| `./autostart.sh status` | läuft er? + Health-Check |
| `./autostart.sh uninstall` | Dienst entfernen (danach wieder Dev-Modus via `./start.sh`) |

### Entwicklungsmodus (zwei Prozesse, Hot-Reload)

```bash
# Backend (:8900)
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8900

# Frontend (:5899) — in zweitem Terminal
cd frontend && npm install && npm run dev
# Browser: http://localhost:5899
```

Oder einfach `./start.sh` (startet beides). Hinweis: kollidiert mit dem Dauerdienst auf
Port 8900 — vorher `./autostart.sh uninstall`.

### Optionale API-Keys

Ohne Keys läuft alles über die Gratis-Quellen. Für Zusatzdaten `.env` aus
[`.env.example`](.env.example) anlegen:

- `YH_RAPIDAPI_KEY` — RapidAPI (Yahoo Finance): stabilere Kurse, Analystenziele, PEG, Cashflow.
  Bequem setzen: `./setkey.sh`.
- `FMP_API_KEY` — Financial Modeling Prep: US-Fundamentals/-Historie. **Der Gratisplan von FMP
  deckt allerdings nur wenige Symbole ab (u.a. AAPL); alles andere läuft weiter über CNBC.**
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` — für den optionalen Telegram-Agenten.

## 📡 Datenquellen

**Kurse, Fundamentaldaten, Historie (US / EU / HK)** laufen über eine mehrstufige
Fallback-Kette, damit die App auch ohne Key funktioniert:

1. **RapidAPI** (nur mit `YH_RAPIDAPI_KEY`) — vollständigste Felder inkl. Analystenziele.
2. **CNBC** (kein Key) — Standard-Gratisquelle: Kurse, Fundamentaldaten, OHLC-Historie
   (für Quant & Backtest), deckt alle gängigen Symbole ab.
3. **FMP** (optional, `FMP_API_KEY`) — US-Fundamentals; Gratisplan symbolbeschränkt.
4. **Yahoo** (crumb / spark, kein Key) — letzter Fallback.

**Aktiensuche**: RapidAPI (Key) → Yahoo (alle Märkte) → Nasdaq (gratis, US). Direkteingabe
eines Symbols (`AAPL`, `SAP.DE`, `0700.HK`) funktioniert immer.

**Nachrichten-Radar**: 12 Branchen, 108 öffentliche RSS-Quellen in `backend/newsradar.py` +
`backend/news_sources.json` (reine Standardbibliothek, kein Key).

> Dieser Fork ist auf **US / EU / HK** ausgerichtet; die A-Aktien-Datenschicht des Originals
> (`a-stock-data` / `astock.py`) wurde entfernt, da hier ungenutzt. Wer A-Aktien braucht,
> findet sie im [Upstream von Simon](https://github.com/simonlin1212/Vibe-Research).

> Alle Daten stammen aus öffentlichen Quellen. Vibe-Research zeigt nur Fakten und öffentliche
> Ranglisten — **keine Aktienempfehlung, keine Kursprognose, keine Kauf/Verkauf-Zeitpunkte**.

## 🔌 KI verbinden

Einmal auf der Seite **„KI verbinden"** konfigurieren — danach nutzen „KI fragen", Rückblick,
Kernpunkte und Analysten-Runde überall dein eigenes Modell. **Alle Analysen kommen von deinem
Modell; dieses Produkt kalibriert nicht und hat keine Tendenz.**

### 1. Abo-Verbindung (lokale CLI, kein API-Key)

Nutzt dein eigenes Abo-Kontingent, keine API-Kosten. Unterstützt: **Claude Code · Codex ·
Qwen Code · DeepSeek CLI**.

- **Voraussetzung**: ① Backend läuft lokal (die Cloud kann deine lokale CLI nicht sehen);
  ② die CLI ist installiert und eingeloggt. Beispiel:
  - Claude Code: `npm i -g @anthropic-ai/claude-code` → `claude` (mit Claude-Abo einloggen)
  - Codex: OpenAI Codex CLI → `codex login` (mit ChatGPT-Abo)
- Auf „KI verbinden → Abo" ein Modell wählen, **kein Key nötig**.
- Prinzip: `backend/cli_runtime.py` erkennt die lokale CLI und spawnt sie einmalig (die Daten
  stecken schon im Prompt). CLI macht keine mehrstufigen Tool-Calls — für freie Nachfrage mit
  eigenständigem Datenzugriff nutze die API-Verbindung.

### 2. API-Verbindung (eigener Key)

„KI verbinden → API" ein Modell wählen, **baseURL wird automatisch gefüllt**, nur Key einfügen.
Eingebaut: DeepSeek / Doubao / MiniMax / OpenAI / OpenRouter / Groq / Together / jeder
OpenAI-kompatible Endpunkt. Unterstützt Function-Calling. **Der Key bleibt nur in deinem
lokalen Browser**, wird nur bei deiner Anfrage an dein eigenes Backend gesendet — kein Upload,
nicht im Repository.

### 3. MCP (für Claude Code / Agenten)

Backend als MCP-Server einhängen — der Agent nutzt sein eigenes Abo, um die Datentools von
Vibe-Research für mehrstufige Analysen aufzurufen. Details: [`backend/README.md`](backend/README.md).

## 🏗 Architektur

Eine Datenschicht + zwei KI-Ausgänge:

```
Vibe-Research/
├── backend/            FastAPI :8900
│   ├── wstock.py         US/EU/HK-Kurse, Fundamentals, Historie (CNBC/Yahoo/RapidAPI-Kette)
│   ├── fmp.py            Financial Modeling Prep (optional, US-Fundamentals)
│   ├── quant.py          technische Indikatoren + Faktor-Scorecard
│   ├── strategy.py       Positionierung (Multi-Faktor: Value/Quality/Health/Momentum)
│   ├── backtest.py       Regel-Strategien vs. Buy&Hold
│   ├── theses.py         „Meine These" — Annahmen gegen Live-Daten
│   ├── newsradar.py      Nachrichten-Radar
│   ├── portfolio.py      Musterdepot (Kauf/Verkauf zum Kurs, lokaler Cache)
│   ├── chat.py           System-KI (OpenAI-kompatibles Function-Calling)
│   ├── cli_runtime.py    Abo-CLI-Anbindung (spawnt lokale CLI)
│   ├── agent.py          Telegram-Agent (optional)
│   └── mcp_server.py     MCP-Server (für Claude Code o.ä.)
└── frontend/           Vite + React 19 + TypeScript + Tailwind :5899
```

## 🧪 Tests

```bash
cd backend && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest -m "not live"   # Offline-Unit-Tests + API-Prüfung (schnell, ohne Netz)
.venv/bin/pytest -m live          # Datenquellen-Shape online prüfen (vor Release)
```

## ⚖️ Compliance

- Nur objektive Datenaufbereitung und öffentliche Ranglisten: **keine Aktienempfehlung, keine
  Kursprognose, keine Kauf/Verkauf-Zeitpunkte, keine Renditeversprechen, keine subjektive
  Bewertung** — neutral, ohne Tendenz.
- Alle Analyserichtungen kommen von deiner selbst konfigurierten KI und stehen in keinem
  Zusammenhang mit diesem Produkt. Keine Kauf/Verkauf-Buttons in der UI.
- **Positionen / Watchlist / hochgeladene Analysen / API-Keys bleiben nur lokal** — kein
  Upload, nicht im Repository.

## 🏛 Verwandtes Ökosystem

Das Original und die ursprünglichen Daten-Engines stammen von
[`simonlin1212`](https://github.com/simonlin1212):

| Repository | Rolle |
|---|---|
| [**Vibe-Research**](https://github.com/simonlin1212/Vibe-Research) | Original (Upstream dieses Forks) — enthält auch die A-Aktien-Datenschicht |
| [**investment-news**](https://github.com/simonlin1212/investment-news) | Nachrichtenquelle (in `newsradar.py` übernommen) |

## 🙏 Danksagung

Dieses Projekt ist ein Fork von **[Vibe-Research](https://github.com/simonlin1212/Vibe-Research)**
von **Simon** ([simonlin.net](https://www.simonlin.net)), lokalisiert auf Deutsch und um
keyless Datenquellen (CNBC / Nasdaq / FMP), Markt-Status, Autostart/PWA erweitert.

- Original & Datenkonzept: [Vibe-Research](https://github.com/simonlin1212/Vibe-Research) (Simonlin1212)
- Nachrichten: [investment-news](https://github.com/simonlin1212/investment-news) (Simonlin1212)
- UI-Designsprache angelehnt an: [HKUDS/Vibe-Trading](https://github.com/HKUDS/Vibe-Trading) (HKUDS · nur UI-Anlehnung, eigenständige Implementierung)

## ⚠️ Haftungsausschluss

Dieses Projekt dient ausschließlich dem Lernen und der Recherche und **stellt keine
Anlageberatung dar**. Das Dashboard zeigt nur objektive Daten und öffentliche Ranglisten —
keine Aktienempfehlung, keine Kursprognose, keine Kauf/Verkauf-Zeitpunkte, keine
Renditeversprechen. Alle Analyserichtungen kommen von deiner selbst konfigurierten KI. Der
Aktienmarkt birgt Risiken — entscheide eigenständig, prüfe selbst, das Risiko trägst du selbst.

## 📄 License

**Doppelte Lizenz** (Details: [`LICENSING.md`](LICENSING.md)):

- Ursprünglicher Code von **simonlin1212** + die Daten-Toolkits → **MIT** ([`LICENSE`](LICENSE)).
- **Eigenständige Ergänzungen dieses Forks** (Strategie-Engine, Datenschicht, Quant/Backtest,
  Agent, Setup-Skripte, deutsche UI …) → **PolyForm Noncommercial 1.0.0**
  ([`LICENSE-ADDITIONS.md`](LICENSE-ADDITIONS.md)), © 2026 Fynn Malte Hellwig.

Nicht-kommerzielle Nutzung ist frei. Kommerzielle Nutzung der Fork-Ergänzungen nur durch
den Copyright-Inhaber bzw. mit dessen schriftlicher Erlaubnis. Keine Rechtsberatung.
