"""
==========================================================
data_loader.py  --  The "CSV translator"
==========================================================

WHAT THIS FILE DOES (in plain English)
--------------------------------------
Every website and broker exports price data in a slightly different shape.
One file says `Date, Open, High, Low, Close, Volume, Ticker`.
Another says `datetime, symbol, security_id, open, high, low, close, volume, oi`.
An index file might only say `time, open, high, low, close`.

This file is the translator. You hand it ANY of those files and it hands back
one tidy table that always looks the same:

        Date (a real calendar date)  |  Open  High  Low  Close  Volume
        ---------------------------------------------------------------
        2024-01-02                   |  187.1 188.4 186.0 187.9  54,000,000

Nothing else in the project has to worry about messy files ever again.

THE FOUR JOBS
-------------
    1. READ    - open a CSV whether it came from disk or from a web upload.
    2. MAP     - rename whatever the columns are called into our standard names.
    3. PARSE   - turn text like "02/03/2024" into a real date, correctly.
    4. ALIGN   - line up many stocks + the benchmark onto one shared calendar.
"""

import io
import os
import re

import numpy as np
import pandas as pd

# ----------------------------------------------------------------------
# SETTINGS YOU MAY WANT TO CHANGE
# ----------------------------------------------------------------------

# If a file name contains any of these words, we GUESS it is the benchmark
# (the index you measure everything against). The user can always override
# this choice from the website, so a wrong guess is harmless.
BENCHMARK_NAME_HINTS = (
    "nifty",
    "spy",
    "spx",
    "qqq",
    "index",
    "benchmark",
    "sensex",
    "banknifty",
    "dji",
    "ndx",
    "russell",
    "iwm",
    "vti",
)

# Every spelling of a "date" column we have ever seen, in lower case.
DATE_COLUMN_ALIASES = (
    "date",
    "datetime",
    "time",
    "timestamp",
    "date_time",
    "trade_date",
    "tradingday",
    "day",
)

# Every spelling of the price / volume / symbol columns, in lower case.
# The KEY is our standard name; the VALUES are the aliases we accept.
COLUMN_ALIASES = {
    "Open": ("open", "o", "open_price", "openprice"),
    "High": ("high", "h", "high_price", "highprice"),
    "Low": ("low", "l", "low_price", "lowprice"),
    "Close": ("close", "c", "close_price", "closeprice", "last", "ltp", "price"),
    "AdjClose": ("adj close", "adj_close", "adjclose", "adjusted close", "adjusted_close"),
    "Volume": ("volume", "vol", "v", "qty", "quantity", "totaltradedquantity"),
    "Ticker": ("ticker", "symbol", "tickersymbol", "scrip", "name", "instrument", "tradingsymbol"),
}

# Date formats we try one by one before falling back to pandas' own guesswork.
EXPLICIT_DATE_FORMATS = (
    "%Y-%m-%d",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y/%m/%d",
    "%d-%m-%Y",
    "%d/%m/%Y",
    "%m/%d/%Y",
    "%d-%b-%Y",
    "%d %b %Y",
    "%Y%m%d",
)


# ======================================================================
# SECTION 1 - SMALL HELPERS
# ======================================================================

def _clean_header(name):
    """
    Turn a raw column header into a simple, comparable word.

    "  Adj Close " -> "adj close"
    "CLOSE_PRICE"  -> "close_price"

    We only lower-case it and trim the spaces at the ends; we deliberately
    keep inner spaces/underscores so that "adj close" and "close" stay
    different from each other.
    """
    return str(name).strip().lower()


def looks_like_benchmark(filename):
    """
    Guess from a FILE NAME alone whether this file is an index/benchmark.

    Returns True/False. Used only to pre-select a sensible default in the
    dropdown on the website - the user always has the final say.
    """
    stem = os.path.basename(str(filename)).lower()
    return any(hint in stem for hint in BENCHMARK_NAME_HINTS)


