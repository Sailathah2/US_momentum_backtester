# Running this strategy live — an operations guide

Everything here is about **mechanics**: when to compute signals, when to send
orders, what the backtest quietly assumes that reality does not, and what to add
before any money is at risk.

Every figure below was measured on your own five-year dataset (748 symbols,
2021-07 to 2026-07) using the configuration in `SOP.md`. Where a number is an
estimate rather than a measurement, it says so.

> **What this is not.** This is engineering and operations guidance for a system
> you built. It is not investment advice, and I am not a licensed adviser. Nothing
> here is a recommendation to trade, or a judgement about whether this strategy
> suits your circumstances. A backtest is a hypothesis about the past.

---

## 1. The timing model

The single most important thing to get right, and the easiest to get wrong.

### How the backtest does it

```
Day T, 16:00   market closes
               -> ROC, EMA, volatility and the regime are all computed from
                  Day T's CLOSING prices
               -> the engine assumes you BUY AT THAT SAME CLOSE
Day T+1        the position is live
```

The engine already shifts the **regime** signal by one day, so it never trades on
information it could not have had. But stock selection still assumes execution *at
the closing price of the day the signal fired.* That is the gap you have to close
in real life, because by the time you have that close, the market is shut.

### The three ways to close that gap

| Approach | How | Measured cost on your data |
|---|---|---|
| **Market-on-close (MOC)** | Send MOC orders before the cut-off (15:50 ET on most US venues) using signals from the *previous* close | Closest to the backtest. You take the official close, the same price the model assumes. |
| **Next open** | Compute after the close, buy at tomorrow's open | **−0.14% per trade on average** (median −0.07%), but std **2.58%**, and 20% of entries gap more than 2% |
| **Next close** | Compute after the close, buy at tomorrow's close | **+0.02% per trade on average** — statistically indistinguishable from free |

The mean gap cost looks trivial. It is not the mean that hurts — it is the
**2.58% standard deviation**. Worst observed gap on an entry date was **−21%**,
best **+23%**. Over 120 entries a year that variance swamps the edge you are
trying to harvest.

**The practical read:** MOC is the closest match to the model. If your broker
cannot do MOC, next-*close* execution is far better behaved than next-*open*,
because the overnight gap is where the violence lives. Buying the open on
momentum names means competing with everyone else's overnight news.

### Recommended live cycle (monthly cadence)

```
Rebalance day    16:00   market closes
    (evening)    16:30   download today's data, run the portal
                 17:00   review the picks, sanity-check them
Next morning     09:30   market opens
                 15:50   send MOC orders for the full switch
                 16:00   fills at the official close
```

That is a **one-day lag versus the backtest**, which the numbers above say costs
roughly nothing on average. Do not try to beat it by trading intraday on the
signal day — you would be using prices that had not happened yet when the model
made its decision.

---

## 2. When to rebalance

### Cadence

Monthly is what the sweep favoured, and it is also the only cadence that is
practical by hand. Weekly quadruples the order count for no measured improvement.

### Which day

The engine uses the **last trading day of each month**. Keep it. Two reasons:

- It is unambiguous — no drift, no "was that the 30th or the 31st?"
- Month-end has the deepest liquidity of the month, because index funds and
  everyone else are rebalancing too

The cost is that you are trading alongside the crowd. If fills look poor, moving
to the *first* trading day of the month is a defensible variant — but **backtest
it first**, do not assume it is equivalent.

### Which time

Only two defensible choices: **MOC on the day after the signal**, or **at the
open** if your broker forces it. Never "sometime during the day when I get
around to it" — discretionary timing quietly adds a random variable you cannot
measure or attribute later.

### What to do if you miss a rebalance

**Execute it late, same day you notice.** Do not skip to the next month.

This matters more for this strategy than most, because the returns are extremely
concentrated: **the top 10 of 510 trades produced 49% of all contribution.**
Removing the single best trade (`RGTI`, +400% in one month) drops the raw book
return from 1,489% to 1,084%. Skipping one rebalance is a real chance of missing
the trade that makes the year.

---

## 3. Regime filter operations

The filter runs on a **different clock** from the rebalance. This trips people up.

