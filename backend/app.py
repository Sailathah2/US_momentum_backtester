"""
==========================================================
app.py  --  The Flask web server ("the waiter")
==========================================================

This program sits quietly in the background and answers questions asked by
the website (the React app in the /frontend folder). It never draws anything
itself - it only loads CSV files, runs the backtest, and hands back numbers.

    Website  --- "here are 200 CSV files, load them" --->  app.py
    Website  --- "now backtest top-10 vs SPY"        --->  app.py
    Website  <--- equity curve + metrics + trade log ----  app.py

HOW TO START IT
---------------
    cd backend
    pip install -r requirements.txt
    python app.py

Leave the window open. You should see:
    * Running on http://127.0.0.1:5001

(Port 5001, not 5000 - the US Stock Data Downloader project already uses 5000,
and two programs cannot share one port.)

THE ENDPOINTS ("questions" the website can ask)
-----------------------------------------------
    GET  /api/health           -> "are you alive?"
    POST /api/upload           -> receive uploaded CSV files, load them
    POST /api/scan-folder      -> load every CSV inside a folder on this PC
    GET  /api/session/<id>     -> what is currently loaded?
    POST /api/backtest         -> run the momentum strategy, return everything
    POST /api/export           -> turn the last result into a downloadable CSV
    POST /api/reset            -> forget everything that was loaded
"""

import csv
import io
import os
import traceback
import uuid
import zipfile
from datetime import datetime, timedelta

import pandas as pd
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS

# Our own helper modules, both in this same folder.
import auth
import backfill
import data_loader
import engine
import indicators
from auth import login_required

# ----------------------------------------------------------------------
# SETTINGS YOU MAY WANT TO CHANGE
# ----------------------------------------------------------------------
# The "door number" this server listens on.
#
# WHY 5001 AND NOT 5000? The US Stock Data Downloader project from earlier in
# this masterclass already uses port 5000. Two programs cannot share a port,
# so this one lives next door on 5001 and both can run at the same time.
# If you change this number, change it in frontend/vite.config.js too.
PORT = 5001
HOST = "127.0.0.1"     # 127.0.0.1 = this computer only (a safe default).

MAX_UPLOAD_MEGABYTES = 512   # Biggest total upload allowed in one request.
MAX_SESSIONS = 8             # How many loaded datasets to keep in memory.

# ----------------------------------------------------------------------
# CREATE THE APP
# ----------------------------------------------------------------------
app = Flask(__name__)

# CORS = "Cross-Origin Resource Sharing". Browsers normally block a page
# served from port 5173 (React) from calling a server on port 5000. This
# line tells the browser that our own website is allowed to talk to us.
CORS(app)

app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MEGABYTES * 1024 * 1024

# ----------------------------------------------------------------------
# WHERE LOADED DATA LIVES
# ----------------------------------------------------------------------
# Loaded price tables are kept in the computer's memory (not on disk) inside
# this dictionary, one entry per "session". A session is simply one batch of
# files you loaded. Restarting the server clears everything.
SESSIONS = {}


def _new_session():
    """Create an empty session and make room by evicting the oldest one."""
    while len(SESSIONS) >= MAX_SESSIONS:
        oldest = min(SESSIONS, key=lambda key: SESSIONS[key]["created"])
        SESSIONS.pop(oldest, None)

    session_id = uuid.uuid4().hex[:12]
    SESSIONS[session_id] = {
        "id": session_id,
        "created": datetime.utcnow().timestamp(),
        "series": {},       # ticker -> {"frame": DataFrame, "file": filename}
        "files": [],        # what came from where, for the UI list
        "warnings": [],
        "last_result": None,
        "last_settings": None,
    }
    return SESSIONS[session_id]


def _get_session(session_id):
    """Fetch a session or raise a friendly error if it has expired."""
    session = SESSIONS.get(session_id)
    if session is None:
        raise ValueError(
            "That dataset is no longer loaded (the server may have restarted). "
            "Please load your CSV files again."
        )
    return session


def _absorb(session, filename, series_list, path=None):
    """
    Put the tidy price tables from one file into the session.

    If the same ticker turns up twice (say a daily file and a longer archive)
    we keep whichever version has MORE rows of history.
    """
    added = []
    for entry in series_list:
        ticker = entry["ticker"]
        existing = session["series"].get(ticker)
        if existing is not None and len(existing["frame"]) >= len(entry["frame"]):
            session["warnings"].append(
                f"{filename}: '{ticker}' already loaded from {existing['file']} "
                "with more history - kept the longer one."
            )
            continue
        session["series"][ticker] = {"frame": entry["frame"], "file": filename}
        added.append(data_loader.describe_series(entry, filename))

    session["files"].append({
        "name": filename,
        "path": path,
        "tickers": [item["ticker"] for item in added],
        "series": added,
    })
    return added


def _session_payload(session):
    """Build the JSON summary the website shows after loading files."""
    symbols = []
    for ticker, holder in sorted(session["series"].items()):
        frame = holder["frame"]
        symbols.append({
            "ticker": ticker,
            "file": holder["file"],
            "rows": int(len(frame)),
            "start": frame.index.min().strftime("%Y-%m-%d"),
            "end": frame.index.max().strftime("%Y-%m-%d"),
            "last_close": round(float(frame["Close"].iloc[-1]), 4),
            "benchmark_candidate": bool(
                data_loader.looks_like_benchmark(holder["file"])
                or data_loader.looks_like_benchmark(ticker)
            ),
        })

    # Pre-select a sensible default benchmark: the first file whose name
    # looks like an index. The user can change it in the dropdown.
    suggested = next((s["ticker"] for s in symbols if s["benchmark_candidate"]), None)

    return {
        "session_id": session["id"],
        "symbols": symbols,
        "total_symbols": len(symbols),
        "suggested_benchmark": suggested,
        "warnings": session["warnings"][-40:],
        "files_loaded": len(session["files"]),
    }


def _fail(message, status=400):
    """Send a clean error message the website can display to the user."""
    return jsonify({"ok": False, "error": str(message)}), status


# ======================================================================
# ENDPOINT 1 - HEALTH CHECK
# ======================================================================

@app.get("/api/health")
def health():
    """
    The website pings this on start-up to show the green 'connected' dot.

    `service_id` is a fixed code-name the website checks. Without it, if some
    OTHER project's server happened to be on this port, the website would show
    a cheerful green light and then fail on every real request. Now it can say
    exactly what is wrong instead.
    """
    return jsonify({
        "ok": True,
        "service_id": "momentum-backtest-portal",
        "service": "Momentum Backtest Portal",
        # The website reads these to decide whether to show a login screen.
        "auth_required": auth.REQUIRE_LOGIN and auth.any_users_exist(),
        "auth_configured": auth.any_users_exist(),
        "signed_in_as": auth.current_user(),
        "version": "1.0.0",
        "sessions_loaded": len(SESSIONS),
        "time": datetime.utcnow().isoformat() + "Z",
    })