def ticker_from_filename(filename):
    """
    Work out a ticker symbol from a file name when the file itself has no
    Ticker/symbol column.

        "AAPL.csv"              -> "AAPL"
        "data/INDEX_GSPC.csv"   -> "INDEX_GSPC"
        "reliance_daily.csv"    -> "RELIANCE_DAILY"
    """
    stem = os.path.splitext(os.path.basename(str(filename)))[0]
    # Strip characters that are never part of a symbol.
    stem = re.sub(r"[^A-Za-z0-9_.\-^]", "_", stem).strip("_")
    return stem.upper() if stem else "UNKNOWN"


# ======================================================================
# SECTION 2 - THE FLEXIBLE DATE PARSER
# ======================================================================

def parse_dates_flexibly(raw_series):
    """
    Turn a column of date TEXT into real dates, coping with several formats.

    THE TRICKY BIT: "03/04/2024" is ambiguous. It means 3rd April in Europe
    and India (day first) but 4th March in America (month first). Guessing
    wrong silently corrupts an entire backtest, so we decide carefully:

        Step 1. Try each known format exactly. If one format parses (almost)
                every row, we trust it and stop. This catches ISO dates
                like 2024-01-02 immediately.
        Step 2. Otherwise, parse the column BOTH ways (day-first and
                month-first) and keep whichever produced fewer failures.
        Step 3. If both ways succeed equally, look for a value where the
                first number is bigger than 12 (e.g. "25/12/2024"). Such a
                value can ONLY be day-first, so it settles the argument.

    Returns a pandas Series of timestamps (NaT where a row was unreadable).
    """
    values = raw_series.copy()

    # If the file was already parsed into dates (or is numeric epoch time),
    # pandas handles it directly - no detective work needed.
    if pd.api.types.is_datetime64_any_dtype(values):
        return pd.to_datetime(values, errors="coerce")

    text = values.astype(str).str.strip()
    # Treat obvious blanks as missing rather than letting them become junk.
    text = text.replace({"": np.nan, "nan": np.nan, "NaT": np.nan, "None": np.nan})
    non_empty = int(text.notna().sum())
    if non_empty == 0:
        return pd.to_datetime(pd.Series([pd.NaT] * len(values), index=values.index))

    # --- Step 1: try each exact format ---------------------------------
    for fmt in EXPLICIT_DATE_FORMATS:
        attempt = pd.to_datetime(text, format=fmt, errors="coerce")
        # "Good enough" = at least 98% of the non-blank rows parsed.
        if attempt.notna().sum() >= non_empty * 0.98:
            return attempt

    # --- Step 2: parse it both ways and compare -------------------------
    day_first = pd.to_datetime(text, errors="coerce", dayfirst=True)
    month_first = pd.to_datetime(text, errors="coerce", dayfirst=False)
    day_ok = int(day_first.notna().sum())
    month_ok = int(month_first.notna().sum())

    if day_ok > month_ok:
        return day_first
    if month_ok > day_ok:
        return month_first

    # --- Step 3: both work equally - look for a day number above 12 -----
    # "25/12/2024" proves the file is day-first, because there is no 25th month.
    first_numbers = text.str.extract(r"^\s*(\d{1,2})[/\-.]", expand=False)
    first_numbers = pd.to_numeric(first_numbers, errors="coerce")
    if (first_numbers > 12).any():
        return day_first

    # Truly ambiguous: default to month-first, which matches US data sources
    # such as the US Stock Data Downloader this portal is built for.
    return month_first


# ======================================================================
# SECTION 3 - THE COLUMN MAPPER
# ======================================================================

