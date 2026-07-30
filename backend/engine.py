"""
==========================================================
engine.py  --  The backtesting brain
==========================================================

WHAT THIS FILE DOES (in plain English)
--------------------------------------
It plays the strategy forward through history, day by day, and records what
would have happened to your money.

THE STRATEGY, IN ONE PARAGRAPH
------------------------------
"Relative-strength momentum" says: buy the stocks that are climbing FASTER
than the market, and keep only those. Every so often (the *rebalance*), we
measure how much each stock has risen over the last N days, compare that to
how much the index rose over the same N days, throw away everything that
failed to beat the index, and buy the strongest survivors. We hold them
until the next rebalance, then repeat.

THE FIVE STEPS AT EACH REBALANCE DATE
-------------------------------------
    1. MEASURE   ROC = (price today / price N days ago) - 1, for every stock
                 and for the benchmark index.
    2. FILTER    Keep only stocks whose ROC beat the benchmark's ROC.
    3. RANK      Sort the survivors strongest-first, keep the top X.
    4. WEIGHT    Split the money between them (equally, or in proportion to
                 their momentum). Any unfilled slot stays in cash.
    5. HOLD      Do nothing until the next rebalance date, then start again.

Everything below is that idea written out carefully, with trading costs.
"""

import numpy as np
import pandas as pd

# The EMA / Supertrend regime machinery lives in its own file next door.
from indicators import summarise_regime

# ----------------------------------------------------------------------
# CONSTANTS
# ----------------------------------------------------------------------

# The number of trading days in a typical year. Used to turn a daily
# volatility number into an annual one (the standard "square-root of time"
# scaling every risk report uses).
TRADING_DAYS_PER_YEAR = 252

# The rebalance rhythms the website offers.
VALID_CADENCES = ("days", "weekly", "biweekly", "monthly", "quarterly")

# The two ways of splitting money between the chosen stocks.
VALID_WEIGHTINGS = ("equal", "roc")


# ======================================================================
# SECTION 1 - WHEN DO WE REBALANCE?
# ======================================================================

def build_rebalance_dates(calendar, cadence, every_n_days, first_valid_position):
    """
    Work out the exact list of dates on which we re-pick the portfolio.

    `calendar`            - every trading day in the backtest, in order.
    `cadence`             - "days", "weekly", "biweekly", "monthly", "quarterly".
    `every_n_days`        - only used when cadence is "days".
    `first_valid_position`- the earliest day we are allowed to trade, because
                            before that we do not yet have enough history to
                            measure momentum.

    Returns a list of POSITIONS (0, 1, 2 ... row numbers into `calendar`)
    rather than dates, because positions make the maths later much simpler
    and completely avoid "what if that date was a holiday" bugs.
    """
    total_days = len(calendar)
    if first_valid_position >= total_days:
        raise ValueError(
            "There is not enough price history to measure momentum even once. "
            "Try a shorter lookback window, or load longer price files."
        )

    if cadence == "days":
        step = max(1, int(every_n_days))
        positions = list(range(first_valid_position, total_days, step))

    else:
        # For calendar rhythms we take the LAST trading day of each week /
        # fortnight / month / quarter. Using the last day means we always
        # trade on a day the market was actually open.
        frame = pd.DataFrame({"pos": np.arange(total_days)}, index=calendar)

        if cadence == "weekly" or cadence == "biweekly":
            group_key = calendar.to_period("W")
        elif cadence == "monthly":
            group_key = calendar.to_period("M")
        elif cadence == "quarterly":
            group_key = calendar.to_period("Q")
        else:
            raise ValueError(f"Unknown rebalance cadence: {cadence}")

        last_of_each_group = frame.groupby(group_key)["pos"].max().sort_values()
        positions = [int(p) for p in last_of_each_group if p >= first_valid_position]

        # "Bi-weekly" = every second week.
        if cadence == "biweekly":
            positions = positions[::2]

    # Always make sure the very first tradable day is included, otherwise a
    # monthly schedule could waste weeks sitting in cash at the start.
    if not positions or positions[0] != first_valid_position:
        positions = [first_valid_position] + [p for p in positions if p > first_valid_position]

    # The final rebalance must leave at least one day to hold something.
    positions = [p for p in positions if p < total_days - 1]
    if not positions:
        raise ValueError(
            "The chosen lookback leaves no room to trade. Load more history "
            "or shorten the lookback window."
        )

    return positions


