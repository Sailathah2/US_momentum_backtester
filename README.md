# Momentum Backtest Portal (US & Global Equities)

**Tradewithsai · Morning Brief**

A desktop web app that tests one specific, well-known trading idea on your own CSV
price files:

> **Own the stocks that are climbing faster than the market — and only those.**

You point it at a folder of daily stock CSV files plus one index file (SPY, QQQ,
NIFTY, or any benchmark you like). It replays history, shows you what would have
happened to your money, and lets you download every trade it made.

**No coding required.** If you can copy and paste two commands, you can run this.

> **Running it day to day, or changing the code?** See **[SOP.md](SOP.md)** — the
> operating checklist, the traps (a backend edit needs a server restart), how to
> judge whether a result is trustworthy, and the regression suite.

---

## What it actually does

Every so often — you choose how often — the portal does five things:

| Step | What happens |
|------|--------------|
| **1. Measure** | Works out how much each stock rose over your lookback window. This is called **ROC** (Rate of Change). |
| **2. Compare** | Works out the same number for the benchmark index over the same days. |
| **3. Filter** | Throws away every stock that failed to beat the index. *(This is the "relative strength" rule.)* |
| **4. Rank & buy** | Sorts the survivors strongest-first and buys the top few. |
| **5. Hold & repeat** | Changes nothing until the next rebalance date, then starts again. If nothing beats the index, it sits in cash. |

Then it reports back: CAGR, Sharpe, Sortino, max drawdown, win rate, an equity curve
against the benchmark, an underwater chart, a monthly calendar grid, and a full
trade log you can export to Excel.

---

## Part 1 — One-time setup

You need **Python 3.10 or newer** and **Node.js 18 or newer** installed. Both are
free. If you already ran the *US Stock Data Downloader* project, you have both.

Check by opening a terminal (Command Prompt or PowerShell on Windows) and typing:

```bash
python --version
node --version
```

If either says "not recognised", install it first from
[python.org](https://www.python.org/downloads/) and [nodejs.org](https://nodejs.org/).

### Install the backend (the calculation engine)

```bash
cd D:\algo_trading\ai_masterclass\day_4\backend
pip install -r requirements.txt
```

### Install the frontend (the website)

```bash
cd D:\algo_trading\ai_masterclass\day_4\frontend
npm install
```

This downloads a few hundred small files into a `node_modules` folder. It takes a
minute or two, and you only ever do it once.

---

## Part 2 — Running the app

The app is two programs that talk to each other, so you need **two terminal
windows**, both left open while you work.

### Terminal 1 — the backend

```bash
cd D:\algo_trading\ai_masterclass\day_4\backend
python app.py
```

You should see:

```
==============================================================
  Momentum Backtest Portal  -  backend server
==============================================================
  Listening on http://127.0.0.1:5001
```

**Leave this window open.** If you close it, the website loses its brain.

> **"Address already in use"?** Another app is already on port 5001. Close it, or
> change `PORT = 5001` near the top of `backend/app.py` **and** the matching proxy
> target in `frontend/vite.config.js` — the two must agree.
>
> Note this project deliberately uses **5001**, not 5000, so it can run alongside
> the day_3 US Stock Data Downloader.

### Terminal 2 — the website

```bash
cd D:\algo_trading\ai_masterclass\day_4\frontend
npm run dev
```

Your browser opens automatically at **http://localhost:5173** (Vite picks the next
free port, e.g. 5174, if 5173 is already taken — read the terminal for the real one).

The dot in the top-right corner should say **Backend online**. If it says offline,
Terminal 1 is not running.

> **Changed the Python code?** Restart Terminal 1. Python loads modules once at
> startup, so an edit to `engine.py` or `app.py` has no effect until you stop the
> server with `Ctrl + C` and run `python app.py` again — the symptom is a new
> setting appearing to do nothing at all. The website hot-reloads on its own and
> needs no restart.

### When you are finished

Press `Ctrl + C` in both terminal windows.

---

## Part 3 — Using it

### Step 1 · Load your price data

Two ways, either is fine:

**Scan a folder (fastest — best for hundreds of files)**
Type the full path of the folder holding your CSVs and press **Scan**. It reads
every `.csv` in that folder *and its sub-folders*, so a layout like this loads in
one go:

```
day_4\data\
├── stocks\        <- your stock CSV files
└── index\         <- your benchmark / index CSV file
```

