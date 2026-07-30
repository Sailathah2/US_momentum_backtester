/**
 * ==========================================================
 * MonthlyHeatmap.jsx -- the calendar grid of returns
 * ==========================================================
 * One row per year, one column per month, plus the full-year total on the
 * right. This is the "factsheet" view every fund publishes, and it answers
 * questions the equity curve cannot: was the good year one lucky month? How
 * many losing months in a row did it have?
 *
 * ABOUT THE COLOURS
 * -----------------
 * Green = a profitable month, red = a losing month, and the shade shows how
 * big. That is a diverging scale with a neutral middle, which is exactly the
 * right choice for a number that can be positive or negative.
 *
 * Red/green is the universal convention in finance, but it is also the
 * hardest pair for a colour-blind reader. So EVERY cell prints its actual
 * percentage. The colour is a fast summary; the digits are the real data,
 * and nobody has to rely on the colour to read the table.
 */
import React from "react";
import { CalendarDays } from "lucide-react";

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Work out the background colour for one cell.
 *
 * `strength` runs 0 (tiny move) to 1 (the biggest move in the whole table),
 * so a table of quiet months still shows contrast, and one wild month never
 * flattens everything else into grey.
 */
function cellStyle(value, biggest) {
  if (value === null || value === undefined) {
    return { backgroundColor: "transparent" };
  }

  const strength = biggest > 0 ? Math.min(1, Math.abs(value) / biggest) : 0;
  // Never fully transparent (so a zero month still reads as a filled cell)
  // and never fully opaque (so the white text stays legible on top).
  const opacity = 0.12 + strength * 0.62;

  // 34,197,94  = market up green    (#22C55E)
  // 225,29,72  = market down red    (#E11D48)
  const rgb = value >= 0 ? "34,197,94" : "225,29,72";
  return { backgroundColor: `rgba(${rgb},${opacity.toFixed(3)})` };
}

/** Format a fraction as a compact percentage: 0.0432 -> "4.3". */
function pct(value, digits = 1) {
  if (value === null || value === undefined) return "";
  return (value * 100).toFixed(digits);
}

export default function MonthlyHeatmap({ rows }) {
  if (!rows?.length) return null;

  // Find the largest single monthly move, which sets the colour scale.
  let biggest = 0;
  rows.forEach((row) => {
    Object.values(row.months).forEach((value) => {
      if (value !== null && value !== undefined) {
        biggest = Math.max(biggest, Math.abs(value));
      }
    });
  });

  return (
    <section className="brief-card p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <CalendarDays className="h-4 w-4 text-precision-400" />
        <div>
          <p className="brief-eyebrow">Calendar performance</p>
          <h3 className="mt-0.5 text-base font-bold text-cream-50">
            Monthly &amp; annual returns (%)
          </h3>
        </div>

        {/* A plain-language legend. */}
        <div className="ml-auto flex items-center gap-3 text-2xs text-brief-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: "rgba(225,29,72,0.6)" }} />
            Loss
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: "rgba(34,197,94,0.6)" }} />
            Gain
          </span>
        </div>
      </div>

      {/* The table scrolls sideways on a narrow screen rather than squashing
          the numbers or pushing the whole page wider. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-[2px] text-center">
          <thead>
            <tr>
              <th className="px-2 py-1.5 text-left text-2xs font-semibold uppercase tracking-wider text-brief-muted">
                Year
              </th>
              {MONTH_LABELS.map((month) => (
                <th
                  key={month}
                  className="px-1 py-1.5 text-2xs font-semibold uppercase tracking-wider text-brief-muted"
                >
                  {month}
                </th>
              ))}
              <th className="px-2 py-1.5 text-2xs font-semibold uppercase tracking-wider text-cream-200">
                Year
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr key={row.year}>
                <td className="px-2 py-1.5 text-left font-mono text-xs font-bold text-cream-50">
                  {row.year}
                </td>

                {MONTH_LABELS.map((label, index) => {
                  const value = row.months[String(index + 1)];
                  const traded = value !== null && value !== undefined;
                  return (
                    <td
                      key={label}
                      style={cellStyle(value, biggest)}
                      title={
                        traded
                          ? `${label} ${row.year}: ${pct(value, 2)}%`
                          : `${label} ${row.year}: no trading data`
                      }
                      className={`rounded px-1 py-1.5 font-mono text-2xs ${
                        traded ? "font-semibold text-cream-50" : "text-brief-muted/40"
                      }`}
                    >
                      {traded ? pct(value) : "·"}
                    </td>
                  );
                })}

                {/* The year total gets a border rather than a fill, so it
                    reads as a summary and not as another month. */}
                <td
                  className={`rounded border px-2 py-1.5 font-mono text-2xs font-bold ${
                    row.year_total >= 0
                      ? "border-market-up/40 text-market-up"
                      : "border-market-down/40 text-market-down"
                  }`}
                >
                  {pct(row.year_total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-2xs leading-relaxed text-brief-muted">
        A dot (&middot;) means the strategy was not yet running that month — the first
        months of the test are spent building up enough history to measure momentum.
        Every cell shows its real percentage, so the colours are only a quick summary.
      </p>
    </section>
  );
}
