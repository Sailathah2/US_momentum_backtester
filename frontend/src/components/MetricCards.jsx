/**
 * ==========================================================
 * MetricCards.jsx -- the row of headline numbers
 * ==========================================================
 * These are "stat tiles", not charts: each one is a single number that
 * answers one question about the strategy, with the benchmark's equivalent
 * printed underneath for comparison.
 */
import React from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Coins,
  Gauge,
  Percent,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

/** Format a fraction (0.1234) as a percentage string ("12.34%"). */
function pct(value, digits = 2) {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

/** Format a plain ratio like Sharpe ("1.42"). */
function ratio(value) {
  if (value === null || value === undefined) return "—";
  return value.toFixed(2);
}

/** Format money with thousands separators. */
function money(value) {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/**
 * One tile. `tone` decides the accent: "up" green, "down" red, "neutral" blue.
 * The number itself is always cream-coloured text - the colour lives in the
 * small icon and the sub-line, never in the digits, so the tile is readable
 * for everyone.
 */
function Tile({ icon: Icon, label, value, sub, tone = "neutral", hint }) {
  const toneClasses = {
    up: "text-market-up",
    down: "text-market-down",
    neutral: "text-precision-400",
  }[tone];

  return (
    <div className="brief-card group relative p-4" title={hint}>
      <div className="flex items-start justify-between">
        <p className="brief-eyebrow">{label}</p>
        <Icon className={`h-4 w-4 shrink-0 ${toneClasses}`} />
      </div>
      <p className="mt-2 font-mono text-2xl font-bold leading-none text-cream-50">{value}</p>
      {sub && <p className={`mt-1.5 text-2xs font-medium ${toneClasses}`}>{sub}</p>}
    </div>
  );
}

/**
 * The secondary strip: how the individual TRADES did, plus the ratios that
 * do not fit in the headline tiles.
 *
 * These answer a different question from the tiles above. The tiles say how
 * your money did; these say how good the individual picks were - which is
 * what tells you whether the edge is broad or whether a couple of lucky
 * names carried the whole record.
 */
function StatStrip({ metrics, stats }) {
  if (!stats || !stats.total_trades) return null;

  const items = [
    { label: "Win rate (trades)", value: pct(stats.trade_win_rate, 2), tone: "neutral",
      hint: `${stats.winners} winners, ${stats.losers} losers. Counts individual trades — the tile above counts rebalance periods, so the two differ.` },
    { label: "Avg winner", value: pct(stats.avg_winner), tone: "up",
      hint: "Average return of the trades that made money." },
    { label: "Avg loser", value: pct(stats.avg_loser), tone: "down",
      hint: "Average return of the trades that lost money." },
    { label: "Biggest winner", value: pct(stats.biggest_winner), tone: "up",
      hint: stats.biggest_winner_ticker
        ? `${stats.biggest_winner_ticker}, bought ${stats.biggest_winner_date}`
        : "" },
    { label: "Biggest loser", value: pct(stats.biggest_loser), tone: "down",
      hint: stats.biggest_loser_ticker
        ? `${stats.biggest_loser_ticker}, bought ${stats.biggest_loser_date}`
        : "" },
    { label: "Risk to reward", value: ratio(stats.risk_reward), tone: "neutral",
      hint: "Average winner divided by the average loser. Above 1 means winners are bigger than losers." },
    { label: "Profit factor", value: ratio(stats.profit_factor), tone: "neutral",
      hint: "Everything won divided by everything lost. Below 1 loses money overall." },
    { label: "Trades per year", value: stats.avg_trades_per_year?.toFixed(1) ?? "—",
      tone: "neutral", hint: "How much work this strategy is to run." },
    { label: "Calmar ratio", value: ratio(metrics.calmar), tone: "neutral",
      hint: "CAGR divided by the worst drawdown — return per unit of pain." },
    { label: "XIRR", value: pct(metrics.xirr), tone: "neutral",
      hint: "Annualised return from the actual cash flows. Identical to CAGR when there is a single lump sum and no deposits." },
  ];

  return (
    <section className="brief-card px-5 py-4">
      <p className="brief-eyebrow mb-3">Trade quality</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((item) => (
          <div key={item.label} title={item.hint}>
            <p className="text-2xs uppercase tracking-wider text-brief-muted">
              {item.label}
            </p>
            <p
              className={`mt-1 font-mono text-lg font-bold leading-none ${
                item.tone === "up"
                  ? "text-market-up"
                  : item.tone === "down"
                  ? "text-market-down"
                  : "text-cream-50"
              }`}
            >
              {item.value}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-2xs leading-relaxed text-brief-muted">
        A high <strong className="text-cream-100">biggest winner</strong> next to a
        modest <strong className="text-cream-100">average winner</strong> is the
        signature of a strategy carried by a handful of trades — check the trade log
        before trusting the headline return.
      </p>
    </section>
  );
}

export default function MetricCards({
  metrics,
  benchmarkMetrics,
  outperformance,
  summary,
  tradeStats,
}) {
  if (!metrics) return null;

  const m = metrics;
  const b = benchmarkMetrics || {};

  // A small helper: is this number better or worse than the benchmark's?
  const tone = (mine, theirs, higherIsBetter = true) => {
    if (mine === null || mine === undefined || theirs === null || theirs === undefined)
      return "neutral";
    return higherIsBetter === mine > theirs ? "up" : "down";
  };

  return (
    <div className="space-y-3">
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
      <Tile
        icon={m.total_return >= 0 ? ArrowUpRight : ArrowDownRight}
        label="Total return"
        value={pct(m.total_return)}
        sub={`Index ${pct(b.total_return)}`}
        tone={tone(m.total_return, b.total_return)}
        hint="How much the whole portfolio grew from the first day to the last."
      />
      <Tile
        icon={TrendingUp}
        label="CAGR"
        value={pct(m.cagr)}
        sub={`Index ${pct(b.cagr)}`}
        tone={tone(m.cagr, b.cagr)}
        hint="That same growth expressed as a steady yearly rate."
      />
      <Tile
        icon={Gauge}
        label="Sharpe"
        value={ratio(m.sharpe)}
        sub={`Index ${ratio(b.sharpe)}`}
        tone={tone(m.sharpe, b.sharpe)}
        hint="Return earned per unit of volatility. Above 1 is good, above 2 excellent."
      />
      <Tile
        icon={Activity}
        label="Sortino"
        value={ratio(m.sortino)}
        sub={`Index ${ratio(b.sortino)}`}
        tone={tone(m.sortino, b.sortino)}
        hint="Like Sharpe, but it only counts downward moves as risk."
      />
      <Tile
        icon={TrendingDown}
        label="Max drawdown"
        value={pct(m.max_drawdown)}
        sub={`Index ${pct(b.max_drawdown)}`}
        tone={tone(m.max_drawdown, b.max_drawdown)}
        hint="The worst peak-to-trough fall in the whole test - how painful it was to hold."
      />
      <Tile
        icon={Target}
        label="Win rate"
        value={pct(m.win_rate, 1)}
        sub={`${summary?.total_rebalances ?? 0} periods`}
        tone="neutral"
        hint="The share of rebalance periods that ended with a profit."
      />
      <Tile
        icon={Percent}
        label="vs Benchmark"
        value={pct(outperformance)}
        sub={outperformance >= 0 ? "Ahead of the index" : "Behind the index"}
        tone={outperformance >= 0 ? "up" : "down"}
        hint="Total return minus the index's total return over the same days."
      />
      <Tile
        icon={Coins}
        label="Final value"
        value={money(m.end_value)}
        sub={`From ${money(m.start_value)}`}
        tone={m.end_value >= m.start_value ? "up" : "down"}
        hint="What the starting capital turned into by the last day."
      />
    </div>

    <StatStrip metrics={metrics} stats={tradeStats} />
    </div>
  );
}
