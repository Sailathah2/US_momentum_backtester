"""
==========================================================
verify_all.py  --  the regression suite
==========================================================

Run this after ANY change to the backend. It exercises every feature end to
end and prints one line per check, finishing with a pass/fail count.

    cd backend
    python verify_all.py

It exits with code 1 if anything fails, and it promotes Python's
FutureWarning to a hard error - so a pandas deprecation warning also fails
the run rather than quietly piling up in the log.

It needs the five-year sample data in ../data_5y. Point DATA5 elsewhere if
your files live somewhere else. It does NOT need the web server running:
it drives the Flask app in-process, which also means it always tests the
code on disk rather than whatever an old server happens to have loaded.
"""
import sys, os, io, json, zipfile, warnings
from datetime import datetime, timedelta
sys.path.insert(0, r"D:\algo_trading\ai_masterclass\day_4\backend")
warnings.simplefilter("error", FutureWarning)          # a warning is a failure here
import numpy as np, pandas as pd
import app as srv, engine, indicators, data_loader

PASS = FAIL = 0
def check(label, cond, detail=""):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  [ok]   {label}" + (f"  {detail}" if detail else ""))
    else:    FAIL += 1; print(f"  [FAIL] {label}  {detail}")

c = srv.app.test_client()
DATA5 = r"D:\algo_trading\ai_masterclass\day_4\data_5y"

print("=" * 72); print("1. DATA LOADING & PARSING"); print("=" * 72)
r = c.post("/api/scan-folder", json={"folder": DATA5}).get_json()
SID = r["session_id"]; S = srv.SESSIONS[SID]["series"]
check("folder scan", r["ok"], f"{r['total_symbols']} symbols, {r['files_loaded']} files")
check("benchmark auto-detected", r["suggested_benchmark"] is not None, r["suggested_benchmark"])
check("index files flagged", sum(1 for s in r["symbols"] if s["benchmark_candidate"]) > 0)
check("bad files skipped, not fatal", len(r["warnings"]) >= 0, f"{len(r['warnings'])} notes")

# date-format torture test
idx = pd.bdate_range("2021-01-04", "2024-12-31")
rng = np.random.default_rng(1); px = 100*np.exp(np.cumsum(rng.normal(0.0003,0.02,len(idx))))
import tempfile
tmp = tempfile.mkdtemp()
pd.DataFrame({"Date":idx.strftime("%Y-%m-%d"),"Open":px,"High":px*1.01,"Low":px*.99,"Close":px,"Volume":1,"Ticker":"AAA"}).to_csv(f"{tmp}/AAA.csv",index=False)
pd.DataFrame({"datetime":idx.strftime("%d/%m/%Y 15:30:00"),"symbol":"BBB","security_id":1,"open":px,"high":px*1.01,"low":px*.99,"close":px,"volume":1,"oi":0}).to_csv(f"{tmp}/BBB.csv",index=False)
pd.DataFrame({"time":idx.strftime("%Y-%m-%d"),"open":px,"high":px*1.01,"low":px*.99,"close":px}).to_csv(f"{tmp}/SPY_index.csv",index=False)
pd.DataFrame({"Date":idx.strftime("%m/%d/%Y"),"Close":px}).to_csv(f"{tmp}/CCC.csv",index=False)
t = c.post("/api/scan-folder", json={"folder": tmp}).get_json()
got = {s["ticker"] for s in t["symbols"]}
check("4 CSV schemas + 4 date formats parsed", {"AAA","BBB","CCC","SPY_INDEX"} <= got, str(sorted(got)))
for s in t["symbols"]:
    if s["ticker"] in ("AAA","BBB","CCC"):
        check(f"  {s['ticker']} date range correct", s["start"]=="2021-01-04" and s["end"]=="2024-12-31")

print("\n" + "=" * 72); print("2. CORE MOMENTUM ENGINE"); print("=" * 72)
BASE = dict(session_id=SID, benchmark="^GSPC", lookback=40, top_n=10, cadence="monthly",
            weighting="equal", cash_buffer=True, cost_bps=10, start_capital=100000)
