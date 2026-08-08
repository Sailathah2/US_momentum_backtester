/**
 * ==========================================================
 * DrawdownRecovery.jsx -- every dip, and how long it took to heal
 * ==========================================================
 * The "Max drawdown" tile gives you one number: the single worst fall. It
 * says nothing about how OFTEN falls happen or how long you had to sit in
 * them, and those two questions are what really decide whether you could
 * live with a strategy.
 *
 * This panel lists each fall separately:
 *
 *   DEPTH      how far down it went, in percent and in money
 *   PEAK       the all-time high the fall started from
 *   TROUGH     the lowest point it reached
 *   DECLINE    trading days from peak down to trough
 *   RECOVERED  the day it got back to the old peak
 *   RECOVERY   trading days from trough back up to that peak
 *
 * The depth filter along the top decides how deep a dip has to be before it
 * is worth a row. Everything is already loaded, so switching is instant and
 * the summary on the right always describes exactly the rows on screen.
 */
import React, { useMemo, useState } from "react";
import { LifeBuoy, TrendingDown } from "lucide-react";

// How deep a fall has to be to earn a row. 0.01 is the floor the server
// sends: below 1% a portfolio has thousands of dips and none of them matter.
const DEPTH_FILTERS = [
  [0.01, "All"],
  [0.05, "> 5%"],
  [0.1, "> 10%"],
  [0.15, "> 15%"],
  [0.2, "> 20%"],
];

const pct = (value, digits = 2) =>
  value === null || value === undefined ? "—" : `${(value * 100).toFixed(digits)}%`;

const money = (value) =>
  value === null || value === undefined
    ? "—"
    : value.toLocaleString(undefined, { maximumFractionDigits: 0 });