# ======================================================================
# SECTION 2 - PICKING THE STOCKS ON ONE REBALANCE DAY
# ======================================================================

def select_holdings(prices, benchmark, position, lookback, top_n, weighting,
                    cash_buffer, min_roc):
    """
    Do steps 1-4 of the strategy for a SINGLE rebalance day.

    Returns a dictionary describing the decision:
        picks        -> list of {ticker, roc, weight}
        cash_weight  -> the share of money left sitting in cash (0.0 - 1.0)
        benchmark_roc-> the index's momentum on this day, for the log
    """
    today_prices = prices.iloc[position]
    past_prices = prices.iloc[position - lookback]

    # ---- STEP 1: MEASURE momentum ------------------------------------
    # Rate Of Change = how much the price grew over the lookback window.
    # A value of 0.18 means "up 18% over that window".
    with np.errstate(divide="ignore", invalid="ignore"):
        roc = (today_prices / past_prices) - 1.0

    # A stock is only tradable if we have a real price at BOTH ends of the
    # window (a company that listed last month has no 252-day history).
    tradable = today_prices.notna() & past_prices.notna() & (past_prices > 0) & (today_prices > 0)
    roc = roc[tradable]

    benchmark_roc = (benchmark.iloc[position] / benchmark.iloc[position - lookback]) - 1.0

    # ---- STEP 2: FILTER out anything weaker than the index -------------
    # This is the "relative strength" rule: beating the market is the entry
    # ticket. `min_roc` is an extra optional hurdle (e.g. "and it must also
    # be up at least 5% in absolute terms").
    hurdle = max(float(benchmark_roc), float(min_roc)) if min_roc is not None else float(benchmark_roc)
    survivors = roc[roc > hurdle]

    # ---- STEP 3: RANK strongest first and keep the top X --------------
    survivors = survivors.sort_values(ascending=False)
    chosen = survivors.head(int(top_n))

    n_chosen = len(chosen)
    if n_chosen == 0:
        # Nothing beat the index today - the strategy sits 100% in cash.
        return {"picks": [], "cash_weight": 1.0, "benchmark_roc": float(benchmark_roc)}

    # ---- STEP 4: WEIGHT the chosen stocks ------------------------------
    if weighting == "roc":
        # Momentum-proportional: the strongest stock gets the biggest slice.
        strength = chosen.clip(lower=0.0)
        if strength.sum() <= 0:
            raw_weights = pd.Series(1.0 / n_chosen, index=chosen.index)
        else:
            raw_weights = strength / strength.sum()
    else:
        # Equal weighting.
        if cash_buffer:
            # "Top X slots": each slot is worth 1/X. If only 3 of 10 stocks
            # qualified, we invest 30% and the other 70% stays in cash.
            raw_weights = pd.Series(1.0 / float(top_n), index=chosen.index)
        else:
            # Fully invested: split everything between whoever qualified.
            raw_weights = pd.Series(1.0 / n_chosen, index=chosen.index)

    if weighting == "roc" and cash_buffer:
        # Scale the momentum weights down so unfilled slots still hold cash.
        raw_weights = raw_weights * (n_chosen / float(top_n))

    invested = float(raw_weights.sum())
    cash_weight = max(0.0, 1.0 - invested)

    picks = [
        {"ticker": str(ticker), "roc": float(chosen[ticker]), "weight": float(raw_weights[ticker])}
        for ticker in chosen.index
    ]
    return {"picks": picks, "cash_weight": cash_weight, "benchmark_roc": float(benchmark_roc)}


# ======================================================================
# SECTION 3 - THE MAIN BACKTEST LOOP
# ======================================================================

