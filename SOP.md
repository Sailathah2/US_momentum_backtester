# Standard Operating Procedure — Momentum Backtest Portal

A working checklist for running, changing and trusting this application.
The [README](README.md) explains *what every setting means*; this document
covers *how to operate the thing without fooling yourself*.

---

## 1. Daily start-up

Two programs, two terminals, both left open.

```bash
# Terminal 1 — the calculation engine
cd D:\algo_trading\ai_masterclass\day_4\backend
python app.py                      # must print: Listening on http://127.0.0.1:5001

# Terminal 2 — the website
cd D:\algo_trading\ai_masterclass\day_4\frontend
npm run dev                        # opens http://localhost:5173 (or 5174 if taken)
```

**Confirm before doing anything else:** the header badge reads **Backend online**.

| Badge | Meaning | Fix |
|-------|---------|-----|
| Backend online (green) | Correct server answering | — |
| Backend offline (red) | Terminal 1 not running | Start it |
| Wrong program on port 5001 (amber) | Another app has the port | Close it, then start Terminal 1 |

### Port map

| Port | Owner |
|------|-------|
| 5000 | day_3 US Stock Data Downloader — **not this project** |
| 5001 | This backend |
| 5173 / 5174 | This website (Vite picks the next free one) |

---

## 2. The rule that catches everyone

> **Edited any file in `backend/`? Restart Terminal 1.**

Python loads a module once at start-up. An edit to `engine.py` or `app.py` has
**no effect** until you stop the server (`Ctrl + C`) and run `python app.py`
again.

The symptom is nasty because nothing errors: a new setting simply appears to do
nothing, and two different configurations return byte-identical results. If a
control looks broken, restart the backend *before* you go looking for a bug.

The website is different — Vite hot-reloads it, so frontend edits appear
immediately. A hard refresh (`Ctrl + F5`) clears a stubborn cached bundle.

### Confirming which code is live

```bash
curl -s http://127.0.0.1:5001/api/health
```

Then check that a setting you expect actually changes the answer. If two runs
that should differ come back identical, the server is stale.

### Only one server at a time

Windows lets two Python processes bind the same port, and the older one can win
the request. Check before starting:

```bash
netstat -ano | grep ":5001" | grep LISTEN     # expect exactly ONE line
```

---

## 3. Running a backtest

1. **Load data** — type a folder path and press **Scan** (reads sub-folders too),
   or drag CSVs onto the drop zone.
2. **Check the yellow notes.** Skipped files are listed there. A file skipped is
   a symbol silently missing from the universe.
3. **Pick a benchmark.** It is removed from the tradable universe automatically.
4. **Set the strategy**, press **Run backtest**.
5. **Optional:** set the regime filter and press **Compare filter ON vs OFF** —
   this runs the strategy twice and is the only way to see what the filter cost.

### Warm-up

The first trade waits for the **longest** of: lookback, stock-EMA period,
volatility window. With a 200-day stock EMA and one year of data you get almost
no tradable period. Load more history than you think you need.

---

## 4. Reading a result honestly

Work down this list before believing any number.

| Check | Where | Why it matters |
|-------|-------|----------------|
| Does the universe contain delisted names? | Your data folder | If every symbol still trades today, the backtest is survivor-biased and **overstates** returns. |
| Is the result driven by a few trades? | Trade Log, sort by contribution | If the top 10 of 500 trades make up most of the gain, you own lottery tickets, not an edge. |
| Is turnover realistic? | Rebalance Log → turnover | 1.5 per monthly rebalance ≈ 1,800% a year. Ask whether you can actually trade that. |
| Are costs realistic? | Trading cost (bps) | 10 bps is optimistic for thin small-caps. Re-run at 30 and see if the edge survives. |
| Does the drawdown move when it should? | Underwater chart | If max drawdown is identical across settings, the loss happened while fully invested and no filter could have helped. |
| Does it survive out of sample? | Start/End date | Fit on the first half, then run untouched on the second. |

### Judging a parameter

Nudge it one step either side.

- **Plateau** (neighbours perform similarly) → robust, keep it.
- **Monotonic slope** → a real directional effect, trust the direction.
- **Spike** (neighbours collapse) → curve-fit, do not rely on the exact value.