| | Stock selection | Regime filter |
|---|---|---|
| Checked | Monthly, at rebalance | **Every trading day** |
| Decides | *Which* stocks | *Whether to hold anything at all* |
| Acts | On the rebalance date | Any day it flips |

On your data, **zero** of the 18 regime switches landed on a rebalance date. The
filter will pull you out mid-month, and if you only look at the portal monthly you
will miss it.

### The daily check (two minutes)

After the close, each trading day:

1. Update the index file the filter watches
2. Run the portal (or a small script) and read today's regime state
3. If it **changed**, act at tomorrow's close — same one-day lag as everything else

If you cannot commit to a daily check, use the **weekly** timeframe. On weekly
candles the state can only change on the week's last trading day, so a Friday
evening check is sufficient. That is a legitimate reason to accept a slower filter.

### Exiting to Risk-OFF

Signal fires on today's close → sell at **tomorrow's close** (MOC). Move the
configured percentage out of equities and into your chosen destination.

Do not partially execute or "wait to see if it recovers". The filter's only value
is that it is mechanical; overriding it on the days it feels wrong removes exactly
the discipline you installed it for.

### Re-entering Risk-ON

Same mechanics in reverse — but be aware of what you are re-entering *into*. You
buy back the **current** month's picks at current prices, not the ones you sold.
The portal already models this.

### The uncomfortable truth about your filter

Measured on your data: across 9 Risk-OFF stretches, **the market rose in 7 of
them.** The filter mostly sat out rallies, not crashes. And the worst drawdown
happened while the filter was fully invested, which is why parking in gold made no
difference to it.

That is not an argument against having a filter. It is an argument for checking
whether *yours* has ever actually caught a decline, before you trust it to.

---

## 4. What the backtest assumes that live trading breaks

Each of these is measured, not hypothetical.

### Friction is larger than modelled

Turnover is **1.64 per rebalance ≈ 1,970% a year**. Friction scales directly:

| Cost assumption | Annual drag on capital |
|---|---|
| 10 bps (what you ran) | **1.97%** |
| 30 bps (realistic for small caps) | **5.91%** |
| 50 bps (thin names, larger size) | **9.85%** |

Re-run your configuration at 30 bps before believing any headline number. If the
edge does not survive, it was never an edge — it was a costing assumption.

### The universe is survivor-biased

All 748 symbols still trade on the final date. **Zero delistings.** Every company
that failed between 2021 and 2026 is absent. A momentum strategy buying volatile
small-caps is exactly the strategy that would have owned some of them.

Live, you get the failures. There is no way to correct for this after the fact —
only to know your live results will be worse than the backtest, and to size for
that.

### There is no liquidity screen

The strategy will happily pick anything. On your data, 2% of picks traded under
$1M/day, and the thinnest was **REGCO at $39,524/day**.

| Position limit | Book capacity (10 names, 10th-percentile liquidity) |
|---|---|
| 1% of ADV | ~$2.2M |
| 5% of ADV | ~$11.0M |

At 1% of ADV the thinnest single name in the whole sample caps a position at
about **$400**. **Add a minimum-ADV filter before trading this live** — it is the
most important missing piece.

### Returns depend on a handful of trades

Top 10 of 510 trades = 49% of contribution. Period returns are strongly
right-skewed (mean +6.3%, median +3.9%). You will have long stretches that feel
broken while you wait for the few that pay.

This has a direct operational consequence: **you cannot cherry-pick.** Skipping
the picks that look uncomfortable is precisely how you miss the +400% one.

### Other silent assumptions

| Assumption | Reality |
|---|---|
| Fills at the exact close | Partial fills, price improvement, rejections |
| No market impact | Your own order moves thin names |
| Price-only returns | Dividends add, taxes subtract |
| Gaps forward-filled | Understates the volatility of illiquid names |
| Infinitely divisible shares | Whole shares, so weights are approximate |
| No corporate actions | Splits, mergers and halts all need handling |

---

## 5. Before you risk money — the additions that matter

In rough priority order:

1. **A minimum liquidity filter.** Exclude anything under, say, $5M median dollar
   volume over 60 days. This is the biggest gap between the model and a tradable
   strategy.