def run_backtest(prices, benchmark, settings, regime=None):
    """
    Walk through history and build the portfolio's equity curve.

    `prices`    - wide table of daily closes (rows = dates, columns = tickers)
    `benchmark` - the index's daily closes on exactly the same dates
    `settings`  - a dictionary of the user's choices from the website
    `regime`    - OPTIONAL daily True/False series from indicators.py.
                  True means "Risk-ON, stay invested"; False means
                  "Risk-OFF, hold 100% cash today". Pass None to run the
                  strategy with no macro filter at all.

    Returns a big dictionary containing the equity curves, the metrics, the
    rebalance history and the per-trade log.
    """
    lookback = int(settings["lookback"])
    top_n = int(settings["top_n"])
    cadence = settings["cadence"]
    every_n_days = int(settings.get("every_n_days", 21))
    weighting = settings.get("weighting", "equal")
    cash_buffer = bool(settings.get("cash_buffer", True))
    cost_bps = float(settings.get("cost_bps", 0.0))
    start_capital = float(settings.get("start_capital", 100000.0))
    risk_free = float(settings.get("risk_free_rate", 0.0))
    min_roc = settings.get("min_roc", None)
    if min_roc is not None:
        min_roc = float(min_roc)

    calendar = prices.index
    # We can only measure momentum once we have `lookback` days of history
    # behind us, so the earliest tradable row is row number `lookback`.
    rebalance_positions = build_rebalance_dates(calendar, cadence, every_n_days, lookback)
    last_position = len(calendar) - 1

    # ------------------------------------------------------------------
    # THE REGIME MASK, AND WHY IT IS SHIFTED BY ONE DAY
    # ------------------------------------------------------------------
    # The filter reads the index's CLOSING price to decide Risk-ON or
    # Risk-OFF. You cannot act on a closing price until the market has
    # closed, so the earliest that decision can affect you is the NEXT day.
    #
    # Shifting by one day is what keeps this test honest. Without the shift
    # we would be selling on the morning of a crash using that evening's
    # information - a mistake called "lookahead bias" that makes any
    # strategy look brilliant and is completely impossible in real life.
    if regime is not None:
        # `fill_value=True` on the shift keeps the dtype as a clean boolean.
        # (Letting a NaN appear first would turn the column into `object`,
        # which pandas then warns about downcasting.)
        regime_daily = regime.reindex(calendar).ffill().fillna(True).infer_objects(copy=False).astype(bool)
        regime_exec = regime_daily.shift(1, fill_value=True).astype(bool)
    else:
        # No filter: we are invested every single day.
        regime_exec = pd.Series(True, index=calendar)

    regime_switch_costs = 0.0
    regime_switch_count = 0

    # ------------------------------------------------------------------
    # Containers we fill as we walk forward through time.
    # ------------------------------------------------------------------
    equity_dates = [calendar[rebalance_positions[0]]]
    equity_values = [start_capital]
    equity = start_capital

    rebalance_rows = []   # one row per rebalance period
    trade_rows = []       # one row per stock per period
    drifted_weights = pd.Series(dtype=float)  # what we held coming into today

    # `zip` pairs each rebalance day with the NEXT one, which is when we sell.
    # The final period is held all the way to the last day of data.
    period_edges = list(zip(rebalance_positions,
                            rebalance_positions[1:] + [last_position]))

    for period_number, (start_pos, end_pos) in enumerate(period_edges, start=1):
        rebalance_date = calendar[start_pos]

        # ---- Decide what to hold for this period ----------------------
        decision = select_holdings(
            prices, benchmark, start_pos, lookback, top_n,
            weighting, cash_buffer, min_roc,
        )
        picks = decision["picks"]
        cash_weight = decision["cash_weight"]
        benchmark_roc = decision["benchmark_roc"]

        target_weights = pd.Series(
            {p["ticker"]: p["weight"] for p in picks}, dtype=float
        )

        # ---- Charge the trading cost ----------------------------------
        # "Turnover" is how much of the portfolio we had to buy or sell to
        # get from yesterday's holdings to today's. Selling 40% of the book
        # and buying 40% of something else = 0.8 turnover. The cost is that
        # turnover multiplied by the fee you entered, in basis points
        # (1 bp = 0.01%). With the default 0 bps this line does nothing.
        all_tickers = target_weights.index.union(drifted_weights.index)
        turnover = float(
            (target_weights.reindex(all_tickers).fillna(0.0)
             - drifted_weights.reindex(all_tickers).fillna(0.0)).abs().sum()
        )

        # If the regime filter has us sitting in cash on this rebalance day,
        # no shares actually change hands, so there is nothing to pay for.
        # We still work out the target weights above, because we need to
        # know what to buy the moment the filter lets us back in.
        invested_at_rebalance = bool(regime_exec.loc[rebalance_date])
        if not invested_at_rebalance:
            turnover = 0.0

        cost_fraction = turnover * (cost_bps / 10000.0)
        cost_amount = equity * cost_fraction
        equity = equity * (1.0 - cost_fraction)

        # ---- Ride the market until the next rebalance -----------------
        # `window` holds every price from the rebalance day up to and
        # including the sell day.
        window = prices.iloc[start_pos:end_pos + 1]

        if picks:
            held = [p["ticker"] for p in picks]
            held_window = window[held]
            # "Growth" = how much 1 rupee/dollar in each stock became.
            # Row one is always 1.0 (we just bought at that price).
            growth = held_window.divide(held_window.iloc[0], axis=1)
            growth = growth.ffill().fillna(1.0)

            # Multiply each stock's growth by its share of the money, add it
            # all up, and add the cash we did not invest (cash earns 0%).
            weights_vector = target_weights.reindex(held).values
            portfolio_growth = (growth.values * weights_vector).sum(axis=1) + cash_weight
        else:
            # 100% cash: the portfolio simply does not move.
            portfolio_growth = np.ones(len(window))

        # ---- Overlay the Risk-ON / Risk-OFF filter --------------------
        # `portfolio_growth` above is what the book WOULD do if we held it
        # every day. Now we mute the days the filter says to be in cash.
        #
        # We do that on daily RETURNS rather than on the cumulative curve,
        # because a return of 0% is exactly what "sitting in cash" means,
        # and re-compounding the muted returns gives the filtered curve.
        window_dates = window.index

        # Turn the growth path into one return per day. Element k here is
        # the return earned ON window_dates[k + 1].
        daily_returns = (portfolio_growth[1:] / portfolio_growth[:-1]) - 1.0

        # Was the filter letting us hold shares on each of those days?
        invested_today = regime_exec.reindex(window_dates[1:]).fillna(True).to_numpy()

        # In cash the portfolio simply does not move: the return becomes 0.
        effective_returns = np.where(invested_today, daily_returns, 0.0)

        # Charge for getting out and back in. Every flip means selling the
        # whole book or rebuying it, so turnover is a full 1.0 each time.
        # Only periods that actually hold something can incur this.
        if picks and regime is not None:
            previous_state = bool(regime_exec.loc[window_dates[0]])
            for day_number, state in enumerate(invested_today):
                if bool(state) != previous_state:
                    regime_switch_count += 1
                    switch_cost = cost_bps / 10000.0
                    # Fold the cost straight into that day's return.
                    effective_returns[day_number] = (
                        (1.0 + effective_returns[day_number]) * (1.0 - switch_cost) - 1.0
                    )
                    regime_switch_costs += switch_cost
                    previous_state = bool(state)

        # Re-compound the muted returns back into a growth path that starts
        # at 1.0 on the rebalance date.
        filtered_growth = np.concatenate([[1.0], np.cumprod(1.0 + effective_returns)])

        # Record every day of this period on the equity curve. We skip the
        # first row because that date was already written by the previous
        # period (or by the starting value).
        period_values = equity * filtered_growth
        equity_dates.extend(list(window.index[1:]))
        equity_values.extend([float(v) for v in period_values[1:]])

        period_start_equity = equity
        equity = float(period_values[-1])
        period_return = (equity / period_start_equity) - 1.0 if period_start_equity else 0.0

        # ---- What are we left holding? (weights drift with prices) ----
        # If the filter had us in cash on the final day of the period, we
        # are holding nothing at all - so the next rebalance has to buy the
        # whole book from scratch and pay full turnover for it.
        ended_in_cash = not bool(regime_exec.loc[window_dates[-1]])

        if picks and not ended_in_cash:
            final_growth = growth.iloc[-1]
            grown_weights = target_weights.reindex(held) * final_growth
            total_grown = float(grown_weights.sum()) + cash_weight
            drifted_weights = grown_weights / total_grown if total_grown > 0 else grown_weights
        else:
            drifted_weights = pd.Series(dtype=float)

        # ---- Write the logs -------------------------------------------
        exit_date = calendar[end_pos]
        benchmark_period_return = float(
            (benchmark.iloc[end_pos] / benchmark.iloc[start_pos]) - 1.0
        )

        rebalance_rows.append({
            "period": period_number,
            "rebalance_date": rebalance_date.strftime("%Y-%m-%d"),
            "exit_date": exit_date.strftime("%Y-%m-%d"),
            "holding_days": int(end_pos - start_pos),
            "num_holdings": len(picks),
            "tickers": ", ".join(p["ticker"] for p in picks) if picks else "CASH",
            "weights": ", ".join(f"{p['weight'] * 100:.1f}%" for p in picks) if picks else "100.0%",
            "cash_weight": round(cash_weight, 6),
            "benchmark_roc": round(benchmark_roc, 6),
            "period_return": round(period_return, 6),
            "benchmark_period_return": round(benchmark_period_return, 6),
            "excess_return": round(period_return - benchmark_period_return, 6),
            "turnover": round(turnover, 6),
            "cost_paid": round(cost_amount, 2),
            "equity_start": round(period_start_equity, 2),
            "equity_end": round(equity, 2),
        })

        for pick in picks:
            ticker = pick["ticker"]
            entry_price = float(prices.iloc[start_pos][ticker])
            exit_price = float(prices.iloc[end_pos][ticker])
            stock_return = (exit_price / entry_price) - 1.0 if entry_price else 0.0
            trade_rows.append({
                "period": period_number,
                "rebalance_date": rebalance_date.strftime("%Y-%m-%d"),
                "exit_date": exit_date.strftime("%Y-%m-%d"),
                "ticker": ticker,
                "weight": round(pick["weight"], 6),
                "roc_at_entry": round(pick["roc"], 6),
                "benchmark_roc": round(benchmark_roc, 6),
                "relative_strength": round(pick["roc"] - benchmark_roc, 6),
                "entry_price": round(entry_price, 4),
                "exit_price": round(exit_price, 4),
                "trade_return": round(stock_return, 6),
                "contribution": round(stock_return * pick["weight"], 6),
            })

    # ------------------------------------------------------------------
    # Turn the recorded values into tidy pandas Series for the maths below.
    # ------------------------------------------------------------------
    equity_curve = pd.Series(equity_values, index=pd.DatetimeIndex(equity_dates))
    equity_curve = equity_curve[~equity_curve.index.duplicated(keep="last")].sort_index()

    # The benchmark is rebased so it starts at the same money as the
    # portfolio - that is the only fair way to compare two lines on a chart.
    benchmark_window = benchmark.loc[equity_curve.index]
    benchmark_curve = benchmark_window / float(benchmark_window.iloc[0]) * start_capital

    return {
        "equity_curve": equity_curve,
        "benchmark_curve": benchmark_curve,
        "rebalance_rows": rebalance_rows,
        "trade_rows": trade_rows,
        "risk_free": risk_free,
        "start_capital": start_capital,
        # The regime as it was actually TRADED (already shifted by a day),
        # trimmed to the days the strategy was really running.
        "regime_exec": regime_exec.loc[equity_curve.index],
        "regime_switch_count": regime_switch_count,
        "regime_switch_costs": regime_switch_costs,
    }


