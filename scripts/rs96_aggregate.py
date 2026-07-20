# -*- coding: utf-8 -*-
"""RS-KR 최종구성 백테스트 Excel → 월별/연도별 성과 집계 + CSV 저장.
성과 대시보드(/performance) 갱신 1단계. 이후 make_rs96_json.py 로 lib/rs96Perf.json 생성.
입력 Excel(F)은 quantBacktest 17_88_cmp_sf1 엔진 산출물(채택 구성). 환경변수로 경로 오버라이드 가능."""
import os
import pandas as pd, numpy as np
F = os.environ.get("RS96_XLSX", r"C:/quantBacktest/screen/backtest_result_17_88_dash_final.xlsx")
OUT = os.path.dirname(os.path.abspath(__file__))   # 중간 CSV 는 scripts/ 에 생성

xl = pd.ExcelFile(F)
tr = xl.parse("KR_거래"); eq = xl.parse("KR_자산")
eq["date"] = pd.to_datetime(eq["date"]); eq = eq.sort_values("date").reset_index(drop=True)
tr["entry_date"] = pd.to_datetime(tr["entry_date"]); tr["exit_date"] = pd.to_datetime(tr["exit_date"])

# ── NAV + dd (자산곡선) ──
eq["dd"] = eq["equity"] / eq["equity"].cummax() - 1
BASE = eq["equity"].iloc[0]

# ── 월별 집계 ──
eq["ym"] = eq["date"].dt.strftime("%Y-%m")
mrows = []
prev_end = BASE
for ym, g in eq.groupby("ym"):
    nav_end = g["equity"].iloc[-1]; nav_start = prev_end
    ret = nav_end / nav_start - 1
    mdd = (g["equity"] / g["equity"].cummax() - 1).min()   # 월내 낙폭(월시작 대비 근사)
    # 그 달 청산 거래
    ex = tr[tr["exit_date"].dt.strftime("%Y-%m") == ym]
    n = len(ex); win = (ex["pnl_%"] > 0).mean()*100 if n else 0
    avg = ex["pnl_%"].mean() if n else 0
    pnl = ex["pnl_$"].sum() if n else 0
    mrows.append(dict(month=ym, nav_start=nav_start, nav_end=nav_end, return_pct=ret*100,
                      mdd_pct=mdd*100, num_trades=n, win_rate=win, avg_ret=avg, realized_pnl=pnl))
    prev_end = nav_end
monthly = pd.DataFrame(mrows)

# ── 연도별 집계 (+ KOSPI/KOSDAQ 벤치마크) ──
eq["yr"] = eq["date"].dt.year
yrows = []
prev_end = BASE
kospi0 = eq["KOSPI"].iloc[0]; kosdaq0 = eq["KOSDAQ"].iloc[0]
prev_ks = kospi0; prev_kq = kosdaq0
for yr, g in eq.groupby("yr"):
    nav_end = g["equity"].iloc[-1]
    ret = nav_end / prev_end - 1
    mdd = (g["equity"] / g["equity"].cummax() - 1).min()
    ks_end = g["KOSPI"].iloc[-1]; kq_end = g["KOSDAQ"].iloc[-1]
    ks_ret = ks_end/prev_ks - 1; kq_ret = kq_end/prev_kq - 1
    ex = tr[tr["exit_date"].dt.year == yr]
    n = len(ex); win = (ex["pnl_%"] > 0).mean()*100 if n else 0
    avg = ex["pnl_%"].mean() if n else 0; pnl = ex["pnl_$"].sum() if n else 0
    yrows.append(dict(year=yr, return_pct=ret*100, mdd_pct=mdd*100, kospi=ks_ret*100,
                      kosdaq=kq_ret*100, num_trades=n, win_rate=win, avg_ret=avg, realized_pnl=pnl))
    prev_end = nav_end; prev_ks = ks_end; prev_kq = kq_end
yearly = pd.DataFrame(yrows)

# ── 전체 지표 ──
yrs = (eq["date"].iloc[-1]-eq["date"].iloc[0]).days/365.25
cagr = (eq["equity"].iloc[-1]/BASE)**(1/yrs)-1
mdd_all = eq["dd"].min()
print(f"전체: CAGR {cagr*100:.2f}% · MDD {mdd_all*100:.2f}% · Calmar {cagr/abs(mdd_all):.2f} "
      f"· 거래 {len(tr)} · 승률 {(tr['pnl_%']>0).mean()*100:.1f}% · 평균 {tr['pnl_%'].mean():+.2f}% "
      f"· 최종 {eq['equity'].iloc[-1]/BASE:.2f}배 · 기간 {yrs:.1f}년")

print("\n연도별 성과 (전략 vs KOSPI vs KOSDAQ)")
print(f"{'연도':>6} {'전략':>8} {'MDD':>8} {'KOSPI':>8} {'KOSDAQ':>8} {'거래':>5} {'승률':>6} {'평균':>7}")
for _, r in yearly.iterrows():
    print(f"{int(r.year):>6} {r.return_pct:>+7.1f}% {r.mdd_pct:>7.1f}% {r.kospi:>+7.1f}% "
          f"{r.kosdaq:>+7.1f}% {int(r.num_trades):>5} {r.win_rate:>5.0f}% {r.avg_ret:>+6.1f}%")

# 청산사유 분포
print("\n청산사유:", " · ".join(f"{k} {v}" for k,v in tr["exit_reason"].str.replace(r'\(.*\)','',regex=True).value_counts().items()))

monthly.to_csv(f"{OUT}/rs96_monthly.csv", index=False)
yearly.to_csv(f"{OUT}/rs96_yearly.csv", index=False)
eq[["date","equity","dd","positions","cash","KOSPI","KOSDAQ"]].to_csv(f"{OUT}/rs96_nav.csv", index=False)
tr.to_csv(f"{OUT}/rs96_trades.csv", index=False)
print(f"\n저장: rs96_monthly/yearly/nav/trades.csv")
