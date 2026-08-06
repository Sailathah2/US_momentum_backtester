/**
 * ==========================================================
 * PerformanceBreakup.jsx -- the calendar grid of returns
 * ==========================================================
 * One row per year, with the period along the top. Two switches:
 *
 *   Monthly / Quarterly / Yearly  - how finely to slice the calendar
 *   ROI % / P&L                   - percentages, or the money made and lost
 *
 * ABOUT THE COLOURS
 * -----------------
 * Green for a profitable period, red for a losing one, and the shade shows
 * how big. That is a diverging scale with a neutral middle, which is the
 * right choice for a number that can go either way.
 *
 * Red/green is the convention in finance but the hardest pair for a
 * colour-blind reader, so EVERY cell prints its actual figure. The colour is
 * a fast summary; the digits are the data, and nobody has to rely on hue.
 */
import React, { useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";

const GRAINS = [
  ["monthly", "Monthly"],
  ["quarterly", "Quarterly"],
  ["yearly", "Yearly"],
];

/**
 * Background for one cell.
 *
 * `strength` runs 0 (a tiny move) to 1 (the biggest move in the grid), so a
 * table of quiet periods still shows contrast and one wild period never
 * flattens everything else into grey.
 */
function cellStyle(value, biggest) {
  if (value === null || value === undefined) return { backgroundColor: "transparent" };
  const strength = biggest > 0 ? Math.min(1, Math.abs(value) / biggest) : 0;
  // Never fully transparent (so a flat period still reads as a filled cell)
  // and never fully opaque (so the text on top stays legible).
  const opacity = 0.12 + strength * 0.62;
  const rgb = value >= 0 ? "34,197,94" : "225,29,72";   // market up / down
  return { backgroundColor: `rgba(${rgb},${opacity.toFixed(3)})` };
}

export default function PerformanceBreakup({ performance, currency = "" }) {
  const [grain, setGrain] = useState("monthly");
  const [showMoney, setShowMoney] = useState(false);

  const table = performance?.[grain];

  // The colour scale is set by the biggest move actually on screen, so it
  // rescales when you switch between percentages and money.
  const biggest = useMemo(() => {
    if (!table) return 0;
    let peak = 0;
    table.rows.forEach((row) => {
      table.slots.forEach((slot) => {
        const v = showMoney ? row.pnl?.[slot] : row.cells?.[slot];
        if (v !== null && v !== undefined) peak = Math.max(peak, Math.abs(v));
      });
    });
    return peak;
  }, [table, showMoney]);

  if (!table?.rows?.length) return null;

  const format = (value) => {
    if (value === null || value === undefined) return "";
    if (showMoney) {
      const abs = Math.abs(value);
      // Big money is unreadable in full, so shorten it once past a thousand.
      if (abs >= 1e6) return `${value < 0 ? "-" : ""}${(abs / 1e6).toFixed(1)}M`;
      if (abs >= 1e3) return `${value < 0 ? "-" : ""}${(abs / 1e3).toFixed(1)}k`;
      return value.toFixed(0);
    }
    return (value * 100).toFixed(1);
  };

  const fullFormat = (value) =>
    value === null || value === undefined
      ? "no data"
      : showMoney
      ? `${currency}${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      : `${(value * 100).toFixed(2)}%`;

  return (
    <section className="brief-card p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <CalendarDays className="h-4 w-4 text-precision-400" />
        <div>
          <p className="brief-eyebrow">Performance breakup</p>
          <h3 className="mt-0.5 text-base font-bold text-cream-50">
            {showMoney ? "Money made and lost" : "Returns"} by{" "}
            {grain === "yearly" ? "year" : grain.replace("ly", "")}
          </h3>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          {/* ROI % vs money */}
          <div className="flex gap-1.5">
            <button
              className={`chip ${!showMoney ? "chip-active" : ""}`}
              onClick={() => setShowMoney(false)}
            >
              ROI %
            </button>
            <button
              className={`chip ${showMoney ? "chip-active" : ""}`}
              onClick={() => setShowMoney(true)}
            >
              P&amp;L
            </button>
          </div>

          <span className="h-5 w-px bg-brief-line" />

          {/* How finely to slice the calendar */}
          <div className="flex gap-1.5">
            {GRAINS.map(([id, label]) => (
              <button
                key={id}
                className={`chip ${grain === id ? "chip-active" : ""}`}
                onClick={() => setGrain(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Scrolls sideways on a narrow screen rather than squashing the
          numbers or pushing the whole page wider. */}
      <div className="overflow-x-auto">
        <table
          className={`w-full border-separate border-spacing-[2px] text-center ${
            grain === "monthly" ? "min-w-[720px]" : "min-w-[380px]"
          }`}
        >
          <thead>
            <tr>
              <th className="px-2 py-1.5 text-left text-2xs font-semibold uppercase tracking-wider text-brief-muted">
                Year
              </th>
              {table.slots.map((slot) => (
                <th
                  key={slot}
                  className="px-1 py-1.5 text-2xs font-semibold uppercase tracking-wider text-brief-muted"
                >
                  {slot}
                </th>
              ))}
              {grain !== "yearly" && (
                <th className="px-2 py-1.5 text-2xs font-semibold uppercase tracking-wider text-cream-200">
                  Total
                </th>
              )}
            </tr>
          </thead>

          <tbody>
            {table.rows.map((row) => (
              <tr key={row.year}>
                <td className="px-2 py-1.5 text-left font-mono text-xs font-bold text-cream-50">
                  {row.year}
                </td>

                {table.slots.map((slot) => {
                  const value = showMoney ? row.pnl?.[slot] : row.cells?.[slot];
                  const traded = value !== null && value !== undefined;
                  return (
                    <td
                      key={slot}
                      style={cellStyle(value, biggest)}
                      title={`${slot} ${row.year}: ${fullFormat(value)}`}
                      className={`rounded px-1 py-1.5 font-mono text-2xs ${
                        traded ? "font-semibold text-cream-50" : "text-brief-muted/40"
                      }`}
                    >
                      {traded ? format(value) : "·"}
                    </td>
                  );
                })}

                {/* The year total gets a border rather than a fill, so it
                    reads as a summary and not as another period. */}
                {grain !== "yearly" && (
                  <td
                    className={`rounded border px-2 py-1.5 font-mono text-2xs font-bold ${
                      (showMoney ? row.total_pnl : row.total) >= 0
                        ? "border-market-up/40 text-market-up"
                        : "border-market-down/40 text-market-down"
                    }`}
                    title={fullFormat(showMoney ? row.total_pnl : row.total)}
                  >
                    {format(showMoney ? row.total_pnl : row.total)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-2xs leading-relaxed text-brief-muted">
        A dot (&middot;) means the strategy was not running that period — the first
        months are spent building enough history to measure momentum.{" "}
        {showMoney ? (
          <>
            Money figures compound, so later periods look larger simply because the
            book is bigger. Switch to <strong>ROI %</strong> to compare like with like.
          </>
        ) : (
          <>
            Every cell shows its real percentage, so the colours are only a quick
            summary.
          </>
        )}
      </p>
    </section>
  );
}
