/**
 * ==========================================================
 * UploadZone.jsx -- STEP 1: get the price data in
 * ==========================================================
 * Two ways to load CSV files:
 *
 *   1. Drag a pile of files onto the dashed box (or click to browse).
 *   2. Type the full path of a folder and press Scan - the fastest way to
 *      load hundreds of files at once from the US Stock Data Downloader's
 *      output folder.
 */
import React, { useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FolderSearch,
  Loader2,
  RotateCcw,
  UploadCloud,
} from "lucide-react";

// How many symbols to list in the sidebar preview. Everything loaded is used
// in the backtest regardless - this only limits what the little table draws,
// so the mouse wheel is not trapped inside it for hundreds of turns.
const PREVIEW_ROWS = 40;

export default function UploadZone({
  onUpload,
  onScan,
  onReset,
  busy,
  symbols,
  warnings,
  defaultFolder,
}) {
  const [dragging, setDragging] = useState(false);
  const [folder, setFolder] = useState(defaultFolder || "");
  const [showAllWarnings, setShowAllWarnings] = useState(false);
  const fileInput = useRef(null);

  /** Fired when files are dropped onto the dashed box. */
  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files).filter((f) =>
      f.name.toLowerCase().endsWith(".csv")
    );
    if (files.length) onUpload(files);
  }

  const visibleWarnings = showAllWarnings ? warnings : warnings.slice(0, 4);

  return (
    <section className="brief-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="brief-eyebrow">Step 1</p>
          <h2 className="mt-1 text-base font-bold text-cream-50">Load price data</h2>
        </div>
        {symbols.length > 0 && (
          <button className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={onReset} disabled={busy}>
            <RotateCcw className="h-3.5 w-3.5" />
            Clear
          </button>
        )}
      </div>

      {/* ---------- Option A: scan a folder already on this PC ---------- */}
      <label className="field-label">Scan a folder on this computer</label>
      <div className="mt-1.5 flex gap-2">
        <input
          className="field font-mono !text-xs"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && folder.trim() && !busy) onScan(folder.trim());
          }}
          placeholder="D:\algo_trading\ai_masterclass\day_4\data"
          spellCheck={false}
        />
        <button
          className="btn-primary shrink-0"
          onClick={() => onScan(folder.trim())}
          disabled={busy || !folder.trim()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderSearch className="h-4 w-4" />}
          Scan
        </button>
      </div>
      <p className="field-help">
        Reads every <span className="font-mono">.csv</span> inside that folder{" "}
        <strong>and its sub-folders</strong>, so a layout like{" "}
        <span className="font-mono">data\stocks\</span> +{" "}
        <span className="font-mono">data\index\</span> loads in one go.
      </p>

      {/* ---------- Option B: drag files from anywhere ------------------ */}
      <div className="my-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-brief-line" />
        <span className="text-2xs uppercase tracking-[0.18em] text-brief-muted">or</span>
        <div className="h-px flex-1 bg-brief-line" />
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => !busy && fileInput.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${
          dragging
            ? "border-precision-500 bg-precision-600/10"
            : "border-brief-line hover:border-precision-500/60 hover:bg-brief-surface/60"
        } ${busy ? "pointer-events-none opacity-50" : ""}`}
      >
        <UploadCloud className="mx-auto h-7 w-7 text-precision-400" />
        <p className="mt-2 text-sm font-semibold text-cream-50">
          Drag &amp; drop your CSV files here
        </p>
        <p className="mt-1 text-2xs text-brief-muted">
          Stock files and the benchmark/index file together &middot; click to browse
        </p>
        <input
          ref={fileInput}
          type="file"
          accept=".csv"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onUpload(Array.from(e.target.files));
            e.target.value = ""; // allows re-picking the same file later
          }}
        />
      </div>

      {/* ---------- What did we manage to load? ------------------------- */}
      {symbols.length > 0 && (
        <div className="mt-4 animate-riseIn">
          <div className="flex items-center gap-2 text-xs font-semibold text-market-up">
            <CheckCircle2 className="h-4 w-4" />
            {symbols.length} symbol{symbols.length === 1 ? "" : "s"} ready
          </div>

          {/* A short scrollable list so 700+ tickers do not push the page
              down. We deliberately render only the first PREVIEW_ROWS of
              them: with all 736 in here, the mouse wheel gets swallowed by
              this little box for hundreds of turns and the Step 2 panel
              below feels unreachable. A short list hands the scroll back to
              the page almost immediately. */}
          <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-brief-line bg-brief-surface">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th className="text-right">Rows</th>
                  {/* Only the LAST date is shown. In a normal download every
                      file starts on the same day, so a "From" column would
                      repeat itself 700 times and squeeze the dates until
                      they clip - which is exactly what it did. The full
                      range is still in the tooltip on each row. */}
                  <th>Latest bar</th>
                </tr>
              </thead>
              <tbody>
                {symbols.slice(0, PREVIEW_ROWS).map((symbol) => (
                  <tr
                    key={symbol.ticker}
                    title={`${symbol.ticker}: ${symbol.rows.toLocaleString()} rows, ${symbol.start} to ${symbol.end} (${symbol.file})`}
                  >
                    <td className="font-semibold text-cream-50">
                      {symbol.ticker}
                      {symbol.benchmark_candidate && (
                        <span className="ml-2 rounded bg-precision-600/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-precision-300">
                          index
                        </span>
                      )}
                    </td>
                    <td className="num">{symbol.rows.toLocaleString()}</td>
                    <td className="font-mono">{symbol.end}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Everything IS loaded and will be used in the backtest - this
              little list is only a preview so the sidebar stays usable. */}
          {symbols.length > PREVIEW_ROWS && (
            <p className="mt-1.5 text-2xs text-brief-muted">
              Showing the first {PREVIEW_ROWS} of {symbols.length.toLocaleString()}.
              All {symbols.length.toLocaleString()} are loaded and will be ranked.
            </p>
          )}
        </div>
      )}

      {/* ---------- Anything odd we noticed while reading -------------- */}
      {warnings.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-700/40 bg-amber-900/10 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            {warnings.length} note{warnings.length === 1 ? "" : "s"} while reading your files
          </div>
          <ul className="mt-2 space-y-1 text-2xs leading-relaxed text-amber-200/80">
            {visibleWarnings.map((warning, index) => (
              <li key={index}>&bull; {warning}</li>
            ))}
          </ul>
          {warnings.length > 4 && (
            <button
              className="mt-2 text-2xs font-semibold text-amber-400 underline"
              onClick={() => setShowAllWarnings((value) => !value)}
            >
              {showAllWarnings ? "Show fewer" : `Show all ${warnings.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