/** "2024-10-16" -> "16 Oct 2024", which is far easier to scan in a column. */
function prettyDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[Number(m) - 1]} ${y}`;
}

/** Trading days, phrased so nobody mistakes them for calendar days. */
const days = (value) => (value === null || value === undefined ? "—" : `${value}d`);

export default function DrawdownRecovery({ episodes }) {
  const [minDepth, setMinDepth] = useState(0.05);

  // How many rows survive each filter, so a button that would empty the
  // table can say so before you press it.
  const counts = useMemo(() => {
    const list = episodes || [];
    return Object.fromEntries(
      DEPTH_FILTERS.map(([level]) => [level, list.filter((e) => e.depth <= -level).length])
    );
  }, [episodes]);

  const rows = useMemo(
    () => (episodes || []).filter((e) => e.depth <= -minDepth),
    [episodes, minDepth]
  );

  // The summary is recomputed from the FILTERED rows, never from the whole
  // set, so the paragraph and the table can never disagree.
  const profile = useMemo(() => {
    if (!rows.length) return null;
    const healed = rows.filter((e) => e.recovery_days !== null);
    const recoveries = healed.map((e) => e.recovery_days);
    const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
    return {
      count: rows.length,
      ongoing: rows.filter((e) => e.ongoing).length,
      avgRecovery: recoveries.length ? mean(recoveries) : null,
      longestRecovery: recoveries.length ? Math.max(...recoveries) : null,
      avgDecline: mean(rows.map((e) => e.decline_days)),
      avgDepth: mean(rows.map((e) => e.depth)),
      deepest: rows[0], // the server sends them deepest-first
    };
  }, [rows]);

  if (!episodes?.length) return null;

  return (
    <section className="brief-card p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <TrendingDown className="h-4 w-4 text-precision-400" />
        <div>
          <p className="brief-eyebrow">Drawdown recovery analysis</p>
          <h3 className="mt-0.5 text-base font-bold text-cream-50">
            Every fall, and how long it took to heal
          </h3>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-2xs uppercase tracking-wider text-brief-muted">
            Deeper than
          </span>
          {DEPTH_FILTERS.map(([level, label]) => (
            <button
              key={level}
              className={`chip ${minDepth === level ? "chip-active" : ""}`}
              onClick={() => setMinDepth(level)}
              title={`${counts[level]} episode${counts[level] === 1 ? "" : "s"}`}
            >
              {label}
              <span className="ml-1.5 opacity-60">{counts[level]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        {/* ---------------- the episode table ---------------- */}
        <div className="max-h-80 overflow-auto rounded-lg border border-brief-line">
          <table className="data-table">
            <thead>
              <tr>
                <th>Depth</th>
                <th>Peak</th>
                <th>Trough</th>
                <th className="text-right">Decline</th>
                <th>Recovered</th>
                <th className="text-right">Recovery</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={`${e.peak_date}-${e.trough_date}`}>
                  <td>
                    {/* Percentage first because it compares across time; the
                        money underneath because that is what it felt like. */}
                    <span className="font-mono font-semibold text-market-down">
                      {pct(e.depth)}
                    </span>
                    <span className="ml-2 font-mono text-brief-muted">
                      {money(e.depth_money)}
                    </span>
                  </td>
                  <td className="font-mono">{prettyDate(e.peak_date)}</td>
                  <td className="font-mono">{prettyDate(e.trough_date)}</td>
                  <td className="text-right font-mono">{days(e.decline_days)}</td>
                  <td className="font-mono">
                    {e.ongoing ? (
                      <span className="text-market-down">still under water</span>
                    ) : (
                      prettyDate(e.recovered_date)
                    )}
                  </td>
                  <td className="text-right font-mono">
                    {e.ongoing ? "—" : days(e.recovery_days)}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-brief-muted">
                    No fall ever got that deep — try a smaller threshold.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ---------------- the plain-English summary ---------------- */}
        <div className="rounded-lg border border-brief-line bg-brief-surface p-4">
          <div className="mb-3 flex items-center gap-2">
            <LifeBuoy className="h-4 w-4 text-precision-400" />
            <p className="text-sm font-bold text-cream-50">Recovery profile</p>
          </div>

          {profile ? (
            <>
              <p className="text-xs leading-relaxed text-cream-200">
                Across <strong className="text-cream-50">{profile.count}</strong>{" "}
                drawdown{profile.count === 1 ? "" : "s"} deeper than{" "}
                {pct(minDepth, 0)}, the average fall was{" "}
                <strong className="text-cream-50">{pct(profile.avgDepth)}</strong> and took{" "}
                <strong className="text-cream-50">
                  {profile.avgDecline.toFixed(0)} trading days
                </strong>{" "}
                to bottom out.{" "}
                {profile.avgRecovery !== null ? (
                  <>
                    Getting back to the old high then took{" "}
                    <strong className="text-cream-50">
                      {profile.avgRecovery.toFixed(0)} days
                    </strong>{" "}
                    on average, and{" "}
                    <strong className="text-cream-50">
                      {profile.longestRecovery} days
                    </strong>{" "}
                    at worst.
                  </>
                ) : (
                  <>None of them has recovered yet.</>
                )}
              </p>

              <p className="mt-2 text-xs leading-relaxed text-cream-200">
                The deepest was{" "}
                <strong className="text-market-down">{pct(profile.deepest.depth)}</strong>{" "}
                ({money(profile.deepest.depth_money)}), from{" "}
                {prettyDate(profile.deepest.peak_date)} down to{" "}
                {prettyDate(profile.deepest.trough_date)}
                {profile.deepest.ongoing
                  ? " — and it is still under water."
                  : `, back to even on ${prettyDate(profile.deepest.recovered_date)} (${
                      profile.deepest.recovery_days
                    } trading days from the trough).`}
              </p>

              {/* The verdict line. It changes with the numbers rather than
                  always congratulating you, so it is worth reading. */}
              <div
                className={`mt-3 rounded-md border-l-2 p-3 text-xs leading-relaxed ${
                  profile.longestRecovery !== null && profile.longestRecovery <= 60
                    ? "border-market-up bg-market-up/10 text-cream-100"
                    : "border-market-down bg-market-down/10 text-cream-100"
                }`}
              >
                {profile.ongoing > 0 && (
                  <>
                    <strong>{profile.ongoing}</strong> of these has not recovered yet.{" "}
                  </>
                )}
                {profile.longestRecovery === null
                  ? "Nothing here has healed, so there is no recovery record to judge."
                  : profile.longestRecovery <= 60
                  ? "Dips here tend to be brief — the curve has climbed back to new highs within a few weeks."
                  : `The worst recovery ran ${profile.longestRecovery} trading days, roughly ${(
                      profile.longestRecovery / 21
                    ).toFixed(0)} months under water. That is the stretch you would have had to sit through without quitting.`}
              </div>
            </>
          ) : (
            <p className="text-xs leading-relaxed text-brief-muted">
              Nothing to summarise at this threshold.
            </p>
          )}

          <p className="mt-3 text-2xs leading-relaxed text-brief-muted">
            Day counts are <strong className="text-cream-100">trading</strong> days, not
            calendar days — about 21 to a month. A fall only counts as recovered once
            the curve is back at the old high, not merely rising. Rows are sorted by
            percentage, so a later dip can show a bigger money figure than a deeper
            early one simply because the book had grown.
          </p>
        </div>
      </div>
    </section>
  );
}
