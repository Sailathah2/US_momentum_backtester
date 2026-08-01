/**
 * ==========================================================
 * TradeLogTable.jsx -- the audit trail
 * ==========================================================
 * Two tabs over the same panel:
 *
 *   REBALANCE LOG - one row per period: what was bought, in what weights,
 *                   and how that period turned out versus the index.
 *   TRADE LOG     - one row per stock per period: its momentum score at
 *                   entry, its entry/exit price, and what it contributed.
 *
 * Both can be downloaded as CSV so the numbers can be checked in Excel.
 */
import React, { useMemo, useState } from "react";
import {
  Download,
  FileArchive,
  FileSpreadsheet,
  Loader2,
  Search,
  Table2,
} from "lucide-react";

/** Format a fraction as a signed percentage: 0.0432 -> "+4.32%". */
function pct(value, digits = 2) {
  if (value === null || value === undefined) return "—";
  const shown = (value * 100).toFixed(digits);
  return `${value > 0 ? "+" : ""}${shown}%`;
}

/** Colour a number green when positive, red when negative. */
function toneClass(value) {
  if (value === null || value === undefined) return "text-cream-100";
  if (value > 0) return "text-market-up";
  if (value < 0) return "text-market-down";
  return "text-brief-muted";
}

export default function TradeLogTable({
  rebalances,
  trades,
  actions,
  onExport,
  onReport,
  exporting,
  riskMeasure = "stddev",
}) {
  const [tab, setTab] = useState("rebalances");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(100);

  const isRebalanceTab = tab === "rebalances";
  const isActionTab = tab === "actions";
  const source = isRebalanceTab ? rebalances : isActionTab ? actions : trades;

  // The keep/exit/enter log only exists when the rank cushion was on.
  const hasActions = Boolean(actions?.length) && actions.some((a) => a.action === "KEEP");

  // The volatility columns are only meaningful when that ranking was on -
  // the backend leaves `stddev` blank otherwise.
  const showsScore = Boolean(
    trades?.length && trades[0].stddev !== null && trades[0].stddev !== undefined
  );

  // Filter by the search box: match on any date or ticker text in the row.
  const filtered = useMemo(() => {
    if (!source) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return source;
    return source.filter((row) =>
      `${row.rebalance_date} ${row.exit_date || ""} ${row.tickers || row.ticker || ""} ${
        row.action || ""
      }`
        .toLowerCase()
        .includes(needle)
    );
  }, [source, query]);

  const visible = filtered.slice(0, limit);

  if (!rebalances?.length) return null;

  return (
    <section className="brief-card p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Table2 className="h-4 w-4 text-precision-400" />
        <div>
          <p className="brief-eyebrow">Step 3</p>
          <h3 className="mt-0.5 text-base font-bold text-cream-50">
            Rebalance &amp; trade history
          </h3>
        </div>

        {/* -- Export buttons ------------------------------------------ */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* The full report comes first: it contains everything the four
              single-table buttons do, plus the settings and the metrics. */}
          <button
            className="btn-primary !px-3 !py-1.5 !text-xs"
            onClick={() => onReport("xlsx")}
            disabled={exporting}
          >
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-3.5 w-3.5" />
            )}
            Full report (Excel)
          </button>
          <button
            className="btn-ghost !px-3 !py-1.5 !text-xs"
            onClick={() => onReport("csv")}
            disabled={exporting}
            title="One CSV per sheet, bundled in a ZIP"
          >
            <FileArchive className="h-3.5 w-3.5" />
            Full report (CSVs)
          </button>

          <span className="mx-1 hidden h-5 w-px bg-brief-line sm:block" />

          <button
            className="btn-ghost !px-3 !py-1.5 !text-xs"
            onClick={() => onExport("rebalances")}
            disabled={exporting}
          >
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Rebalances
          </button>
          <button
            className="btn-ghost !px-3 !py-1.5 !text-xs"
            onClick={() => onExport("trades")}
            disabled={exporting}
          >
            <Download className="h-3.5 w-3.5" />
            Trades
          </button>
          <button
            className="btn-ghost !px-3 !py-1.5 !text-xs"
            onClick={() => onExport("timeseries")}
            disabled={exporting}
          >
            <Download className="h-3.5 w-3.5" />
            Equity curve
          </button>
          <button
            className="btn-ghost !px-3 !py-1.5 !text-xs"
            onClick={() => onExport("monthly")}
            disabled={exporting}
          >
            <Download className="h-3.5 w-3.5" />
            Monthly
          </button>
        </div>
      </div>

      {/* -- Tabs + search --------------------------------------------- */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          className={`chip ${isRebalanceTab ? "chip-active" : ""}`}
          onClick={() => {
            setTab("rebalances");
            setLimit(100);
          }}
        >
          Rebalance log ({rebalances.length})
        </button>
        <button
          className={`chip ${tab === "trades" ? "chip-active" : ""}`}
          onClick={() => {
            setTab("trades");
            setLimit(100);
          }}
        >
          Trade log ({trades?.length || 0})
        </button>
        {hasActions && (
          <button
            className={`chip ${isActionTab ? "chip-active" : ""}`}
            onClick={() => {
              setTab("actions");
              setLimit(100);
            }}
          >
            Keep / exit / enter ({actions.length})
          </button>
        )}

        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-brief-muted" />
          <input
            className="field !w-56 !py-1.5 !pl-8 !text-xs"
            placeholder="Filter by date or ticker…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(100);
            }}
          />
        </div>
      </div>

      {/* -- The table ------------------------------------------------- */}
      <div className="max-h-[460px] overflow-auto rounded-lg border border-brief-line">
        <table className="data-table">
          {isActionTab ? (
            <>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Rebalance</th>
                  <th>Ticker</th>
                  <th>Action</th>
                  <th className="text-right">Rank</th>
                  <th className="text-right">Weight after</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row, index) => (
                  <tr key={`${row.period}-${row.ticker}-${index}`}>
                    <td className="num text-brief-muted">{row.period}</td>
                    <td className="font-mono text-cream-50">{row.rebalance_date}</td>
                    <td className="font-semibold text-cream-50">{row.ticker}</td>
                    <td>
                      {/* The action is a state, so it gets a shape as well as a
                          colour - never colour alone. */}
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          row.action === "KEEP"
                            ? "bg-precision-600/20 text-precision-300"
                            : row.action === "ENTER"
                            ? "bg-market-up/15 text-market-up"
                            : "bg-market-down/15 text-market-down"
                        }`}
                      >
                        {row.action}
                      </span>
                    </td>
                    <td className="num">
                      {row.rank === null || row.rank === undefined ? "—" : row.rank}
                    </td>
                    <td className="num">
                      {row.weight_after ? `${(row.weight_after * 100).toFixed(1)}%` : "—"}
                    </td>
                    <td className="max-w-[300px] !whitespace-normal text-brief-muted">
                      {row.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </>
          ) : isRebalanceTab ? (
            <>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Rebalance</th>
                  <th>Exit</th>
                  <th className="text-right">Days</th>
                  <th className="text-right">Held</th>
                  {/* Only meaningful once the rank cushion is keeping things. */}
                  {hasActions && <th className="text-right">Kept</th>}
                  {hasActions && <th className="text-right">In</th>}
                  {hasActions && <th className="text-right">Out</th>}
                  <th>Tickers &amp; weights</th>
                  <th className="text-right">Cash</th>
                  <th className="text-right">Index ROC</th>
                  <th className="text-right">Period</th>
                  <th className="text-right">vs Index</th>
                  <th className="text-right">Equity</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.period}>
                    <td className="num text-brief-muted">{row.period}</td>
                    <td className="font-mono text-cream-50">{row.rebalance_date}</td>
                    <td className="font-mono text-brief-muted">{row.exit_date}</td>
                    <td className="num">{row.holding_days}</td>
                    <td className="num">{row.num_holdings}</td>
                    {hasActions && (
                      <td className="num text-precision-300">{row.kept ?? "—"}</td>
                    )}
                    {hasActions && (
                      <td className="num text-market-up">{row.entered ?? "—"}</td>
                    )}
                    {hasActions && (
                      <td className="num text-market-down">{row.exited ?? "—"}</td>
                    )}
                    <td className="max-w-[320px] !whitespace-normal">
                      {row.num_holdings === 0 ? (
                        <span className="rounded bg-brief-surface px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brief-muted">
                          100% cash — nothing beat the index
                        </span>
                      ) : (
                        <span className="font-medium text-cream-50">
                          {row.tickers}
                          <span className="ml-1.5 font-mono text-brief-muted">
                            ({row.weights})
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="num text-brief-muted">
                      {(row.cash_weight * 100).toFixed(0)}%
                    </td>
                    <td className="num text-brief-muted">{pct(row.benchmark_roc)}</td>
                    <td className={`num font-semibold ${toneClass(row.period_return)}`}>
                      {pct(row.period_return)}
                    </td>
                    <td className={`num ${toneClass(row.excess_return)}`}>
                      {pct(row.excess_return)}
                    </td>
                    <td className="num text-cream-50">
                      {row.equity_end.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </>
          ) : (
            <>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Bought</th>
                  <th>Sold</th>
                  <th>Ticker</th>
                  <th className="text-right">Weight</th>
                  <th className="text-right">ROC at entry</th>
                  <th className="text-right">Index ROC</th>
                  <th className="text-right">Rel. strength</th>
                  {/* These two only appear when the volatility-adjusted
                      ranking was actually used, so the table stays narrow
                      in the ordinary case. */}
                  {showsScore && (
                    <th className="text-right">
                      {riskMeasure === "downside" ? "Downside dev" : "Std dev"}
                    </th>
                  )}
                  {showsScore && <th className="text-right">Score</th>}
                  <th className="text-right">Entry</th>
                  <th className="text-right">Exit</th>
                  <th className="text-right">Return</th>
                  <th className="text-right">Contribution</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row, index) => (
                  <tr key={`${row.period}-${row.ticker}-${index}`}>
                    <td className="num text-brief-muted">{row.period}</td>
                    <td className="font-mono text-cream-50">{row.rebalance_date}</td>
                    <td className="font-mono text-brief-muted">{row.exit_date}</td>
                    <td className="font-semibold text-cream-50">{row.ticker}</td>
                    <td className="num">{(row.weight * 100).toFixed(1)}%</td>
                    <td className="num">{pct(row.roc_at_entry)}</td>
                    <td className="num text-brief-muted">{pct(row.benchmark_roc)}</td>
                    <td className={`num ${toneClass(row.relative_strength)}`}>
                      {pct(row.relative_strength)}
                    </td>
                    {showsScore && (
                      <td className="num text-brief-muted">
                        {row.stddev === null || row.stddev === undefined
                          ? "—"
                          : row.stddev.toFixed(4)}
                      </td>
                    )}
                    {showsScore && (
                      <td className="num font-semibold text-cream-50">
                        {row.rank_score === null || row.rank_score === undefined
                          ? "—"
                          : row.rank_score.toFixed(2)}
                      </td>
                    )}
                    <td className="num text-brief-muted">{row.entry_price.toFixed(2)}</td>
                    <td className="num text-brief-muted">{row.exit_price.toFixed(2)}</td>
                    <td className={`num font-semibold ${toneClass(row.trade_return)}`}>
                      {pct(row.trade_return)}
                    </td>
                    <td className={`num ${toneClass(row.contribution)}`}>
                      {pct(row.contribution)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </>
          )}
        </table>

        {visible.length === 0 && (
          <p className="px-4 py-8 text-center text-xs text-brief-muted">
            Nothing matches “{query}”.
          </p>
        )}
      </div>

      {/* Only render 100 rows at a time so a 10-year weekly backtest with
          thousands of trades still scrolls smoothly. */}
      {filtered.length > visible.length && (
        <button
          className="btn-ghost mt-3 w-full !py-2 !text-xs"
          onClick={() => setLimit((value) => value + 250)}
        >
          Show more ({visible.length.toLocaleString()} of {filtered.length.toLocaleString()} rows)
        </button>
      )}
    </section>
  );
}