The box is pre-filled with `D:\algo_trading\ai_masterclass\day_4\data` — change it
to wherever your files actually live.

**Drag and drop**
Drop the files onto the dashed box, or click it to browse.

The portal reads all these column layouts automatically, so you almost never have
to touch your files:

| Source | Columns it uses |
|--------|-----------------|
| US Stock Data Downloader | `Date, Open, High, Low, Close, Volume, Ticker` |
| Legacy / broker exports | `datetime, symbol, security_id, open, high, low, close, volume, oi` |
| Index files | `time, open, high, low, close` |

It also copes with `YYYY-MM-DD`, `DD/MM/YYYY`, `MM/DD/YYYY` and timestamps like
`2024-01-02 15:30:00`, works out which is which, and quietly skips rows with
missing or broken prices. Anything it had to skip is reported in a yellow note so
nothing is hidden from you.

### Step 2 · Choose your settings

| Setting | What it means | Try changing it to… |
|---------|---------------|---------------------|
| **Benchmark / index** | The file every stock must beat. Auto-detected if the filename contains `spy`, `qqq`, `nifty`, `index`, etc. — but you can pick any file. | Compare SPY vs QQQ as the hurdle. |
| **Lookback window** | How far back momentum is measured, in trading days. | `20` reacts fast and trades often; `252` follows slow, year-long trends. `126` ≈ six months. |
| **Rebalance every** | How often the portfolio is re-picked. | Monthly is a good starting point. Weekly tracks momentum closer but pays more costs. |
| **Hold top N** | How many stocks to own. | Fewer = more concentrated and more volatile. |
| **Exit rank cushion** | `Off` sells and rebuilds the whole book every rebalance. Set a rank above your Top N and a stock you already own is **kept** until it falls past that rank or stops beating the index — while a new stock still has to reach the Top N to get in. | With Top 10, try `Rank 15`. |
| **When positions are kept** | **Re-balance all** resets every holding to its target weight. **Recycle cash only** leaves kept positions untouched and spends just the cash freed by the sales. | Recycle for the lowest costs. |
| **Stock must be above its own EMA** | An extra health check on each candidate. Beating the index is not much of an achievement if the index is falling and the stock is falling too — this insists the stock is in **its own** uptrend as well. | `Off` for the original behaviour; `100d` or `200d` to demand a genuine uptrend. |
| **Risk adjustment** | `Nil` ranks on raw momentum — the biggest gainer wins, however wild the ride. Set a window and stocks are ranked by **ROC ÷ risk** instead: momentum earned *per unit of risk*. | `60d` is a good starting point. |
| **Std dev / Downside dev** | Which risk figure goes in the denominator — see below. | Try both; they pick different stocks. |

**Two flavours of risk.** Once you set a window, you choose what "risk" means:

| Measure | Formula | What it penalises |
|---|---|---|
| **Std dev** | `ROC ÷ StdDev` | *Total* volatility. A violent jump **up** counts as just as risky as a fall, so a stock that rockets higher is penalised alongside one that lurches down. |
| **Downside dev** | `ROC ÷ DownsideDev` | Only *losing* days. Every up day contributes a clean zero, so a stock that climbed in fast, smooth steps is not punished — while one that got there through a jagged series of drops is. |

Downside deviation is the Sortino idea, and it is usually closer to what a trader
actually means by risk. It is the textbook definition — the root-mean-square of the
losing days, averaged over **all** N days in the window, not just the losing ones,
which correctly rewards a stock for having had few down days at all.

> **A subtlety worth knowing.** A downside deviation of zero means the stock had *no
> losing days* — the best possible outcome, not bad data. The portal keeps those
> stocks and ranks them top (ordered among themselves by raw momentum) rather than
> discarding them. It tells them apart from genuinely dead stocks by checking total
> volatility: a flawless riser has plenty of it, a halted stock being carried forward
> at a flat price has none, and only the latter is dropped.
| **Weighting** | Equal = same money in each. Momentum = the strongest gets the biggest slice. | Momentum weighting increases both return *and* risk. |
| **Keep unfilled slots in cash** | **Ticked:** each of your N slots is worth 1/N. Only 3 stocks qualified? You invest 30% and hold 70% cash. **Unticked:** always 100% invested — those 3 stocks get a third each. | Untick it to see how much the cash buffer costs you in a bull market. |
| **Trading cost (bps)** | Fees + slippage. 1 bp = 0.01%. | `0` for gross returns; `10` is a realistic retail estimate. Watch weekly rebalancing get much worse. |
| **Starting capital** | Cosmetic — it only scales the chart. Percentages don't change. | |
| **Start / end date** | Limit the test to a window. Leave blank to use everything. | Test 2020 and 2022 separately — momentum behaves very differently in each. |