# ======================================================================
# ENDPOINT 1b - SIGNING IN AND OUT
# ======================================================================

@app.post("/api/login")
def login():
    """
    Exchange a username and password for a signed token.

    The token goes back to the browser, which sends it on every later
    request. The password itself is never stored and never travels again.
    """
    body = request.get_json(silent=True) or {}
    token, error = auth.attempt_login(body.get("username"), body.get("password"))
    if error:
        # 401 rather than 400: this is "who are you", not "malformed request".
        return jsonify({"ok": False, "error": error}), 401
    return jsonify({"ok": True, "token": token,
                    "username": str(body.get("username", "")).strip().lower(),
                    "expires_hours": auth.TOKEN_HOURS})


@app.post("/api/logout")
def logout():
    """
    Sign out.

    Nothing to do server-side: the token is self-contained and simply stops
    being sent. This route exists so the website has something honest to
    call, and so the behaviour is obvious to anyone reading the code.
    """
    return jsonify({"ok": True})


@app.get("/api/me")
def me():
    """Who is signed in right now? Used to restore a session on refresh."""
    who = auth.current_user()
    if who is None and auth.REQUIRE_LOGIN and auth.any_users_exist():
        return jsonify({"ok": False, "error": "Not signed in.", "auth_required": True}), 401
    return jsonify({"ok": True, "username": who,
                    "auth_required": auth.REQUIRE_LOGIN and auth.any_users_exist()})


# ======================================================================
# ENDPOINT 2 - UPLOAD CSV FILES FROM THE BROWSER
# ======================================================================

@app.post("/api/upload")
@login_required
def upload():
    """
    Receive one or more CSV files that the user dragged onto the website,
    translate each of them, and remember the result.

    Sending `session_id` in the form adds the files to an EXISTING dataset
    instead of starting a fresh one - that is how "add more files" works.
    """
    try:
        uploaded = request.files.getlist("files")
        if not uploaded:
            return _fail("No files were received. Please choose at least one CSV file.")

        session_id = request.form.get("session_id")
        if session_id and session_id in SESSIONS:
            session = SESSIONS[session_id]
        else:
            session = _new_session()

        loaded, failed = 0, []
        for storage in uploaded:
            name = storage.filename or "unnamed.csv"
            if not name.lower().endswith(".csv"):
                failed.append(f"{name}: not a .csv file")
                continue
            try:
                content = storage.read()
                series_list, warnings = data_loader.load_csv(content, name)
                session["warnings"].extend(warnings)
                _absorb(session, name, series_list)
                loaded += 1
            except Exception as exc:
                # One unreadable file must never stop the other 199.
                failed.append(f"{name}: {exc}")

        if not session["series"]:
            return _fail(
                "None of those files could be read. Details: " + " | ".join(failed[:5])
            )

        session["warnings"].extend(failed)
        payload = _session_payload(session)
        payload.update({"ok": True, "files_read": loaded, "files_failed": failed[:20]})
        return jsonify(payload)

    except Exception as exc:
        traceback.print_exc()
        return _fail(f"Upload failed: {exc}", 500)


# ======================================================================
# ENDPOINT 2b - BACKFILL: top every symbol's file up to yesterday
# ======================================================================

@app.post("/api/backfill/start")
@login_required
def backfill_start():
    """
    Read a symbol list from an Excel file and bring every one of those
    symbols' CSV files up to yesterday's close.

    Returns a job id straight away; the work carries on in the background
    because several hundred symbols takes minutes. Poll
    /api/backfill/status/<job_id> to follow it.
    """
    try:
        body = request.get_json(silent=True) or {}
        excel = (body.get("excel_path") or "").strip().strip('"')
        folder = (body.get("folder") or "").strip().strip('"')
        if not folder:
            return _fail("Please give the folder your CSV files live in.")

        job_id = backfill.start_backfill(
            folder,
            excel_path=excel or None,       # blank = auto-detect from the folder
            column=body.get("column") or None,
            full_history_years=float(body.get("history_years") or 5),
            recursive=bool(body.get("recursive", True)),
        )
        status = backfill.job_status(job_id)
        return jsonify({"ok": True, "job_id": job_id, "status": status})

    except ValueError as exc:
        return _fail(str(exc))
    except Exception as exc:
        traceback.print_exc()
        return _fail(f"Could not start the update: {exc}", 500)


@app.get("/api/backfill/status/<job_id>")
@login_required
def backfill_status(job_id):
    """How is the update going? The page polls this while it runs."""
    status = backfill.job_status(job_id)
    if status is None:
        return _fail("That update is no longer running (the server may have restarted).", 404)
    return jsonify({"ok": True, "status": status})


@app.post("/api/backfill/cancel/<job_id>")
@login_required
def backfill_cancel(job_id):
    """Stop after the symbol currently in flight."""
    job = backfill.JOBS.get(job_id)
    if job is None:
        return _fail("That update is no longer running.", 404)
    job["cancel"] = True
    return jsonify({"ok": True})


@app.post("/api/backfill/preview")
@login_required
def backfill_preview():
    """
    Read the symbol list WITHOUT downloading anything, so the user can check
    the right column was picked up before starting a long job.
    """
    try:
        body = request.get_json(silent=True) or {}
        excel = (body.get("excel_path") or "").strip().strip('"')
        folder = (body.get("folder") or "").strip().strip('"')
        if not folder:
            return _fail("Please give the folder your CSV files live in.")

        targets, skipped, column, source = backfill.resolve_targets(
            folder, excel or None, body.get("column") or None,
            bool(body.get("recursive", True)))

        have = sum(1 for t in targets if os.path.exists(t["path"]))

        # Show how stale things are, so the size of the job is obvious
        # before starting it.
        cutoff = (datetime.now() - timedelta(days=1)).replace(
            hour=0, minute=0, second=0, microsecond=0)
        checked = targets[:60]          # a sample is enough to characterise it
        dates = [backfill.last_date_in(t["path"]) for t in checked]
        dates = [d for d in dates if d is not None]
        already_current = sum(1 for d in dates if d >= cutoff)

        return jsonify({
            "ok": True,
            "source": source,
            "column": column,
            "count": len(targets),
            "sample": [t["symbol"] for t in targets[:24]],
            "already_have": have,
            "new_files": len(targets) - have,
            "skipped_files": skipped[:12],
            "skipped_count": len(skipped),
            "cutoff": cutoff.strftime("%Y-%m-%d"),
            "oldest_file": min(dates).strftime("%Y-%m-%d") if dates else None,
            "newest_file": max(dates).strftime("%Y-%m-%d") if dates else None,
            "sampled": len(checked),
            "sample_already_current": already_current,
        })
    except ValueError as exc:
        return _fail(str(exc))
    except Exception as exc:
        traceback.print_exc()
        return _fail(f"Could not read that file: {exc}", 500)


