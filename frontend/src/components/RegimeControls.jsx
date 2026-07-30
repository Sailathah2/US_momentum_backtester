/**
 * ==========================================================
 * RegimeControls.jsx -- the macro "should I be invested?" filter
 * ==========================================================
 *
 * The momentum settings decide WHICH stocks to buy. This panel decides
 * something bigger: whether to be in the market at all.
 *
 * It watches one index (usually the benchmark) and switches the whole
 * portfolio between two states:
 *
 *     Risk-ON   the index is trending up   -> run the strategy normally
 *     Risk-OFF  the index is trending down -> hold 100% cash
 */
import React from "react";
import { Activity, Loader2, ShieldCheck, Waves } from "lucide-react";

// The four filter modes, in the order they appear as buttons.
const MODES = [
  {
    id: "disabled",
    label: "Off",
    blurb: "No macro filter. The strategy stays fully invested at all times.",
  },
  {
    id: "ema",
    label: "EMA only",
    blurb:
      "Invested while the index closes ABOVE its moving average. Simple and slow to change its mind.",
  },
  {
    id: "supertrend",
    label: "Supertrend only",
    blurb:
      "Invested while the index closes above its Supertrend line. The line widens in volatile markets, so ordinary noise does not shake you out.",
  },
  {
    id: "both",
    label: "Both (recommended)",
    blurb:
      "Needs BOTH indicators to agree before it changes state. If only one turns bearish, the current state is retained - this is what stops the costly in-out-in-out churn called whipsaw.",
  },
];

// Common EMA lengths. 200 is the classic long-term trend line.
const EMA_PRESETS = [20, 50, 100, 200];

export default function RegimeControls({
  settings,
  onChange,
  onRun,
  busy,
  symbols,
  canRun,
}) {
  const set = (key, value) => onChange({ ...settings, [key]: value });

  const mode = settings.regime_mode;
  const usesEma = mode === "ema" || mode === "both";
  const usesSupertrend = mode === "supertrend" || mode === "both";
  const active = mode !== "disabled";

  const activeMode = MODES.find((m) => m.id === mode);

  return (
    <section className="brief-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-precision-400" />
        <div>
          <p className="brief-eyebrow">Step 3 &middot; optional</p>
          <h2 className="mt-1 text-base font-bold text-cream-50">
            Index regime filter
          </h2>
        </div>
      </div>

      <p className="mb-4 text-2xs leading-relaxed text-brief-muted">
        A momentum strategy buys the strongest stocks — but in a falling market even
        the strongest stocks fall. This filter watches an index and moves you to{" "}
        <strong className="text-cream-100">100% cash</strong> while that index is in a
        downtrend.
      </p>

      {/* ---------------- MODE ---------------------------------------- */}
      <label className="field-label">Filter mode</label>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        {MODES.map((option) => (
          <button
            key={option.id}
            className={`chip !py-2 ${mode === option.id ? "chip-active" : ""}`}
            onClick={() => set("regime_mode", option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {activeMode && <p className="field-help">{activeMode.blurb}</p>}

      {/* Everything below only matters once a filter is switched on. */}
      {active && (
        <div className="mt-4 animate-riseIn space-y-4">
          {/* ---------------- WHICH INDEX ----------------------------- */}
          <div>
            <label className="field-label">Index to watch</label>
            <select
              className="field mt-1.5"
              value={settings.regime_index || ""}
              onChange={(e) => set("regime_index", e.target.value)}
            >
              <option value="">— choose an index or stock —</option>
              {symbols.map((symbol) => (
                <option key={symbol.ticker} value={symbol.ticker}>
                  {symbol.ticker}
                  {symbol.benchmark_candidate ? "  (looks like an index)" : ""}
                </option>
              ))}
            </select>
            <p className="field-help">
              Usually your benchmark. But you can gate a small-cap universe on the
              S&amp;P 500, or on any single stock you treat as a bellwether.
            </p>
          </div>

          {/* ---------------- EMA PERIOD ------------------------------ */}
          {usesEma && (
            <div>
              <label className="field-label">EMA period (days)</label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {EMA_PRESETS.map((days) => (
                  <button
                    key={days}
                    className={`chip ${settings.ema_period === days ? "chip-active" : ""}`}
                    onClick={() => set("ema_period", days)}
                  >
                    {days}
                  </button>
                ))}
                <input
                  type="number"
                  min={2}
                  className="field !w-24 !py-1.5 !text-xs"
                  value={settings.ema_period}
                  onChange={(e) => set("ema_period", Number(e.target.value) || 2)}
                />
              </div>
              <p className="field-help">
                The index is &quot;healthy&quot; while its close is above this average.{" "}
                <strong>200</strong> is the classic long-term trend line; shorter
                values react sooner but change their mind far more often.
              </p>
            </div>
          )}

          {/* ---------------- SUPERTREND SETTINGS --------------------- */}
          {usesSupertrend && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label">ATR period</label>
                <input
                  type="number"
                  min={1}
                  className="field mt-1.5"
                  value={settings.atr_period}
                  onChange={(e) => set("atr_period", Number(e.target.value) || 1)}
                />
                <p className="field-help">
                  How many days of price movement feed the volatility estimate. 10 is
                  standard.
                </p>
              </div>
              <div>
                <label className="field-label">Multiplier</label>
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  className="field mt-1.5"
                  value={settings.st_multiplier}
                  onChange={(e) =>
                    set("st_multiplier", Number(e.target.value) || 0.1)
                  }
                />
                <p className="field-help">
                  How far the stop sits from price, in ATRs. <strong>Higher</strong> =
                  looser, fewer exits. Lower = twitchier.
                </p>
              </div>
            </div>
          )}

          {/* ---------------- WHAT WILL HAPPEN ------------------------ */}
          <div className="rounded-lg border border-brief-line bg-brief-surface p-3">
            <div className="flex items-center gap-2">
              <Waves className="h-3.5 w-3.5 text-precision-400" />
              <p className="text-xs font-semibold text-cream-50">
                What this run will show you
              </p>
            </div>
            <p className="field-help !mt-1.5">
              The same strategy is run <strong>twice</strong> — once with this filter
              and once without — so you can see exactly what the filter cost you in
              return and what it saved you in drawdown.
            </p>
          </div>

          <button className="btn-primary w-full !py-3" onClick={onRun} disabled={!canRun}>
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Comparing both runs…
              </>
            ) : (
              <>
                <Activity className="h-4 w-4" />
                Compare filter ON vs OFF
              </>
            )}
          </button>

          {!settings.regime_index && (
            <p className="text-center text-2xs text-amber-400">
              Choose an index to watch above.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
