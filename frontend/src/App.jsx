/**
 * ==========================================================
 * App.jsx -- the whole website, assembled
 * ==========================================================
 *
 * This file holds the application's "memory" (which files are loaded, what
 * the settings are, what the last result was) and decides which panels to
 * show. The actual drawing is done by the small components in /components.
 *
 * THE USER'S JOURNEY, TOP TO BOTTOM
 * ---------------------------------
 *   Step 1  Load CSV files            -> <UploadZone />
 *   Step 2  Choose strategy settings  -> <BacktestControls />
 *   Step 3  Read the results          -> metrics, charts, logs
 */
import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, BookOpen, Coins, Layers, Percent, X } from "lucide-react";

import { checkHealth, exportCsv, runBacktest, scanFolder, uploadFiles } from "./api";
import BacktestControls from "./components/BacktestControls";
import DrawdownChart from "./components/DrawdownChart";
import EquityChart from "./components/EquityChart";
import Header from "./components/Header";
import MetricCards from "./components/MetricCards";
import MonthlyHeatmap from "./components/MonthlyHeatmap";
import TradeLogTable from "./components/TradeLogTable";
import UploadZone from "./components/UploadZone";

// The folder this project ships its sample data in. It is only a suggestion
// typed into the box for you - change it to wherever your CSV files live.
const DEFAULT_DATA_FOLDER = "D:\\algo_trading\\ai_masterclass\\day_4\\data";

// The settings the page opens with. These are sensible, widely used defaults:
// a six-month lookback rebalanced monthly, holding the ten strongest names.
const DEFAULT_SETTINGS = {
  benchmark: "",
  lookback: 126,
  cadence: "monthly",
  every_n_days: 21,
  top_n: 10,
  weighting: "equal",
  cash_buffer: true,
  cost_bps: 0,
  start_capital: 100000,
  start_date: "",
  end_date: "",
};