# ======================================================================
# ENDPOINT 3 - SCAN A FOLDER ALREADY ON THIS COMPUTER
# ======================================================================

@app.post("/api/scan-folder")
@login_required
def scan_folder():
    """
    Load every CSV inside a folder path typed by the user - by far the
    quickest way to load a few hundred files from the US Stock Data
    Downloader's output folder.
    """
    try:
        body = request.get_json(silent=True) or {}
        folder = (body.get("folder") or "").strip().strip('"')
        if not folder:
            return _fail("Please type the full path of the folder holding your CSV files.")

        files, warnings = data_loader.scan_folder(folder)

        session = _new_session()
        session["warnings"].extend(warnings)
        for item in files:
            _absorb(session, item["name"], item["series"], path=item["path"])

        payload = _session_payload(session)
        payload.update({"ok": True, "files_read": len(files), "folder": folder})
        return jsonify(payload)

    except Exception as exc:
        traceback.print_exc()
        return _fail(str(exc))


# ======================================================================
# ENDPOINT 4 - WHAT IS CURRENTLY LOADED?
# ======================================================================

@app.get("/api/session/<session_id>")
@login_required
def session_info(session_id):
    """Used when the page is refreshed, so the UI can rebuild its file list."""
    try:
        session = _get_session(session_id)
        payload = _session_payload(session)
        payload["ok"] = True
        return jsonify(payload)
    except Exception as exc:
        return _fail(str(exc), 404)


# ======================================================================
# SHARED SETUP FOR BOTH BACKTEST ENDPOINTS
# ======================================================================

def _prepare_backtest(session, body):
    """
    Everything that happens BEFORE a backtest runs: work out the benchmark,
    the stock universe and the settings, then build the aligned price table.

    Both /api/backtest and /api/regime-analysis need exactly this, so it
    lives in one place - if the validation rules ever change, they change
    for both endpoints at once.

    Raises ValueError with a friendly message if anything is wrong.
    Returns (prices, benchmark, settings, benchmark_ticker, universe).
    """
    # ---- Which file is the benchmark? ---------------------------------
    benchmark_ticker = body.get("benchmark")
    if not benchmark_ticker:
        raise ValueError("Please choose which file is the benchmark / index.")
    if benchmark_ticker not in session["series"]:
        raise ValueError(f"'{benchmark_ticker}' is not one of the loaded files.")

    # ---- Which stocks form the universe? ------------------------------
    # Default: everything loaded EXCEPT the benchmark itself.
    requested_universe = body.get("universe") or []
    if requested_universe:
        universe = [t for t in requested_universe
                    if t in session["series"] and t != benchmark_ticker]
    else:
        universe = [t for t in session["series"] if t != benchmark_ticker]

    if len(universe) < 2:
        raise ValueError(
            "At least 2 stock files (plus the benchmark) are needed to run a "
            "momentum ranking. Load more CSV files."
        )

    # ---- Read and sanity-check the strategy settings ------------------
    settings = {
        "lookback": int(body.get("lookback", 126)),
        "top_n": int(body.get("top_n", 10)),
        "cadence": str(body.get("cadence", "monthly")),
        "every_n_days": int(body.get("every_n_days", 21)),
        "weighting": str(body.get("weighting", "equal")),
        "cash_buffer": bool(body.get("cash_buffer", True)),
        "cost_bps": float(body.get("cost_bps", 0.0)),
        "start_capital": float(body.get("start_capital", 100000.0)),
        "risk_free_rate": float(body.get("risk_free_rate", 0.0)) / 100.0,
        "min_roc": body.get("min_roc", None),
        # How much of the portfolio moves to cash on a Risk-OFF day.
        # 100 = sell everything (the strictest, and the default).
        "risk_off_cash_pct": float(body.get("risk_off_cash_pct", 100.0)),
        # Optional extra screens. 0 (or missing) means "switched off", so
        # leaving these alone reproduces the original strategy exactly.
        "stock_ema_period": int(body.get("stock_ema_period") or 0),
        "stddev_period": int(body.get("stddev_period") or 0),
        # Which risk figure goes in the denominator of the ranking:
        # "stddev" (total volatility) or "downside" (the Sortino idea).
        # Defaults to stddev so older saved settings keep working.
        "risk_measure": str(body.get("risk_measure") or "stddev").lower(),
        # The rank cushion. 0 = off (sell everything and rebuild each time).
        "exit_rank": int(body.get("exit_rank") or 0),
        "reweight_mode": str(body.get("reweight_mode") or "rebalance").lower(),
    }
    if settings["min_roc"] not in (None, ""):
        settings["min_roc"] = float(settings["min_roc"]) / 100.0
    else:
        settings["min_roc"] = None

    if settings["cadence"] not in engine.VALID_CADENCES:
        raise ValueError(f"Unknown rebalance cadence '{settings['cadence']}'.")
    if settings["weighting"] not in engine.VALID_WEIGHTINGS:
        raise ValueError(f"Unknown weighting scheme '{settings['weighting']}'.")
    if settings["lookback"] < 2:
        raise ValueError("The lookback window must be at least 2 trading days.")
    if settings["top_n"] < 1:
        raise ValueError("Top N must be at least 1.")
    if not 0.0 <= settings["risk_off_cash_pct"] <= 100.0:
        raise ValueError("The Risk-OFF cash percentage must be between 0 and 100.")
    if settings["stock_ema_period"] and settings["stock_ema_period"] < 2:
        raise ValueError("The stock EMA period must be at least 2 days (or 0 to switch it off).")
    if settings["stddev_period"] and settings["stddev_period"] < 2:
        raise ValueError("The volatility window must be at least 2 days (or 0 to switch it off).")
    if settings["exit_rank"] and settings["exit_rank"] <= settings["top_n"]:
        raise ValueError(
            f"The exit rank ({settings['exit_rank']}) must be LARGER than the number of "
            f"stocks you hold ({settings['top_n']}) - that gap is the cushion. "
            "Set it to 0 to switch the cushion off."
        )
    if settings["reweight_mode"] not in engine.VALID_REWEIGHT_MODES:
        raise ValueError(
            f"Unknown re-weighting mode '{settings['reweight_mode']}'. Use one of: "
            + ", ".join(engine.VALID_REWEIGHT_MODES)
        )
    if settings["risk_measure"] not in engine.VALID_RISK_MEASURES:
        raise ValueError(
            f"Unknown risk measure '{settings['risk_measure']}'. Use one of: "
            + ", ".join(engine.VALID_RISK_MEASURES)
        )

    # Every screen needs its own run-up before the first trade, so the total
    # history required is however long the slowest of them is.
    warmup = max(settings["lookback"], settings["stock_ema_period"],
                 settings["stddev_period"])

    # ---- Build the aligned price tables -------------------------------
    series_list = [
        {"ticker": ticker, "frame": session["series"][ticker]["frame"]}
        for ticker in universe
    ]
    price_matrix = data_loader.build_price_matrix(series_list)
    benchmark_close = session["series"][benchmark_ticker]["frame"]["Close"]

    prices, benchmark = data_loader.align_with_benchmark(price_matrix, benchmark_close)

    # Optional date window chosen by the user on the website.
    start_date = body.get("start_date")
    end_date = body.get("end_date")
    if start_date:
        prices = prices.loc[prices.index >= pd.to_datetime(start_date)]
        benchmark = benchmark.loc[benchmark.index >= pd.to_datetime(start_date)]
    if end_date:
        prices = prices.loc[prices.index <= pd.to_datetime(end_date)]
        benchmark = benchmark.loc[benchmark.index <= pd.to_datetime(end_date)]

    if len(prices) <= warmup + 2:
        # Name whichever setting is actually the blocker, so the fix is obvious.
        blocker = "lookback"
        if warmup == settings["stock_ema_period"] and warmup > settings["lookback"]:
            blocker = "stock EMA period"
        elif warmup == settings["stddev_period"] and warmup > settings["lookback"]:
            blocker = "volatility window"
        raise ValueError(
            f"Only {len(prices)} trading days are available, which is not enough "
            f"for a {warmup}-day {blocker}. Choose a shorter {blocker} "
            "or widen the date range."
        )

    return prices, benchmark, settings, benchmark_ticker, universe


