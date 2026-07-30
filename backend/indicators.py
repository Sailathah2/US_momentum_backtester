"""
==========================================================
indicators.py  --  EMA, ATR and Supertrend, from scratch
==========================================================

WHAT THIS FILE DOES (in plain English)
--------------------------------------
The momentum strategy picks WHICH stocks to buy. This file answers a
different, bigger question: *should we be in the market at all today?*

It builds two classic trend indicators on the benchmark index, and turns
them into a single yes/no answer we call the **regime**:

    Risk-ON   -> the index is in an uptrend, run the strategy normally
    Risk-OFF  -> the index is in a downtrend, sit in 100% cash

THE TWO INDICATORS
------------------
    EMA         An "Exponential Moving Average" - a smoothed average price
                that leans more heavily on recent days than old ones. If
                today's price is ABOVE it, the trend is up.

    SUPERTREND  A trailing stop line that sits below the price in an uptrend
                and above it in a downtrend. It widens and narrows with how
                violent the market is, using ATR (see below), so it does not
                get knocked out by ordinary daily noise.

Every formula below is written out step by step with its own comment.
"""

import numpy as np
import pandas as pd

# The regime filter modes the website offers.
VALID_REGIME_MODES = ("disabled", "ema", "supertrend", "both")


# ======================================================================
# SECTION 1 - EXPONENTIAL MOVING AVERAGE (EMA)
# ======================================================================

def exponential_moving_average(close, period):
    """
    The EMA is a running average that gives recent prices more weight.

    THE MATHS, ONE STEP AT A TIME
    -----------------------------
    Each day the EMA moves a fraction of the way from yesterday's EMA
    towards today's price. That fraction is called alpha:

        alpha = 2 / (period + 1)

    So for a 200-day EMA, alpha = 2/201 = about 0.00995, meaning each new
    day nudges the average by roughly 1% of the gap. The formula is:

        EMA_today = (Close_today * alpha) + (EMA_yesterday * (1 - alpha))

    A LONGER period = a SMOOTHER, SLOWER line that ignores small wobbles.
    A SHORTER period = a twitchier line that reacts fast but cries wolf.

    pandas does this for us with `.ewm(span=...)`, which uses exactly the
    alpha above. `adjust=False` makes it use the simple recursive formula
    written out here, which is what every charting platform draws.
    """
    period = max(1, int(period))
    return close.ewm(span=period, adjust=False).mean()


# ======================================================================
# SECTION 2 - AVERAGE TRUE RANGE (ATR)
# ======================================================================

def true_range(high, low, close):
    """
    "True Range" measures how far the price actually travelled in one day,
    INCLUDING any overnight gap. It is the largest of these three distances:

        1. today's high  -  today's low          (the normal daily span)
        2. |today's high -  yesterday's close|   (a gap UP overnight)
        3. |today's low  -  yesterday's close|   (a gap DOWN overnight)

    Why bother with the gaps? Because if a stock closes at 100 and opens at
    90 the next morning, the day's high-to-low range alone badly understates
    how much really moved.
    """
    previous_close = close.shift(1)

    span_today = high - low
    gap_up = (high - previous_close).abs()
    gap_down = (low - previous_close).abs()

    # Take the biggest of the three, column by column.
    return pd.concat([span_today, gap_up, gap_down], axis=1).max(axis=1)


def average_true_range(high, low, close, period=10):
    """
    ATR is simply a smoothed average of the True Range - a plain-English
    measure of "how much does this market typically move in a day?".

    We use **Wilder's smoothing**, the method the indicator's inventor
    (J. Welles Wilder) specified and the one every charting platform uses:

        ATR_today = ((ATR_yesterday * (period - 1)) + TrueRange_today) / period

    In pandas this is an exponential average with alpha = 1/period, which is
    what `.ewm(alpha=1/period)` gives us. Note this is NOT the same as
    `span=period`; using the wrong one makes a Supertrend that disagrees
    with TradingView, which is a classic and very confusing bug.
    """
    period = max(1, int(period))
    tr = true_range(high, low, close)
    return tr.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()


# ======================================================================
# SECTION 3 - SUPERTREND
# ======================================================================