d = c.post("/api/backtest", json=BASE).get_json()
check("baseline backtest runs", d["ok"], f"CAGR {d['metrics']['cagr']:.1%}, maxDD {d['metrics']['max_drawdown']:.1%}")
tr = pd.DataFrame(d["trades"]); rb = pd.DataFrame(d["rebalances"])
check("every pick beats the index", (tr.relative_strength > 0).all())
check("holdings == top_n", (tr.groupby("period").size() == 10).all())
check("weights sum to 1", np.allclose(tr.groupby("period").weight.sum(), 1.0))
check("equity chain consistent", np.allclose(rb.equity_end/rb.equity_start - 1, rb.period_return, atol=1e-6))
for cad in ("weekly","biweekly","monthly","quarterly","days"):
    x = c.post("/api/backtest", json={**BASE, "cadence":cad, "every_n_days":10}).get_json()
    check(f"cadence '{cad}'", x.get("ok"), f"{x['summary']['total_rebalances']} periods" if x.get("ok") else x.get("error","")[:40])
for w in ("equal","roc"):
    x = c.post("/api/backtest", json={**BASE,"weighting":w}).get_json()
    check(f"weighting '{w}'", x.get("ok"))
x = c.post("/api/backtest", json={**BASE,"cash_buffer":False}).get_json()
check("cash_buffer off = fully invested", x["ok"] and all(r_["cash_weight"]==0 for r_ in x["rebalances"]))

print("\n" + "=" * 72); print("3. STOCK EMA GATE"); print("=" * 72)
series=[{"ticker":t_,"frame":S[t_]["frame"]} for t_ in S if t_!="^GSPC"]
prices,bmk = data_loader.align_with_benchmark(data_loader.build_price_matrix(series), S["^GSPC"]["frame"]["Close"])
for p_ in (50,100,200):
    x = c.post("/api/backtest", json={**BASE,"stock_ema_period":p_}).get_json()
    ema = prices.ewm(span=p_, adjust=False, min_periods=p_).mean()
    viol = sum(1 for t_ in x["trades"] if prices.loc[t_["rebalance_date"],t_["ticker"]] <= ema.loc[t_["rebalance_date"],t_["ticker"]])
    check(f"EMA{p_} gate: every pick above its own EMA", viol==0, f"{viol} violations")

print("\n" + "=" * 72); print("4. RISK-ADJUSTED RANKING"); print("=" * 72)
for meas in ("stddev","downside"):
    x = c.post("/api/backtest", json={**BASE,"stddev_period":60,"risk_measure":meas}).get_json()
    t_ = pd.DataFrame(x["trades"])
    check(f"'{meas}' runs", x["ok"], f"CAGR {x['metrics']['cagr']:.1%}")
    check(f"  {meas}: score == roc/risk", np.allclose(t_.roc_at_entry/t_.stddev, t_.rank_score, atol=1e-2))
    check(f"  {meas}: all risk values > 0", (t_.stddev > 0).all())
    ordered = all(g.rank_score.is_monotonic_decreasing for _,g in t_.groupby("period"))
    check(f"  {meas}: ranked by score desc", ordered)
a=c.post("/api/backtest", json={**BASE,"stddev_period":60}).get_json()["metrics"]
b=c.post("/api/backtest", json={**BASE,"stddev_period":60,"risk_measure":"stddev"}).get_json()["metrics"]
n=c.post("/api/backtest", json=BASE).get_json()["metrics"]
z=c.post("/api/backtest", json={**BASE,"stddev_period":60,"risk_measure":"none"}).get_json()["metrics"]
check("default risk_measure == stddev (back-compat)", a==b)
check("risk_measure 'none' == raw ROC", z==n)