# ======================================================================
# ENDPOINT 5 - RUN THE BACKTEST
# ======================================================================

@app.post("/api/backtest")
@login_required
def backtest():
    """
    The main event. Takes the user's settings, lines up the price data, runs
    the momentum strategy through history, and returns everything the charts
    and tables need.
    """
    try:
        body = request.get_json(silent=True) or {}
        session = _get_session(body.get("session_id"))

        prices, benchmark, settings, benchmark_ticker, universe = _prepare_backtest(session, body)

        # ---- Run it ----------------------------------------------------
        result = engine.analyse(prices, benchmark, settings)
        # analyse() carries some pandas objects along for the regime
        # comparison to use. They cannot be turned into JSON, so they have to
        # come out before this is sent to the browser.
        engine.strip_private(result)

        # Remember the answer so the export buttons can rebuild the CSVs
        # without running the whole backtest a second time.
        session["last_result"] = result
        session["last_settings"] = {
            **settings,
            "benchmark": benchmark_ticker,
            "universe_size": len(universe),
        }

        result.update({
            "ok": True,
            "benchmark": benchmark_ticker,
            "universe_size": len(universe),
            "trading_days": int(len(prices)),
            "settings": session["last_settings"],
        })
        return jsonify(result)

    except ValueError as exc:
        return _fail(str(exc))
    except Exception as exc:
        traceback.print_exc()
        return _fail(f"The backtest failed: {exc}", 500)


# ======================================================================
# ENDPOINT 5b - THE INDEX REGIME FILTER
# ======================================================================

def _resolve_regime_inputs(session, body):
    """
    Shared helper: read the regime settings out of the request and build the
    daily Risk-ON / Risk-OFF table from whichever index the user picked.

    Returns (regime_frame, regime_settings). `regime_frame` is None when the
    filter is switched off.
    """
    mode = str(body.get("regime_mode", "disabled")).lower()
    if mode not in indicators.VALID_REGIME_MODES:
        raise ValueError(
            f"Unknown regime mode '{mode}'. Use one of: "
            + ", ".join(indicators.VALID_REGIME_MODES)
        )

    timeframe = str(body.get("regime_timeframe", "daily")).lower()
    if timeframe not in indicators.VALID_REGIME_TIMEFRAMES:
        raise ValueError(
            f"Unknown regime timeframe '{timeframe}'. Use one of: "
            + ", ".join(indicators.VALID_REGIME_TIMEFRAMES)
        )

    # Where the de-risked money sits. Blank (or "CASH") means plain cash
    # earning nothing; anything else must be a loaded symbol - gold and bond
    # funds are the usual picks.
    parked_in = str(body.get("risk_off_asset") or "").strip().upper()
    if parked_in in ("", "CASH"):
        parked_in = ""

    regime_settings = {
        "regime_mode": mode,
        "regime_timeframe": timeframe,
        "risk_off_asset": parked_in,
        "regime_index": body.get("regime_index") or body.get("benchmark"),
        "ema_period": int(body.get("ema_period", 200)),
        "atr_period": int(body.get("atr_period", 10)),
        "st_multiplier": float(body.get("st_multiplier", 3.0)),
    }

    if mode == "disabled":
        return None, regime_settings

    if parked_in and parked_in not in session["series"]:
        raise ValueError(
            f"'{parked_in}' is not one of the loaded files, so the Risk-OFF money "
            "cannot be parked there. Load that symbol's CSV first, or choose Cash."
        )

    # The filter can run off ANY loaded file - usually the benchmark, but a
    # trader might prefer to gate a small-cap universe on the S&P 500, or
    # even on a single bellwether stock.
    index_ticker = regime_settings["regime_index"]
    if not index_ticker:
        raise ValueError("Choose which index the regime filter should watch.")
    if index_ticker not in session["series"]:
        raise ValueError(f"'{index_ticker}' is not one of the loaded files.")

    if regime_settings["ema_period"] < 2:
        raise ValueError("The EMA period must be at least 2 days.")
    if regime_settings["atr_period"] < 1:
        raise ValueError("The Supertrend ATR period must be at least 1 day.")
    if regime_settings["st_multiplier"] <= 0:
        raise ValueError("The Supertrend multiplier must be greater than 0.")

    index_frame = session["series"][index_ticker]["frame"]

    # On weekly candles the periods count WEEKS, so a 200-week EMA needs
    # nearly four years of history before it produces its first number. Check
    # up front and say so plainly, rather than returning a filter that never
    # actually switches on.
    if timeframe == "weekly":
        weekly_bars = len(indicators.to_weekly(index_frame))
        needed = regime_settings["ema_period"] if mode in ("ema", "both") else 0
        needed = max(needed, regime_settings["atr_period"] if mode in ("supertrend", "both") else 0)
        if weekly_bars < needed:
            raise ValueError(
                f"'{index_ticker}' only covers {weekly_bars} weekly candles, but the "
                f"settings need {needed}. On weekly candles the periods count WEEKS "
                f"({needed} weeks is about {needed / 52.0:.1f} years). Use a shorter "
                "period, load more history, or switch back to daily candles."
            )

    regime_frame = indicators.build_regime(
        index_frame,
        mode=mode,
        ema_period=regime_settings["ema_period"],
        atr_period=regime_settings["atr_period"],
        multiplier=regime_settings["st_multiplier"],
        timeframe=timeframe,
    )
    return regime_frame, regime_settings


