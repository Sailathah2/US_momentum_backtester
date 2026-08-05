"""
==========================================================
backfill.py  --  keep your price files up to date
==========================================================

WHAT THIS FILE DOES (in plain English)
--------------------------------------
You keep a list of symbols in an Excel file. This reads that list, looks at
each symbol's CSV to see how far it goes, downloads only the days that are
MISSING, and appends them.

It is deliberately incremental. Re-running it the next day fetches one more
bar per symbol, not five years of history again - which is both far faster
and much kinder to the data provider.

WHAT "UP TO DATE" MEANS HERE
----------------------------
Up to and including **yesterday's close**. Today's bar is deliberately left
out: while the market is open it is a partial, moving number, and writing it
into a file would silently corrupt every calculation that reads it. Run this
in the evening and you get a complete, final set of bars.

A LONG JOB, NOT A QUICK ANSWER
------------------------------
Several hundred symbols takes minutes, so the website does not sit and wait.
The work runs on a background thread and reports progress, which the page
polls a few times a second.
"""

import os
import threading
import time
import uuid
from datetime import datetime, timedelta

import pandas as pd

# The column layout every file in this project uses.
COLUMNS = ["Date", "Open", "High", "Low", "Close", "Volume", "Ticker"]

# Column headers we accept as "this is the symbol column" in the Excel file.
SYMBOL_HEADERS = ("symbol", "ticker", "tickers", "symbols", "scrip", "code",
                  "instrument", "tradingsymbol", "name")

# How long to keep a finished job around so the page can read its result.
JOB_TTL_SECONDS = 3600

# Every running and recently finished job.
JOBS = {}
_lock = threading.Lock()


# ======================================================================
# SECTION 1 - READING THE SYMBOL LIST
# ======================================================================

def read_symbols(path, column=None):
    """
    Pull the list of symbols out of an Excel (or CSV) file.

    Finds the symbol column by name if it can - 'Symbol', 'Ticker' and
    friends - and falls back to the first column when the file has no
    recognisable header. Duplicates and blanks are dropped.
    """
    if not os.path.exists(path):
        raise ValueError(f"No such file: {path}")

    suffix = os.path.splitext(path)[1].lower()
    try:
        if suffix in (".xlsx", ".xlsm", ".xls"):
            frame = pd.read_excel(path)
        elif suffix == ".csv":
            frame = pd.read_csv(path)
        else:
            raise ValueError(
                f"'{os.path.basename(path)}' is not a spreadsheet. "
                "Use a .xlsx or .csv file.")
    except ImportError:
        raise ValueError("Reading .xlsx files needs the 'openpyxl' library "
                         "(pip install openpyxl).")

    if frame.empty:
        raise ValueError(f"'{os.path.basename(path)}' has no rows in it.")

    # Which column holds the symbols?
    chosen = None
    if column:
        matches = [c for c in frame.columns if str(c).strip().lower() == column.strip().lower()]
        if not matches:
            raise ValueError(
                f"'{column}' is not a column in that file. "
                f"Columns found: {', '.join(str(c) for c in frame.columns)}")
        chosen = matches[0]
    else:
        for candidate in frame.columns:
            if str(candidate).strip().lower() in SYMBOL_HEADERS:
                chosen = candidate
                break
        if chosen is None:
            chosen = frame.columns[0]      # no header we recognise; use column A

    symbols = (frame[chosen].dropna().astype(str).str.strip().str.upper())
    symbols = [s for s in symbols if s and s.lower() != "nan"]

    # Keep the original order but drop repeats.
    seen, unique = set(), []
    for s in symbols:
        if s not in seen:
            seen.add(s)
            unique.append(s)

    if not unique:
        raise ValueError(f"No symbols found in column '{chosen}'.")
    return unique, str(chosen)


# ======================================================================
# SECTION 2 - READING AND WRITING ONE SYMBOL'S FILE
# ======================================================================