# ======================================================================
# SECTION 4 - THE PERFORMANCE MATHS
# ======================================================================

def drawdown_series(equity):
    """
    "Drawdown" answers: how far below its own best-ever level is the
    portfolio right now? It is always zero or negative.

        drawdown = (today's value / highest value so far) - 1

    A value of -0.25 means "we are 25% below the peak" - the number that
    tells you how painful the strategy was to actually live through.
    """
    running_peak = equity.cummax()
    return (equity / running_peak) - 1.0


def compute_metrics(equity, risk_free=0.0, period_returns=None):
    """
    Turn one equity curve into the standard set of performance statistics.

    Every number is explained in plain English in the comments below.
    """
    equity = equity.dropna()
    if len(equity) < 2:
        return {}

    daily_returns = equity.pct_change().dropna()

    start_value = float(equity.iloc[0])
    end_value = float(equity.iloc[-1])

    # -- Total Return: the whole journey, start to finish ---------------
    total_return = (end_value / start_value) - 1.0

    # -- CAGR: that same journey expressed as a steady yearly rate ------
    days_elapsed = (equity.index[-1] - equity.index[0]).days
    years = days_elapsed / 365.25 if days_elapsed > 0 else np.nan
    if years and years > 0 and start_value > 0 and end_value > 0:
        cagr = (end_value / start_value) ** (1.0 / years) - 1.0
    else:
        cagr = np.nan

    # -- Volatility: how bumpy the ride was, as a yearly percentage -----
    daily_vol = float(daily_returns.std())
    annual_vol = daily_vol * np.sqrt(TRADING_DAYS_PER_YEAR)

    # -- Sharpe Ratio: return earned per unit of bumpiness --------------
    # Above 1 is generally considered good, above 2 excellent.
    annual_return = float(daily_returns.mean()) * TRADING_DAYS_PER_YEAR
    sharpe = (annual_return - risk_free) / annual_vol if annual_vol > 0 else np.nan

    # -- Sortino Ratio: like Sharpe, but it only counts DOWNWARD moves --
    # Upside volatility is not a risk you want to be penalised for.
    downside = daily_returns[daily_returns < 0]
    downside_vol = float(downside.std()) * np.sqrt(TRADING_DAYS_PER_YEAR) if len(downside) > 1 else np.nan
    sortino = (annual_return - risk_free) / downside_vol if downside_vol and downside_vol > 0 else np.nan

    # -- Max Drawdown: the worst peak-to-trough fall in the whole test ---
    drawdown = drawdown_series(equity)
    max_drawdown = float(drawdown.min())
    trough_date = drawdown.idxmin()

    # -- Calmar Ratio: yearly return divided by that worst fall ---------
    calmar = (cagr / abs(max_drawdown)) if max_drawdown < 0 and not np.isnan(cagr) else np.nan

    # -- Win Rate: how often a holding period made money -----------------
    # If we have rebalance periods we use those (the meaningful unit of the
    # strategy); otherwise we fall back to counting winning days.
    if period_returns is not None and len(period_returns) > 0:
        wins = sum(1 for r in period_returns if r > 0)
        win_rate = wins / len(period_returns)
        best_period = max(period_returns)
        worst_period = min(period_returns)
    else:
        win_rate = float((daily_returns > 0).mean())
        best_period = float(daily_returns.max())
        worst_period = float(daily_returns.min())

    return {
        "total_return": _clean(total_return),
        "cagr": _clean(cagr),
        "annual_volatility": _clean(annual_vol),
        "sharpe": _clean(sharpe),
        "sortino": _clean(sortino),
        "max_drawdown": _clean(max_drawdown),
        "max_drawdown_date": trough_date.strftime("%Y-%m-%d") if pd.notna(trough_date) else None,
        "calmar": _clean(calmar),
        "win_rate": _clean(win_rate),
        "best_period": _clean(best_period),
        "worst_period": _clean(worst_period),
        "start_value": round(start_value, 2),
        "end_value": round(end_value, 2),
        "start_date": equity.index[0].strftime("%Y-%m-%d"),
        "end_date": equity.index[-1].strftime("%Y-%m-%d"),
        "years": _clean(years),
    }