@app.post("/api/regime-analysis")
@login_required
def regime_analysis():
    """
    Run the momentum strategy TWICE - with the macro filter and without -
    and return both, side by side, with the deltas already worked out.

    This is the endpoint behind the "Regime Filter" dashboard. It accepts
    everything /api/backtest does, plus:

        regime_mode    "disabled" | "ema" | "supertrend" | "both"
        regime_index   which loaded file the filter watches (e.g. "^GSPC")
        ema_period     default 200
        atr_period     default 10
        st_multiplier  default 3.0
    """
    try:
        body = request.get_json(silent=True) or {}
        session = _get_session(body.get("session_id"))

        prices, benchmark, settings, benchmark_ticker, universe = _prepare_backtest(session, body)
        regime_frame, regime_settings = _resolve_regime_inputs(session, body)

        if regime_frame is None:
            return _fail(
                "The regime filter is switched off, so there is nothing to compare. "
                "Choose EMA, Supertrend or Both first."
            )

        # Line the regime up with the trading calendar the backtest uses.
        regime_frame = regime_frame.reindex(prices.index).ffill()
        regime_frame["regime"] = regime_frame["regime"].fillna(True).astype(bool)

        # Pull the closing prices of wherever the de-risked money is parked,
        # onto that same calendar.
        defensive = None
        parked_in = regime_settings["risk_off_asset"]
        if parked_in:
            defensive = (
                session["series"][parked_in]["frame"]["Close"]
                .astype(float)
                .reindex(prices.index)
                .ffill()
            )
            if defensive.notna().sum() < 2:
                raise ValueError(
                    f"'{parked_in}' has no usable prices inside the backtest window, "
                    "so the Risk-OFF money cannot be parked there."
                )

        result = engine.compare_with_regime(
            prices, benchmark, settings, regime_frame, defensive=defensive
        )

        # Keep the filtered run as "the" result, so the existing export
        # buttons download the filtered trade log rather than the baseline.
        session["last_result"] = result["filtered"]
        session["last_settings"] = {**settings, **regime_settings,
                                    "benchmark": benchmark_ticker,
                                    "universe_size": len(universe)}
        session["last_regime"] = result

        result.update({
            "ok": True,
            "benchmark": benchmark_ticker,
            "universe_size": len(universe),
            "trading_days": int(len(prices)),
            "settings": session["last_settings"],
            "regime_settings": regime_settings,
        })
        return jsonify(result)

    except ValueError as exc:
        return _fail(str(exc))
    except Exception as exc:
        traceback.print_exc()
        return _fail(f"The regime analysis failed: {exc}", 500)


# ======================================================================
# ENDPOINT 6 - EXPORT RESULTS AS CSV
# ======================================================================

@app.post("/api/export")
@login_required
def export():
    """
    Turn the most recent backtest into a downloadable CSV file.

    `kind` picks which table you get:
        "trades"      -> every stock bought, its momentum score and its result
        "rebalances"  -> one row per rebalance period
        "timeseries"  -> the daily equity curve and drawdowns
        "monthly"     -> the calendar grid of monthly returns
    """
    try:
        body = request.get_json(silent=True) or {}
        session = _get_session(body.get("session_id"))
        result = session.get("last_result")
        if not result:
            return _fail("Run a backtest first - there is nothing to export yet.")

        kind = (body.get("kind") or "trades").lower()
        buffer = io.StringIO()
        writer = csv.writer(buffer, lineterminator="\n")

        if kind == "trades":
            rows = result["trades"]
            headers = ["period", "rebalance_date", "exit_date", "ticker", "weight",
                       "roc_at_entry", "benchmark_roc", "relative_strength",
                       "stddev", "rank_score",
                       "entry_price", "exit_price", "trade_return", "contribution"]
        elif kind == "rebalances":
            rows = result["rebalances"]
            headers = ["period", "rebalance_date", "exit_date", "holding_days",
                       "num_holdings", "kept", "entered", "exited",
                       "kept_tickers", "entered_tickers", "exited_tickers",
                       "tickers", "weights", "cash_weight",
                       "benchmark_roc", "period_return", "benchmark_period_return",
                       "excess_return", "turnover", "cost_paid",
                       "equity_start", "equity_end"]
        elif kind == "actions":
            rows = result.get("actions", [])
            headers = ["period", "rebalance_date", "ticker", "action", "rank",
                       "weight_after", "reason"]
        elif kind == "timeseries":
            rows = result["curve"]
            headers = ["date", "portfolio", "benchmark", "portfolio_dd", "benchmark_dd"]
        elif kind == "monthly":
            # The monthly grid is nested, so we flatten it into plain rows.
            writer.writerow(["year", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                             "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Year"])
            for row in result["monthly"]:
                values = [row["months"].get(str(m)) for m in range(1, 13)]
                writer.writerow(
                    [row["year"]]
                    + ["" if v is None else round(v * 100, 4) for v in values]
                    + ["" if row["year_total"] is None else round(row["year_total"] * 100, 4)]
                )
            return _csv_response(buffer, "monthly_returns")
        else:
            return _fail(f"Unknown export type '{kind}'.")

        writer.writerow(headers)
        for row in rows:
            writer.writerow([row.get(column, "") for column in headers])

        return _csv_response(buffer, kind)

    except Exception as exc:
        traceback.print_exc()
        return _fail(f"Export failed: {exc}", 500)


def _csv_response(buffer, name):
    """Wrap the text we just built into a real file download."""
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    data = io.BytesIO(buffer.getvalue().encode("utf-8-sig"))
    return send_file(
        data,
        mimetype="text/csv",
        as_attachment=True,
        download_name=f"momentum_{name}_{stamp}.csv",
    )


# ======================================================================
# ENDPOINT 5c - RANK CHECKER: the league table on one historical day
# ======================================================================

