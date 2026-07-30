<system_instruction>
You are an expert Lead Quantitative Developer and Full-Stack Software Architect. Build a complete, production-ready, interactive web application called "Momentum Backtest Portal (US & Global Equities)".

The application enables quantitative traders and non-developers to run relative-strength momentum backtests on daily stock candlestick CSV files (from the "US Stock Data Downloader" or custom sources) against an index or benchmark file (such as NIFTY, SPY, QQQ, or custom benchmark CSVs).

All code must be production-ready, fully functional out-of-the-box, modular, and thoroughly commented for non-technical users.
</system_instruction>

<project_overview>
Application Name: Momentum Backtest Portal
Brand Theme: Tradewithsai ("Morning Brief" editorial financial UI)
Core Functionality:
1. Load and process daily stock candlestick CSV files and benchmark index CSV files with multi-format auto-detection.
2. Execute relative-strength momentum backtesting on a stock universe versus a chosen index/benchmark.
3. Compute quantitative risk & return metrics (CAGR, Sharpe Ratio, Sortino Ratio, Max Drawdown, Win Rate).
4. Display interactive charts (Equity Curves vs. Benchmark, Drawdown Charts, Monthly Performance Matrix).(option for benchmark selection)
5. Provide one-click CSV export options for trade logs, rebalance histories, and portfolio time-series data.
</project_overview>

<data_schema_and_parser_rules>
The application must parse both stock and index/benchmark CSV files seamlessly:

1. **Stock CSV Schema**:
   - Primary Columns: `Date, Open, High, Low, Close, Volume, Ticker` (Standard output from US Stock Data Downloader).
   - Alternative/Legacy Schema: `datetime, symbol, security_id, open, high, low, close, volume, oi`.

2. **Index / Benchmark CSV Schema**:
   - Index Files Schema: `time, open, high, low, close` (or `datetime, open, high, low, close` or `Date, Open, High, Low, Close, Volume, Ticker`).
   - Benchmark Identification:
     - Auto-detect benchmark files if the filename contains "nifty", "spy", "spx", "qqq", "index", or "benchmark" (case-insensitive).
     - Allow the user to manually select or override which CSV file acts as the benchmark from the UI.

3. **Data Normalization Routine (`data_loader.py`)**:
   - Column Auto-Mapping: Standardize date column (`time`, `datetime`, `Date`) -> `Date`; close price column (`close`, `Close`) -> `Close`.
   - Flexible Date Parser: Parse `YYYY-MM-DD`, `YYYY-MM-DD HH:MM:SS`, `DD/MM/YYYY`, and `MM/DD/YYYY` formats cleanly.
   - Alignment & Gap Handling: Resample and forward-fill missing price points to ensure synchronized trading days across all universe stocks and the benchmark index.
</data_schema_and_parser_rules>

<trading_strategy_specification>
Strategy Mechanics (Relative-Strength Momentum):
1. Rebalance Cadence: User-configurable (e.g., Every N Trading Days, Weekly, Bi-weekly, Monthly).
2. Lookback Window: User-configurable (e.g., 20, 60, 126, 252 days).
3. Benchmark Relative Strength Calculation (at each rebalance date t, using Close prices):
   - Calculate Rate of Change for each stock: ROC_stock = (Close[t] / Close[t - lookback]) - 1
   - Calculate Rate of Change for Benchmark Index: ROC_bm = (Close[t] / Close[t - lookback]) - 1
4. Filter & Rank:
   - Relative Strength Filter: Retain only stocks where ROC_stock > ROC_bm.
   - Ranking: Sort qualifying survivors by ROC_stock descending, selecting the Top X names (e.g., Top 5, 10, 20).
5. Asset Allocation & Weighting Schemes:
   - Equal Weighting: 1 / n (where n = number of qualified stocks, n <= X).
   - ROC-Based Weighting: Weight proportional to max(ROC_stock, 0) normalized to sum to 1.
   - Cash Buffer: If n < X, unallocated capital remains in Cash. If n = 0, 100% of portfolio is held in Cash for the period.
6. Position Execution: Hold selected assets until the next rebalance date, exit at that day's Close price, and repeat from Step 3.
7. Friction Model: Default gross returns (0% fee/slippage) with an adjustable basis points (bps) input field for trading costs.
</trading_strategy_specification>

<tech_stack>
Backend:
- Python 3.10+ / Flask (Running on Port 5000)
- Dependencies: flask, flask-cors, pandas, numpy, python-dateutil, requests

Frontend:
- React (Vite)
- Tailwind CSS (Configured with Tradewithsai custom theme)
- Recharts (Interactive Equity Curve, Drawdown Chart, & Monthly Returns Heatmap)
- Lucide-React (Modern financial icons)
- Axios (API communication)

Design System (Tradewithsai "Morning Brief" Style):
- Default Theme: Dark Mode (`bg-slate-950` / `bg-slate-900`)
- Accent Colors: Precision Blue (`#2563EB` / `#3B82F6`) and Cream (`#FDFBF7` / `#F5F2EB`) for editorial highlights
- Panels: Slate borders (`#334155`) with high-contrast, tabular financial numbers
</tech_stack>

<project_structure>
Strictly generate all code adhering to this directory layout:

/
├── backend/
│   ├── app.py           # Core Flask REST API endpoints & upload handlers
│   ├── engine.py        # Vectorized backtest logic & quantitative analytics calculation
│   ├── data_loader.py   # Robust multi-schema CSV scanner, column mapper, & date parsing module
│   └── requirements.txt # Python dependencies
├── frontend/
│   ├── package.json
│   ├── tailwind.config.js # Custom theme setup (Cream + Dark slate + Precision Blue)
│   ├── src/
│   │   ├── App.jsx      # Main UI application shell & state management
│   │   └── components/  # BacktestControls, MetricCards, EquityChart, DrawdownChart, TradeLogTable
└── README.md            # Step-by-step setup guide for non-developers
</project_structure>

<key_features_and_outputs>
1. **Quantitative Performance Metrics**:
   - Total Return (%), CAGR (%), Sharpe Ratio, Sortino Ratio, Max Drawdown (%), Win Rate (%), Benchmark Relative Outperformance (%).
2. **Interactive UI Analytics**:
   - Portfolio Equity Curve vs. Benchmark Index Equity Curve.
   - Underwater / Historical Drawdown % chart.
   - Monthly and Annual performance heatmap grid.
3. **Rebalance Log & Data Export**:
   - Scannable table of each rebalance period: Date, Selected Tickers, Portfolio Weights, Calculated ROCs, and Holding Returns.
   - One-click CSV export button for trade logs and portfolio time-series data.
4. **Code Quality & Non-Developer Readability**:
   - Detailed inline comments preceding every pandas transformation, column mapping routine, mathematical step, and API route.
</key_features_and_outputs>

<instruction>
Generate complete, runnable code for every single file specified in the project structure above. Do not use placeholder code, stub functions, or missing implementation comments. Provide complete, fully functional files ready to run.
</instruction>