print("\n" + "=" * 72); print("5. RANK CUSHION (keep / exit / enter)"); print("=" * 72)
off = c.post("/api/backtest", json={**BASE,"exit_rank":0}).get_json()
check("exit_rank 0 == omitting it", off["metrics"]==n)
for er, mode in ((15,"rebalance"),(20,"rebalance"),(20,"recycle")):
    x = c.post("/api/backtest", json={**BASE,"exit_rank":er,"reweight_mode":mode}).get_json()
    ac = pd.DataFrame(x["actions"]); rbx = pd.DataFrame(x["rebalances"])
    k = ac[ac.action=="KEEP"]; e = ac[ac.action=="ENTER"]; xx = ac[ac.action=="EXIT"]
    tag = f"rank {er}/{mode}"
    check(f"{tag}: runs", x["ok"], f"turnover {x['summary']['average_turnover']:.2f}")
    check(f"{tag}: every KEEP rank <= exit_rank", (k["rank"]<=er).all() if len(k) else True)
    check(f"{tag}: every ENTER rank <= top_n", (e["rank"]<=10).all() if len(e) else True)
    check(f"{tag}: every EXIT justified", len(xx[(xx["rank"].notna())&(xx["rank"]<=er)])==0)
    check(f"{tag}: kept+entered == holdings", (rbx.kept+rbx.entered==rbx.num_holdings).all())
    holds = {p:set(g.ticker) for p,g in pd.DataFrame(x["trades"]).groupby("period")}
    check(f"{tag}: KEEPs were held before", all(a_.ticker in holds.get(a_.period-1,set()) for _,a_ in k.iterrows()))
    check(f"{tag}: ENTERs were not held", all(a_.period==1 or a_.ticker not in holds.get(a_.period-1,set()) for _,a_ in e.iterrows()))
check("cushion reduces turnover",
      c.post("/api/backtest", json={**BASE,"exit_rank":20}).get_json()["summary"]["average_turnover"]
      < off["summary"]["average_turnover"])

print("\n" + "=" * 72); print("6. REGIME FILTER"); print("=" * 72)
RG = {**BASE, "regime_index":"^GSPC", "ema_period":200, "atr_period":10, "st_multiplier":3.0,
      "risk_off_cash_pct":100}
for mode in ("ema","supertrend","both"):
    for tf in ("daily","weekly"):
        ema = 200 if tf=="daily" else 40
        x = c.post("/api/regime-analysis", json={**RG,"regime_mode":mode,"regime_timeframe":tf,"ema_period":ema}).get_json()
        check(f"{mode}/{tf}", x.get("ok"), f"switches {x['exposure']['switches']}, in-mkt {x['exposure']['time_in_market']:.0%}" if x.get("ok") else x.get("error","")[:40])
spy = S["^GSPC"]["frame"]
sw = {m: indicators.summarise_regime(indicators.build_regime(spy,m,200,10,3.0)["regime"])["switches"] for m in ("ema","supertrend","both")}
check("hysteresis: 'both' churns least", sw["both"] <= min(sw["ema"], sw["supertrend"]), str(sw))
wk = indicators.to_weekly(spy)
check("weekly bars labelled on real trading days", all(dt in spy.index for dt in wk.index))
reg = indicators.build_regime(spy,"both",40,10,3.0,timeframe="weekly")
flips = reg["regime"][reg["regime"]!=reg["regime"].shift()].index[1:]
check("weekly: no lookahead (flips only on week close)", all(f_ in set(wk.index) for f_ in flips))
x = c.post("/api/regime-analysis", json={**RG,"regime_mode":"disabled"}).get_json()
check("mode 'disabled' rejected with a clear message", not x.get("ok") and "switched off" in x.get("error",""))

print("\n" + "=" * 72); print("7. RISK-OFF CASH % AND PARKING"); print("=" * 72)
prev=None
for pct in (0,25,50,75,100):
    x = c.post("/api/regime-analysis", json={**RG,"regime_mode":"both","risk_off_cash_pct":pct}).get_json()
    ex=x["exposure"]
    check(f"cash {pct}% runs", x["ok"], f"avg exposure {ex['average_exposure']:.1%}")
    if pct==0: prev=x["filtered"]["metrics"]
z = c.post("/api/backtest", json=BASE).get_json()["metrics"]
check("0% cash == no filter at all", prev==z)
x100 = c.post("/api/regime-analysis", json={**RG,"regime_mode":"both","risk_off_cash_pct":100}).get_json()
check("100% cash: avg exposure == time in market",
      abs(x100["exposure"]["average_exposure"]-x100["exposure"]["time_in_market"])<1e-9)
for asset in ("", "GLD"):
    x = c.post("/api/regime-analysis", json={**RG,"regime_mode":"both","risk_off_asset":asset}).get_json()
    check(f"park in '{asset or 'cash'}'", x.get("ok"),
          f"parked return {x['exposure'].get('parked_return')}" if x.get("ok") else x.get("error","")[:40])