@app.post("/api/rank-check")
@login_required
def rank_check():
    """
    Show the full stock ranking exactly as it stood on one chosen date.

    This answers "why was X not picked that month?" without having to read a
    whole backtest. It runs the SAME selection code the backtest uses - the
    diagnostics come out of `select_holdings` itself - so the two can never
    disagree about what the ranking was.
    """
    try:
        body = request.get_json(silent=True) or {}
        session = _get_session(body.get("session_id"))

        prices, benchmark, settings, benchmark_ticker, universe = _prepare_backtest(session, body)

        # ---- Which day are we looking at? -----------------------------
        wanted = body.get("date")
        if not wanted:
            raise ValueError("Please choose a date to inspect.")
        stamp = pd.to_datetime(wanted)

        # Snap to the last trading day on or before the request. Picking a
        # Sunday should show you Friday, not an error.
        calendar = prices.index
        earlier = calendar[calendar <= stamp]
        if len(earlier) == 0:
            raise ValueError(
                f"{stamp:%Y-%m-%d} is before the data starts "
                f"({calendar.min():%Y-%m-%d}). Choose a later date."
            )
        as_of = earlier[-1]
        position = calendar.get_loc(as_of)

        # ---- Is there enough run-up behind that day? ------------------
        warmup = max(settings["lookback"], settings["stock_ema_period"],
                     settings["stddev_period"])
        if position < warmup:
            raise ValueError(
                f"{as_of:%Y-%m-%d} is only {position} trading days into the data, "
                f"but the settings need {warmup} days of history behind them. "
                "Choose a later date, or shorten the lookback."
            )

        # ---- Build the same helper tables the backtest builds ---------
        stock_ema = None
        if settings["stock_ema_period"] >= 2:
            stock_ema = prices.ewm(span=settings["stock_ema_period"], adjust=False,
                                   min_periods=settings["stock_ema_period"]).mean()

        rolling_sd = rolling_alive = None
        if settings["stddev_period"] >= 2 and settings["risk_measure"] != "none":
            daily = prices.pct_change(fill_method=None)
            rolling_alive = daily.rolling(settings["stddev_period"],
                                          min_periods=settings["stddev_period"]).std()
            if settings["risk_measure"] == "downside":
                losses = daily.clip(upper=0.0)
                rolling_sd = (losses ** 2).rolling(
                    settings["stddev_period"],
                    min_periods=settings["stddev_period"]).mean() ** 0.5
            else:
                rolling_sd = rolling_alive

        decision = engine.select_holdings(
            prices, benchmark, position,
            settings["lookback"], settings["top_n"], settings["weighting"],
            settings["cash_buffer"], settings["min_roc"],
            stock_ema=stock_ema, rolling_sd=rolling_sd,
            risk_measure=settings["risk_measure"], alive=rolling_alive,
            exit_rank=settings["exit_rank"], held=None,
            reweight_mode=settings["reweight_mode"],
            with_diagnostics=True,
        )

        diag = decision.get("diagnostics") or {"rows": [], "funnel": {}}
        picked = {p["ticker"] for p in decision["picks"]}
        weight_of = {p["ticker"]: p["weight"] for p in decision["picks"]}

        # Label every row so the table can be read at a glance.
        top_n = settings["top_n"]
        cushion = settings["exit_rank"]
        for row in diag["rows"]:
            place = row.get("rank")
            if row["ticker"] in picked:
                row["status"] = "SELECTED"
                row["weight"] = weight_of.get(row["ticker"])
            elif place is None:
                row["status"] = "REJECTED"
                row["weight"] = None
            elif cushion and place <= cushion:
                # Not bought today, but close enough that it would be KEPT
                # if you already held it.
                row["status"] = "IN CUSHION"
                row["weight"] = None
            else:
                row["status"] = "RANKED"
                row["weight"] = None

        # Ranked names first, in order; rejects afterwards, best ROC first.
        diag["rows"].sort(key=lambda r: (r["rank"] is None,
                                         r["rank"] if r["rank"] is not None else 0,
                                         -(r["roc"] if r["roc"] is not None else -9e9)))

        return jsonify({
            "ok": True,
            "as_of": as_of.strftime("%Y-%m-%d"),
            "requested": stamp.strftime("%Y-%m-%d"),
            "snapped": as_of.strftime("%Y-%m-%d") != stamp.strftime("%Y-%m-%d"),
            "position": int(position),
            "benchmark": benchmark_ticker,
            "universe_size": len(universe),
            "rows": diag["rows"],
            "funnel": diag["funnel"],
            "benchmark_roc": diag.get("benchmark_roc"),
            "hurdle": diag.get("hurdle"),
            "settings": {**settings, "benchmark": benchmark_ticker},
            "selected": [p["ticker"] for p in decision["picks"]],
            "cash_weight": decision["cash_weight"],
        })

    except ValueError as exc:
        return _fail(str(exc))
    except Exception as exc:
        traceback.print_exc()
        return _fail(f"The rank check failed: {exc}", 500)


# ======================================================================
# ENDPOINT 6b - THE FULL REPORT (every table in one file)
# ======================================================================

# The sheets that go into the report, in order. Sheet names are capped at 31
# characters because that is Excel's hard limit.
REPORT_SHEETS = (
    ("1. Inputs", "the settings that produced this run"),
    ("2. Metrics", "headline performance, portfolio vs benchmark"),
    ("3. Regime Comparison", "filter ON vs OFF (only when a regime run)"),
    ("4. Equity Curve", "daily portfolio, benchmark and drawdowns"),
    ("5. Rebalance Log", "one row per rebalance period"),
    ("6. Trade Log", "one row per stock per period"),
    ("7. Keep Exit Enter", "every hold/sell/buy decision and why (rank cushion)"),
    ("8. Monthly Returns", "the calendar grid"),
)