def supertrend(high, low, close, period=10, multiplier=3.0):
    """
    Supertrend draws ONE line that flips from below the price to above it.

    THE MATHS, ONE STEP AT A TIME
    -----------------------------
    Step 1. Find the middle of each day's range:

                hl2 = (High + Low) / 2

    Step 2. Put a band above and below it, `multiplier` ATRs wide. Because
            ATR grows in wild markets, the bands automatically widen when
            the market is choppy - that is what stops us being shaken out:

                basic_upper = hl2 + (multiplier * ATR)
                basic_lower = hl2 - (multiplier * ATR)

    Step 3. Make the bands "ratchet". A trailing stop should only ever move
            in your favour, never against you. So the upper band may only
            move DOWN (and the lower band only UP) while the trend holds.
            It is allowed to reset only when price closes through it:

                final_upper = min(basic_upper, previous final_upper)
                              ...unless yesterday closed above it
                final_lower = max(basic_lower, previous final_lower)
                              ...unless yesterday closed below it

    Step 4. Decide which band is today's Supertrend line. We are bullish
            while price stays above the lower band; the moment price closes
            below it, we flip to bearish and the line jumps to the upper
            band (and vice-versa).

    WHY THIS PART USES A LOOP
    -------------------------
    Steps 3 and 4 are genuinely sequential: today's answer depends on
    yesterday's answer, which depends on the day before. That cannot be
    vectorised away. It is cheap here because we only ever run it on ONE
    series - the benchmark index - not on hundreds of stocks.

    Returns a DataFrame with two columns:
        line     -> the Supertrend price level for that day
        bullish  -> True when the line sits BELOW price (uptrend)
    """
    period = max(1, int(period))
    multiplier = float(multiplier)

    atr = average_true_range(high, low, close, period)

    # Step 1 & 2: the raw bands.
    hl2 = (high + low) / 2.0
    basic_upper = hl2 + (multiplier * atr)
    basic_lower = hl2 - (multiplier * atr)

    # Pull everything into plain numpy arrays: the loop below is much faster
    # and much easier to read that way.
    close_values = close.to_numpy(dtype=float)
    upper_values = basic_upper.to_numpy(dtype=float)
    lower_values = basic_lower.to_numpy(dtype=float)

    total = len(close_values)
    final_upper = np.full(total, np.nan)
    final_lower = np.full(total, np.nan)
    line = np.full(total, np.nan)
    bullish = np.zeros(total, dtype=bool)

    # ATR needs `period` days before it produces a number, so the indicator
    # cannot start before then.
    first = int(np.argmax(~np.isnan(upper_values))) if np.any(~np.isnan(upper_values)) else total
    if first >= total:
        # Not enough history for a Supertrend at all.
        return pd.DataFrame({"line": line, "bullish": bullish}, index=close.index)

    # Seed the very first day: assume an uptrend and put the line below price.
    final_upper[first] = upper_values[first]
    final_lower[first] = lower_values[first]
    line[first] = lower_values[first]
    bullish[first] = True

    for i in range(first + 1, total):
        # -- Step 3: ratchet the bands ---------------------------------
        # The upper band tightens downward, unless price broke above it
        # yesterday, in which case it is allowed to reset wider.
        if upper_values[i] < final_upper[i - 1] or close_values[i - 1] > final_upper[i - 1]:
            final_upper[i] = upper_values[i]
        else:
            final_upper[i] = final_upper[i - 1]

        # The lower band tightens upward, unless price broke below it.
        if lower_values[i] > final_lower[i - 1] or close_values[i - 1] < final_lower[i - 1]:
            final_lower[i] = lower_values[i]
        else:
            final_lower[i] = final_lower[i - 1]

        # -- Step 4: which band are we following today? ------------------
        was_bullish = bullish[i - 1]

        if was_bullish:
            # We were in an uptrend, following the LOWER band as a stop.
            # Closing below it ends the uptrend.
            if close_values[i] < final_lower[i]:
                bullish[i] = False
                line[i] = final_upper[i]
            else:
                bullish[i] = True
                line[i] = final_lower[i]
        else:
            # We were in a downtrend, following the UPPER band.
            # Closing above it starts a new uptrend.
            if close_values[i] > final_upper[i]:
                bullish[i] = True
                line[i] = final_lower[i]
            else:
                bullish[i] = False
                line[i] = final_upper[i]

    return pd.DataFrame({"line": line, "bullish": bullish}, index=close.index)


# ======================================================================
# SECTION 4 - THE REGIME STATE MACHINE
# ======================================================================