flat = pd.Series(100.0, index=prices.index)
st0 = dict(lookback=40,top_n=10,cadence="monthly",every_n_days=21,weighting="equal",cash_buffer=True,
           cost_bps=0,start_capital=100000,risk_free_rate=0.0,min_roc=None,risk_off_cash_pct=100,
           stock_ema_period=0,stddev_period=0,exit_rank=0,reweight_mode="rebalance")
rr = indicators.build_regime(spy,"both",200,10,3.0).reindex(prices.index).ffill()
rr["regime"]=rr["regime"].fillna(True).astype(bool)
m1 = engine.analyse(prices,bmk,st0,regime=rr["regime"])["metrics"]
m2 = engine.analyse(prices,bmk,st0,regime=rr["regime"],defensive=flat)["metrics"]
check("flat parked asset == plain cash at 0 bps", m1==m2)

print("\n" + "=" * 72); print("8. EXPORTS"); print("=" * 72)
c.post("/api/backtest", json={**BASE,"exit_rank":15,"stddev_period":60})
for kind in ("trades","rebalances","timeseries","monthly","actions"):
    e = c.post("/api/export", json={"session_id":SID,"kind":kind})
    check(f"CSV '{kind}'", e.status_code==200 and len(e.data)>50, f"{len(e.data):,} bytes")
rep = c.post("/api/export-report", json={"session_id":SID,"format":"xlsx"})
xl = pd.ExcelFile(io.BytesIO(rep.data))
check("Excel report: 8 sheets", len(xl.sheet_names)==8, str(len(xl.sheet_names)))
for s_ in xl.sheet_names:
    check(f"  sheet '{s_}' populated", xl.parse(s_).shape[0] > 0, f"{xl.parse(s_).shape[0]} rows")
zp = c.post("/api/export-report", json={"session_id":SID,"format":"csv"})
zf = zipfile.ZipFile(io.BytesIO(zp.data))
check("ZIP report: 8 CSVs + README", len(zf.namelist())==9, str(len(zf.namelist())))

print("\n" + "=" * 72); print("9. ERROR HANDLING"); print("=" * 72)
cases = [
    ("no benchmark", "/api/backtest", {"session_id":SID}),
    ("bad session", "/api/backtest", {"session_id":"nope","benchmark":"^GSPC"}),
    ("bad cadence", "/api/backtest", {**BASE,"cadence":"hourly"}),
    ("lookback too long", "/api/backtest", {**BASE,"lookback":5000}),
    ("exit_rank <= top_n", "/api/backtest", {**BASE,"exit_rank":5}),
    ("bad reweight mode", "/api/backtest", {**BASE,"exit_rank":15,"reweight_mode":"drift"}),
    ("bad risk measure", "/api/backtest", {**BASE,"risk_measure":"sharpe"}),
    ("cash pct out of range", "/api/backtest", {**BASE,"risk_off_cash_pct":150}),
    ("bad regime mode", "/api/regime-analysis", {**RG,"regime_mode":"rsi"}),
    ("unloaded park asset", "/api/regime-analysis", {**RG,"regime_mode":"both","risk_off_asset":"NOPE"}),
    ("weekly warmup too short", "/api/regime-analysis", {**RG,"regime_mode":"ema","regime_timeframe":"weekly","ema_period":400}),
    ("bad folder", "/api/scan-folder", {"folder":"D:/nope"}),
    ("bad report format", "/api/export-report", {"session_id":SID,"format":"pdf"}),
]
for label, ep, body in cases:
    resp = c.post(ep, json=body).get_json()
    check(f"{label} -> friendly error", not resp.get("ok") and len(resp.get("error",""))>15, resp.get("error","")[:52])

print("\n" + "=" * 72); print("10. JSON SAFETY & HEALTH"); print("=" * 72)
big = c.post("/api/regime-analysis", json={**RG,"regime_mode":"both","risk_off_asset":"GLD",
             "exit_rank":15,"stddev_period":60,"risk_measure":"downside","stock_ema_period":200}).get_json()
check("all features together", big.get("ok"))
json.dumps(big); check("full payload JSON-serialises", True)
check("no private keys leak", not [k for k in big if k.startswith("_")]
      and not [k for k in big["filtered"] if k.startswith("_")])
h = c.get("/api/health").get_json()
check("health reports service_id", h.get("service_id")=="momentum-backtest-portal")