Then press **Run backtest**.

### The rank cushion (hold / exit buffer)

Without a cushion the portfolio is liquidated and rebuilt at every rebalance, so a
stock that merely slipped from 10th to 11th place is sold and often bought straight
back a month later. The cushion introduces a gap between the rank you need to **get
in** and the rank at which you are **thrown out**.

At each rebalance the portal now makes three separate decisions:

| Currently | Rank | Beats index? | Action |
|---|---|---|---|
| Held | ≤ exit rank | Yes | **KEEP** |
| Held | > exit rank | either | **EXIT** |
| Held | ≤ exit rank | No | **EXIT** |
| Not held | ≤ Top N | Yes | **ENTER** (fills a vacant slot) |

Vacant slots are then filled with the highest-ranked stocks that are not already
held. The cushion widens the *exit* door only — the entry bar never moves.

Every decision is recorded. A new **Keep / exit / enter** tab shows each ticker with
its action, its rank, the weight it ended up with, and the reason in plain English
("rank 12 still inside the cushion (15)", "no longer beats the index"). The rebalance
log gains Kept / In / Out columns, and both exports carry the full audit trail.

> **What to expect.** On the five-year test set, widening the cushion from off to
> rank 20 lifted kept positions from 0 to 123 and cut average turnover from 1.64 to
> 1.51 — a real but modest saving, because holding only 10 names monthly is
> inherently high-churn. Switching to **Recycle cash only** cut it further to 1.43
> and saved about 20% of all trading costs, at the price of a deeper drawdown as
> winners are left to grow unchecked.

### Step 3 · (Optional) Add the index regime filter

The momentum strategy decides *which* stocks to buy. The regime filter decides
something bigger: **whether to be in the market at all**.

It watches one index and flips the whole portfolio between two states:

| State | Meaning |
|-------|---------|
| **Risk-ON** | The index is trending up → run the strategy normally. |
| **Risk-OFF** | The index is trending down → hold **100% cash**, zero market exposure. |

**The four modes**

| Mode | Rule |
|------|------|
| **Off** | No filter. Fully invested at all times. |
| **EMA only** | Invested while the index closes **above** its moving average. |
| **Supertrend only** | Invested while the index closes above its Supertrend line. The line widens in volatile markets, so ordinary noise doesn't shake you out. |
| **Both** (recommended) | Needs **both** indicators to agree before changing state. |

**Why "Both" is recommended — hysteresis**

A filter that flips the instant any one indicator wobbles will sell you out and buy
you back repeatedly, bleeding money on costs each time. That churn is called
*whipsaw*. So "Both" mode is deliberately stubborn:

- Currently Risk-ON → go OFF **only if** close < EMA **and** close < Supertrend
- Currently Risk-OFF → go ON **only if** close > EMA **and** close > Supertrend
- The two disagree → **keep the state you're already in**

On five years of real data this roughly halves the churn: `both` produced **17
switches** where EMA alone gave 31 and Supertrend alone gave 34.

**The parameters**

| Setting | Default | What it does |
|---------|---------|--------------|
| **Index to watch** | your benchmark | Any loaded file. You can gate a small-cap universe on the S&P 500, or on a single bellwether stock. |
| **Candles to read** | Daily | **Daily** = one bar per trading day; reacts quickly but flips more often. **Weekly** = each week becomes one candle, so the trend is far smoother and the filter changes its mind much less, at the cost of reacting later. |
| **EMA period** | 200 | The classic long-term trend line. Shorter reacts sooner but changes its mind far more often. |
| **ATR period** | 10 | How many days of movement feed the volatility estimate. |
| **Multiplier** | 3.0 | How far the trailing stop sits from price, in ATRs. Higher = looser, fewer exits. |
| **Cash when Risk-OFF** | 100% | How much of the portfolio moves to cash on a Risk-OFF day. **100%** = fully defensive, sell everything. **50%** = halve the position and ride the rest out. **0%** = the filter does nothing. |
| **Park that money in** | Cash | Where the de-risked money sits. **Cash** earns nothing. Pick any loaded symbol — a gold or bond fund — and it earns whatever that asset did instead. |