def csv_path_for(folder, symbol):
    """Where a symbol's file lives. Mirrors the downloader's naming."""
    safe = "".join(ch if ch.isalnum() or ch in "._-^" else "_" for ch in symbol)
    return os.path.join(folder, f"{safe}.csv")


def symbol_inside(path):
    """
    Work out which symbol a CSV actually holds.

    The file NAME is not reliable: this project's index files are called
    things like INDEX_DJI.csv but hold the symbol ^DJI. Downloading '^DJI'
    and saving it as '^DJI.csv' would leave a duplicate file sitting beside
    the original, so we always trust the Ticker column when there is one and
    fall back to the filename only when there is not.

    Returns None for a CSV that is not price data at all.
    """
    try:
        head = pd.read_csv(path, nrows=2)
    except Exception:
        return None

    lowered = {str(c).strip().lower(): c for c in head.columns}
    # Not a price file - no date and no close means it is something else.
    if not ({"date", "datetime", "time"} & set(lowered)):
        return None
    if not ({"close", "adj close", "adj_close"} & set(lowered)):
        return None

    for name in ("ticker", "symbol"):
        if name in lowered and len(head):
            value = str(head[lowered[name]].iloc[0]).strip().upper()
            if value and value.lower() != "nan":
                return value

    stem = os.path.splitext(os.path.basename(path))[0]
    return stem.upper()


def discover_targets(folder, recursive=True):
    """
    Find every price CSV already in a folder and say which symbol each holds.

    This is the usual way to use the updater: you already have a folder of
    files, and you want all of them brought up to date. No symbol list to
    maintain.

    Returns (targets, skipped) where each target is {"symbol", "path"} and
    the file is updated IN PLACE, keeping its existing name.
    """
    if not os.path.isdir(folder):
        raise ValueError(f"'{folder}' is not a folder on this computer.")

    paths = []
    if recursive:
        for root, _dirs, names in os.walk(folder):
            paths.extend(os.path.join(root, n) for n in sorted(names)
                         if n.lower().endswith(".csv"))
    else:
        paths = [os.path.join(folder, n) for n in sorted(os.listdir(folder))
                 if n.lower().endswith(".csv")]

    targets, skipped, seen = [], [], {}
    for path in paths:
        symbol = symbol_inside(path)
        if symbol is None:
            skipped.append(os.path.basename(path))
            continue
        # The same symbol in two folders: update the longer file and leave
        # the other alone, rather than downloading twice.
        if symbol in seen:
            keep = seen[symbol]
            try:
                if os.path.getsize(path) > os.path.getsize(keep["path"]):
                    keep["path"] = path
            except OSError:
                pass
            continue
        entry = {"symbol": symbol, "path": path}
        seen[symbol] = entry
        targets.append(entry)

    if not targets:
        raise ValueError(
            f"No price CSV files found in '{folder}'. Files need a date column "
            "and a close column.")
    return targets, skipped


def last_date_in(path):
    """The most recent date already in a file, or None if there is no file."""
    if not os.path.exists(path):
        return None
    try:
        frame = pd.read_csv(path, usecols=lambda c: str(c).strip().lower() in ("date", "datetime", "time"))
        if frame.empty:
            return None
        stamps = pd.to_datetime(frame.iloc[:, 0], errors="coerce").dropna()
        return stamps.max().normalize() if len(stamps) else None
    except Exception:
        return None


