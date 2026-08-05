/**
 * ==========================================================
 * RankChecker.jsx -- the league table on one historical day
 * ==========================================================
 * Pick a date, pick your settings, and see exactly how every stock in the
 * universe scored that day — including the ones that were rejected, and
 * why.
 *
 * This answers the question a backtest cannot: "why wasn't X picked that
 * month?" It runs the same selection code the backtest does, so the two can
 * never disagree.
 */
import React, { useState } from "react";
import { Filter, Loader2, Search, Target } from "lucide-react";

import { checkRank } from "../api";

/** Format a fraction as a signed percentage. */
function pct(value, digits = 1) {
  if (value === null || value === undefined) return "—";
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

const STATUS_STYLE = {
  SELECTED: "bg-market-up/15 text-market-up",
  "IN CUSHION": "bg-precision-600/20 text-precision-300",
  RANKED: "bg-brief-surface text-brief-muted",
  REJECTED: "bg-market-down/10 text-market-down",
};

export default function RankChecker({ sessionId, symbols, settings, onChange }) {
  const [date, setDate] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [showRejected, setShowRejected] = useState(false);
  const [limit, setLimit] = useState(60);

  const set = (key, value) => onChange({ ...settings, [key]: value });

  async function run() {
    setError(null);
    setBusy(true);
    try {
      setResult(await checkRank({ session_id: sessionId, date, ...settings }));
      setLimit(60);
    } catch (exception) {
      setError(exception.message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  const rows = (result?.rows || []).filter((row) => {
    if (!showRejected && row.status === "REJECTED") return false;
    if (query && !row.ticker.toLowerCase().includes(query.trim().toLowerCase()))
      return false;
    return true;
  });
  const visible = rows.slice(0, limit);

  if (!symbols.length) {
    return (
      <div className="mx-auto max-w-2xl">
        <section className="brief-card p-6 text-center">
          <Target className="mx-auto h-6 w-6 text-precision-400" />
          <h2 className="mt-3 text-base font-bold text-cream-50">
            Load your price files first
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-brief-muted">
            Go to the <strong className="text-cream-100">Backtest</strong> tab and
            scan a folder. Once the data is loaded you can inspect the ranking on any
            date it covers.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ---------------- CONTROLS ---------------------------------- */}
      <section className="brief-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <Target className="h-4 w-4 text-precision-400" />
          <div>
            <p className="brief-eyebrow">Rank checker</p>
            <h2 className="mt-1 text-base font-bold text-cream-50">
              The ranking as it stood on one day
            </h2>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="field-label">Date to inspect</label>
            <input
              type="date"
              className="field mt-1.5"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label">Benchmark</label>
            <select
              className="field mt-1.5"
              value={settings.benchmark || ""}
              onChange={(e) => set("benchmark", e.target.value)}
            >
              <option value="">— choose —</option>
              {symbols.map((s) => (
                <option key={s.ticker} value={s.ticker}>
                  {s.ticker}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">Lookback (days)</label>
            <input
              type="number"
              min={2}
              className="field mt-1.5"
              value={settings.lookback}
              onChange={(e) => set("lookback", Number(e.target.value) || 2)}
            />
          </div>
          <div>
            <label className="field-label">Hold top</label>
            <input
              type="number"
              min={1}
              className="field mt-1.5"
              value={settings.top_n}
              onChange={(e) => set("top_n", Number(e.target.value) || 1)}
            />
          </div>
          <div>
            <label className="field-label">Stock EMA gate</label>
            <input
              type="number"
              min={0}
              className="field mt-1.5"
              value={settings.stock_ema_period}
              onChange={(e) => set("stock_ema_period", Number(e.target.value) || 0)}
            />
          </div>
          <div>
            <label className="field-label">Risk window</label>
            <input
              type="number"
              min={0}
              className="field mt-1.5"
              value={settings.stddev_period}
              onChange={(e) => set("stddev_period", Number(e.target.value) || 0)}
            />
          </div>
          <div>
            <label className="field-label">Risk measure</label>
            <select
              className="field mt-1.5"
              value={settings.risk_measure}
              onChange={(e) => set("risk_measure", e.target.value)}
            >
              <option value="stddev">Std dev</option>
              <option value="downside">Downside dev</option>
            </select>
          </div>
          <div>
            <label className="field-label">Exit rank cushion</label>
            <input
              type="number"
              min={0}
              className="field mt-1.5"
              value={settings.exit_rank}
              onChange={(e) => set("exit_rank", Number(e.target.value) || 0)}
            />
          </div>
        </div>

        <button
          className="btn-primary mt-4 w-full !py-2.5"
          onClick={run}
          disabled={busy || !date || !settings.benchmark}
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Ranking…
            </>
          ) : (
            <>
              <Search className="h-4 w-4" />
              Show the ranking
            </>
          )}
        </button>

        {error && (
          <p className="mt-3 rounded-lg border border-market-down/40 bg-market-down/10 px-3 py-2 text-2xs leading-relaxed text-cream-100">
            {error}
          </p>
        )}
      </section>

      {result && (
        <>
          {/* ---------------- THE FUNNEL ---------------------------- */}
          <section className="brief-card animate-riseIn p-5">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <Filter className="h-4 w-4 text-precision-400" />
              <div>
                <p className="brief-eyebrow">How the field narrowed</p>
                <h3 className="mt-0.5 text-base font-bold text-cream-50">
                  {result.as_of}
                  {result.snapped && (
                    <span className="ml-2 text-2xs font-normal text-brief-muted">
                      (nearest trading day to {result.requested})
                    </span>
                  )}
                </h3>
              </div>
              <div className="ml-auto rounded-lg border border-brief-line bg-brief-surface px-3 py-1.5 text-right">
                <p className="text-2xs uppercase tracking-wider text-brief-muted">
                  {result.benchmark} had to be beaten by
                </p>
                <p className="font-mono text-sm font-bold text-cream-50">
                  {pct(result.hurdle, 2)}
                </p>
              </div>
            </div>

            {/* Each step shows what survived it, so a surprising result is
                traceable to the exact filter that caused it. */}
            <div className="flex flex-wrap gap-2">
              {[
                ["Universe", result.funnel.universe, null],
                ["Enough history", result.funnel.enough_history, "lookback"],
                ["Above own EMA", result.funnel.above_own_ema, "stock EMA gate"],
                ["Beat the index", result.funnel.beat_index, "relative strength"],
                ["Ranked", result.funnel.ranked, null],
                ["Selected", result.selected.length, `top ${result.settings.top_n}`],
              ].map(([label, value, note], index) => (
                <div
                  key={label}
                  className={`flex-1 rounded-lg border px-3 py-2 ${
                    index === 5
                      ? "border-market-up/40 bg-market-up/10"
                      : "border-brief-line bg-brief-surface"
                  }`}
                  style={{ minWidth: "120px" }}
                >
                  <p className="text-2xs uppercase tracking-wider text-brief-muted">
                    {label}
                  </p>
                  <p
                    className={`mt-0.5 font-mono text-lg font-bold leading-none ${
                      index === 5 ? "text-market-up" : "text-cream-50"
                    }`}
                  >
                    {value}
                  </p>
                  {note && (
                    <p className="mt-0.5 text-[10px] text-brief-muted">via {note}</p>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* ---------------- THE TABLE ----------------------------- */}
          <section className="brief-card p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-cream-50">
                {rows.length.toLocaleString()} stock
                {rows.length === 1 ? "" : "s"}
              </h3>
              <button
                className={`chip ${showRejected ? "chip-active" : ""}`}
                onClick={() => {
                  setShowRejected((v) => !v);
                  setLimit(60);
                }}
              >
                {showRejected ? "Hiding nothing" : "Show rejected too"}
              </button>
              <div className="relative ml-auto">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-brief-muted" />
                <input
                  className="field !w-48 !py-1.5 !pl-8 !text-xs"
                  placeholder="Find a ticker…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setLimit(60);
                  }}
                />
              </div>
            </div>

            <div className="max-h-[560px] overflow-auto rounded-lg border border-brief-line">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="text-right">Rank</th>
                    <th>Ticker</th>
                    <th>Status</th>
                    <th className="text-right">Close</th>
                    <th className="text-right">ROC</th>
                    <th className="text-right">vs index</th>
                    {result.settings.stddev_period > 0 && (
                      <th className="text-right">Risk</th>
                    )}
                    <th className="text-right">Score</th>
                    {result.settings.stock_ema_period > 0 && (
                      <th className="text-right">Own EMA</th>
                    )}
                    <th className="text-right">Weight</th>
                    <th>Why not</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.ticker}>
                      <td className="num text-brief-muted">{row.rank ?? "—"}</td>
                      <td className="font-semibold text-cream-50">{row.ticker}</td>
                      <td>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            STATUS_STYLE[row.status]
                          }`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="num text-brief-muted">
                        {row.close === null ? "—" : row.close.toFixed(2)}
                      </td>
                      <td
                        className={`num ${
                          row.roc > 0 ? "text-market-up" : "text-market-down"
                        }`}
                      >
                        {pct(row.roc)}
                      </td>
                      <td
                        className={`num ${
                          row.relative_strength > 0
                            ? "text-market-up"
                            : "text-market-down"
                        }`}
                      >
                        {pct(row.relative_strength)}
                      </td>
                      {result.settings.stddev_period > 0 && (
                        <td className="num text-brief-muted">
                          {row.stddev === null ? "—" : row.stddev.toFixed(4)}
                        </td>
                      )}
                      <td className="num font-semibold text-cream-50">
                        {row.score === null ? "—" : row.score.toFixed(2)}
                      </td>
                      {result.settings.stock_ema_period > 0 && (
                        <td
                          className={`num ${
                            row.above_own_ema ? "text-brief-muted" : "text-market-down"
                          }`}
                        >
                          {row.own_ema === null ? "—" : row.own_ema.toFixed(2)}
                        </td>
                      )}
                      <td className="num">
                        {row.weight ? `${(row.weight * 100).toFixed(1)}%` : "—"}
                      </td>
                      <td className="!whitespace-normal text-brief-muted">
                        {row.reason || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {visible.length === 0 && (
                <p className="px-4 py-8 text-center text-xs text-brief-muted">
                  Nothing matches. Try &ldquo;Show rejected too&rdquo;.
                </p>
              )}
            </div>

            {rows.length > visible.length && (
              <button
                className="btn-ghost mt-3 w-full !py-2 !text-xs"
                onClick={() => setLimit((v) => v + 200)}
              >
                Show more ({visible.length} of {rows.length.toLocaleString()})
              </button>
            )}

            {/* With a cushion on, real holdings depend on what you already
                owned - which this screen cannot know. Say so plainly rather
                than let the SELECTED column quietly mislead. */}
            {result.settings.exit_rank > 0 && (
              <p className="mt-3 rounded-lg border border-brief-line bg-brief-surface px-3 py-2 text-2xs leading-relaxed text-brief-muted">
                You have an exit cushion of {result.settings.exit_rank} set. This screen
                shows what you would buy <strong className="text-cream-100">starting
                from cash</strong> on this date. In a running backtest some of these
                slots would instead be filled by stocks you already held — anything
                ranked inside the cushion is kept rather than replaced. Check the
                Keep / exit / enter log in the Backtest tab for what actually happened.
              </p>
            )}

            <p className="mt-3 text-2xs leading-relaxed text-brief-muted">
              <strong className="text-cream-100">SELECTED</strong> would have been
              bought that day.{" "}
              <strong className="text-precision-300">IN CUSHION</strong> ranks below the
              top {result.settings.top_n} but inside the exit cushion — not bought, but
              kept if already held.{" "}
              <strong>RANKED</strong> qualified but placed too low.{" "}
              <strong className="text-market-down">REJECTED</strong> failed a filter;
              the last column says which.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