**About parking the money in gold.** Sitting in cash during a downtrend protects you
but earns nothing. Gold is the classic alternative because it often rises exactly
when shares are falling, so the defensive money can work for you instead of waiting.

To use it, the asset must be **loaded as one of your CSV files** — download `GLD`,
`IAU`, `TLT` or whatever you prefer with the US Stock Data Downloader and drop it in
your data folder alongside the stocks.

Two honest caveats:

- **It is not free.** Each regime switch becomes *two* trades instead of one (sell
  the shares **and** buy the gold, then the reverse on the way back), so the portal
  charges double the trading cost on every flip.
- **It is not automatically better.** Parking in something risky can deepen your
  drawdown rather than cushion it. The exposure panel reports how the parked asset
  itself did over exactly the days you were sitting in it, so you can judge the swap
  on evidence. In testing, parking in a gold-royalty stock improved both return and
  drawdown, while parking in an ordinary tech stock improved return but made the
  worst drawdown **deeper** — check the drawdown row, not just the return.

**About weekly candles.** When you switch to weekly, the period numbers count
**weeks**, exactly as they do on any charting website — so an EMA of `40` means 40
weekly bars, roughly nine months of trend. Switching timeframe snaps the EMA to a
sensible default for it (200 daily / 40 weekly), because leaving `200` in place
would silently mean 200 *weeks* — nearly four years. The panel always spells out
the span underneath ("40 weeks is about 9 months of trend"), and the portal refuses
the run with a clear message if your file is too short for the period you asked for.

On five years of test data, switching the same `Both` filter from daily to weekly
cut the regime switches from **17 to 7** and improved max drawdown from −52.2% to
−47.8%, at the cost of lower total return — the classic smoothness-versus-agility
trade.

**About partial cash.** Going 100% to cash is the strictest setting, but it is not
always the best one — you miss the recovery bounce as well as the fall. Holding
part of the book through a downtrend is a middle path: less upside given up, but
some downside kept. On five years of test data, the *shallowest* drawdown came at
**75% cash (−48.9%)**, not at 100% (−52.2%) — going fully flat meant re-entering
after the bounce had already happened.

> When you use partial cash, judge the run on **average exposure**, not "time in
> market". Time in market counts *days* the filter was fully Risk-ON; average
> exposure is the share of *capital* actually at risk, which is the honest number
> once you are holding part of the book through Risk-OFF days.

Press **Compare filter ON vs OFF**. The same strategy runs **twice** — with the
filter and without — so you can see exactly what it cost and what it saved:

- **Three-line equity chart** — blue (filter ON), violet (filter OFF), amber (index).
- **Regime timeline strip** under the chart — green where invested, grey where in
  cash. Line a grey block up with a dip in the violet line to see a fall the filter
  dodged; line it up with a rally to see what it cost you.
- **Head-to-head table** — every metric side by side with the difference.
- **Exposure breakdown** — time in market vs time in cash, plus the switch count.
- **Drawdown comparison** — the two underwater curves overlaid.

> **Reading it honestly.** A good filter usually *gives up some return* in exchange
> for a shallower worst-case fall. If the return row is red, check the drawdown row
> before concluding it failed. And if the switch count looks high, try a longer EMA
> or a bigger multiplier — both make the filter slower to change its mind.

### Step 4 · Read the results

- **The eight tiles** — headline numbers, each with the benchmark's equivalent
  underneath so you always know whether you actually beat buy-and-hold.
- **Equity curve** — blue is your portfolio, amber is the benchmark. Both start at
  the same money on the same day. Switch to **Log** scale for long tests; it makes
  an early 20% gain look the same size as a late one, which is the honest view.
- **Underwater chart** — how far below its own previous peak the portfolio was, day
  by day. This is the chart that tells you whether you could have *stuck with it*.
- **Monthly grid** — one row per year. Every cell prints its real percentage, so
  the colours are only a quick summary, never the only way to read it.
- **Rebalance & trade log** — every decision the strategy made, searchable, with
  four **Download CSV** buttons.

---

## Understanding the numbers