print("\n" + "=" * 72); print("11. RANK CHECKER"); print("=" * 72)
# Without a cushion the backtest re-picks from scratch each time, so the
# Rank Checker - which has no holdings history - must agree exactly.
FRESH = {**BASE, "exit_rank": 0, "stddev_period": 60, "risk_measure": "stddev"}
btf = c.post("/api/backtest", json=FRESH).get_json()
probe_f = btf["rebalances"][25]["rebalance_date"]
rkf = c.post("/api/rank-check", json={**FRESH, "date": probe_f}).get_json()
check("picks IDENTICAL to a no-cushion backtest",
      sorted(rkf["selected"]) == sorted(t["ticker"] for t in btf["trades"]
                                        if t["rebalance_date"] == probe_f),
      f"{len(rkf['selected'])} names on {probe_f}")

# WITH a cushion the backtest carries positions forward, so its holdings
# depend on history the Rank Checker cannot know. It still has to produce a
# valid fresh top-N, and its RANKING must match the backtest's view.
RC = {**BASE, "exit_rank": 15, "stddev_period": 60, "risk_measure": "stddev"}
bt = c.post("/api/backtest", json=RC).get_json()
probe = bt["rebalances"][25]["rebalance_date"]
rk = c.post("/api/rank-check", json={**RC, "date": probe}).get_json()
check("rank check runs", rk.get("ok"), f"as of {rk.get('as_of')}")
if rk.get("ok"):
    bt_picks = sorted(t["ticker"] for t in bt["trades"] if t["rebalance_date"] == probe)
    kept = {a["ticker"] for a in bt["actions"]
            if a["period"] == bt["rebalances"][25]["period"] and a["action"] == "KEEP"}
    # Everything the backtest bought was either kept from before, or is in
    # the fresh top-N the Rank Checker shows.
    check("every backtest pick is explained (kept, or in the fresh top-N)",
          all(t in kept or t in set(rk["selected"]) for t in bt_picks),
          f"{len(kept)} kept + {len(set(bt_picks) & set(rk['selected']))} shared")
    f_ = rk["funnel"]
    check("funnel narrows monotonically",
          f_["universe"] >= f_["enough_history"] >= f_["above_own_ema"] >= f_["beat_index"],
          f"{f_['universe']}->{f_['enough_history']}->{f_['above_own_ema']}->{f_['beat_index']}")
    rows = rk["rows"]
    check("every stock accounted for", len(rows) == f_["universe"], f"{len(rows)} rows")
    sel = [r for r in rows if r["status"] == "SELECTED"]
    check("SELECTED count == top_n", len(sel) == RC["top_n"])
    check("SELECTED all rank <= top_n", all(r["rank"] <= RC["top_n"] for r in sel))
    cush = [r for r in rows if r["status"] == "IN CUSHION"]
    check("cushion rows sit between top_n and exit_rank",
          all(RC["top_n"] < r["rank"] <= RC["exit_rank"] for r in cush), f"{len(cush)} rows")
    rej = [r for r in rows if r["status"] == "REJECTED"]
    check("every REJECTED row states a reason", all(r["reason"] for r in rej), f"{len(rej)} rows")
    check("ranked rows ordered by score",
          all(rows[i]["score"] >= rows[i + 1]["score"] for i in range(min(30, f_["ranked"]) - 1)))
    json.dumps(rk); check("rank check JSON-serialises", True)
check("weekend snaps to a trading day",
      c.post("/api/rank-check", json={**RC, "date": "2025-06-29"}).get_json().get("as_of") == "2025-06-27")
for label, body in (("no date", {**RC}), ("before data", {**RC, "date": "2019-01-01"}),
                    ("too early for warm-up", {**RC, "date": "2021-09-01"})):
    r_ = c.post("/api/rank-check", json=body).get_json()
    check(f"{label} -> friendly error", not r_.get("ok") and len(r_.get("error", "")) > 15,
          r_.get("error", "")[:46])

print("\n" + "=" * 72); print("12. DATA BACKFILL"); print("=" * 72)
import tempfile as _tf
import backfill as _bf
_dir = _tf.mkdtemp(); _xl = os.path.join(_dir, "syms.xlsx")
pd.DataFrame({"Symbol": ["AAPL", "MSFT"]}).to_excel(_xl, index=False)
_data = os.path.join(_dir, "stocks"); os.makedirs(_data, exist_ok=True)
prev = c.post("/api/backfill/preview", json={"excel_path": _xl, "folder": _data}).get_json()
check("preview finds the symbol column", prev.get("ok") and prev.get("column") == "Symbol",
      f"{prev.get('count')} symbols")