def monthly_return_table(equity):
    """
    Build the calendar grid: one row per year, one column per month, plus a
    full-year total on the right. This is the classic "heatmap" every fund
    factsheet shows.
    """
    # Take the LAST equity value in each calendar month...
    month_end = equity.resample("ME").last()
    # ...and prepend the starting value so the very first month is measured
    # from the day the strategy began, not from the month before it.
    seed = pd.Series([float(equity.iloc[0])], index=[equity.index[0] - pd.Timedelta(days=1)])
    month_end = pd.concat([seed, month_end])
    monthly = month_end.pct_change().dropna()

    rows = {}
    for stamp, value in monthly.items():
        year = int(stamp.year)
        rows.setdefault(year, {})[int(stamp.month)] = _clean(float(value))

    table = []
    for year in sorted(rows):
        months = rows[year]
        # Compound the months together to get the year's total return.
        year_growth = 1.0
        for month_value in months.values():
            if month_value is not None:
                year_growth *= (1.0 + month_value)
        table.append({
            "year": year,
            "months": {str(m): months.get(m) for m in range(1, 13)},
            "year_total": _clean(year_growth - 1.0),
        })
    return table


def _clean(value):
    """
    JSON cannot carry NaN or Infinity, and pandas produces both. This turns
    any such value into `null` so the website never receives broken data.
    """
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if np.isnan(number) or np.isinf(number):
        return None
    return round(number, 8)