| Metric | Plain English | Rough guide |
|--------|---------------|-------------|
| **Total return** | How much it grew, start to finish. | — |
| **CAGR** | That same growth as a steady yearly rate. | Compare it to the benchmark's, not to a target. |
| **Sharpe ratio** | Return earned per unit of bumpiness. | Above 1 good, above 2 excellent. |
| **Sortino ratio** | Like Sharpe, but only counts *downward* moves as risk. | Always higher than Sharpe. |
| **Max drawdown** | The worst peak-to-trough fall in the whole test. | If this number would have made you quit, the strategy is too aggressive for you. |
| **Win rate** | Share of rebalance periods that ended in profit. | 50–60% is normal and perfectly healthy. |
| **vs Benchmark** | Your total return minus the index's. | The only number that says whether the work was worth it. |

---

## What's in each file

```
day_4/
├── backend/
│   ├── app.py            # The web server. Handles uploads, runs backtests, builds CSV exports.
│   ├── engine.py         # The backtesting brain: the strategy loop, the regime overlay, and all the performance maths.
│   ├── indicators.py     # EMA, ATR, Supertrend and the Risk-ON/Risk-OFF state machine.
│   ├── data_loader.py    # The CSV translator: column mapping, date parsing, calendar alignment.
│   ├── requirements.txt  # The Python libraries to install.
│   └── verify_all.py     # Regression suite - run after any backend change.
│
├── frontend/
│   ├── package.json          # The JavaScript libraries to install.
│   ├── vite.config.js        # Dev server settings (and the /api -> port 5001 forwarding).
│   ├── tailwind.config.js    # The Morning Brief colour theme.
│   ├── index.html            # The single page React draws into.
│   └── src/
│       ├── App.jsx           # The app's memory and page layout.
│       ├── api.js            # Every conversation with the Python backend.
│       └── components/
│           ├── Header.jsx            # Masthead + backend status dot.
│           ├── UploadZone.jsx        # Step 1: drag-drop and folder scanning.
│           ├── BacktestControls.jsx  # Step 2: every strategy setting.
│           ├── RegimeControls.jsx    # Step 3: the macro filter settings.
│           ├── MetricCards.jsx       # The row of headline numbers.
│           ├── EquityChart.jsx       # Portfolio vs benchmark growth.
│           ├── EquityComparisonChart.jsx  # Filter ON vs OFF vs benchmark + regime strip.
│           ├── ComparisonMetricsCard.jsx  # The head-to-head metrics table.
│           ├── ExposureChart.jsx     # Time in market vs time in cash.
│           ├── DrawdownChart.jsx     # The underwater chart (also does ON-vs-OFF).
│           ├── MonthlyHeatmap.jsx    # The calendar grid of returns.
│           └── TradeLogTable.jsx     # Rebalance log, trade log, CSV exports.
│
├── data/
│   ├── stocks/           # Put your stock CSV files here.
│   └── index/            # Put your benchmark / index CSV file here.
│
├── SOP.md                # Operating checklist, house rules, troubleshooting.
└── README.md             # This file.
```

---

## If something goes wrong

| What you see | What it means |
|--------------|---------------|
| **"Backend offline"** in the header | Terminal 1 isn't running. Go to `backend` and run `python app.py`. |
| **"Address already in use"** | Something else has port 5001. Close it, or change `PORT` in `app.py` *and* the proxy in `vite.config.js`. |
| **"The stock files and the benchmark file do not overlap in time"** | Your index file covers different dates than your stocks. The message tells you both date ranges. |
| **"Only N trading days are available…"** | Your lookback is longer than your price history. Use a shorter lookback or load more history. |
| **"At least 2 stock files… are needed"** | You loaded only the benchmark, or only one stock. Momentum needs something to rank. |
| **A yellow note about skipped rows** | Normal. Some rows had a broken date or a missing price and were left out. The note names the file. |
| **"That dataset is no longer loaded"** | The backend restarted. Load your files again — it takes seconds. |
| The whole portfolio sits in **cash** for long stretches | Working as designed. In a falling market, few stocks beat the index, so the strategy steps aside. Try a shorter lookback or a larger universe. |

---

## Notes on how it's calculated

A few decisions worth knowing about, so you can trust the numbers:

- **Prices are aligned to the benchmark's calendar.** The benchmark defines what
  counts as a trading day. Missing stock prices are forward-filled (the last known
  price still stands) — never invented.
- **A stock is only eligible if it has a real price at both ends of the lookback
  window.** A company that listed last month cannot be picked on a 252-day lookback.
- **Weights drift between rebalances.** Once bought, positions are left alone until
  the next rebalance, exactly as they would be in reality.
