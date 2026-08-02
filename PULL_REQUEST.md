# Momentum Backtest Portal — relative-strength momentum backtesting for US & global equities

A local web app that replays a relative-strength momentum strategy over your own
daily CSV price files and reports what would have happened, with the evidence
attached.

**11 commits · 109/109 regression checks passing**

---

## What it does

Every rebalance the strategy measures each stock's Rate of Change over a lookback
window, compares it to the benchmark's over the same days, discards anything that
failed to beat the index, ranks the survivors and buys the strongest. It then
reports CAGR, Sharpe, Sortino, max drawdown and win rate against buy-and-hold,
with an equity curve, underwater chart, monthly heatmap and a full audit trail.

## Features

**Data loading** — reads four CSV schemas (US Stock Data Downloader, legacy broker
long-format, index-only `time/open/high/low/close`, and close-only) and resolves
`YYYY-MM-DD`, `DD/MM/YYYY`, `MM/DD/YYYY` and intraday timestamps, disambiguating
day-first from month-first rather than guessing. Scans a folder and its
sub-folders, or accepts drag-and-drop. A malformed file is skipped with a visible
note, never a crash.

**Core engine** — configurable lookback, five rebalance cadences, Top N, equal or
momentum weighting, optional cash buffer for unfilled slots, and turnover-based
trading costs in bps.

**Stock-EMA gate** — a candidate must also close above its own EMA, so it has to be
in its own uptrend rather than merely beating a falling index.

**Risk-adjusted ranking** — rank by `ROC ÷ StdDev` or `ROC ÷ DownsideDeviation`
(the Sortino idea, where only losing days count as risk).

**Rank cushion** — replaces full liquidation with a three-way Keep / Exit / Enter
decision. A held stock survives until it falls past the exit rank or stops beating
the index; the entry bar stays at Top N. Freed capital is either fully rebalanced
or recycled into newcomers only.

**Index regime filter** — EMA, Supertrend, or both with hysteresis, on daily or
weekly candles. Moves a configurable share of the book out of equities during a
downtrend, into cash or into a nominated asset such as gold. Runs the strategy
twice, with and without, so the filter's cost is visible rather than assumed.

**Reporting** — an 8-sheet Excel workbook or a ZIP of CSVs covering inputs,
metrics, the regime comparison, the daily equity curve, and the rebalance, trade
and keep/exit/enter logs. Sheet 1 records every setting, so any run is
reproducible.

## Correctness

The parts most likely to be quietly wrong were tested directly:

- **No lookahead.** Signals derived from a close are shifted one day before they
  are traded on. Asserted across all 1,254 days.
- **Weekly bars carry no future information.** Each is labelled with the week's
  last *trading* day — a calendar Friday falling on a holiday would be dropped by
  the reindex — and a week's verdict only reaches days after it closes.
- **Wilder's smoothing for ATR** (`alpha = 1/period`, not `span`), so Supertrend
  agrees with standard charting platforms.
- **Zero-denominator guards.** A halted stock carried forward flat has zero
  volatility and `ROC ÷ 0` is infinity, which would pin it to the top of the
  ranking permanently — it is excluded. Zero *downside* deviation is the opposite
  case, a stock with no losing days, and is kept and floored rather than dropped.
- **Every optional feature defaults to off** and is verified bit-identical to the
  previous engine when disabled.

`backend/verify_all.py` runs 109 checks over parsing, engine rules, every optional
screen, the regime state machine, exports, thirteen error paths and JSON safety.
It drives Flask in-process so it always tests the code on disk, and promotes
`FutureWarning` to an error.

## Notable fixes made along the way

- Port collision with the day_3 project on 5000; moved to 5001 and added a
  `service_id` check so a wrong server on the port reports clearly instead of
  showing a false "online" badge.
- `Object of type Series is not JSON serializable` on the plain backtest route —
  private pandas keys were stripped by a hand-written list at each call site and
  the lists drifted. Replaced with a single registry plus `strip_private()`.
- Export errors were swallowed: the throw carrying the server's message sat inside
  its own `try`, so users always saw a generic failure.
- `pct_change` was carrying prices across data gaps before differencing, inventing
  fake 0% days.

## Known limitations

Stated plainly in `SOP.md` §8 and worth repeating: the universe is whatever CSVs
are loaded, so a screen of companies that exist today is **survivor-biased** and
overstates returns. Costs are a flat bps charge with no slippage or market impact.
Price-only returns, no dividends or taxes. Sessions live in memory and are cleared
by a backend restart.

## Docs

- `README.md` — setup and what every setting means
- `SOP.md` — operating checklist, how to judge whether a result is trustworthy,
  house rules for adding a setting, troubleshooting

## Verification

```bash
cd backend && python app.py          # http://127.0.0.1:5001
cd frontend && npm run dev           # http://localhost:5173
cd backend && python verify_all.py   # 109 passed, 0 failed
```