def _download(symbol, start, end):
    """
    Fetch daily bars from Yahoo Finance.

    `end` is exclusive, which is exactly what we want: passing today gives
    bars up to and including yesterday.
    """
    import yfinance as yf

    frame = yf.download(symbol, start=start, end=end, interval="1d",
                        auto_adjust=False, progress=False, threads=False)
    if frame is None or frame.empty:
        return pd.DataFrame()

    # Newer yfinance returns a two-level column index even for one symbol.
    if isinstance(frame.columns, pd.MultiIndex):
        frame.columns = [str(c[0]) for c in frame.columns]

    frame = frame.rename(columns={c: str(c).strip().title() for c in frame.columns})
    frame = frame.reset_index()
    date_col = "Date" if "Date" in frame.columns else frame.columns[0]
    frame["Date"] = pd.to_datetime(frame[date_col]).dt.normalize()

    for needed in ("Open", "High", "Low", "Close", "Volume"):
        if needed not in frame.columns:
            frame[needed] = pd.NA
    frame["Ticker"] = symbol
    return frame[COLUMNS].dropna(subset=["Close"])


def update_symbol(symbol, path, cutoff, full_history_years=5):
    """
    Bring one symbol's file up to `cutoff` by APPENDING the missing days.

    `path` is the exact file to write, so a file called INDEX_DJI.csv keeps
    that name even though it holds ^DJI. Nothing already in the file is
    changed or re-downloaded - only newer rows are added.

    Returns (action, rows_added, note) where action is one of
    "created", "updated", "current" or "failed".
    """
    have_until = last_date_in(path)

    if have_until is None:
        start = (cutoff - timedelta(days=int(365.25 * full_history_years))).date()
        fresh = _download(symbol, start, (cutoff + timedelta(days=1)).date())
        if fresh.empty:
            return "failed", 0, "no data returned (wrong symbol, or delisted?)"
        fresh = fresh[fresh["Date"] <= cutoff]
        fresh.to_csv(path, index=False)
        return "created", len(fresh), f"{fresh['Date'].min():%Y-%m-%d} to {fresh['Date'].max():%Y-%m-%d}"

    if have_until >= cutoff:
        return "current", 0, f"already current to {have_until:%Y-%m-%d}"

    start = (have_until + timedelta(days=1)).date()
    fresh = _download(symbol, start, (cutoff + timedelta(days=1)).date())
    if fresh.empty:
        return "current", 0, f"nothing new since {have_until:%Y-%m-%d}"

    # Only rows strictly newer than what we already hold, and never today's
    # unfinished bar.
    fresh = fresh[(fresh["Date"] > have_until) & (fresh["Date"] <= cutoff)]
    if fresh.empty:
        return "current", 0, f"nothing new since {have_until:%Y-%m-%d}"

    existing = pd.read_csv(path)

    # Keep whatever the file already used as its symbol, so appending to
    # INDEX_DJI.csv does not suddenly start writing a different Ticker value
    # into the new rows than the old ones carry.
    if "Ticker" in existing.columns and len(existing):
        fresh = fresh.copy()
        fresh["Ticker"] = existing["Ticker"].dropna().iloc[-1] if existing["Ticker"].notna().any() else symbol

    combined = pd.concat([existing, fresh], ignore_index=True)

    # Belt and braces: a duplicated date would quietly double-count a day.
    combined["Date"] = pd.to_datetime(combined["Date"]).dt.normalize()
    combined = combined.drop_duplicates(subset="Date", keep="last").sort_values("Date")
    combined["Date"] = combined["Date"].dt.strftime("%Y-%m-%d")

    # Preserve the file's original column order; only add columns it lacked.
    ordered = [c for c in existing.columns if c in combined.columns]
    ordered += [c for c in combined.columns if c not in ordered]
    combined[ordered].to_csv(path, index=False)
    return "updated", len(fresh), f"appended through {fresh['Date'].max():%Y-%m-%d}"


# ======================================================================
# SECTION 3 - THE BACKGROUND JOB
# ======================================================================

def _sweep_old_jobs():
    """Forget jobs that finished a while ago, so memory does not creep."""
    now = time.time()
    for job_id in [k for k, v in JOBS.items()
                   if v.get("finished_at") and now - v["finished_at"] > JOB_TTL_SECONDS]:
        JOBS.pop(job_id, None)


