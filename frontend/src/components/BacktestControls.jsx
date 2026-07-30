/**
 * ==========================================================
 * BacktestControls.jsx -- STEP 2: the strategy settings panel
 * ==========================================================
 * Every dial the user can turn lives here. Each one carries a plain-English
 * sentence explaining what changing it actually does to the backtest.
 */
import React from "react";
import { Loader2, Play, Settings2 } from "lucide-react";

// The rebalance rhythms, in the order they appear as buttons.
const CADENCES = [
  { id: "weekly", label: "Weekly" },
  { id: "biweekly", label: "Bi-weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "quarterly", label: "Quarterly" },
  { id: "days", label: "Every N days" },
];

// Common momentum lookback windows, in trading days.
// (21 days is about a month, 252 days is about a year.)
const LOOKBACKS = [20, 60, 126, 252];

export default function BacktestControls({ settings, onChange, onRun, busy, symbols }) {
  /** Update one setting without disturbing the others. */
  const set = (key, value) => onChange({ ...settings, [key]: value });

  // The benchmark cannot also be one of the stocks we rank.
  const universeSize = Math.max(0, symbols.length - (settings.benchmark ? 1 : 0));
  const canRun = Boolean(settings.benchmark) && universeSize >= 2 && !busy;

  return (
    <section className="brief-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <Settings2 className="h-4 w-4 text-precision-400" />
        <div>
          <p className="brief-eyebrow">Step 2</p>
          <h2 className="mt-1 text-base font-bold text-cream-50">Strategy settings</h2>
        </div>
      </div>

      {/* ---------------- BENCHMARK ---------------------------------- */}
      <div className="mb-4">
        <label className="field-label">Benchmark / index</label>
        <select
          className="field mt-1.5"
          value={settings.benchmark || ""}
          onChange={(e) => set("benchmark", e.target.value)}
        >
          <option value="">— choose the index file —</option>
          {symbols.map((symbol) => (
            <option key={symbol.ticker} value={symbol.ticker}>
              {symbol.ticker}
              {symbol.benchmark_candidate ? "  (looks like an index)" : ""}
            </option>
          ))}
        </select>
        <p className="field-help">
          Every stock must beat THIS to be bought. Whatever you pick here is removed
          from the stock universe, leaving <strong>{universeSize}</strong> stock
          {universeSize === 1 ? "" : "s"} to rank.
        </p>
      </div>

      {/* ---------------- LOOKBACK ----------------------------------- */}
      <div className="mb-4">
        <label className="field-label">Lookback window (trading days)</label>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {LOOKBACKS.map((days) => (
            <button
              key={days}
              className={`chip ${settings.lookback === days ? "chip-active" : ""}`}
              onClick={() => set("lookback", days)}
            >
              {days}d
            </button>
          ))}
          <input
            type="number"
            min={2}
            className="field !w-24 !py-1.5 !text-xs"
            value={settings.lookback}
            onChange={(e) => set("lookback", Number(e.target.value) || 2)}
          />
        </div>
        <p className="field-help">
          How far back we look to measure momentum. <strong>Shorter</strong> (20d)
          reacts fast but trades a lot; <strong>longer</strong> (252d) follows slow,
          durable trends. 126 days is roughly six months.
        </p>
      </div>

      {/* ---------------- REBALANCE CADENCE -------------------------- */}
      <div className="mb-4">
        <label className="field-label">Rebalance every</label>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {CADENCES.map((cadence) => (
            <button
              key={cadence.id}
              className={`chip ${settings.cadence === cadence.id ? "chip-active" : ""}`}
              onClick={() => set("cadence", cadence.id)}
            >
              {cadence.label}
            </button>
          ))}
        </div>

        {/* This extra box only appears for the "Every N days" option. */}
        {settings.cadence === "days" && (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              min={1}
              className="field !w-24 !py-1.5 !text-xs"
              value={settings.every_n_days}
              onChange={(e) => set("every_n_days", Number(e.target.value) || 1)}
            />
            <span className="text-2xs text-brief-muted">trading days between rebalances</span>
          </div>
        )}
        <p className="field-help">
          How often the portfolio is re-picked. More frequent rebalancing tracks
          momentum more closely but pays more in trading costs.
        </p>
      </div>

      {/* ---------------- TOP N + WEIGHTING -------------------------- */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <label className="field-label">Hold top</label>
          <input
            type="number"
            min={1}
            className="field mt-1.5"
            value={settings.top_n}
            onChange={(e) => set("top_n", Number(e.target.value) || 1)}
          />
          <p className="field-help">
            How many stocks to own. Fewer = more concentrated and more volatile.
          </p>
        </div>
        <div>
          <label className="field-label">Weighting</label>
          <select
            className="field mt-1.5"
            value={settings.weighting}
            onChange={(e) => set("weighting", e.target.value)}
          >
            <option value="equal">Equal weight</option>
            <option value="roc">Momentum weighted</option>
          </select>
          <p className="field-help">
            Equal = same money in each. Momentum = the strongest stock gets the
            biggest slice.
          </p>
        </div>
      </div>

      {/* ---------------- CASH BUFFER -------------------------------- */}
      <div className="mb-4 rounded-lg border border-brief-line bg-brief-surface p-3">
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-precision-600"
            checked={settings.cash_buffer}
            onChange={(e) => set("cash_buffer", e.target.checked)}
          />
          <span>
            <span className="text-xs font-semibold text-cream-50">
              Keep unfilled slots in cash
            </span>
            <span className="field-help !mt-0.5 block">
              <strong>Ticked:</strong> each of your {settings.top_n} slots is worth
              1/{settings.top_n} of the money. If only 3 stocks beat the index, you
              invest 3 slots and the rest sits safely in cash.
              <br />
              <strong>Unticked:</strong> always 100% invested — those same 3 stocks
              would each get a third of the money.
            </span>
          </span>
        </label>
      </div>

      {/* ---------------- COSTS, CAPITAL, HURDLE --------------------- */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <label className="field-label">Trading cost (bps)</label>
          <input
            type="number"
            min={0}
            step={1}
            className="field mt-1.5"
            value={settings.cost_bps}
            onChange={(e) => set("cost_bps", Number(e.target.value) || 0)}
          />
          <p className="field-help">
            Fees + slippage. 1 bp = 0.01%. Leave at 0 for gross returns; 10 is a
            realistic retail estimate.
          </p>
        </div>
        <div>
          <label className="field-label">Starting capital</label>
          <input
            type="number"
            min={1}
            step={1000}
            className="field mt-1.5"
            value={settings.start_capital}
            onChange={(e) => set("start_capital", Number(e.target.value) || 1)}
          />
          <p className="field-help">
            Cosmetic only — it scales the chart. Percentages are unaffected.
          </p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <label className="field-label">Start date (optional)</label>
          <input
            type="date"
            className="field mt-1.5"
            value={settings.start_date}
            onChange={(e) => set("start_date", e.target.value)}
          />
        </div>
        <div>
          <label className="field-label">End date (optional)</label>
          <input
            type="date"
            className="field mt-1.5"
            value={settings.end_date}
            onChange={(e) => set("end_date", e.target.value)}
          />
        </div>
      </div>
      <p className="field-help !mt-0 mb-4">
        Leave both blank to use every day your files contain. Remember the first{" "}
        {settings.lookback} trading days are spent building history, not trading.
      </p>

      {/* ---------------- RUN ---------------------------------------- */}
      <button className="btn-primary w-full !py-3" onClick={onRun} disabled={!canRun}>
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Running backtest…
          </>
        ) : (
          <>
            <Play className="h-4 w-4" />
            Run backtest
          </>
        )}
      </button>

      {!settings.benchmark && symbols.length > 0 && (
        <p className="mt-2 text-center text-2xs text-amber-400">
          Choose a benchmark file above to enable this button.
        </p>
      )}
      {settings.benchmark && universeSize < 2 && (
        <p className="mt-2 text-center text-2xs text-amber-400">
          Load at least 2 stock files besides the benchmark.
        </p>
      )}
    </section>
  );
}
