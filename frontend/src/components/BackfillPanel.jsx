/**
 * ==========================================================
 * BackfillPanel.jsx -- top up your price files
 * ==========================================================
 * Point it at an Excel file of symbols and a folder of CSVs, and it
 * downloads only the days that are missing from each file, up to and
 * including yesterday's close.
 *
 * Today's bar is deliberately left out: while the market is open it is a
 * partial, moving number, and writing it into a file would quietly corrupt
 * every calculation that later reads it.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Eye,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";

import {
  backfillStatus,
  cancelBackfill,
  previewSymbols,
  startBackfill,
} from "../api";

export default function BackfillPanel({ defaultFolder }) {
  const [excelPath, setExcelPath] = useState("");
  const [folder, setFolder] = useState(defaultFolder || "");
  const [column, setColumn] = useState("");
  const [historyYears, setHistoryYears] = useState(5);

  const [preview, setPreview] = useState(null);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pollTimer = useRef(null);

  // Poll while the job runs, and stop the moment it finishes. The cleanup
  // matters: without it the timer keeps firing after you switch tabs.
  useEffect(() => {
    if (!job?.id || job.status !== "running") return undefined;
    pollTimer.current = setInterval(async () => {
      try {
        const status = await backfillStatus(job.id);
        setJob({ ...status, id: status.id });
      } catch (exception) {
        setError(exception.message);
        clearInterval(pollTimer.current);
      }
    }, 900);
    return () => clearInterval(pollTimer.current);
  }, [job?.id, job?.status]);

  async function handlePreview() {
    setError(null);
    setBusy(true);
    try {
      setPreview(await previewSymbols(excelPath.trim(), folder.trim(), column.trim()));
    } catch (exception) {
      setError(exception.message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleStart() {
    setError(null);
    setBusy(true);
    try {
      const started = await startBackfill(excelPath.trim(), folder.trim(), {
        column: column.trim(),
        historyYears,
      });
      setJob({ ...started.status, id: started.job_id });
    } catch (exception) {
      setError(exception.message);
    } finally {
      setBusy(false);
    }
  }

  const running = job?.status === "running";
  const finished = job && !running;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <section className="brief-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <Database className="h-4 w-4 text-precision-400" />
          <div>
            <p className="brief-eyebrow">Data</p>
            <h2 className="mt-1 text-base font-bold text-cream-50">
              Update price files to yesterday&apos;s close
            </h2>
          </div>
        </div>

        <p className="mb-4 text-2xs leading-relaxed text-brief-muted">
          Reads a list of symbols from an Excel file and tops up each one&apos;s CSV
          with only the days it is missing. Re-running tomorrow fetches one more bar
          per symbol, not the whole history again.{" "}
          <strong className="text-cream-100">Today&apos;s bar is never written</strong>{" "}
          — while the market is open it is still moving, and a partial bar would
          corrupt every calculation that reads it.
        </p>

        <div className="space-y-3">
          <div>
            <label className="field-label">Excel file of symbols</label>
            <input
              className="field mt-1.5 font-mono !text-xs"
              value={excelPath}
              onChange={(e) => setExcelPath(e.target.value)}
              placeholder="D:\algo_trading\symbols.xlsx"
              spellCheck={false}
            />
            <p className="field-help">
              The symbol column is found automatically if it is headed Symbol,
              Ticker, Scrip or similar. Otherwise column A is used.
            </p>
          </div>

          <div>
            <label className="field-label">Folder holding the CSV files</label>
            <input
              className="field mt-1.5 font-mono !text-xs"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="D:\algo_trading\ai_masterclass\day_4\data_5y\stocks"
              spellCheck={false}
            />
            <p className="field-help">
              Existing files are appended to. A symbol with no file yet gets a fresh
              download of the history length below.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Column name (optional)</label>
              <input
                className="field mt-1.5 !text-xs"
                value={column}
                onChange={(e) => setColumn(e.target.value)}
                placeholder="auto-detect"
                spellCheck={false}
              />
            </div>
            <div>
              <label className="field-label">History for new symbols</label>
              <select
                className="field mt-1.5"
                value={historyYears}
                onChange={(e) => setHistoryYears(Number(e.target.value))}
              >
                {[1, 2, 5, 10].map((y) => (
                  <option key={y} value={y}>
                    {y} year{y > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="btn-ghost !py-2 !text-xs"
            onClick={handlePreview}
            disabled={busy || running || !excelPath.trim()}
          >
            {busy && !running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            Check the list first
          </button>
          <button
            className="btn-primary !py-2 !text-xs"
            onClick={handleStart}
            disabled={busy || running || !excelPath.trim() || !folder.trim()}
          >
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {running ? "Updating…" : "Update now"}
          </button>
          {running && (
            <button
              className="btn-ghost !py-2 !text-xs"
              onClick={() => cancelBackfill(job.id)}
            >
              <XCircle className="h-3.5 w-3.5" />
              Stop
            </button>
          )}
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-market-down/40 bg-market-down/10 px-3 py-2 text-2xs leading-relaxed text-cream-100">
            {error}
          </p>
        )}
      </section>

      {/* ---- What the Excel file actually contains -------------------- */}
      {preview && !job && (
        <section className="brief-card animate-riseIn p-5">
          <div className="mb-3 flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-precision-400" />
            <h3 className="text-sm font-bold text-cream-50">
              Found {preview.count} symbol{preview.count === 1 ? "" : "s"} in column
              &ldquo;{preview.column}&rdquo;
            </h3>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-2xs text-brief-muted">
            <span>
              <strong className="text-cream-100">{preview.already_have}</strong> already
              have a file (will be topped up)
            </span>
            <span>
              <strong className="text-cream-100">{preview.new_files}</strong> are new
              (full download)
            </span>
          </div>
          <p className="mt-3 font-mono text-2xs leading-relaxed text-cream-200">
            {preview.sample.join(", ")}
            {preview.count > preview.sample.length && ` … +${preview.count - preview.sample.length} more`}
          </p>
        </section>
      )}

      {/* ---- Progress ------------------------------------------------ */}
      {job && (
        <section className="brief-card animate-riseIn p-5">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin text-precision-400" />
            ) : job.status === "cancelled" ? (
              <AlertTriangle className="h-4 w-4 text-amber-400" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-market-up" />
            )}
            <h3 className="text-sm font-bold text-cream-50">
              {running
                ? `Updating ${job.done} of ${job.total}…`
                : job.status === "cancelled"
                ? "Stopped"
                : "Update complete"}
            </h3>
            <span className="ml-auto font-mono text-2xs text-brief-muted">
              up to {job.cutoff}
            </span>
          </div>

          {/* Progress bar. The label repeats the number so progress is never
              conveyed by the bar's length alone. */}
          <div className="h-2 w-full overflow-hidden rounded-full bg-brief-surface">
            <div
              className="h-full rounded-full bg-precision-500 transition-all duration-300"
              style={{ width: `${job.percent}%` }}
            />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-2xs text-brief-muted">
            <span className="font-mono">{job.percent}%</span>
            {running && job.current_symbol && (
              <span className="font-mono">{job.current_symbol}</span>
            )}
            <span className="font-mono">
              {job.elapsed_seconds}s elapsed
              {running && job.eta_seconds > 0 && ` · ~${job.eta_seconds}s left`}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Updated", job.updated, "text-market-up"],
              ["Created", job.created, "text-precision-300"],
              ["Already current", job.current, "text-brief-muted"],
              ["Failed", job.failed, job.failed ? "text-market-down" : "text-brief-muted"],
            ].map(([label, value, tone]) => (
              <div
                key={label}
                className="rounded-lg border border-brief-line bg-brief-surface px-3 py-2"
              >
                <p className="text-2xs uppercase tracking-wider text-brief-muted">
                  {label}
                </p>
                <p className={`mt-0.5 font-mono text-lg font-bold leading-none ${tone}`}>
                  {value}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-3 text-2xs text-brief-muted">
            <strong className="text-cream-100">{job.rows_added.toLocaleString()}</strong>{" "}
            new daily bars written.
          </p>

          {job.recent?.length > 0 && (
            <div className="mt-3 max-h-40 overflow-y-auto rounded-lg border border-brief-line">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Action</th>
                    <th className="text-right">Rows</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {[...job.recent].reverse().map((row, index) => (
                    <tr key={index}>
                      <td className="font-semibold text-cream-50">{row.symbol}</td>
                      <td
                        className={
                          row.action === "failed"
                            ? "text-market-down"
                            : row.action === "current"
                            ? "text-brief-muted"
                            : "text-market-up"
                        }
                      >
                        {row.action}
                      </td>
                      <td className="num">{row.rows || "—"}</td>
                      <td className="!whitespace-normal text-brief-muted">{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {finished && job.failures?.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-700/40 bg-amber-900/10 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                {job.failures.length} symbol{job.failures.length === 1 ? "" : "s"} could
                not be updated
              </div>
              <ul className="mt-2 space-y-1 text-2xs text-amber-200/80">
                {job.failures.slice(0, 8).map((f) => (
                  <li key={f.symbol}>
                    &bull; <span className="font-mono">{f.symbol}</span> — {f.why}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-2xs text-brief-muted">
                Usually a renamed, delisted or mistyped symbol. The rest of the run was
                unaffected.
              </p>
            </div>
          )}

          {finished && (
            <p className="mt-3 text-2xs text-brief-muted">
              Now go to <strong className="text-cream-100">Backtest</strong> and press
              Scan to load the refreshed files.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