# ======================================================================
# SECTION 5 - THE ONE FUNCTION THE WEB SERVER CALLS
# ======================================================================

def analyse(prices, benchmark, settings, regime=None):
    """
    Run the whole thing and package the answer for the website:
    equity curves, drawdowns, metrics, monthly grid, and both log tables.

    `regime` is the optional daily Risk-ON/Risk-OFF mask from indicators.py.
    """
    result = run_backtest(prices, benchmark, settings, regime=regime)

    equity = result["equity_curve"]
    bench = result["benchmark_curve"]
    risk_free = result["risk_free"]

    period_returns = [row["period_return"] for row in result["rebalance_rows"]]
    benchmark_period_returns = [row["benchmark_period_return"] for row in result["rebalance_rows"]]

    portfolio_metrics = compute_metrics(equity, risk_free, period_returns)
    benchmark_metrics = compute_metrics(bench, risk_free, benchmark_period_returns)

    portfolio_dd = drawdown_series(equity)
    benchmark_dd = drawdown_series(bench)

    # The chart data: one entry per trading day with everything the front
    # end needs to draw both lines and both drawdown areas.
    curve = []
    for stamp in equity.index:
        curve.append({
            "date": stamp.strftime("%Y-%m-%d"),
            "portfolio": round(float(equity.loc[stamp]), 2),
            "benchmark": round(float(bench.loc[stamp]), 2),
            "portfolio_dd": round(float(portfolio_dd.loc[stamp]) * 100.0, 4),
            "benchmark_dd": round(float(benchmark_dd.loc[stamp]) * 100.0, 4),
        })

    # How much better (or worse) than simply buying the index?
    outperformance = None
    if portfolio_metrics.get("total_return") is not None and benchmark_metrics.get("total_return") is not None:
        outperformance = round(
            portfolio_metrics["total_return"] - benchmark_metrics["total_return"], 8
        )

    # How often were we sitting in cash instead of stocks?
    cash_periods = sum(1 for row in result["rebalance_rows"] if row["num_holdings"] == 0)
    average_holdings = (
        sum(row["num_holdings"] for row in result["rebalance_rows"]) / len(result["rebalance_rows"])
        if result["rebalance_rows"] else 0
    )

    return {
        "metrics": portfolio_metrics,
        "benchmark_metrics": benchmark_metrics,
        "outperformance": outperformance,
        "curve": curve,
        "monthly": monthly_return_table(equity),
        "rebalances": result["rebalance_rows"],
        "trades": result["trade_rows"],
        "summary": {
            "total_rebalances": len(result["rebalance_rows"]),
            "total_trades": len(result["trade_rows"]),
            "cash_periods": cash_periods,
            "average_holdings": round(average_holdings, 2),
            "total_costs": round(sum(row["cost_paid"] for row in result["rebalance_rows"]), 2),
            "start_capital": result["start_capital"],
            "regime_switches": result["regime_switch_count"],
        },
        # Kept in pandas form for compare_with_regime() below; the API layer
        # never sends these raw objects to the browser.
        "_equity": equity,
        "_benchmark": bench,
        "_regime_exec": result["regime_exec"],
    }


