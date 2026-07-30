/**
 * ==========================================================
 * EquityComparisonChart.jsx -- three curves and a regime strip
 * ==========================================================
 * The chart draws three lines that all start at the same money:
 *
 *   BLUE   the strategy WITH the regime filter
 *   VIOLET the same strategy WITHOUT it
 *   AMBER  simply buying and holding the index
 *
 * Underneath sits the "regime strip": a thin bar coloured green where the
 * filter was invested and slate where it sat in cash. Line the strip up
 * with a dip in the violet line and you can see, at a glance, exactly which
 * falls the filter dodged and which rallies it missed.
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

// Identity colours - these mean the same thing on every chart in the app.
const FILTER_ON = "#3B82F6"; // Precision Blue
const FILTER_OFF = "#8B5CF6"; // Violet
const BENCHMARK = "#D97706"; // Amber

const REGIME_ON = "#22C55E"; // green  - invested
const REGIME_OFF = "#475569"; // slate  - in cash

function shortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleString("en", { month: "short" })} '${String(date.getFullYear()).slice(2)}`;
}

function money(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function ChartTooltip({ active, payload, label, startCapital }) {
  if (!active || !payload?.length) return null;

  // Every point carries its own regime flag, so the tooltip can say whether
  // you were invested or in cash on that exact day.
  const riskOn = payload[0]?.payload?.risk_on === 1;

  return (
    <div className="rounded-lg border border-brief-line bg-brief-panel/95 px-3 py-2 shadow-panel backdrop-blur">
      <div className="mb-1.5 flex items-center gap-2">
        <p className="font-mono text-2xs text-brief-muted">{label}</p>
        <span
          className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
          style={{
            backgroundColor: `${riskOn ? REGIME_ON : REGIME_OFF}33`,
            color: riskOn ? REGIME_ON : "#CBD5E1",
          }}
        >
          {riskOn ? "Risk-ON" : "In cash"}
        </span>
      </div>

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

/**
 * The regime strip.
 *
 * We walk the chart data once and group neighbouring days that share the
 * same state into blocks. Each block then gets `flexGrow` equal to how many
 * days it covers, so the strip lines up with the chart above it (Recharts
 * spaces category points evenly, so one day = one equal slice).
 */
function RegimeStrip({ data }) {
  const blocks = [];
  let current = null;

  data.forEach((point) => {
    const state = point.risk_on === 1;
    if (!current || current.state !== state) {
      current = { state, days: 1, start: point.date, end: point.date };
      blocks.push(current);
    } else {
      current.days += 1;
      current.end = point.date;
    }
  });

  return (
    <div className="mt-1">
      <div className="flex h-3 w-full overflow-hidden rounded-sm border border-brief-line">
        {blocks.map((block, index) => (
          <div
            key={index}
            style={{
              flexGrow: block.days,
              backgroundColor: block.state ? REGIME_ON : REGIME_OFF,
            }}
            title={`${block.state ? "Risk-ON (invested)" : "Risk-OFF (cash)"}: ${
              block.start
            } to ${block.end} — ${block.days} trading day${block.days === 1 ? "" : "s"}`}
          />
        ))}
      </div>

      {/* The strip's own legend, in words as well as colour. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-4 text-2xs text-brief-muted">
        <span className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: REGIME_ON }}
          />
          Risk-ON — invested
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: REGIME_OFF }}
          />
          Risk-OFF — 100% cash
        </span>
        <span className="ml-auto">
          {blocks.length - 1} switch{blocks.length - 1 === 1 ? "" : "es"} across{" "}
          {data.length.toLocaleString()} trading days
        </span>
      </div>
    </div>
  );
}

export default function EquityComparisonChart({ data, startCapital, benchmarkName }) {
  const [logScale, setLogScale] = useState(false);

  if (!data?.length) return null;

  return (
    <section className="brief-card p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <LineIcon className="h-4 w-4 text-precision-400" />
        <div>
          <p className="brief-eyebrow">Growth of capital</p>
          <h3 className="mt-0.5 text-base font-bold text-cream-50">
            Filter ON vs Filter OFF vs {benchmarkName || "benchmark"}
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
          <LineChart data={data} margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
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
              domain={["auto", "auto"]}
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

            <Line
              type="monotone"
              dataKey="filter_on"
              name="Strategy — filter ON"
              stroke={FILTER_ON}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "#0F172A" }}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="filter_off"
              name="Strategy — filter OFF"
              stroke={FILTER_OFF}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "#0F172A" }}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="benchmark"
              name={`${benchmarkName || "Benchmark"} — buy & hold`}
              stroke={BENCHMARK}
              strokeWidth={2}
              strokeDasharray="5 3"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "#0F172A" }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ---- The regime timeline, directly under the x-axis ---------- */}
      <RegimeStrip data={data} />

      <p className="mt-3 text-2xs leading-relaxed text-brief-muted">
        Where the strip is grey the filter was holding cash, so the blue line runs
        flat while the violet one keeps moving. Flat stretches during a violet
        <em> fall</em> are the filter working; flat stretches during a violet{" "}
        <em>rally</em> are what it cost you.
      </p>
    </section>
  );
}
