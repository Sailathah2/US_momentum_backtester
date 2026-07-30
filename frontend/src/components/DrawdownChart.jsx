/**
 * ==========================================================
 * DrawdownChart.jsx -- "how far below the peak was I?"
 * ==========================================================
 * Also called an "underwater chart", because the shape shows how long the
 * portfolio spent below its own previous high-water mark.
 *
 * Every value is zero or negative: 0% means "at an all-time high today",
 * -25% means "a quarter below the best it has ever been". This is the chart
 * that tells you whether you could actually have stuck with the strategy.
 *
 * The colours mean exactly what they mean on the equity chart:
 * BLUE = your portfolio, AMBER = the benchmark.
 */
import React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingDown } from "lucide-react";

const PORTFOLIO = "#3B82F6"; // Precision Blue
const BENCHMARK = "#D97706"; // Amber

function shortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleString("en", { month: "short" })} '${String(date.getFullYear()).slice(2)}`;
}

function DrawdownTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-brief-line bg-brief-panel/95 px-3 py-2 shadow-panel backdrop-blur">
      <p className="mb-1.5 font-mono text-2xs text-brief-muted">{label}</p>
      {payload.map((row) => (
        <div key={row.dataKey} className="flex items-center gap-2 py-0.5">
          <span
            className="h-2 w-2 shrink-0 rounded-sm"
            style={{ backgroundColor: row.color }}
          />
          <span className="text-2xs text-cream-200">{row.name}</span>
          <span className="ml-auto pl-4 font-mono text-2xs font-semibold text-cream-50">
            {row.value.toFixed(2)}%
          </span>
        </div>
      ))}
    </div>
  );
}

export default function DrawdownChart({ data, maxDrawdown, maxDrawdownDate, benchmarkName }) {
  if (!data?.length) return null;

  return (
    <section className="brief-card p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <TrendingDown className="h-4 w-4 text-market-down" />
        <div>
          <p className="brief-eyebrow">Underwater chart</p>
          <h3 className="mt-0.5 text-base font-bold text-cream-50">
            Drawdown from the previous peak
          </h3>
        </div>

        {/* The single worst moment, called out in words as well as colour. */}
        {maxDrawdown !== null && maxDrawdown !== undefined && (
          <div className="ml-auto rounded-lg border border-brief-line bg-brief-surface px-3 py-1.5 text-right">
            <p className="text-2xs uppercase tracking-wider text-brief-muted">Worst fall</p>
            <p className="font-mono text-sm font-bold text-market-down">
              {(maxDrawdown * 100).toFixed(2)}%
            </p>
            {maxDrawdownDate && (
              <p className="font-mono text-[10px] text-brief-muted">{maxDrawdownDate}</p>
            )}
          </div>
        )}
      </div>

      <div className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 8, left: 8, bottom: 5 }}>
            {/* A soft fade so the filled area never fights with the line. */}
            <defs>
              <linearGradient id="portfolioDrawdownFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={PORTFOLIO} stopOpacity={0.05} />
                <stop offset="100%" stopColor={PORTFOLIO} stopOpacity={0.35} />
              </linearGradient>
            </defs>

            <CartesianGrid stroke="#334155" strokeOpacity={0.4} vertical={false} />

            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              minTickGap={60}
              tick={{ fill: "#94A3B8", fontSize: 11 }}
              stroke="#334155"
            />
            <YAxis
              tickFormatter={(value) => `${value.toFixed(0)}%`}
              width={56}
              tick={{ fill: "#94A3B8", fontSize: 11 }}
              stroke="#334155"
            />

            {/* The zero line is the "surface of the water". */}
            <ReferenceLine y={0} stroke="#64748B" strokeWidth={1} />

            <Tooltip
              content={<DrawdownTooltip />}
              cursor={{ stroke: "#64748B", strokeWidth: 1, strokeDasharray: "3 3" }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              iconType="plainline"
              iconSize={18}
            />

            <Area
              type="monotone"
              dataKey="portfolio_dd"
              name="Momentum portfolio"
              stroke={PORTFOLIO}
              strokeWidth={2}
              fill="url(#portfolioDrawdownFill)"
              isAnimationActive={false}
            />
            {/* The benchmark stays an unfilled line, so the two never muddy
                each other where they overlap. */}
            <Area
              type="monotone"
              dataKey="benchmark_dd"
              name={benchmarkName || "Benchmark"}
              stroke={BENCHMARK}
              strokeWidth={2}
              fill="none"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-2 text-2xs leading-relaxed text-brief-muted">
        0% means the portfolio is at an all-time high that day. The deeper and wider
        a dip, the harder the strategy would have been to live through.
      </p>
    </section>
  );
}