def map_columns(frame):
    """
    Rename a raw table's columns into our standard names.

    Given a table whose headers are, say, `datetime, symbol, open, close`,
    this returns a NEW table whose headers are `Date, Ticker, Open, Close`.
    Columns we do not recognise (like `security_id` or `oi`) are simply
    dropped - the backtest never needs them.
    """
    # A lookup of "cleaned header" -> "original header", so we can find the
    # real column no matter how it was capitalised or padded.
    available = {_clean_header(col): col for col in frame.columns}
    renames = {}

    # -- Find the date column first (it is the only truly required one) --
    for alias in DATE_COLUMN_ALIASES:
        if alias in available:
            renames[available[alias]] = "Date"
            break

    # -- Then every price / volume / symbol column ----------------------
    for standard_name, aliases in COLUMN_ALIASES.items():
        if standard_name in renames.values():
            continue
        for alias in aliases:
            if alias in available and available[alias] not in renames:
                renames[available[alias]] = standard_name
                break

    mapped = frame.rename(columns=renames)

    # Keep only the columns we understand, in a predictable order.
    wanted = [c for c in ("Date", "Ticker", "Open", "High", "Low", "Close", "AdjClose", "Volume")
              if c in mapped.columns]
    return mapped[wanted]


# ======================================================================
# SECTION 4 - READING ONE FILE INTO TIDY SERIES
# ======================================================================

def _tidy_one_symbol(frame, ticker):
    """
    Final clean-up for the rows belonging to ONE ticker:
      * make sure prices are numbers, not text
      * throw away rows with no date or no close price
      * sort oldest-first and remove duplicate dates
      * collapse intraday timestamps down to one row per calendar day
    """
    tidy = frame.copy()

    # Every price column must be a real number. `errors="coerce"` turns
    # rubbish such as "-" or "N/A" into a blank instead of crashing.
    for col in ("Open", "High", "Low", "Close", "AdjClose", "Volume"):
        if col in tidy.columns:
            tidy[col] = pd.to_numeric(
                tidy[col].astype(str).str.replace(",", "", regex=False),
                errors="coerce",
            )

    # A row without a date or a close price is useless to us.
    tidy = tidy.dropna(subset=["Date", "Close"])
    # A zero or negative price is bad data, not a real trade.
    tidy = tidy[tidy["Close"] > 0]

    # This portal is a DAILY strategy tester, so an intraday timestamp like
    # "2024-01-02 15:30:00" becomes simply "2024-01-02". If a file holds
    # several intraday bars per day we keep the LAST one, which is that
    # day's closing price.
    tidy["Date"] = pd.to_datetime(tidy["Date"]).dt.normalize()
    tidy = tidy.sort_values("Date")
    tidy = tidy.drop_duplicates(subset="Date", keep="last")

    tidy = tidy.set_index("Date")
    if "Ticker" in tidy.columns:
        tidy = tidy.drop(columns=["Ticker"])

    # If a file only has an adjusted close, use it as THE close price.
    if "Close" not in tidy.columns and "AdjClose" in tidy.columns:
        tidy["Close"] = tidy["AdjClose"]

    tidy.attrs["ticker"] = ticker
    return tidy