export default function App() {
  // --- What the server knows ------------------------------------------
  const [online, setOnline] = useState(false);
  // Set when something IS answering our port, but it is a different app.
  const [wrongService, setWrongService] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [symbols, setSymbols] = useState([]);
  const [warnings, setWarnings] = useState([]);

  // --- What the user has chosen ---------------------------------------
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  // --- What came back from the backtest --------------------------------
  const [result, setResult] = useState(null);

  // --- Transient UI state ----------------------------------------------
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);

  // Ping the Python server on start-up, then every 20 seconds, so the
  // status dot in the header stays honest.
  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      const status = await checkHealth();
      if (cancelled) return;
      setOnline(status.online);
      setWrongService(status.wrongService ? status.message : null);
    };
    ping();
    const timer = setInterval(ping, 20000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  /**
   * Both loading routes (drag-drop and folder scan) end up here. It stores
   * the file list and pre-selects a benchmark if the server spotted one.
   */
  const absorbPayload = useCallback((payload) => {
    setSessionId(payload.session_id);
    setSymbols(payload.symbols || []);
    setWarnings([...(payload.warnings || []), ...(payload.files_failed || [])]);
    setResult(null); // the old result belongs to the old files

    setSettings((previous) => {
      const stillLoaded = (payload.symbols || []).some(
        (symbol) => symbol.ticker === previous.benchmark
      );
      return {
        ...previous,
        // Keep the user's choice if it survived; otherwise take the server's
        // suggestion (a file whose name contained "spy", "nifty", etc.).
        benchmark: stillLoaded ? previous.benchmark : payload.suggested_benchmark || "",
      };
    });
  }, []);

  async function handleUpload(files) {
    setError(null);
    setLoadingFiles(true);
    try {
      // Passing the existing session id ADDS to what is already loaded.
      const payload = await uploadFiles(files, sessionId);
      absorbPayload(payload);
    } catch (exception) {
      setError(exception.message);
    } finally {
      setLoadingFiles(false);
    }
  }

  async function handleScan(folder) {
    setError(null);
    setLoadingFiles(true);
    try {
      const payload = await scanFolder(folder);
      absorbPayload(payload);
    } catch (exception) {
      setError(exception.message);
    } finally {
      setLoadingFiles(false);
    }
  }

  function handleReset() {
    setSessionId(null);
    setSymbols([]);
    setWarnings([]);
    setResult(null);
    setError(null);
    setSettings(DEFAULT_SETTINGS);
  }

  async function handleRun() {
    setError(null);
    setRunning(true);
    try {
      const payload = await runBacktest({ session_id: sessionId, ...settings });
      setResult(payload);
      // Slide down to the results once they are ready.
      requestAnimationFrame(() => {
        document.getElementById("results")?.scrollIntoView({ behavior: "smooth" });
      });
    } catch (exception) {
      setError(exception.message);
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  async function handleExport(kind) {
    setError(null);
    setExporting(true);
    try {
      await exportCsv(sessionId, kind);
    } catch (exception) {
      setError(exception.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="min-h-screen bg-brief-bg">
      <Header online={online} universeSize={symbols.length} />

      <main className="mx-auto max-w-[1600px] px-6 py-6">
        {/* ---------- A DIFFERENT app is sitting on our port ------------ */}
        {wrongService && (
          <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-600/50 bg-amber-900/15 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            <div className="text-sm">
              <p className="font-semibold text-cream-50">
                The wrong program is answering on port 5001.
              </p>
              <p className="mt-1 text-xs leading-relaxed text-cream-200">{wrongService}</p>
            </div>
          </div>
        )}

        {/* ---------- The backend-is-not-running warning ---------------- */}
        {!online && !wrongService && (
          <div className="mb-5 flex items-start gap-3 rounded-xl border border-market-down/40 bg-market-down/10 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-market-down" />
            <div className="text-sm">
              <p className="font-semibold text-cream-50">The Python backend is not running.</p>
              <p className="mt-1 text-xs leading-relaxed text-cream-200">
                Open a terminal, go to the project's <span className="font-mono">backend</span>{" "}
                folder and run:
                <code className="ml-2 rounded bg-brief-surface px-2 py-0.5 font-mono text-precision-300">
                  python app.py
                </code>
                <br />
                It listens on port 5001. Leave that window open, and this banner will
                disappear on its own.
              </p>
            </div>
          </div>
        )}

        {/* ---------- Any error, in plain language ---------------------- */}
        {error && (
          <div className="mb-5 flex items-start gap-3 rounded-xl border border-market-down/40 bg-market-down/10 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-market-down" />
            <p className="flex-1 text-sm leading-relaxed text-cream-100">{error}</p>
            <button onClick={() => setError(null)} className="text-brief-muted hover:text-cream-50">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* ================= THE TWO-COLUMN LAYOUT ==================== */}
        <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
          {/* ---- LEFT: the controls, which stay put while you scroll --- */}
          <div className="space-y-5 xl:sticky xl:top-24 xl:self-start">
            <UploadZone
              onUpload={handleUpload}
              onScan={handleScan}
              onReset={handleReset}
              busy={loadingFiles}
              symbols={symbols}
              warnings={warnings}
              defaultFolder={DEFAULT_DATA_FOLDER}
            />

            {symbols.length > 0 && (
              <BacktestControls
                settings={settings}
                onChange={setSettings}
                onRun={handleRun}
                busy={running}
                symbols={symbols}
              />
            )}
          </div>

          {/* ---- RIGHT: the results ------------------------------------ */}
          <div id="results" className="space-y-5">
            {/* Nothing loaded yet: explain the strategy while they wait. */}
            {!result && <WelcomePanel hasFiles={symbols.length > 0} />}

            {result && (
              <div className="animate-riseIn space-y-5">
                <MetricCards
                  metrics={result.metrics}
                  benchmarkMetrics={result.benchmark_metrics}
                  outperformance={result.outperformance}
                  summary={result.summary}
                />

                <RunSummary result={result} />

                <EquityChart
                  data={result.curve}
                  startCapital={result.summary.start_capital}
                  benchmarkName={result.benchmark}
                />

                <DrawdownChart
                  data={result.curve}
                  maxDrawdown={result.metrics.max_drawdown}
                  maxDrawdownDate={result.metrics.max_drawdown_date}
                  benchmarkName={result.benchmark}
                />

                <MonthlyHeatmap rows={result.monthly} />

                <TradeLogTable
                  rebalances={result.rebalances}
                  trades={result.trades}
                  onExport={handleExport}
                  exporting={exporting}
                />
              </div>
            )}
          </div>
        </div>

        <footer className="mt-10 border-t border-brief-line pt-5 text-center text-2xs leading-relaxed text-brief-muted">
          Momentum Backtest Portal &middot; Tradewithsai Morning Brief
          <br />
          For research and education only. Past performance in a backtest is not a
          promise of future results — real trading involves costs, taxes and slippage
          this tool can only estimate.
        </footer>
      </main>
    </div>
  );
}

/**
 * The panel shown before any results exist. It explains the strategy in five
 * short steps so a first-time user knows what they are about to run.
 */
function WelcomePanel({ hasFiles }) {
  const steps = [
    {
      title: "Measure",
      text: "On each rebalance date we work out how much every stock has risen over your lookback window. That number is called ROC (Rate of Change).",
    },
    {
      title: "Compare",
      text: "We calculate the same number for the benchmark index over the very same days.",
    },
    {
      title: "Filter",
      text: "Any stock that failed to beat the index is thrown out. This is the 'relative strength' rule — beating the market is the entry ticket.",
    },
    {
      title: "Rank & buy",
      text: "The survivors are sorted strongest-first and the top few are bought, either equally weighted or weighted by their momentum.",
    },
    {
      title: "Hold & repeat",
      text: "Nothing changes until the next rebalance date, when the whole process runs again. If nothing beats the index, the portfolio sits in cash.",
    },
  ];

  return (
    <section className="brief-card p-6">
      <div className="flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-precision-400" />
        <p className="brief-eyebrow">How this strategy works</p>
      </div>

      <h2 className="mt-2 text-xl font-extrabold tracking-tight text-cream-50">
        Relative-strength momentum, in five steps
      </h2>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-cream-200">
        The idea is simple: own the stocks that are climbing faster than the market,
        and only those. Everything below happens automatically once you press{" "}
        <em>Run backtest</em>.
      </p>

      <ol className="mt-5 space-y-3">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-precision-600/20 font-mono text-xs font-bold text-precision-300">
              {index + 1}
            </span>
            <div>
              <p className="text-sm font-semibold text-cream-50">{step.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-brief-muted">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-6 rounded-lg border border-brief-line bg-brief-surface p-4">
        <p className="text-xs font-semibold text-cream-50">
          {hasFiles
            ? "Your files are loaded — pick a benchmark on the left and press Run backtest."
            : "To begin: load your CSV files on the left."}
        </p>
        <p className="mt-1.5 text-2xs leading-relaxed text-brief-muted">
          You need two things: a set of daily stock CSV files, and one index/benchmark
          file to measure them against (SPY, QQQ, NIFTY, or any file you choose). The
          portal reads the common column layouts automatically, so files from the US
          Stock Data Downloader work as-is.
        </p>
      </div>
    </section>
  );
}

/**
 * A one-line recap of the settings that produced the result on screen, so a
 * screenshot of the page is always self-explanatory.
 */
function RunSummary({ result }) {
  const s = result.settings || {};

  const cadenceLabel =
    s.cadence === "days" ? `every ${s.every_n_days} trading days` : s.cadence;

  const items = [
    { icon: Layers, label: "Universe", value: `${result.universe_size} stocks` },
    { icon: Percent, label: "Lookback", value: `${s.lookback} days` },
    { icon: Layers, label: "Rebalance", value: cadenceLabel },
    { icon: Layers, label: "Holding", value: `top ${s.top_n}` },
    {
      icon: Layers,
      label: "Weighting",
      value: s.weighting === "roc" ? "momentum" : "equal",
    },
    { icon: Coins, label: "Cost", value: `${s.cost_bps} bps` },
    {
      icon: Coins,
      label: "Total costs paid",
      value: result.summary.total_costs.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      }),
    },
    {
      icon: Layers,
      label: "Avg. holdings",
      value: `${result.summary.average_holdings}`,
    },
    {
      icon: Layers,
      label: "Periods in cash",
      value: `${result.summary.cash_periods} of ${result.summary.total_rebalances}`,
    },
  ];

  return (
    <section className="brief-card px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div>
          <p className="brief-eyebrow">Run settings</p>
          <p className="mt-0.5 font-mono text-sm font-bold text-cream-50">
            {result.metrics.start_date} → {result.metrics.end_date}
          </p>
        </div>

        <div className="h-8 w-px bg-brief-line" />

        {items.map((item) => (
          <div key={item.label}>
            <p className="text-2xs uppercase tracking-wider text-brief-muted">
              {item.label}
            </p>
            <p className="mt-0.5 font-mono text-xs font-semibold text-cream-100">
              {item.value}
            </p>
          </div>
        ))}

        <div className="ml-auto rounded-lg border border-precision-600/40 bg-precision-600/10 px-3 py-2">
          <p className="text-2xs uppercase tracking-wider text-precision-300">Benchmark</p>
          <p className="mt-0.5 font-mono text-sm font-bold text-cream-50">
            {result.benchmark}
          </p>
        </div>
      </div>
    </section>
  );
}
