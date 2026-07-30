/**
 * ==========================================================
 * ExposureChart.jsx -- how much of the time were you invested?
 * ==========================================================
 * Two things on one panel:
 *
 *   1. A single split bar: time in market vs time in cash. A bar (not a pie)
 *      because comparing two lengths along a common baseline is far easier
 *      to read accurately than comparing two wedge angles.
 *   2. The underlying day counts and switch count, written out as numbers.
 *
 * "Exposure" matters because two strategies with the same return are not
 * equal if one of them achieved it while risking your money only half the
 * time. Less time exposed to the market means less time something can go
 * catastrophically wrong.
 */
import React from "react";
import { Gauge, PieChart as PieIcon, Repeat, Wallet } from "lucide-react";

const REGIME_ON = "#22C55E"; // green - invested
const REGIME_OFF = "#475569"; // slate - cash

function pct(value, digits = 1) {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

/** One number with a caption underneath. */
function Stat({ icon: Icon, label, value, sub, tone = "text-cream-50" }) {
  return (
    <div className="rounded-lg border border-brief-line bg-brief-surface px-3 py-2.5">
      <div className="flex items-center justify-between">
        <p className="text-2xs uppercase tracking-wider text-brief-muted">{label}</p>
        <Icon className="h-3.5 w-3.5 text-brief-muted" />
      </div>
      <p className={`mt-1 font-mono text-lg font-bold leading-none ${tone}`}>{value}</p>
      {sub && <p className="mt-1 text-2xs text-brief-muted">{sub}</p>}
    </div>
  );
}

export default function ExposureChart({ exposure }) {
  if (!exposure) return null;

  const inMarket = exposure.time_in_market ?? 0;
  const inCash = exposure.time_in_cash ?? 0;

  // How much of the book is still held on a Risk-OFF day. 0 means the
  // classic "everything to cash"; anything above that is partial de-risking,
  // which changes what the labels below should honestly say.
  const riskOffExposure = exposure.risk_off_exposure ?? 0;
  const partialCash = riskOffExposure > 0;

  // Guard against a zero-length run so the bar never collapses to NaN width.
  const marketPercent = Math.max(0, Math.min(100, inMarket * 100));
  const cashPercent = Math.max(0, Math.min(100, inCash * 100));

  return (
    <section className="brief-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <PieIcon className="h-4 w-4 text-precision-400" />
        <div>
          <p className="brief-eyebrow">Exposure breakdown</p>
          <h3 className="mt-0.5 text-base font-bold text-cream-50">
            Time in market vs time in cash
          </h3>
        </div>
      </div>

      {/* ---- The split bar ------------------------------------------- */}
      {/* A 2px gap separates the two fills so they never blur into one
          another at small sizes. */}
      <div className="flex h-9 w-full gap-[2px] overflow-hidden rounded-lg">
        {marketPercent > 0 && (
          <div
            className="flex items-center justify-center transition-all"
            style={{ width: `${marketPercent}%`, backgroundColor: REGIME_ON }}
            title={`Invested on ${exposure.days_in_market} of ${exposure.total_days} trading days`}
          >
            {/* Only print the label if there is room for it. */}
            {marketPercent > 14 && (
              <span className="font-mono text-xs font-bold text-slate-950">
                {pct(inMarket)}
              </span>
            )}
          </div>
        )}
        {cashPercent > 0 && (
          <div
            className="flex items-center justify-center transition-all"
            style={{ width: `${cashPercent}%`, backgroundColor: REGIME_OFF }}
            title={`In cash on ${exposure.days_in_cash} of ${exposure.total_days} trading days`}
          >
            {cashPercent > 14 && (
              <span className="font-mono text-xs font-bold text-cream-50">
                {pct(inCash)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* The legend spells out both states in words, so the split is never
          carried by colour alone. */}
      <div className="mt-2 flex flex-wrap items-center gap-4 text-2xs">
        <span className="flex items-center gap-1.5 text-cream-200">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: REGIME_ON }} />
          Risk-ON, fully invested — {pct(inMarket)}
        </span>
        <span className="flex items-center gap-1.5 text-cream-200">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: REGIME_OFF }} />
          {partialCash
            ? `Risk-OFF, ${pct(1 - riskOffExposure, 0)} cash — ${pct(inCash)}`
            : `Risk-OFF, 100% cash — ${pct(inCash)}`}
        </span>
      </div>

      {/* When the user keeps part of the book through Risk-OFF days, the
          bar above no longer tells the whole story - it counts DAYS, not
          money at risk. Say so explicitly rather than let it mislead. */}
      {partialCash && (
        <p className="mt-2 rounded-lg border border-brief-line bg-brief-surface px-3 py-2 text-2xs leading-relaxed text-brief-muted">
          The bar counts <strong>days</strong>, not money. Because you hold{" "}
          {pct(riskOffExposure, 0)} of the book through Risk-OFF days, your capital was
          never fully out of the market — the{" "}
          <strong className="text-cream-100">average exposure</strong> figure below is
          the number to judge this run on.
        </p>
      )}

      {/* ---- The same information as hard numbers -------------------- */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          icon={Wallet}
          label="Days invested"
          value={exposure.days_in_market?.toLocaleString() ?? "—"}
          sub={`of ${exposure.total_days?.toLocaleString() ?? "—"} trading days`}
        />
        <Stat
          icon={Wallet}
          label="Days de-risked"
          value={exposure.days_in_cash?.toLocaleString() ?? "—"}
          sub={
            partialCash
              ? `holding ${pct(riskOffExposure, 0)} of the book`
              : "zero market risk on these days"
          }
        />
        <Stat
          icon={Gauge}
          label="Avg. exposure"
          value={pct(exposure.average_exposure)}
          sub="capital actually at risk"
        />
        <Stat
          icon={Repeat}
          label="Regime switches"
          value={exposure.switches ?? "—"}
          sub="each one costs a round trip"
        />
      </div>

      <p className="mt-3 text-2xs leading-relaxed text-brief-muted">
        A high switch count is a warning sign: every flip pays the spread twice. If
        this number looks large, try the <strong>Both</strong> filter mode, a longer
        EMA, or a bigger Supertrend multiplier — all three make the filter slower to
        change its mind.
      </p>
    </section>
  );
}