def load_csv(source, filename):
    """
    Read ONE csv file and return a list of tidy per-ticker tables.

    `source`   - either a path on disk, or raw bytes from a web upload.
    `filename` - the display name, used to work out a ticker if the file
                 has no Ticker/symbol column.

    Why a LIST and not a single table? Because some exports stack many
    symbols in one file (a "long" format with a `symbol` column). We split
    those apart so each symbol becomes its own price history.

    Returns: (list_of_series, warnings)
        list_of_series -> [{"ticker": "AAPL", "frame": <DataFrame>}, ...]
        warnings       -> human-readable notes about anything odd.
    """
    warnings = []

    # -- 1. Open the file, whatever form it arrived in -------------------
    if isinstance(source, (bytes, bytearray)):
        handle = io.BytesIO(source)
    else:
        handle = source

    try:
        raw = pd.read_csv(handle, skipinitialspace=True)
    except UnicodeDecodeError:
        # Some Windows exports are saved in the older "latin-1" text encoding.
        if isinstance(source, (bytes, bytearray)):
            handle = io.BytesIO(source)
        raw = pd.read_csv(handle, skipinitialspace=True, encoding="latin-1")

    if raw.empty:
        raise ValueError(f"'{filename}' has no rows in it.")

    # Some exporters write a second header row (yfinance multi-index style).
    # If the first data row repeats the header words, drop it.
    if len(raw) and str(raw.iloc[0].astype(str).str.lower().tolist()).count("date") > 0:
        first_row = raw.iloc[0].astype(str).str.lower()
        if first_row.isin(["date", "ticker", "open", "high", "low", "close", "volume"]).any():
            raw = raw.iloc[1:].reset_index(drop=True)

    # -- 2. Rename the columns into our standard names -------------------
    mapped = map_columns(raw)
    if "Date" not in mapped.columns:
        raise ValueError(
            f"'{filename}' has no date column. Expected one of: "
            + ", ".join(DATE_COLUMN_ALIASES)
        )
    if "Close" not in mapped.columns and "AdjClose" not in mapped.columns:
        raise ValueError(f"'{filename}' has no close-price column.")

    # -- 3. Turn the date text into real dates ---------------------------
    mapped["Date"] = parse_dates_flexibly(mapped["Date"])
    unreadable = int(mapped["Date"].isna().sum())
    if unreadable:
        warnings.append(f"{filename}: skipped {unreadable} row(s) with an unreadable date.")

    # -- 4. Split by symbol if the file holds more than one --------------
    series_list = []
    if "Ticker" in mapped.columns and mapped["Ticker"].notna().any():
        symbols = (
            mapped["Ticker"].astype(str).str.strip().str.upper().replace({"": np.nan})
        )
        mapped = mapped.assign(Ticker=symbols)
        unique_symbols = [s for s in mapped["Ticker"].dropna().unique() if s]

        if len(unique_symbols) == 0:
            unique_symbols = [ticker_from_filename(filename)]
            mapped["Ticker"] = unique_symbols[0]

        for symbol in unique_symbols:
            block = mapped[mapped["Ticker"] == symbol]
            tidy = _tidy_one_symbol(block, symbol)
            if len(tidy) >= 2:
                series_list.append({"ticker": symbol, "frame": tidy})
            else:
                warnings.append(f"{filename}: '{symbol}' had fewer than 2 usable rows - ignored.")
    else:
        symbol = ticker_from_filename(filename)
        tidy = _tidy_one_symbol(mapped, symbol)
        if len(tidy) >= 2:
            series_list.append({"ticker": symbol, "frame": tidy})
        else:
            warnings.append(f"{filename}: fewer than 2 usable rows - ignored.")

    if not series_list:
        raise ValueError(f"'{filename}' contained no usable daily price rows.")

    return series_list, warnings


# ======================================================================
# SECTION 5 - READING A WHOLE FOLDER
# ======================================================================

def scan_folder(folder):
    """
    Read EVERY .csv file inside a folder (and its sub-folders).

    This is the fastest way to load a universe: point the portal at the
    output folder of the US Stock Data Downloader and press Scan.

    Returns: (files, warnings)
        files -> one entry per CSV, each describing what we found inside.
    """
    if not os.path.isdir(folder):
        raise ValueError(f"'{folder}' is not a folder on this computer.")

    csv_paths = []
    for root, _dirs, names in os.walk(folder):
        for name in sorted(names):
            if name.lower().endswith(".csv"):
                csv_paths.append(os.path.join(root, name))

    if not csv_paths:
        raise ValueError(f"No .csv files were found inside '{folder}'.")

    files, warnings = [], []
    for path in csv_paths:
        name = os.path.basename(path)
        try:
            series_list, file_warnings = load_csv(path, name)
            warnings.extend(file_warnings)
            files.append({"name": name, "path": path, "series": series_list})
        except Exception as exc:  # a single bad file must never stop the scan
            warnings.append(f"{name}: skipped ({exc})")

    if not files:
        raise ValueError("None of the CSV files in that folder could be read.")

    return files, warnings