---

## 5. Exporting

| Button | Output |
|--------|--------|
| **Full report (Excel)** | One `.xlsx`, 8 sheets |
| **Full report (CSVs)** | One `.zip`, 8 CSVs + README |
| Rebalances / Trades / Equity curve / Monthly | A single table each |

Always prefer the **full report** for anything you intend to keep: sheet 1
records every setting, so the run can be reproduced. The single-table CSVs do
not, and a trade log with no settings attached is unreproducible.

Sheets: `1. Inputs`, `2. Metrics`, `3. Regime Comparison`, `4. Equity Curve`,
`5. Rebalance Log`, `6. Trade Log`, `7. Keep Exit Enter`, `8. Monthly Returns`.

> **Export failed?** Almost always a stale session after a backend restart. The
> data lives in the server's memory, so restarting clears it. Re-scan and re-run.

---

## 6. Changing the code

### Where things live

| File | Responsibility |
|------|----------------|
| `backend/data_loader.py` | Reading CSVs: column mapping, date parsing, calendar alignment |
| `backend/indicators.py` | EMA, ATR, Supertrend, weekly bars, the regime state machine |
| `backend/engine.py` | The backtest loop, stock selection, all performance maths |
| `backend/app.py` | HTTP routes, validation, exports |
| `frontend/src/App.jsx` | App state and page layout |
| `frontend/src/components/` | One file per panel |

### House rules

1. **New setting → four places.** `DEFAULT_SETTINGS` in `App.jsx`, a control in
   the relevant component, parsing plus validation in `_prepare_backtest`, and a
   row in `SETTING_LABELS` so it reaches the report's Inputs sheet.
2. **Default every new setting to OFF**, so existing results do not move.
3. **Never hand-list the private keys.** `analyse()` attaches pandas objects that
   cannot be JSON-encoded; strip them with `engine.strip_private()`. Listing them
   by hand at each call site is what caused the *"Object of type Series is not
   JSON serializable"* bug.
4. **Anything derived from a closing price must be shifted a day** before it is
   traded on. `regime_exec` does this; copy the pattern.
5. **Guard zero denominators.** A halted stock carried forward flat has zero
   volatility, and `ROC ÷ 0` is infinity, which would pin it to the top of the
   ranking for ever. Note that zero *downside* deviation is the opposite — a
   flawless riser — and must be kept, not dropped.

### After any change

```bash
# 1. restart the backend  (Ctrl+C in Terminal 1, then)
python app.py

# 2. run the regression suite - it must report 0 failures
python verify_all.py
```

`verify_all.py` covers 109 checks: parsing, engine rules, every optional screen,
the regime state machine, exports, error handling and JSON safety. It also
promotes `FutureWarning` to an error, so deprecation noise fails the build.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| A new setting changes nothing | Backend running stale code | Restart Terminal 1 |
| "That API address does not exist" | Talking to the wrong server | Check nothing else holds port 5001 |
| Two runs identical when they should differ | Stale backend, or the setting genuinely has no effect on this data | Restart first, then investigate |
| "The export failed" | Session cleared by a restart | Re-scan and re-run |
| "Only N trading days are available" | Warm-up longer than the history | Shorten the window or load more data |
| "The stock files and the benchmark do not overlap" | Mismatched date ranges | The message names both ranges |
| Portfolio sits in cash for long stretches | Working as designed in a downtrend | Shorten the lookback, or check the regime filter is not too twitchy |
| Max drawdown identical across cash/gold settings | The drawdown happened while fully invested | Not a bug — see §4 |

---

## 8. Known limitations

Be explicit about these when showing results to anyone.

- **Survivorship bias.** The universe is whatever CSVs you loaded. If they came
  from a screen of companies that exist today, every firm that failed during the
  test window is missing, and the backtest is optimistic.
- **No slippage or market impact.** Costs are a flat bps charge on turnover.
  Thin small-caps will cost more than that in reality.
- **No taxes, no dividends.** Price-only returns.
- **Forward-filled gaps.** A missing day carries the last price forward. Honest,
  but it understates the volatility of illiquid names.
- **In-memory sessions.** Restarting the backend discards loaded data.
- **Single user, localhost.** No authentication; not built to be exposed.