# How each setting should be labelled and explained on the Inputs sheet, so
# the workbook makes sense months later without the app open beside it.
SETTING_LABELS = {
    "benchmark": ("Benchmark / index", "Every stock must beat this to be bought"),
    "universe_size": ("Stocks in universe", "How many symbols were ranked"),
    "lookback": ("Lookback (trading days)", "Window used to measure momentum"),
    "cadence": ("Rebalance cadence", "How often the portfolio is re-picked"),
    "every_n_days": ("Every N days", "Only used when cadence is 'days'"),
    "top_n": ("Hold top N", "How many stocks to own"),
    "weighting": ("Weighting", "equal = same money each; roc = by momentum"),
    "cash_buffer": ("Keep unfilled slots in cash", "Each slot is 1/N when ticked"),
    "cost_bps": ("Trading cost (bps)", "Fees + slippage; 1 bp = 0.01%"),
    "start_capital": ("Starting capital", "Cosmetic - only scales the chart"),
    "risk_free_rate": ("Risk-free rate", "Used by Sharpe and Sortino"),
    "min_roc": ("Minimum ROC hurdle", "Extra absolute momentum requirement"),
    "stock_ema_period": ("Stock EMA gate", "Stock must close above its own EMA; 0 = off"),
    "stddev_period": ("Risk window", "Window for the risk-adjusted ranking; 0 = off"),
    "exit_rank": ("Exit rank cushion", "A held stock survives until it falls past this rank; 0 = off"),
    "reweight_mode": ("When positions are kept", "rebalance = reset all weights; recycle = spend freed cash only"),
    "risk_measure": ("Risk measure", "stddev = total volatility; downside = Sortino style"),
    "regime_mode": ("Regime filter mode", "disabled / ema / supertrend / both"),
    "regime_timeframe": ("Regime candles", "daily or weekly bars"),
    "regime_index": ("Regime index watched", "Which file the macro filter reads"),
    "ema_period": ("Regime EMA period", "Counts WEEKS when candles are weekly"),
    "atr_period": ("Supertrend ATR period", "Volatility lookback for Supertrend"),
    "st_multiplier": ("Supertrend multiplier", "How far the stop sits, in ATRs"),
    "risk_off_cash_pct": ("Risk-OFF cash (%)", "How much is pulled out on a Risk-OFF day"),
    "risk_off_asset": ("Risk-OFF parked in", "Where that money sits; blank = plain cash"),
}


def _report_tables(session):
    """
    Turn the last run into an ordered dict of {sheet name: list-of-rows}.

    Every sheet is a plain list of dictionaries, so the same tables can be
    written either as one Excel workbook or as a folder of CSV files.
    """
    result = session.get("last_result")
    if not result:
        raise ValueError("Run a backtest first - there is nothing to report on yet.")

    settings = session.get("last_settings") or {}
    regime = session.get("last_regime")

    # ---- Sheet 1: every input, labelled and explained -----------------
    inputs = []
    for key, (label, note) in SETTING_LABELS.items():
        if key not in settings:
            continue
        value = settings[key]
        if key == "risk_free_rate" and isinstance(value, (int, float)):
            value = f"{value * 100:g}%"      # stored as a fraction internally
        if key == "min_roc" and isinstance(value, (int, float)):
            value = f"{value * 100:g}%"
        if value is None or value == "":
            value = "off" if key in ("risk_off_asset", "min_roc") else "-"
        if isinstance(value, bool):
            value = "yes" if value else "no"
        inputs.append({"Setting": label, "Value": value, "What it does": note})

    inputs.append({"Setting": "Report generated",
                   "Value": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                   "What it does": "Local time this workbook was built"})
    inputs.append({"Setting": "Backtest window",
                   "Value": f"{result['metrics'].get('start_date')} to {result['metrics'].get('end_date')}",
                   "What it does": "First and last day the strategy was live"})

    # ---- Sheet 2: metrics side by side with the benchmark -------------
    labels = [
        ("total_return", "Total return", "pct"), ("cagr", "CAGR", "pct"),
        ("annual_volatility", "Volatility (annual)", "pct"),
        ("sharpe", "Sharpe ratio", "num"), ("sortino", "Sortino ratio", "num"),
        ("max_drawdown", "Max drawdown", "pct"), ("calmar", "Calmar ratio", "num"),
        ("win_rate", "Win rate", "pct"), ("best_period", "Best period", "pct"),
        ("worst_period", "Worst period", "pct"), ("start_value", "Starting value", "raw"),
        ("end_value", "Final value", "raw"), ("years", "Years tested", "num"),
    ]
    mine, theirs = result["metrics"], result.get("benchmark_metrics") or {}

    def fmt(value, kind):
        if value is None:
            return ""
        if kind == "pct":
            return round(value * 100, 4)
        if kind == "num":
            return round(value, 4)
        return round(value, 2)

    metrics = []
    for key, label, kind in labels:
        metrics.append({
            "Metric": label + (" (%)" if kind == "pct" else ""),
            "Portfolio": fmt(mine.get(key), kind),
            "Benchmark": fmt(theirs.get(key), kind),
        })
    summary = result.get("summary", {})
    for key, label in (("total_rebalances", "Rebalance periods"),
                       ("total_trades", "Trades placed"),
                       ("cash_periods", "Periods fully in cash"),
                       ("average_holdings", "Average holdings"),
                       ("total_costs", "Total costs paid"),
                       ("regime_switches", "Regime switches")):
        if key in summary:
            metrics.append({"Metric": label, "Portfolio": summary[key], "Benchmark": ""})

    tables = {
        "1. Inputs": inputs,
        "2. Metrics": metrics,
        "3. Regime Comparison": [],
        "4. Equity Curve": result.get("curve", []),
        "5. Rebalance Log": result.get("rebalances", []),
        "6. Trade Log": result.get("trades", []),
        "7. Keep Exit Enter": result.get("actions", []),
        "8. Monthly Returns": [],
    }

    # ---- Sheet 3: the filter ON vs OFF table, when there was one ------
    if regime and regime.get("comparison"):
        pretty = {
            "total_return": ("Total return", "pct"), "cagr": ("CAGR", "pct"),
            "max_drawdown": ("Max drawdown", "pct"), "sharpe": ("Sharpe ratio", "num"),
            "sortino": ("Sortino ratio", "num"),
            "annual_volatility": ("Volatility (annual)", "pct"),
            "win_rate": ("Win rate", "pct"), "time_in_market": ("Time in market", "pct"),
            "time_in_cash": ("Time de-risked", "pct"),
            "average_exposure": ("Average exposure", "pct"),
            "regime_switches": ("Regime switches", "num"),
        }
        rows = []
        for key, (label, kind) in pretty.items():
            cell = regime["comparison"].get(key)
            if not cell:
                continue
            rows.append({
                "Metric": label + (" (%)" if kind == "pct" else ""),
                "Filter OFF": fmt(cell.get("off"), kind),
                "Filter ON": fmt(cell.get("on"), kind),
                "Difference": fmt(cell.get("delta"), kind),
            })
        exposure = regime.get("exposure") or {}
        for key, label in (("days_in_market", "Days invested"),
                           ("days_in_cash", "Days de-risked"),
                           ("total_days", "Trading days total")):
            if exposure.get(key) is not None:
                rows.append({"Metric": label, "Filter OFF": "", "Filter ON": exposure[key],
                             "Difference": ""})
        if exposure.get("parked_return") is not None:
            rows.append({"Metric": "Parked asset return while parked (%)", "Filter OFF": "",
                         "Filter ON": fmt(exposure["parked_return"], "pct"), "Difference": ""})
        tables["3. Regime Comparison"] = rows

        # The regime run has its own richer curve, with both arms on it.
        if regime.get("curve"):
            tables["4. Equity Curve"] = regime["curve"]

    # ---- Sheet 7: flatten the monthly grid ----------------------------
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    monthly = []
    for row in result.get("monthly", []):
        flat = {"Year": row["year"]}
        for index, name in enumerate(months, start=1):
            value = row["months"].get(str(index))
            flat[name] = "" if value is None else round(value * 100, 4)
        flat["Year total"] = ("" if row["year_total"] is None
                              else round(row["year_total"] * 100, 4))
        monthly.append(flat)
    tables["8. Monthly Returns"] = monthly

    return tables


