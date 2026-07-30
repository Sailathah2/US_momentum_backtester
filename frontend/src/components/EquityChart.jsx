/**
 * ==========================================================
 * EquityChart.jsx -- "what happened to my money?"
 * ==========================================================
 * Two lines on one chart:
 *   BLUE  = your momentum portfolio
 *   AMBER = simply buying and holding the benchmark index
 *
 * Both lines start at the same amount of money on the same day, which is the
 * only fair way to compare them. There is deliberately only ONE y-axis: a
 * chart with two different scales is the easiest way to mislead yourself.
 */
import React, { useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { LineChart as LineIcon } from "lucide-react";

// The two identity colours, used identically on every chart in the app.
const PORTFOLIO = "#3B82F6"; // Precision Blue
const BENCHMARK = "#D97706"; // Amber

/** Turn "2024-03-14" into "Mar '24" for the x-axis. */
function shortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleString("en", { month: "short" })} '${String(date.getFullYear()).slice(2)}`;
}

/** Money with thousands separators, no decimals. */
function money(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/**
 * The little box that follows your mouse. We write it ourselves so the
 * numbers are monospaced and the wording is plain English.
 */
function ChartTooltip({ active, payload, label, startCapital }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-brief-line bg-brief-panel/95 px-3 py-2 shadow-panel backdrop-blur">
      <p className="mb-1.5 font-mono text-2xs text-brief-muted">{label}</p>
      {payload.map((row) => {
        const growth = startCapital ? row.value / startCapital - 1 : 0;
        return (
          <div key={row.dataKey} className="flex items-center gap-2 py-0.5">
            <span
              className="h-2 w-2 shrink-0 rounded-sm"
              style={{ backgroundColor: row.color }}
            />
            <span className="text-2xs text-cream-200">{row.name}</span>
            <span className="ml-auto pl-4 font-mono text-2xs font-semibold text-cream-50">
              {money(row.value)}
            </span>
            <span className="w-16 text-right font-mono text-2xs text-brief-muted">
              {growth >= 0 ? "+" : ""}
              {(growth * 100).toFixed(1)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function EquityChart({ data, startCapital, benchmarkName }) {
  // A log scale makes early and late percentage moves look the same size,
  // which is the honest way to read a long, strongly-growing curve.
  const [logScale, setLogScale] = useState(false);

  if (!data?.length) return null;

  return (
    <section className="brief-card p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <LineIcon className="h-4 w-4 text-precision-400" />
        <div>
          <p className="brief-eyebrow">Growth of capital</p>
          <h3 className="mt-0.5 text-base font-bold text-cream-50">
            Portfolio vs {benchmarkName || "benchmark"}
          </h3>
        </div>

        <div className="ml-auto flex gap-1.5">
          <button
            className={`chip ${!logScale ? "chip-active" : ""}`}
            onClick={() => setLogScale(false)}
          >
            Linear
          </button>
          <button
            className={`chip ${logScale ? "chip-active" : ""}`}
            onClick={() => setLogScale(true)}
          >
            Log
          </button>
        </div>
      </div>

      <div className="h-[380px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 8, left: 8, bottom: 5 }}>
            {/* A recessive grid: present enough to read values off, quiet
                enough that the data lines dominate. */}
            <CartesianGrid stroke="#334155" strokeOpacity={0.4} vertical={false} />

            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              minTickGap={60}
              tick={{ fill: "#94A3B8", fontSize: 11 }}
              stroke="#334155"
            />
            <YAxis
              scale={logScale ? "log" : "linear"}
              domain={logScale ? ["auto", "auto"] : ["auto", "auto"]}
              allowDataOverflow={false}
              tickFormatter={money}
              width={72}
              tick={{ fill: "#94A3B8", fontSize: 11 }}
              stroke="#334155"
            />

            <Tooltip
              content={<ChartTooltip startCapital={startCapital} />}
              cursor={{ stroke: "#64748B", strokeWidth: 1, strokeDasharray: "3 3" }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              iconType="plainline"
              iconSize={18}
            />

            {/* 2px lines, no dots: with 1,500 daily points, dots would be
                a solid smear rather than information. */}
            <Line
              type="monotone"
              dataKey="portfolio"
              name="Momentum portfolio"
              stroke={PORTFOLIO}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "#0F172A" }}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="benchmark"
              name={benchmarkName || "Benchmark"}
              stroke={BENCHMARK}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "#0F172A" }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-2 text-2xs leading-relaxed text-brief-muted">
        Both lines begin at {money(startCapital)} on the first rebalance date. Hover
        anywhere to compare the two on that exact day.
      </p>
    </section>
  );
}
