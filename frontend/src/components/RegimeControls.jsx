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

// Common EMA lengths, per timeframe.
//
// The numbers count BARS of whichever candle you picked, exactly as they do
// on a charting website. So 200 on daily candles is 200 days (~10 months),
// while 40 on weekly candles is 40 weeks (~9 months).
const EMA_PRESETS = {
  daily: [20, 50, 100, 200],
  weekly: [10, 20, 30, 40],
};

// What each timeframe starts on when you switch to it.
const DEFAULT_EMA = { daily: 200, weekly: 40 };

// Roughly how long a given number of bars covers, in plain English.
function describeSpan(bars, timeframe) {
  // ~252 trading days a year; ~52 weeks a year.
  const years = timeframe === "weekly" ? bars / 52 : bars / 252;
  if (years >= 1) return `about ${years.toFixed(1)} year${years >= 2 ? "s" : ""}`;
  const months = Math.round(years * 12);
  return `about ${months} month${months === 1 ? "" : "s"}`;
}

// How much to move to cash on a Risk-OFF day. 100% is the classic
// "get out of the market entirely"; the lower values let you de-risk
// part of the book instead of all of it.
const CASH_PRESETS = [25, 50, 75, 100];

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
  const timeframe = settings.regime_timeframe || "daily";
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

      {/* A genuinely surprising consequence of the hysteresis rule, worth
          saying out loud so it does not look like a broken control. */}
      {mode === "both" && (
        <p className="field-help">
          <strong className="text-cream-100">Heads up:</strong> because the state only
          moves when both indicators agree, changing the EMA period here often makes{" "}
          <em>no difference at all</em> — the disagreements it creates just get
          absorbed by the retention rule. Use <strong>EMA only</strong> if you want to
          see that setting bite.
        </p>
      )}

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

          {/* ---------------- CANDLE TIMEFRAME ------------------------ */}
          <div>
            <label className="field-label">Candles to read</label>
            <div className="mt-1.5 flex gap-1.5">
              {["daily", "weekly"].map((option) => (
                <button
                  key={option}
                  className={`chip flex-1 !py-2 capitalize ${
                    timeframe === option ? "chip-active" : ""
                  }`}
                  onClick={() => {
                    // Switching timeframe also snaps the EMA length to a
                    // sensible default for it. Leaving 200 in place when you
                    // move to weekly would silently mean 200 WEEKS - nearly
                    // four years - which is almost never what you wanted.
                    onChange({
                      ...settings,
                      regime_timeframe: option,
                      ema_period: DEFAULT_EMA[option],
                    });
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
            <p className="field-help">
              {timeframe === "daily" ? (
                <>
                  One bar per trading day. Reacts quickly, but flips more often.
                </>
              ) : (
                <>
                  Each week becomes one candle, so the trend line is far smoother and
                  the filter changes its mind much less. It also reacts later — you
                  give up some agility for far fewer whipsaws.{" "}
                  <strong className="text-cream-100">
                    Periods now count weeks, not days.
                  </strong>
                </>
              )}
            </p>
          </div>

          {/* ---------------- EMA PERIOD ------------------------------ */}
          {usesEma && (
            <div>
              <label className="field-label">
                EMA period ({timeframe === "weekly" ? "weeks" : "days"})
              </label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {EMA_PRESETS[timeframe].map((bars) => (
                  <button
                    key={bars}
                    className={`chip ${settings.ema_period === bars ? "chip-active" : ""}`}
                    onClick={() => set("ema_period", bars)}
                  >
                    {bars}
                    {timeframe === "weekly" ? "w" : ""}
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
                <strong className="text-cream-100">
                  {settings.ema_period} {timeframe === "weekly" ? "weeks" : "days"} is{" "}
                  {describeSpan(settings.ema_period, timeframe)} of trend.
                </strong>{" "}
                Shorter values react sooner but change their mind far more often.
              </p>
            </div>
          )}

          {/* ---------------- SUPERTREND SETTINGS --------------------- */}
          {usesSupertrend && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label">
                  ATR period ({timeframe === "weekly" ? "weeks" : "days"})
                </label>
                <input
                  type="number"
                  min={1}
                  className="field mt-1.5"
                  value={settings.atr_period}
                  onChange={(e) => set("atr_period", Number(e.target.value) || 1)}
                />
                <p className="field-help">
                  How many {timeframe === "weekly" ? "weeks" : "days"} of price
                  movement feed the volatility estimate. 10 is standard.
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

          {/* ---------------- HOW MUCH CASH ON RISK-OFF --------------- */}
          <div>
            <label className="field-label">Cash to hold when Risk-OFF</label>

            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {CASH_PRESETS.map((percent) => (
                <button
                  key={percent}
                  className={`chip ${
                    settings.risk_off_cash_pct === percent ? "chip-active" : ""
                  }`}
                  onClick={() => set("risk_off_cash_pct", percent)}
                >
                  {percent}%
                </button>
              ))}
            </div>

            {/* A slider as well as the presets, because this is a feel
                setting people like to nudge rather than type. */}
            <div className="mt-2.5 flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={settings.risk_off_cash_pct}
                onChange={(e) => set("risk_off_cash_pct", Number(e.target.value))}
                className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-brief-line accent-precision-500"
              />
              <input
                type="number"
                min={0}
                max={100}
                className="field !w-20 !py-1.5 !text-xs"
                value={settings.risk_off_cash_pct}
                onChange={(e) => {
                  const raw = Number(e.target.value);
                  // Keep it inside 0-100 whatever the user types.
                  const clamped = Math.min(100, Math.max(0, Number.isNaN(raw) ? 0 : raw));
                  set("risk_off_cash_pct", clamped);
                }}
              />
            </div>

            {/* Spell out in plain words what the current number will do. */}
            <p className="field-help">
              On a Risk-OFF day the portfolio moves{" "}
              <strong className="text-cream-100">{settings.risk_off_cash_pct}%</strong> to
              cash and keeps{" "}
              <strong className="text-cream-100">
                {100 - settings.risk_off_cash_pct}%
              </strong>{" "}
              invested in the momentum picks.
              {settings.risk_off_cash_pct === 100 && (
                <> Fully defensive — no market exposure at all while the filter is off.</>
              )}
              {settings.risk_off_cash_pct > 0 && settings.risk_off_cash_pct < 100 && (
                <>
                  {" "}
                  A middle path: you give up less upside than going fully to cash, but
                  you also keep some of the downside.
                </>
              )}
              {settings.risk_off_cash_pct === 0 && (
                <>
                  {" "}
                  <span className="text-amber-400">
                    At 0% the filter never actually does anything — both runs will be
                    identical.
                  </span>
                </>
              )}
            </p>
          </div>

          {/* ---------------- WHERE TO PARK THE MONEY ----------------- */}
          {settings.risk_off_cash_pct > 0 && (
            <div>
              <label className="field-label">Park that money in</label>
              <select
                className="field mt-1.5"
                value={settings.risk_off_asset || ""}
                onChange={(e) => set("risk_off_asset", e.target.value)}
              >
                <option value="">Cash — earns nothing</option>
                {symbols.map((symbol) => (
                  <option key={symbol.ticker} value={symbol.ticker}>
                    {symbol.ticker}
                    {symbol.benchmark_candidate ? "  (looks like an index)" : ""}
                  </option>
                ))}
              </select>
              <p className="field-help">
                {settings.risk_off_asset ? (
                  <>
                    While the filter is off, the de-risked{" "}
                    {settings.risk_off_cash_pct}% is held in{" "}
                    <strong className="text-cream-100">{settings.risk_off_asset}</strong>{" "}
                    instead of sitting idle. Gold is the classic choice, because it
                    often rises exactly when shares are falling — but check the result,
                    since parking in something risky can deepen your drawdown rather
                    than soften it. Each switch now costs{" "}
                    <strong>two trades</strong> (sell shares, buy {settings.risk_off_asset}),
                    so the cost is doubled.
                  </>
                ) : (
                  <>
                    Plain cash: the de-risked money earns 0% and simply waits. Pick a
                    loaded symbol — gold or a bond fund — to put it to work instead.
                  </>
                )}
              </p>
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
              {settings.risk_off_cash_pct < 100 && settings.risk_off_cash_pct > 0 && (
                <>
                  {" "}
                  Because you are holding {100 - settings.risk_off_cash_pct}% through
                  Risk-OFF days, watch the <strong>average exposure</strong> figure
                  rather than &quot;time in market&quot;.
                </>
              )}
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