- **Trading costs are charged on turnover.** Selling 40% of the book and buying 40%
  of something else is 0.8 turnover; at 10 bps that costs 0.08% of the portfolio.
- **Win rate counts rebalance periods, not days** — that's the meaningful unit of
  this strategy.
- **The regime filter is shifted one day, deliberately.** The filter reads the
  index's *closing* price, and you cannot act on a close until the market has shut.
  So the decision only affects the **next** day. Without that shift the backtest
  would be selling on the morning of a crash using that evening's information —
  "lookahead bias", which makes any strategy look brilliant and is impossible in
  real life.
- **ATR uses Wilder's smoothing** (alpha = 1/period), not a simple `span` average.
  Using the wrong one produces a Supertrend that quietly disagrees with every
  charting platform.
- **The risk adjustment changes the ranking, not the entry rule.** A stock
  still has to beat the index on **raw** momentum to qualify — that is the
  strategy's defining filter. The std-dev setting only decides the running order
  among the stocks that already qualified.
- **A stock with zero volatility is dropped, not ranked first.** A halted or
  delisted name whose last price is being carried forward has a std-dev of zero,
  and `ROC ÷ 0` is infinity — which would nail that dead stock to the top of the
  ranking for ever. Any candidate without a real, positive volatility is excluded.
- **The std-dev is not annualised.** For a fixed window it is the same constant
  factor for every stock, so it cannot change the ordering.
- **Weekly regime bars are labelled with the week's last *trading* day**, not the
  calendar Friday, and a week's verdict only reaches the days *after* it closes.
  Both details prevent a weekly signal from leaking information backwards into its
  own week.
- **Every screen waits for its own run-up.** The first trade happens only once the
  slowest of the lookback, stock EMA and volatility windows has enough history —
  otherwise the portfolio would sit in cash at the start and look broken.
- **Regime switches are charged on how much the exposure moved.** Going 100% to
  cash sells the whole book (turnover 1.0); going to 40% cash sells only 40% of it,
  and costs 40% as much. Rebalances are charged the same way — while fully in cash
  no shares move, so the rebalance is free. Parking the money in an asset doubles
  the switch cost, because each flip is two trades rather than one.
- **The de-risked slice is held at a constant weight.** When you split, say, 50/50
  between shares and gold during a Risk-OFF stretch, the model holds that split
  rather than letting the two legs drift apart. At the default 100% there is only
  one asset, so the question does not arise and it is a plain buy-and-hold of the
  parked asset.
- **A missing price for the parked asset counts as a flat day**, so a gap in the
  gold file can never invent or destroy money.
- **There is only ever one y-axis on a chart.** Two different scales on one chart is
  the easiest way to fool yourself, so the app never does it.

---

*For research and education only. A backtest is not a promise. Real trading involves
costs, taxes, slippage and your own behaviour under pressure — things this tool can
only estimate.*

---

## Downloading the full report

The **Rebalance & trade history** panel has two buttons that export the *entire*
run in one file — settings, metrics and every table together:

| Button | You get | Use it when |
|--------|---------|-------------|
| **Full report (Excel)** | One `.xlsx` workbook, one tab per sheet | You want to read or chart it in Excel / Google Sheets |
| **Full report (CSVs)** | A `.zip` holding one `.csv` per sheet, plus a README | Your tool only reads plain CSV |

A single CSV file cannot contain multiple sheets, so the CSV option bundles one
file per sheet instead — same content, same order.

Both contain seven sheets:

| Sheet | Contents |
|-------|----------|
| **1. Inputs** | Every setting that produced the run, each with a plain-English note explaining what it does |
| **2. Metrics** | Total return, CAGR, Sharpe, Sortino, max drawdown, Calmar, win rate — portfolio beside benchmark |
| **3. Regime Comparison** | Filter ON vs OFF with the difference, plus exposure and switch counts *(only when you ran the regime comparison)* |
| **4. Equity Curve** | The daily series behind the charts, including both drawdown lines |
| **5. Rebalance Log** | One row per rebalance period |
| **6. Trade Log** | One row per stock per period, including the risk figure and rank score |
| **7. Monthly Returns** | The calendar grid, one row per year |

The four smaller buttons beside them still export a single table each, if that is
all you need.

> The Excel option needs the `openpyxl` library, which is in `requirements.txt`.
> If it is missing, the portal says so and the CSV/ZIP option still works.