def resolve_targets(folder, excel_path=None, column=None, recursive=True):
    """
    Work out which files to update, from whichever source was chosen.

    FOLDER mode (the usual one): every price CSV already in the folder is
    updated in place, keeping its existing filename.

    EXCEL mode: the symbols come from a spreadsheet instead, which also lets
    you ADD symbols you do not have files for yet.
    """
    if not os.path.isdir(folder):
        raise ValueError(f"'{folder}' is not a folder on this computer.")
    if not os.access(folder, os.W_OK):
        raise ValueError(f"'{folder}' is not writable.")

    if excel_path:
        symbols, used_column = read_symbols(excel_path, column)
        targets = [{"symbol": s, "path": csv_path_for(folder, s)} for s in symbols]
        return targets, [], used_column, "excel"

    targets, skipped = discover_targets(folder, recursive=recursive)
    return targets, skipped, None, "folder"


def start_backfill(folder, excel_path=None, column=None, pause=0.12,
                   full_history_years=5, recursive=True):
    """
    Kick off a backfill and return its job id immediately.

    The caller polls `JOBS[job_id]` to watch it run.
    """
    targets, skipped, used_column, source = resolve_targets(
        folder, excel_path, column, recursive)

    # Yesterday, by the calendar. Weekend runs simply find nothing new for
    # Saturday and Sunday, which is correct rather than an error.
    cutoff = (datetime.now() - timedelta(days=1)).replace(
        hour=0, minute=0, second=0, microsecond=0)

    job_id = uuid.uuid4().hex[:12]
    job = {
        "id": job_id, "status": "running",
        "total": len(targets), "done": 0,
        "created": 0, "updated": 0, "current": 0, "failed": 0,
        "rows_added": 0,
        "cutoff": cutoff.strftime("%Y-%m-%d"),
        "folder": folder, "excel": excel_path, "column": used_column,
        "source": source, "skipped_files": skipped[:20],
        "skipped_count": len(skipped),
        "current_symbol": None,
        "failures": [], "log": [],
        "started_at": time.time(), "finished_at": None,
        "cancel": False,
    }
    with _lock:
        _sweep_old_jobs()
        JOBS[job_id] = job

    def run():
        for target in targets:
            symbol, path = target["symbol"], target["path"]
            if job["cancel"]:
                job["status"] = "cancelled"
                break
            job["current_symbol"] = symbol
            try:
                action, rows, note = update_symbol(symbol, path, cutoff,
                                                   full_history_years)
            except Exception as exc:                      # one bad symbol
                action, rows, note = "failed", 0, str(exc)[:120]   # must not
            job[action] = job.get(action, 0) + 1                   # stop the rest
            job["rows_added"] += rows
            job["done"] += 1
            if action == "failed":
                job["failures"].append({"symbol": symbol, "why": note})
            if len(job["log"]) < 400:
                job["log"].append({"symbol": symbol, "action": action,
                                   "rows": rows, "note": note})
            # A brief pause keeps Yahoo from rate-limiting us into failures.
            if pause:
                time.sleep(pause)

        job["current_symbol"] = None
        if job["status"] == "running":
            job["status"] = "done"
        job["finished_at"] = time.time()

    threading.Thread(target=run, daemon=True).start()
    return job_id


def job_status(job_id):
    """Everything the page needs to draw a progress bar."""
    job = JOBS.get(job_id)
    if job is None:
        return None
    elapsed = (job.get("finished_at") or time.time()) - job["started_at"]
    done, total = job["done"], max(1, job["total"])
    rate = done / elapsed if elapsed > 0 else 0
    return {
        **{k: v for k, v in job.items() if k not in ("cancel", "log")},
        "percent": round(done / total * 100, 1),
        "elapsed_seconds": round(elapsed, 1),
        "eta_seconds": round((total - done) / rate, 0) if rate > 0 and done < total else 0,
        "recent": job["log"][-12:],
    }