def build_regime(index_frame, mode="both", ema_period=200,
                 atr_period=10, multiplier=3.0):
    """
    Turn the index's price history into a daily Risk-ON / Risk-OFF answer.

    `index_frame` is the benchmark's table, with a Close column and ideally
    High and Low too. `mode` is one of: disabled, ema, supertrend, both.

    THE THREE MODES
    ---------------
    "ema"        Risk-ON while  Close > EMA.
    "supertrend" Risk-ON while  Close > Supertrend line (the line is bullish).
    "both"       Needs BOTH to agree before it will change its mind - see
                 the hysteresis explanation below.

    WHAT "HYSTERESIS" MEANS, AND WHY IT MATTERS
    -------------------------------------------
    A filter that flips the instant any single indicator wobbles will sell
    you out of the market and buy you back in over and over, bleeding money
    on costs every time. That churn is called "whipsaw".

    So in "both" mode we make the filter STUBBORN. It only changes state
    when the two indicators AGREE:

        Currently Risk-ON  -> go OFF only if Close < EMA *and* Close < Supertrend
        Currently Risk-OFF -> go ON  only if Close > EMA *and* Close > Supertrend
        Anything else      -> keep whatever state we are already in

    So if price dips under the EMA but Supertrend is still bullish, we stay
    invested. One indicator alone is never enough to move us.

    Returns a DataFrame indexed by date with these columns:
        close, ema, st_line, ema_bullish, st_bullish, regime
    where `regime` is True for Risk-ON.
    """
    if mode not in VALID_REGIME_MODES:
        raise ValueError(f"Unknown regime mode '{mode}'.")

    close = index_frame["Close"].astype(float)

    # Some index CSVs carry only a close price (no high/low columns). In that
    # case we use the close for all three. The Supertrend still works - its
    # bands just become a little narrower, because a day's high-to-low range
    # is treated as zero and only the day-to-day gaps register.
    if "High" in index_frame.columns and index_frame["High"].notna().any():
        high = index_frame["High"].astype(float).fillna(close)
    else:
        high = close
    if "Low" in index_frame.columns and index_frame["Low"].notna().any():
        low = index_frame["Low"].astype(float).fillna(close)
    else:
        low = close

    result = pd.DataFrame(index=close.index)
    result["close"] = close

    # ---- The "off" switch -----------------------------------------------
    if mode == "disabled":
        result["ema"] = np.nan
        result["st_line"] = np.nan
        result["ema_bullish"] = True
        result["st_bullish"] = True
        result["regime"] = True  # always invested
        return result

    # ---- Work out each indicator's own opinion --------------------------
    ema_line = exponential_moving_average(close, ema_period)
    result["ema"] = ema_line
    result["ema_bullish"] = close > ema_line

    st = supertrend(high, low, close, atr_period, multiplier)
    result["st_line"] = st["line"]
    result["st_bullish"] = st["bullish"]

    # ---- Combine those opinions into one regime -------------------------
    if mode == "ema":
        # A single indicator needs no state machine: today's answer depends
        # only on today's prices.
        result["regime"] = result["ema_bullish"]

    elif mode == "supertrend":
        result["regime"] = result["st_bullish"]

    else:
        # "both" - the stubborn, hysteresis version. This one genuinely has
        # to walk forward day by day, because today's state depends on what
        # state we were in yesterday.
        ema_ok = result["ema_bullish"].to_numpy()
        st_ok = result["st_bullish"].to_numpy()

        # We cannot judge anything until both indicators have warmed up.
        ready = (~ema_line.isna()).to_numpy() & (~st["line"].isna()).to_numpy()

        total = len(close)
        state = np.zeros(total, dtype=bool)

        # Where do we start? If both indicators agree on day one, use that.
        # If they disagree, we begin INVESTED - the filter's job is to pull
        # us out of the market on confirmed weakness, not to keep us on the
        # sidelines waiting for permission that may never come.
        current = True
        for i in range(total):
            if not ready[i]:
                # Indicators still warming up: stay invested so the filtered
                # run and the unfiltered run start from the same place.
                state[i] = True
                continue

            both_bullish = ema_ok[i] and st_ok[i]
            both_bearish = (not ema_ok[i]) and (not st_ok[i])

            if both_bullish:
                current = True          # confirmed uptrend  -> Risk-ON
            elif both_bearish:
                current = False         # confirmed downtrend -> Risk-OFF
            # else: the two disagree, so we RETAIN whatever we had. This
            # single missing `else` is the whole anti-whipsaw rule.

            state[i] = current

        result["regime"] = state

    # A day with no indicator value yet counts as invested, so that the
    # filtered and unfiltered backtests begin identically.
    result["regime"] = result["regime"].fillna(True).astype(bool)
    return result


def summarise_regime(regime_series):
    """
    Turn the daily True/False regime into the headline exposure numbers the
    dashboard shows.

        Time in Market  - the share of days we were actually invested
        Time in Cash    - the rest
        Switches        - how many times the filter changed its mind
    """
    values = regime_series.astype(bool)
    total_days = int(len(values))
    if total_days == 0:
        return {
            "time_in_market": None,
            "time_in_cash": None,
            "switches": 0,
            "total_days": 0,
            "days_in_market": 0,
            "days_in_cash": 0,
        }

    days_in_market = int(values.sum())
    # A "switch" is any day whose state differs from the day before.
    switches = int((values != values.shift(1)).iloc[1:].sum())

    return {
        "time_in_market": days_in_market / total_days,
        "time_in_cash": (total_days - days_in_market) / total_days,
        "switches": switches,
        "total_days": total_days,
        "days_in_market": days_in_market,
        "days_in_cash": total_days - days_in_market,
    }
