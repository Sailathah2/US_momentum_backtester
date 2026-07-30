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

export default function MetricCards({ metrics, benchmarkMetrics, outperformance, summary }) {
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
  );
}