# ======================================================================
# SECTION 6 - DESCRIBING WHAT WE LOADED (for the website)
# ======================================================================

def describe_series(entry, filename):
    """
    Build the small summary card the website shows for each loaded symbol:
    how many rows, which dates it covers, and whether it smells like an index.
    """
    frame = entry["frame"]
    return {
        "ticker": entry["ticker"],
        "file": filename,
        "rows": int(len(frame)),
        "start": frame.index.min().strftime("%Y-%m-%d"),
        "end": frame.index.max().strftime("%Y-%m-%d"),
        "last_close": round(float(frame["Close"].iloc[-1]), 4),
        "benchmark_candidate": bool(
            looks_like_benchmark(filename) or looks_like_benchmark(entry["ticker"])
        ),
    }


# ======================================================================
# SECTION 7 - ALIGNING EVERYTHING ONTO ONE CALENDAR
# ======================================================================

def build_price_matrix(series_list):
    """
    Combine many separate price histories into ONE wide table of closes:

                    AAPL     MSFT     NVDA
        2024-01-02  187.90   372.10   481.6
        2024-01-03  184.25   370.60   475.7

    Stocks list on different days, some markets have different holidays, and
    a data file may simply be missing a day. So we:

        1. Build the union of every date seen across every symbol.
        2. Place each symbol's closes on that shared calendar.
        3. Forward-fill gaps - i.e. "if today's price is missing, the last
           known price still stands". This is the standard, honest way to
           handle a missing day; it never invents a price out of thin air.
        4. Leave dates BEFORE a stock's first trade as blank, so a company
           that listed in 2021 is correctly unavailable in 2019.
    """
    closes = {}
    for entry in series_list:
        ticker = entry["ticker"]
        column = entry["frame"]["Close"].astype(float)
        # If the same ticker appears in two files, keep the longer history.
        if ticker in closes and len(closes[ticker]) >= len(column):
            continue
        closes[ticker] = column

    if not closes:
        raise ValueError("No price series were supplied.")

    matrix = pd.DataFrame(closes)
    matrix = matrix.sort_index()

    # Forward-fill holes, but only AFTER each stock's own first trading day.
    matrix = matrix.ffill()

    return matrix


def align_with_benchmark(price_matrix, benchmark_series):
    """
    Put the stock universe and the benchmark on exactly the same set of dates.

    We keep only the dates where the BENCHMARK actually traded, because the
    benchmark defines "a trading day" for the whole backtest. Everything else
    is forward-filled onto that calendar.

    Returns: (aligned_prices, aligned_benchmark)
    """
    benchmark = benchmark_series.astype(float).sort_index()
    benchmark = benchmark[~benchmark.index.duplicated(keep="last")]

    # The overlapping window both sides actually cover.
    start = max(price_matrix.index.min(), benchmark.index.min())
    end = min(price_matrix.index.max(), benchmark.index.max())
    if start >= end:
        raise ValueError(
            "The stock files and the benchmark file do not overlap in time. "
            f"Stocks cover {price_matrix.index.min():%Y-%m-%d} to "
            f"{price_matrix.index.max():%Y-%m-%d}; benchmark covers "
            f"{benchmark.index.min():%Y-%m-%d} to {benchmark.index.max():%Y-%m-%d}."
        )

    calendar = benchmark.loc[start:end].index

    aligned_prices = price_matrix.reindex(price_matrix.index.union(calendar)).ffill()
    aligned_prices = aligned_prices.loc[calendar]
    aligned_benchmark = benchmark.loc[calendar]

    # Drop any stock that has no data at all inside the shared window.
    aligned_prices = aligned_prices.dropna(axis=1, how="all")
    if aligned_prices.shape[1] == 0:
        raise ValueError("No stock had usable prices inside the benchmark's date range.")

    return aligned_prices, aligned_benchmark