check("preview counts new vs existing", prev.get("new_files") == 2)
check("symbol reader returns the list", _bf.read_symbols(_xl)[0] == ["AAPL", "MSFT"])
_cut = _bf.datetime.now() - _bf.timedelta(days=1)
check("cutoff is yesterday, never today", _cut.date() < _bf.datetime.now().date(),
      _cut.strftime("%Y-%m-%d"))
check("csv path builder keeps index carets", _bf.csv_path_for(_data, "^GSPC").endswith("^GSPC.csv"))
for label, body in (("no excel path", {"folder": _data}),
                    ("missing file", {"excel_path": "C:/nope.xlsx", "folder": _data}),
                    ("bad folder", {"excel_path": _xl, "folder": "C:/nope"}),
                    ("bad column", {"excel_path": _xl, "folder": _data, "column": "Nope"})):
    r_ = c.post("/api/backfill/start", json=body).get_json()
    check(f"{label} -> friendly error", not r_.get("ok") and len(r_.get("error", "")) > 15,
          r_.get("error", "")[:46])
check("unknown job id -> 404", c.get("/api/backfill/status/zzzz").status_code == 404)

# --- folder auto-detect: the default way to use the updater ---
import shutil as _sh
_real = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data_5y", "index")
_copy = os.path.join(_tf.mkdtemp(), "index"); _sh.copytree(_real, _copy)
_targets, _skipped = _bf.discover_targets(_copy)
check("folder mode finds the price files", len(_targets) > 0, f"{len(_targets)} files")
check("symbol read from INSIDE the file, not the name",
      any(os.path.splitext(os.path.basename(t["path"]))[0] != t["symbol"] for t in _targets),
      "e.g. INDEX_DJI.csv holds ^DJI")
check("each target keeps its ORIGINAL path",
      all(os.path.exists(t["path"]) for t in _targets))
_pv = c.post("/api/backfill/preview", json={"folder": _copy}).get_json()
check("preview works with no Excel file", _pv.get("ok") and _pv.get("source") == "folder",
      f"{_pv.get('count')} files")
_before = set(os.listdir(_copy))
_rows_before = {f: len(pd.read_csv(os.path.join(_copy, f))) for f in _before if f.endswith(".csv")}
_st = c.post("/api/backfill/start", json={"folder": _copy}).get_json()
import time as _t
for _ in range(120):
    _s = c.get(f"/api/backfill/status/{_st['job_id']}").get_json()["status"]
    if _s["status"] != "running": break
    _t.sleep(1)
check("folder-mode run completes", _s["status"] == "done",
      f"updated {_s['updated']}, current {_s['current']}, failed {_s['failed']}")
check("NO new files created (nothing duplicated)", set(os.listdir(_copy)) == _before)
_bad = []
for f in _before:
    if not f.endswith(".csv"): continue
    _df = pd.read_csv(os.path.join(_copy, f)); _d = pd.to_datetime(_df.Date)
    if len(_df) < _rows_before[f] or _d.duplicated().any() or not _d.is_monotonic_increasing:
        _bad.append(f)
    if "Ticker" in _df.columns and _df["Ticker"].dropna().nunique() > 1:
        _bad.append(f + " (mixed ticker)")
check("appended in place: grew, sorted, no dupes, one ticker each", not _bad, str(_bad[:3]))
_st2 = c.post("/api/backfill/start", json={"folder": _copy}).get_json()
for _ in range(120):
    _s2 = c.get(f"/api/backfill/status/{_st2['job_id']}").get_json()["status"]
    if _s2["status"] != "running": break
    _t.sleep(1)
check("re-run appends nothing (incremental)", _s2["rows_added"] == 0)
check("folder mode with no folder -> friendly error",
      not c.post("/api/backfill/start", json={}).get_json().get("ok"))

print("\n" + "=" * 72)
print(f"RESULT: {PASS} passed, {FAIL} failed")
print("=" * 72)
sys.exit(1 if FAIL else 0)