# ======================================================================
# SECTION 6 - FILTER ON vs FILTER OFF, SIDE BY SIDE
# ======================================================================

def compare_with_regime(prices, benchmark, settings, regime_frame):
    """
    Run the SAME momentum strategy twice - once with the macro filter and
    once without - and lay the two results side by side.

    This is the honest way to judge a filter. A filter that improves returns
    but only by being lucky once is not worth having; what you want to see
    is a smaller worst-case drawdown and a steadier ride, in exchange for
    giving up some of the upside.

    `regime_frame` is the table from indicators.build_regime().

    Returns a dictionary holding both full result sets plus a comparison
    block with the deltas already worked out.
    """
    # ---- The baseline: no filter at all, always invested ---------------
    unfiltered = analyse(prices, benchmark, settings, regime=None)

    # ---- The same strategy, with the macro filter applied --------------
    regime_series = regime_frame["regime"] if regime_frame is not None else None
    filtered = analyse(prices, benchmark, settings, regime=regime_series)

    # ---- Exposure: how much of the time were we actually invested? -----
    # We measure this on the regime as TRADED, over exactly the days the
    # strategy was live - not over the whole file - so the percentage
    # answers "while I was running this, how often did I hold shares?".
    traded_regime = filtered["_regime_exec"]
    exposure = summarise_regime(traded_regime)

    # ---- Build the comparison table ------------------------------------
    on_metrics = filtered["metrics"]
    off_metrics = unfiltered["metrics"]

    def delta(key, invert=False):
        """
        Difference between the filtered and unfiltered runs.

        `invert` is for metrics where LESS is better (drawdown). For those
        we report the improvement as a positive number, so a positive delta
        always reads as "the filter helped".
        """
        a, b = on_metrics.get(key), off_metrics.get(key)
        if a is None or b is None:
            return None
        return _clean((b - a) if invert else (a - b))

    comparison = {
        "total_return": {
            "off": off_metrics.get("total_return"),
            "on": on_metrics.get("total_return"),
            "delta": delta("total_return"),
        },
        "cagr": {
            "off": off_metrics.get("cagr"),
            "on": on_metrics.get("cagr"),
            "delta": delta("cagr"),
        },
        "max_drawdown": {
            "off": off_metrics.get("max_drawdown"),
            "on": on_metrics.get("max_drawdown"),
            # Drawdowns are negative, so "on minus off" being positive means
            # the filtered run fell LESS far. That is the improvement.
            "delta": delta("max_drawdown"),
        },
        "sharpe": {
            "off": off_metrics.get("sharpe"),
            "on": on_metrics.get("sharpe"),
            "delta": delta("sharpe"),
        },
        "sortino": {
            "off": off_metrics.get("sortino"),
            "on": on_metrics.get("sortino"),
            "delta": delta("sortino"),
        },
        "annual_volatility": {
            "off": off_metrics.get("annual_volatility"),
            "on": on_metrics.get("annual_volatility"),
            "delta": delta("annual_volatility"),
        },
        "win_rate": {
            "off": off_metrics.get("win_rate"),
            "on": on_metrics.get("win_rate"),
            "delta": delta("win_rate"),
        },
        # With no filter you are invested every single day, by definition.
        "time_in_market": {
            "off": 1.0,
            "on": _clean(exposure["time_in_market"]),
            "delta": _clean((exposure["time_in_market"] or 0) - 1.0),
        },
        "time_in_cash": {
            "off": 0.0,
            "on": _clean(exposure["time_in_cash"]),
            "delta": _clean(exposure["time_in_cash"]),
        },
        "regime_switches": {
            "off": 0,
            "on": exposure["switches"],
            "delta": None,  # a count, not a difference - nothing to compare
        },
    }

    # ---- One combined chart series: both curves plus the benchmark -----
    equity_on = filtered["_equity"]
    equity_off = unfiltered["_equity"]
    bench_curve = filtered["_benchmark"]

    dd_on = drawdown_series(equity_on)
    dd_off = drawdown_series(equity_off)

    shared_dates = equity_on.index.intersection(equity_off.index)
    curve = []
    for stamp in shared_dates:
        curve.append({
            "date": stamp.strftime("%Y-%m-%d"),
            "filter_on": round(float(equity_on.loc[stamp]), 2),
            "filter_off": round(float(equity_off.loc[stamp]), 2),
            "benchmark": round(float(bench_curve.loc[stamp]), 2),
            "dd_on": round(float(dd_on.loc[stamp]) * 100.0, 4),
            "dd_off": round(float(dd_off.loc[stamp]) * 100.0, 4),
            # 1 = Risk-ON (invested), 0 = Risk-OFF (cash). The timeline
            # strip under the chart reads this.
            "risk_on": int(bool(traded_regime.loc[stamp])),
        })

    # ---- The stretches of cash, as date ranges -------------------------
    # Far lighter to send than one row per day, and it is exactly what the
    # timeline strip and the "when was I out?" list need.
    periods = []
    if len(traded_regime):
        current_state = bool(traded_regime.iloc[0])
        block_start = traded_regime.index[0]
        for stamp, state in traded_regime.items():
            if bool(state) != current_state:
                periods.append({
                    "start": block_start.strftime("%Y-%m-%d"),
                    "end": stamp.strftime("%Y-%m-%d"),
                    "risk_on": current_state,
                })
                current_state = bool(state)
                block_start = stamp
        periods.append({
            "start": block_start.strftime("%Y-%m-%d"),
            "end": traded_regime.index[-1].strftime("%Y-%m-%d"),
            "risk_on": current_state,
        })

    # Strip the private pandas objects before this goes anywhere near JSON.
    for payload in (filtered, unfiltered):
        payload.pop("_equity", None)
        payload.pop("_benchmark", None)
        payload.pop("_regime_exec", None)

    return {
        "filtered": filtered,
        "unfiltered": unfiltered,
        "comparison": comparison,
        "exposure": {
            "time_in_market": _clean(exposure["time_in_market"]),
            "time_in_cash": _clean(exposure["time_in_cash"]),
            "switches": exposure["switches"],
            "days_in_market": exposure["days_in_market"],
            "days_in_cash": exposure["days_in_cash"],
            "total_days": exposure["total_days"],
        },
        "curve": curve,
        "regime_periods": periods,
        "max_drawdown_reduction": comparison["max_drawdown"]["delta"],
    }
