/**
 * ==========================================================
 * ComparisonMetricsCard.jsx -- filter ON vs filter OFF
 * ==========================================================
 * One table, three columns: what the strategy did WITHOUT the macro filter,
 * what it did WITH it, and the difference.
 *
 * Reading it honestly: a good filter usually gives up some return in
 * exchange for a shallower worst-case fall. If a row is red it is not
 * automatically bad — check what the drawdown row did in return.
 */
import React from "react";
import { ArrowRight, Scale } from "lucide-react";

/** Format a fraction as a percentage. */
function pct(value, digits = 2) {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

/** Format a plain ratio like Sharpe. */
function ratio(value) {
  if (value === null || value === undefined) return "—";
  return value.toFixed(2);
}

/** Format a whole number. */
function count(value) {
  if (value === null || value === undefined) return "—";
  return String(value);
}

/**
 * The rows of the table.
 *
 * `higherIsBetter` decides whether a positive delta is coloured green or
 * red. `neutral` marks rows where "better" is genuinely a matter of taste -
 * time in cash, for instance, is neither good nor bad on its own.
 */
const ROWS = [
  { key: "total_return", label: "Total return", format: pct, higherIsBetter: true },
  { key: "cagr", label: "CAGR", format: pct, higherIsBetter: true },
  { key: "max_drawdown", label: "Max drawdown", format: pct, higherIsBetter: true,
    note: "A positive delta means the filtered run fell less far." },
  { key: "sharpe", label: "Sharpe ratio", format: ratio, higherIsBetter: true },
  { key: "sortino", label: "Sortino ratio", format: ratio, higherIsBetter: true },
  { key: "annual_volatility", label: "Volatility (annual)", format: pct, higherIsBetter: false },
  { key: "win_rate", label: "Win rate", format: (v) => pct(v, 1), higherIsBetter: true },
  { key: "time_in_market", label: "Time in market", format: (v) => pct(v, 1), neutral: true },
  { key: "time_in_cash", label: "Time in cash", format: (v) => pct(v, 1), neutral: true },
  { key: "regime_switches", label: "Regime switches", format: count, neutral: true,
    note: "How many times the filter changed its mind. Fewer is usually cheaper." },
];

export default function ComparisonMetricsCard({ comparison, maxDrawdownReduction }) {
  if (!comparison) return null;

  return (
    <section className="brief-card p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Scale className="h-4 w-4 text-precision-400" />
        <div>
          <p className="brief-eyebrow">Head to head</p>
          <h3 className="mt-0.5 text-base font-bold text-cream-50">
            Regime filter ON vs OFF
          </h3>
        </div>

        {/* The single number this whole feature exists to produce. */}
        {maxDrawdownReduction !== null && maxDrawdownReduction !== undefined && (
          <div
            className={`ml-auto rounded-lg border px-3 py-1.5 text-right ${
              maxDrawdownReduction > 0
                ? "border-market-up/40 bg-market-up/10"
                : "border-brief-line bg-brief-surface"
            }`}
          >
            <p className="text-2xs uppercase tracking-wider text-brief-muted">
              Drawdown reduction
            </p>
            <p
              className={`font-mono text-sm font-bold ${
                maxDrawdownReduction > 0 ? "text-market-up" : "text-cream-100"
              }`}
            >
              {maxDrawdownReduction > 0 ? "" : ""}
              {(maxDrawdownReduction * 100).toFixed(2)} pp
            </p>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left">
          <thead>
            <tr className="border-b border-brief-line">
              <th className="px-3 py-2 text-2xs font-semibold uppercase tracking-[0.12em] text-brief-muted">
                Metric
              </th>
              <th className="px-3 py-2 text-right text-2xs font-semibold uppercase tracking-[0.12em] text-brief-muted">
                Filter OFF
              </th>
              <th className="px-3 py-2 text-right text-2xs font-semibold uppercase tracking-[0.12em] text-precision-300">
                Filter ON
              </th>
              <th className="px-3 py-2 text-right text-2xs font-semibold uppercase tracking-[0.12em] text-brief-muted">
                Difference
              </th>
            </tr>
          </thead>

          <tbody>
            {ROWS.map((row) => {
              const cell = comparison[row.key];
              if (!cell) return null;

              const delta = cell.delta;
              const hasDelta = delta !== null && delta !== undefined;

              // Which way is "good" for this particular row?
              let deltaTone = "text-brief-muted";
              if (hasDelta && !row.neutral && delta !== 0) {
                const improved = row.higherIsBetter ? delta > 0 : delta < 0;
                deltaTone = improved ? "text-market-up" : "text-market-down";
              }

              // Deltas for count-style rows are meaningless, so we say so.
              const deltaText = !hasDelta
                ? "n/a"
                : `${delta > 0 ? "+" : ""}${row.format(delta)}`;

              return (
                <tr key={row.key} className="border-b border-brief-line/50">
                  <td className="px-3 py-2.5">
                    <span className="text-xs font-medium text-cream-100">
                      {row.label}
                    </span>
                    {row.note && (
                      <span className="mt-0.5 block text-[10px] leading-snug text-brief-muted">
                        {row.note}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-brief-muted">
                    {row.format(cell.off)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs font-semibold text-cream-50">
                    {row.format(cell.on)}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono text-xs font-semibold ${deltaTone}`}>
                    {deltaText}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-2xs leading-relaxed text-brief-muted">
        <ArrowRight className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          A filter that lowers return but also lowers drawdown has not failed — it has
          made a trade. Judge it on whether that trade suits how much pain you can sit
          through, not on the return column alone.
        </span>
      </p>
    </section>
  );
}