2. **A price floor.** Sub-$5 stocks have wide spreads that no bps assumption
   captures.
3. **Position-size caps as a share of ADV.** Never more than 1–5% of a name's
   daily volume.
4. **Re-run at 30 bps.** If the strategy dies, better to learn it now.
5. **Paper-trade one full quarter.** Log every intended trade and every actual
   fill, then compare. That difference *is* your true slippage — far more
   trustworthy than any assumption.
6. **A survivorship-aware dataset**, if you can get one. Otherwise discount the
   backtest deliberately and explicitly.

---

## 6. Tools and methodology

### Data

You already have the pipeline: the day_3 US Stock Data Downloader feeds this
portal. What to add for live use:

- **A fixed daily download time** (e.g. 17:00 ET), so signals always come from
  complete data
- **A staleness check** — refuse to trade if the latest bar is not today's
- **Corporate-action handling** — a split not adjusted for produces a fake ±50%
  ROC and an instant fake "top pick". This is the most likely source of a
  catastrophic bad trade

### Execution

| Tool | Use |
|---|---|
| Broker with MOC orders | Closest match to the model |
| Broker API (IBKR, Alpaca, Zerodha Kite) | Removes manual entry errors at 10 names a month |
| Limit orders with a band | Protects against a bad print; risks non-fills |
| **Avoid** market orders at the open | Worst of both — the 2.58% gap variance measured above |

Start manual. Ten trades a month is entirely manageable by hand, and you will
learn more about the strategy's real behaviour in the first quarter by doing it
yourself than any amount of automation will teach you.

### Record keeping

Log, for every order: intended price (the model's), actual fill, timestamp,
commission, and why. This gives you:

- Real slippage, replacing the bps guess
- Attribution when live diverges from backtest
- The discipline of writing down every override you make

### Review cadence

| When | What |
|---|---|
| Daily (2 min) | Regime state; did it flip? |
| Monthly (30 min) | Execute the rebalance; log fills vs intended |
| Quarterly (2 hrs) | Live vs backtest divergence; realised slippage vs assumed |
| Annually | Re-run the parameter sweep on fresh data; has the structure held? |

---

## 7. Failure modes and circuit breakers

Decide these **now**, in writing, while nothing is going wrong.

| Trigger | Suggested response |
|---|---|
| Drawdown exceeds the backtest's worst (−25% to −47% depending on config) | Stop and investigate. Do not add capital. |
| Realised slippage exceeds 3× assumed | Halt; your cost model is wrong |
| Three consecutive months where live badly trails the model on the same picks | Execution problem, not a strategy problem — find it |
| A single position moves more than ±50% overnight | Check for a corporate action before believing it |
| Data feed stale or download failed | Do not trade. A missed rebalance beats one on bad data. |
| Regime filter flips more than twice in a month | Your parameters are too twitchy for current conditions |

### The override rule

Write down, in advance, the conditions under which you are allowed to deviate from
the model — then treat everything else as non-negotiable. The strategy's edge
comes from mechanically holding names that feel wrong. If you only take the
comfortable picks you are running a different strategy, and one you have not
tested.

---

## 8. Capacity

Rough, from the measured liquidity above:

| Book size | Verdict |
|---|---|
| Under $250k | Comfortable; liquidity is not a constraint |
| $250k – $2M | Workable with a minimum-ADV filter |
| $2M – $10M | Needs a hard ADV cap and probably more than 10 names |
| Over $10M | The small-cap universe cannot absorb this at 1,970% turnover |

Turnover is what binds. At ~2,000% a year you are recycling the entire book
twenty times over, and every one of those cycles has to find liquidity.

---

## Summary — the five things that matter most

1. **Trade at the close the day after the signal.** MOC if you can. Never the open.
2. **Check the regime daily**, not monthly — zero of your 18 switches fell on a
   rebalance date.
3. **Add a liquidity filter** before anything else. It is the biggest gap between
   this model and a tradable strategy.
4. **Re-run at 30 bps.** At 1,970% turnover, costs are the dominant term.
5. **Never skip a rebalance and never cherry-pick.** Half the return came from ten
   trades out of five hundred.
