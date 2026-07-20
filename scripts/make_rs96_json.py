# -*- coding: utf-8 -*-
"""RS96 성과 CSV(집계) → 앱 내장 JSON(lib/rs96Perf.json) 생성.
성과 대시보드(/performance) 갱신 2단계(rs96_aggregate.py 다음). 구성: meta/yearly/monthly/trades. 원화 1억 base."""
import os
import pandas as pd, numpy as np, json
SP = os.path.dirname(os.path.abspath(__file__))                       # 중간 CSV(rs96_aggregate.py 산출)
APP = os.path.join(os.path.dirname(SP), "lib", "rs96Perf.json")       # scripts/ → ../lib/rs96Perf.json

mon = pd.read_csv(f"{SP}/rs96_monthly.csv")
yr  = pd.read_csv(f"{SP}/rs96_yearly.csv")
tr  = pd.read_csv(f"{SP}/rs96_trades.csv")
nav = pd.read_csv(f"{SP}/rs96_nav.csv")
nav["date"] = pd.to_datetime(nav["date"])
BASE = nav["equity"].iloc[0]
try:
    hld = pd.read_csv(f"{SP}/rs96_held.csv")
except Exception:
    hld = pd.DataFrame(columns=["month","ticker","name","entry","entryPx","meClose","evalPct","evalPnl","mEvalPct","mEvalPnl","rs"])

def d(x): return None if pd.isna(x) else round(float(x), 2)
def i(x): return None if pd.isna(x) else int(x)

# meta
yrs = (nav["date"].iloc[-1]-nav["date"].iloc[0]).days/365.25
cagr = (nav["equity"].iloc[-1]/BASE)**(1/yrs)-1
mdd = (nav["equity"]/nav["equity"].cummax()-1).min()
meta = dict(
    cagr=round(cagr*100,2), mdd=round(mdd*100,2), calmar=round(cagr/abs(mdd),2),
    nTrades=int(len(tr)), winRate=round((tr["pnl_%"]>0).mean()*100,1),
    avgRet=round(tr["pnl_%"].mean(),2), finalMult=round(nav["equity"].iloc[-1]/BASE,2),
    start=nav["date"].iloc[0].strftime("%Y-%m-%d"), end=nav["date"].iloc[-1].strftime("%Y-%m-%d"),
    base=int(BASE),
    config="영업이익 C≥25% + 거래대금 상위20% + ATR 0.7%·2×ATR + EMA 트레일링(+20%→21EMA/+50%→50EMA) + −8% 손절",
)

yearly = [dict(year=int(r.year), ret=d(r.return_pct), mdd=d(r.mdd_pct),
               kospi=d(r.kospi), kosdaq=d(r.kosdaq), num=i(r.num_trades),
               win=round(r.win_rate,0), avg=d(r.avg_ret), pnl=int(r.realized_pnl))
          for _, r in yr.iterrows()]

monthly = [dict(month=r.month, ret=d(r.return_pct), mdd=d(r.mdd_pct), num=i(r.num_trades),
                win=round(r.win_rate,0), avg=d(r.avg_ret), pnl=int(r.realized_pnl))
           for _, r in mon.iterrows()]

# trades — 상세용 (exit 기준 정렬)
tr["entry_date"] = pd.to_datetime(tr["entry_date"]).dt.strftime("%Y-%m-%d")
tr["exit_date"]  = pd.to_datetime(tr["exit_date"]).dt.strftime("%Y-%m-%d")
trades = [dict(ticker=str(r.ticker), name=str(r["name"]),
               entry=r.entry_date, exit=r.exit_date,
               entryPx=d(r.entry_price), exitPx=d(r.exit_price),
               retPct=d(r["pnl_%"]), pnl=int(r["pnl_$"]), days=i(r.hold_days),
               reason=str(r.exit_reason), rs=i(r.entry_rs), ca=str(r.ca_pass))
          for _, r in tr.iterrows()]

# 월말 보유종목 → {YYYY-MM: [포지션...]} (평가손익 큰 순)
held = {}
for m, g in hld.groupby("month"):
    g = g.sort_values("mEvalPnl", ascending=False)   # 이번달 기여 큰 순
    held[str(m)] = [dict(ticker=str(r.ticker), name=str(r["name"]), entry=str(r.entry),
                         entryPx=d(r.entryPx), close=d(r.meClose), evalPct=d(r.evalPct),
                         evalPnl=int(r.evalPnl), mEvalPct=d(r.mEvalPct), mEvalPnl=int(r.mEvalPnl),
                         rs=i(r.rs)) for _, r in g.iterrows()]

out = dict(meta=meta, yearly=yearly, monthly=monthly, trades=trades, held=held)
with open(APP, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print(f"저장: {APP}  ({os.path.getsize(APP)//1024} KB)")
print(f"meta: {meta}")
print(f"yearly {len(yearly)} · monthly {len(monthly)} · trades {len(trades)} · 보유월 {len(held)}")