@app.post("/api/export-report")
@login_required
def export_report():
    """
    Download the WHOLE run as one file, with a sheet per table.

    `format` picks the flavour:
        "xlsx" -> a real Excel workbook, one tab per sheet (the default)
        "csv"  -> a ZIP holding one .csv per sheet, for tools that only
                  read plain CSV. A single .csv file cannot hold multiple
                  sheets, so a folder of them is the honest equivalent.
    """
    try:
        body = request.get_json(silent=True) or {}
        session = _get_session(body.get("session_id"))
        wanted = str(body.get("format") or "xlsx").lower()
        if wanted not in ("xlsx", "csv"):
            return _fail("Unknown report format - use 'xlsx' or 'csv'.")

        tables = _report_tables(session)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        buffer = io.BytesIO()

        if wanted == "xlsx":
            try:
                import openpyxl  # noqa: F401  (checked here so we can explain it)
            except ImportError:
                return _fail(
                    "Excel export needs the 'openpyxl' library. Install it with "
                    "'pip install openpyxl', or choose the CSV (ZIP) format instead."
                )

            with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
                for sheet, _note in REPORT_SHEETS:
                    rows = tables.get(sheet) or []
                    frame = pd.DataFrame(rows)
                    if frame.empty:
                        # Never leave a blank tab with no explanation on it.
                        frame = pd.DataFrame({"Note": ["No data for this section in this run."]})
                    frame.to_excel(writer, sheet_name=sheet[:31], index=False)

                    # Widen each column to fit its contents, capped so one long
                    # ticker list cannot make a column a mile wide.
                    worksheet = writer.sheets[sheet[:31]]
                    for position, column in enumerate(frame.columns, start=1):
                        longest = max(
                            [len(str(column))] +
                            [len(str(v)) for v in frame[column].head(200).tolist()]
                        )
                        worksheet.column_dimensions[
                            openpyxl.utils.get_column_letter(position)
                        ].width = min(max(longest + 2, 10), 46)
                    worksheet.freeze_panes = "A2"

            buffer.seek(0)
            return send_file(
                buffer,
                mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                as_attachment=True,
                download_name=f"momentum_report_{stamp}.xlsx",
            )

        # ---- CSV flavour: a ZIP with one file per sheet -----------------
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as bundle:
            readme = ["Momentum Backtest Portal - full report",
                      f"Generated {datetime.now():%Y-%m-%d %H:%M:%S}", "",
                      "A single CSV file cannot hold multiple sheets, so each",
                      "sheet is its own file inside this ZIP:", ""]
            for sheet, note in REPORT_SHEETS:
                rows = tables.get(sheet) or []
                safe = sheet.replace(". ", "_").replace(" ", "_")
                readme.append(f"  {safe}.csv  -  {note}  ({len(rows)} rows)")
                text = io.StringIO()
                if rows:
                    pd.DataFrame(rows).to_csv(text, index=False, lineterminator="\n")
                else:
                    text.write("Note\nNo data for this section in this run.\n")
                bundle.writestr(f"{safe}.csv", text.getvalue())
            bundle.writestr("README.txt", "\n".join(readme) + "\n")

        buffer.seek(0)
        return send_file(
            buffer,
            mimetype="application/zip",
            as_attachment=True,
            download_name=f"momentum_report_{stamp}.zip",
        )

    except ValueError as exc:
        return _fail(str(exc))
    except Exception as exc:
        traceback.print_exc()
        return _fail(f"Building the report failed: {exc}", 500)


# ======================================================================
# ENDPOINT 7 - START OVER
# ======================================================================

@app.post("/api/reset")
@login_required
def reset():
    """Forget a loaded dataset (frees up memory)."""
    body = request.get_json(silent=True) or {}
    SESSIONS.pop(body.get("session_id"), None)
    return jsonify({"ok": True})


# ======================================================================
# START THE SERVER
# ======================================================================

def _port_already_taken(host, port):
    """
    Is something already listening here?

    Windows will happily let a SECOND process bind a port that is already in
    use, and then the OLD process answers some of the requests. That produces
    the most baffling bug in this project: you add a feature, restart, and
    the website still 404s because a stale server is replying. Better to
    refuse to start and say so.
    """
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.4)
        return probe.connect_ex((host, port)) == 0


if __name__ == "__main__":
    # The auto-reloader restarts the server whenever a .py file here changes.
    # Without it, editing engine.py appears to do nothing until you remember
    # to restart by hand - which has caught us out repeatedly. Set
    # AUTO_RELOAD=0 to turn it off. Hosted deployments run under gunicorn and
    # never reach this block at all.
    auto_reload = os.environ.get("AUTO_RELOAD", "1") not in ("0", "false", "False", "no")

    # Only the watcher process should run the pre-flight check; the reloader's
    # child is *expected* to find the port busy.
    if not os.environ.get("WERKZEUG_RUN_MAIN"):
        if _port_already_taken(HOST, PORT):
            print("=" * 62)
            print("  CANNOT START - something is already using port", PORT)
            print("=" * 62)
            print("  Another copy of this server is probably still running.")
            print("  Windows lets two processes share a port, and then the OLD")
            print("  one answers some requests - which looks like your changes")
            print("  did nothing at all.")
            print("")
            print("  Find and stop it:")
            print(f'    netstat -ano | findstr :{PORT}')
            print("    taskkill /F /PID <the number in the last column>")
            print("=" * 62)
            raise SystemExit(1)

        print("=" * 62)
        print("  Momentum Backtest Portal  -  backend server")
        print("=" * 62)
        print(f"  Listening on http://{HOST}:{PORT}")
        print("  (Port 5001 - the Stock Data Downloader project uses 5000.)")
        print(f"  Auto-reload: {'ON - code edits restart it for you' if auto_reload else 'OFF'}")
        print("  Leave this window open while you use the website.")
        print("  Press CTRL+C here to stop it.")
        print("=" * 62)

    app.run(host=HOST, port=PORT, debug=False, threaded=True, use_reloader=auto_reload)
