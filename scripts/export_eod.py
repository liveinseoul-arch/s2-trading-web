#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""S2 트레이딩 따라하기 · EOD 익스포터 (Phase 1).

기존 검증 엔진(s2_candidates.reconstruct 로직 = 무비용·0버퍼 손절·최종 운용안)을 시작자본부터
전 구간 시뮬레이션해, 웹 서비스용 데이터를 산출하고 Supabase에 적재한다.

산출(테이블): executions · position_snapshots · nav_daily · trades · trade_legs ·
             monthly_stats · daily_order_plan(최신일) · meta

사용:
  python export_eod.py --dry-run            # Supabase 없이 로컬 CSV(_dryrun/) + 요약만
  python export_eod.py --end 2026-05-27     # 특정일까지 시뮬레이션
  python export_eod.py                       # 전체 재계산 후 Supabase upsert(멱등)

환경변수(적재 모드): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (../.env.local 의 KRX_* 와 별도)
경로: s2_method/ 의 config.py·backtest.py 를 import 하므로 부모 폴더가 sys.path 에 있어야 함(자동 처리).
"""
from __future__ import annotations
import argparse, os, sys, json
from datetime import date
from pathlib import Path
import pandas as pd

# 부모(s2_method) 폴더의 엔진 모듈 import
ROOT = Path(__file__).resolve().parents[2]      # .../s2_method
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))  # scripts/ (notify)
from config import Config                         # noqa: E402
from backtest import _prepare                     # noqa: E402
from notify import telegram_send                  # noqa: E402

# ── 운용안 상수 (s2_candidates 와 동일) ──────────────────────────────
SIZE_ABOVE, SIZE_BELOW, MUSEOB = 0.15, 0.075, 0.80
PROX = 0.05                      # 예비후보 근접 허용폭(지지선 위 5%까지 포함)
MA_LONG, WINDOW, NL_AFTER, MAX_LEV = 120, 60, 2, 1.3
S = (0.03, 0.05, 0.07)
ADD_DROP, MAX_BUY = 0.10, 3
# 매도 차수별 비중 — 1차/2차는 SELL_STAGE_PCT, 3차는 잔량(=1 - 2*SELL_STAGE_PCT).
# 기본 10/10/80. 환경변수 S2_SELL_STAGE_PCT 로 변경 가능 (예: 0.30 → 30/30/40).
SELL_STAGE_PCT = float(os.environ.get("S2_SELL_STAGE_PCT", "0.10"))
# 기간 손절 — 진입 후 N영업일 경과해도 분할매도 한 단계도 못 찍으면 강제 청산.
# 0 = 비활성. 환경변수 S2_TIME_STOP_DAYS 로 활성화 (예: 252 ≈ 12개월).
TIME_STOP_DAYS = int(os.environ.get("S2_TIME_STOP_DAYS", "0"))
MKT = {"KOSPI": "KS", "KOSDAQ": "KQ"}


def load(cfg: Config, end: date):
    """전 구간 px(지표 포함) + 이름/시장 맵 + 스파이크 맵 로드."""
    # days: 기본 4000(~11년). 환경변수 S2_LOOKBACK_DAYS 로 늘릴 수 있음 (예: 5000 ≈ 13.7년).
    days = int(os.environ.get("S2_LOOKBACK_DAYS", "4000"))
    px, nmap, mmap, period_start, meta = _prepare(cfg, days=days, end_date=end, fetch=False)
    px = px.sort_values(["ticker", "date"]).reset_index(drop=True)
    px["ma_long"] = px.groupby("ticker")["close"].transform(
        lambda s: s.rolling(MA_LONG, min_periods=MA_LONG).mean())
    thr = cfg.min_trading_value_krw
    sm, smy = {}, {}
    for tk, g in px.groupby("ticker"):
        ds = g["date"].tolist(); tv = g["trading_value"].tolist()
        op = g["open"].tolist(); cl = g["close"].tolist(); last = -10**9; ly = None
        for k in range(len(ds)):
            if pd.notna(tv[k]) and tv[k] >= thr:
                last = k; ly = bool(cl[k] > op[k])
            within = (k - last) < WINDOW
            sm[(tk, ds[k])] = ds[last] if within else None
            smy[(tk, ds[k])] = ly if within else None
    return px, nmap, mmap, period_start, sm, smy


def simulate(px, nmap, mmap, period_start, sm, smy, start_cap):
    """전 구간 시뮬레이션 → 테이블별 row 리스트 반환."""
    all_dates = sorted(px["date"].unique())
    by_date = {d: {} for d in all_dates}
    for rec in px.to_dict("records"):
        by_date[rec["date"]][rec["ticker"]] = rec

    positions, last_exit = {}, {}
    cash = float(start_cap); peak = cash
    executions, trades, legs, nav_rows, snaps = [], [], [], [], []
    candidates, counts = [], []
    tid_seq = 0
    didx = {d: i for i, d in enumerate(all_dates)}

    def cur_hv(day):
        return sum(p["qty"] * (float(day[t]["close"]) if t in day else p["last_close"])
                   for t, p in positions.items())

    def lev_ok(day, cost):
        hv = cur_hv(day); nav = cash + hv
        return nav > 0 and (hv + cost) <= MAX_LEV * nav

    def ex(d, p, action, stage, price, qty, nav_today, blocked=False):
        executions.append(dict(d=d, ticker=p["tk"], name=p["name"], market=p["market"],
            action=action, stage=stage, fill_price=round(price), qty=int(qty),
            amount=round(price * qty), port_pct=round(price * qty / nav_today * 100, 2) if nav_today > 0 else None,
            ma120_above=p["entry_above"], prev_spike_bull=p["entry_bull"], blocked_by_leverage=blocked))

    def leg(p, d, leg_type, stage, price, qty, nav_today):
        p["legs"].append(dict(d=d, leg_type=leg_type, stage=stage, price=round(price), qty=int(qty),
            amount=round(price * qty), port_pct=round(price * qty / nav_today * 100, 2) if nav_today > 0 else None))

    def close_trade(p, d, reason):
        trades.append(dict(_tid=p["tid"], ticker=p["tk"], name=p["name"], market=p["market"],
            entry_date=p["entry_date"], exit_date=d, buy_count=p["buy_count"],
            max_invested=round(p["cost"]), proceeds=round(p["proc"]),
            pnl=round(p["proc"] - p["cost"]),
            ret_pct=round((p["proc"] / p["cost"] - 1) * 100, 2) if p["cost"] > 0 else None,
            holding_days=didx[d] - didx[p["entry_date"]], exit_reason=reason, status="closed"))
        for lg in p["legs"]:
            legs.append(dict(_tid=p["tid"], **lg))

    for d in all_dates:
        day = by_date[d]; nav_today = cash + cur_hv(day); closed = set()
        for tk in list(positions):
            if tk not in day:
                continue
            p = positions[tk]; r = day[tk]
            op, hi, lo, cl = float(r["open"]), float(r["high"]), float(r["low"]), float(r["close"])
            p["last_close"] = cl
            # 매도단계 후 손절 (장초 갭 포함)
            if p["sell_count"] >= 1 and p["qty"] > 0 and lo <= p["stop"]:
                px_ = op if op < p["stop"] else p["stop"]
                ex(d, p, "stop", p["sell_count"], px_, p["qty"], nav_today)
                leg(p, d, "stop", p["sell_count"], px_, p["qty"], nav_today)
                cash += p["qty"] * px_; p["proc"] += p["qty"] * px_; p["qty"] = 0
                close_trade(p, d, "stop"); del positions[tk]; closed.add(tk); last_exit[tk] = d; continue

            # [옵션 B] 시초 분할매도 — 시가(op) 가 평단×1.03/1.05/1.07 이상이면 시초에 체결로 가정.
            # 시초 갭업 케이스(시가 = 그날 최고 근처) 정확 처리.
            # high/low 순서가 모호한 일봉 시뮬 결함 회피 — 시초 매도 후엔 추가매수 차단(sell_count≥1).
            t = [p["avg_buy"] * (1 + s) for s in S]
            for stg in range(p["sell_count"] + 1, 4):
                if op >= t[stg - 1] and p["qty"] > 0:
                    sq = p["qty"] if stg == 3 else min(round(p["total_qty"] * SELL_STAGE_PCT), p["qty"])
                    ex(d, p, f"sell_{stg}", stg, t[stg - 1], sq, nav_today)
                    leg(p, d, f"sell_{stg}", stg, t[stg - 1], sq, nav_today)
                    cash += sq * t[stg - 1]; p["proc"] += sq * t[stg - 1]
                    p["qty"] -= sq; p["sell_count"] = stg; p["stop"] = t[stg - 1]
                else:
                    break

            bought = False
            # 추가매수 — 시뮬에서는 MAX_BUY 까지 허용 (3차까지). 시뮬 내부 가격 순서가 정확해 충돌 없음.
            # broker 충돌 회피는 build_order_plan 에서 조건부로 처리.
            if p["sell_count"] == 0 and p["buy_count"] < MAX_BUY:
                at = p["last_buy"] * (1 - ADD_DROP)
                if lo <= at:
                    sh = int(p["tranche"] // at)
                    if sh > 0 and lev_ok(day, sh * at):
                        cash -= sh * at; p["cost"] += sh * at
                        p["avg_buy"] = (p["avg_buy"] * p["total_qty"] + at * sh) / (p["total_qty"] + sh)
                        p["total_qty"] += sh; p["qty"] += sh; p["last_buy"] = at; p["buy_count"] += 1; bought = True
                        ex(d, p, "buy_add", p["buy_count"], at, sh, nav_today)
                        leg(p, d, "buy_add", p["buy_count"], at, sh, nav_today)
                    elif sh > 0:
                        ex(d, p, "buy_add", p["buy_count"] + 1, at, sh, nav_today, blocked=True)
            if p["sell_count"] == 0 and p["buy_count"] >= NL_AFTER and not bought and lo < p["min_low"]:
                ex(d, p, "newlow_stop", None, cl, p["qty"], nav_today)
                leg(p, d, "newlow_stop", None, cl, p["qty"], nav_today)
                cash += p["qty"] * cl; p["proc"] += p["qty"] * cl; p["qty"] = 0
                close_trade(p, d, "newlow_stop"); del positions[tk]; closed.add(tk); last_exit[tk] = d
                p["min_low"] = min(p["min_low"], lo); continue
            p["min_low"] = min(p["min_low"], lo)

            # 기간 손절 — TIME_STOP_DAYS 영업일 경과 + 분할매도 한 단계도 못 찍었으면 종가 강제 청산
            if (TIME_STOP_DAYS > 0 and p["sell_count"] == 0
                    and (didx[d] - didx[p["entry_date"]]) >= TIME_STOP_DAYS):
                ex(d, p, "stop", None, cl, p["qty"], nav_today)
                leg(p, d, "stop", None, cl, p["qty"], nav_today)
                cash += p["qty"] * cl; p["proc"] += p["qty"] * cl; p["qty"] = 0
                close_trade(p, d, f"time_stop({TIME_STOP_DAYS}d)")
                del positions[tk]; closed.add(tk); last_exit[tk] = d
                continue

            # [옵션 B] 추가매수 발생일은 hi 기반 분할매도 검사 보류 —
            # high 가 추가매수 전이었는지 후였는지 일봉으로 알 수 없어 보수적 처리.
            # 시초 매도(op) 와 다음 영업일 hi 기반 매도는 그대로 작동.
            if not bought:
                # 평단 갱신됐을 수 있으므로 t 재계산
                t = [p["avg_buy"] * (1 + s) for s in S]
                for stg in range(p["sell_count"] + 1, 4):
                    if hi >= t[stg - 1] and p["qty"] > 0:
                        sq = p["qty"] if stg == 3 else min(round(p["total_qty"] * SELL_STAGE_PCT), p["qty"])
                        ex(d, p, f"sell_{stg}", stg, t[stg - 1], sq, nav_today)
                        leg(p, d, f"sell_{stg}", stg, t[stg - 1], sq, nav_today)
                        cash += sq * t[stg - 1]; p["proc"] += sq * t[stg - 1]
                        p["qty"] -= sq; p["sell_count"] = stg; p["stop"] = t[stg - 1]
                    else:
                        break
            if p["sell_count"] >= 1 and p["qty"] > 0 and lo <= p["stop"]:
                ex(d, p, "stop", p["sell_count"], p["stop"], p["qty"], nav_today)
                leg(p, d, "stop", p["sell_count"], p["stop"], p["qty"], nav_today)
                cash += p["qty"] * p["stop"]; p["proc"] += p["qty"] * p["stop"]; p["qty"] = 0
                close_trade(p, d, "stop"); del positions[tk]; closed.add(tk); last_exit[tk] = d
            elif tk in positions and p["qty"] == 0:
                close_trade(p, d, "sell_3"); del positions[tk]; closed.add(tk); last_exit[tk] = d
        # 예비후보 스캔(근접 포함) + 신규 진입(지지선 이하만 체결)
        n_cand = n_reached = n_bought = n_blocked = 0
        for tk, r in day.items():
            if tk in positions or tk in closed:
                continue
            if not (pd.notna(r["ma20"]) and r["date"] >= period_start):
                continue
            support = float(r["support"]); price = float(r["close"])
            if price > support * (1 + PROX):          # 지지선에서 너무 멀면 후보 아님
                continue
            rs = sm.get((tk, d))
            if rs is None or (tk in last_exit and not (rs > last_exit[tk])):
                continue
            ml = r.get("ma_long"); above = bool(pd.notna(ml) and price > ml); bull = smy.get((tk, d))
            sz = SIZE_ABOVE if above else SIZE_BELOW
            if bull is False:
                sz *= MUSEOB
            reached = price < support
            candidates.append(dict(d=d, ticker=tk, kind="new", name=nmap.get(tk, ""),
                market=MKT.get(mmap.get(tk, ""), mmap.get(tk, "")), current_price=round(price),
                order_price=int(support), port_pct=round(sz * 100, 2), ma120_above=above,
                prev_spike_bull=bull, stage=1, reached=reached,
                drop_to_pct=round((support / price - 1) * 100, 2), snapshot_at=f"{d}T15:30:00+09:00"))
            n_cand += 1
            if not reached:                            # 근접(지지선 위) → 후보만, 체결 안 함
                continue
            n_reached += 1
            amt = sz * nav_today; sh = int(amt // price)
            if sh <= 0:
                continue
            stub = dict(tk=tk, name=nmap.get(tk, ""), market=MKT.get(mmap.get(tk, ""), mmap.get(tk, "")),
                        entry_above=above, entry_bull=bull, buy_count=1)
            if not lev_ok(day, sh * price):
                ex(d, stub, "buy_new", 1, price, sh, nav_today, blocked=True)
                n_blocked += 1
                continue
            tid_seq += 1
            cash -= sh * price
            p = dict(tk=tk, name=stub["name"], market=stub["market"], entry_date=d,
                tranche=amt, avg_buy=price, last_buy=price, buy_count=1, sell_count=0, stop=None,
                qty=sh, total_qty=sh, min_low=price, last_close=price,
                entry_above=above, entry_bull=bull, tid=tid_seq, cost=sh * price, proc=0.0, legs=[])
            positions[tk] = p
            ex(d, p, "buy_new", 1, price, sh, nav_today)
            leg(p, d, "buy_new", 1, price, sh, nav_today)
            n_bought += 1
        counts.append(dict(d=d, n_candidates=n_cand, n_reached=n_reached,
                           n_bought=n_bought, n_blocked=n_blocked))
        # 일말: NAV·스냅샷
        hv = cur_hv(day); nav = cash + hv; peak = max(peak, nav)
        dd = (nav / peak - 1) * 100 if peak > 0 else 0.0
        lev = (hv + max(0.0, -cash)) / nav if nav > 0 else 0.0   # gross/nav 근사
        nav_rows.append(dict(d=d, nav=round(nav), cash=round(cash), stock_value=round(hv),
            leverage=round(min(lev, 9.999), 3), dd_pct=round(dd, 2), n_positions=len(positions)))
        for tk, p in positions.items():
            curp = float(day[tk]["close"]) if tk in day else p["last_close"]
            snaps.append(dict(d=d, ticker=tk, name=p["name"], market=p["market"], entry_date=p["entry_date"],
                buy_count=p["buy_count"], sell_count=p["sell_count"], qty=p["qty"], avg_buy=round(p["avg_buy"]),
                last_close=round(curp), eval_amount=round(p["qty"] * curp), eval_pnl=round(p["qty"] * (curp - p["avg_buy"])),
                ret_pct=round((curp / p["avg_buy"] - 1) * 100, 2),
                port_pct=round(p["qty"] * curp / nav * 100, 2) if nav > 0 else None))

    # 미청산 포지션 → trades open
    last_d = all_dates[-1]
    for tk, p in positions.items():
        trades.append(dict(_tid=p["tid"], ticker=tk, name=p["name"], market=p["market"],
            entry_date=p["entry_date"], exit_date=None, buy_count=p["buy_count"], max_invested=round(p["cost"]),
            proceeds=None, pnl=None, ret_pct=None, holding_days=None, exit_reason="open", status="open"))
        for lg in p["legs"]:
            legs.append(dict(_tid=p["tid"], **lg))

    order_plan = build_order_plan(positions, last_d, cash + cur_hv(by_date[last_d]))
    monthly = build_monthly(trades, nav_rows)
    return dict(executions=executions, trades=trades, legs=legs, nav_daily=nav_rows,
                position_snapshots=snaps, daily_order_plan=order_plan, monthly_stats=monthly,
                daily_candidates=candidates, daily_counts=counts, last_date=last_d)


def build_order_plan(positions, d, nav):
    """최신일 보유 포지션 → 다음 거래일 세팅할 감시주문 세트."""
    plan = []
    for tk, p in positions.items():
        is_new = (p["entry_date"] == d)
        diff = "new" if is_new else "keep"
        # 추가매수 감시 — buy_count < MAX_BUY 일 때 표시.
        # 단 buy_count >= NL_AFTER (2 이후) 신저가 손절 활성 상태에서 추가매수 가격이 신저가 손절
        # 가격 이하면 broker 충돌 (신저가 손절 먼저 발동 후 추가매수 잘못 체결) → 표시 skip.
        if p["sell_count"] == 0 and p["buy_count"] < MAX_BUY:
            at = p["last_buy"] * (1 - ADD_DROP)
            skip_conflict = (p["buy_count"] >= NL_AFTER and at <= p["min_low"])
            if not skip_conflict:
                sh = int(p["tranche"] // at)
                plan.append(dict(d=d, ticker=tk, name=p["name"], market=p["market"], order_type="buy_add",
                    stage=p["buy_count"] + 1, trigger_price=round(at), qty=sh,
                    port_pct=round(p["tranche"] / nav * 100, 2) if nav > 0 else None, diff=diff,
                    note=f"{p['buy_count']+1}차 매수(직전매수가 -10%)"))
        t = [p["avg_buy"] * (1 + s) for s in S]                       # 매도 감시(미체결 단계)
        for stg in range(p["sell_count"] + 1, 4):
            sq = p["qty"] if stg == 3 else min(round(p["total_qty"] * SELL_STAGE_PCT), p["qty"])
            plan.append(dict(d=d, ticker=tk, name=p["name"], market=p["market"], order_type="sell",
                stage=stg, trigger_price=round(t[stg - 1]), qty=int(sq),
                port_pct=round(sq * t[stg - 1] / nav * 100, 2) if nav > 0 else None, diff=diff,
                note=f"{stg}차 매도(+{[3,5,7][stg-1]}%)"))
        if p["sell_count"] >= 1:                                      # 손절 감시
            plan.append(dict(d=d, ticker=tk, name=p["name"], market=p["market"], order_type="stop",
                stage=p["sell_count"], trigger_price=round(p["stop"]), qty=int(p["qty"]),
                port_pct=None, diff=diff, note="손절(직전 매도단계가 이탈 시 잔량 전량)"))
        elif p["buy_count"] >= NL_AFTER:                              # 신저가 손절 감시
            plan.append(dict(d=d, ticker=tk, name=p["name"], market=p["market"], order_type="newlow_stop",
                stage=None, trigger_price=round(p["min_low"]), qty=int(p["qty"]),
                port_pct=None, diff=diff, note="신저가 손절(직전 최저가 하향 시 종가청산)"))
    return plan


def build_monthly(trades, nav_rows):
    closed = [t for t in trades if t["status"] == "closed"]
    nav = pd.DataFrame(nav_rows)
    if nav.empty:
        return []
    nav["month"] = pd.to_datetime(nav["d"]).dt.strftime("%Y-%m")
    out = []
    tr = pd.DataFrame(closed)
    if not tr.empty:
        tr["month"] = pd.to_datetime(tr["exit_date"]).dt.strftime("%Y-%m")
    for m, g in nav.groupby("month"):
        gn = g.sort_values("d")
        run_peak = gn["nav"].cummax()
        mdd = ((gn["nav"] / run_peak - 1) * 100).min()
        tg = tr[tr["month"] == m] if not tr.empty else pd.DataFrame()
        nstart, nend = int(gn["nav"].iloc[0]), int(gn["nav"].iloc[-1])
        out.append(dict(month=m, num_trades=int(len(tg)),
            win_rate=round((tg["pnl"] > 0).mean() * 100, 2) if len(tg) else 0.0,
            avg_ret=round(tg["ret_pct"].mean(), 2) if len(tg) else 0.0,
            realized_pnl=int(tg["pnl"].sum()) if len(tg) else 0,
            nav_start=nstart, nav_end=nend,
            return_pct=round((nend / nstart - 1) * 100, 2) if nstart else 0.0,
            mdd_pct=round(float(mdd), 2)))
    return out


# ── 출력 ─────────────────────────────────────────────────────────────
def dry_run_dump(data, base_cap):
    outdir = Path(__file__).resolve().parent / "_dryrun"
    outdir.mkdir(exist_ok=True)
    for name in ("executions", "trades", "legs", "nav_daily", "position_snapshots",
                 "daily_order_plan", "monthly_stats", "daily_candidates", "daily_counts"):
        df = pd.DataFrame(data[name])
        df.to_csv(outdir / f"{name}.csv", index=False, encoding="utf-8-sig")
    nav = pd.DataFrame(data["nav_daily"]); tr = pd.DataFrame(data["trades"])
    closed = tr[tr["status"] == "closed"] if not tr.empty else tr
    final_nav = nav["nav"].iloc[-1]; mdd = nav["dd_pct"].min()
    yrs = (pd.to_datetime(nav["d"].iloc[-1]) - pd.to_datetime(nav["d"].iloc[0])).days / 365.25
    cagr = ((final_nav / base_cap) ** (1 / yrs) - 1) * 100 if yrs > 0 else 0
    print(f"[dry-run] CSV → {outdir}")
    print(f"  기간 {nav['d'].iloc[0]} ~ {nav['d'].iloc[-1]} ({yrs:.1f}년)")
    print(f"  최종 NAV {final_nav:,.0f} (시작 {base_cap:,.0f}, {final_nav/base_cap*100-100:+.1f}%) | "
          f"CAGR {cagr:.2f}% | MDD {mdd:.2f}%")
    print(f"  체결 {len(data['executions'])} (미체결 {sum(1 for e in data['executions'] if e['blocked_by_leverage'])}) | "
          f"완결거래 {len(closed)} | 미청산 {len(tr)-len(closed)} | 월 {len(data['monthly_stats'])}")
    if len(closed):
        print(f"  완결 평균수익률 {closed['ret_pct'].mean():+.2f}% | 승률 {(closed['pnl']>0).mean()*100:.1f}%")
    print(f"  최신 감시주문 플랜 {len(data['daily_order_plan'])}건 (기준일 {data['last_date']})")


def upsert_supabase(data):
    """전체 재계산본을 멱등 적재: 각 테이블 전삭제 후 insert. trade_legs 는 trade_id FK 매핑 후.
    외부 의존성 없이 stdlib(urllib)로 Supabase REST(PostgREST) 직접 호출."""
    import urllib.request, urllib.parse, urllib.error
    base = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1"
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    HBASE = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    def req(method, path, body=None, prefer="return=minimal"):
        h = dict(HBASE); h["Prefer"] = prefer
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        r = urllib.request.Request(base + path, data=payload, method=method, headers=h)
        try:
            with urllib.request.urlopen(r, timeout=60) as resp:
                txt = resp.read().decode("utf-8")
                return json.loads(txt) if txt.strip() else None
        except urllib.error.HTTPError as e:
            raise SystemExit(f"[supabase] {method} {path} 실패 {e.code}: {e.read().decode('utf-8')[:500]}")

    def iso(rows):  # date 객체 → 'YYYY-MM-DD'
        return [{k: (str(v) if isinstance(v, date) else v) for k, v in r.items()} for r in rows]

    def chunk(rows, n=500):
        for i in range(0, len(rows), n):
            yield rows[i:i + n]

    # FK 안전 순서로 전삭제 (각 테이블의 항상-참 필터)
    del_filter = {
        "trade_legs": ("id", "0"), "trades": ("id", "0"), "executions": ("id", "0"),
        "daily_order_plan": ("id", "0"),
        "position_snapshots": ("d", "1900-01-01"), "nav_daily": ("d", "1900-01-01"),
        "monthly_stats": ("month", "0"), "daily_counts": ("d", "1900-01-01"),
        "daily_candidates": ("d", "1900-01-01"),
    }
    for tbl in ("trade_legs", "trades", "executions", "daily_order_plan", "daily_candidates",
                "position_snapshots", "nav_daily", "monthly_stats", "daily_counts"):
        col, sentinel = del_filter[tbl]
        req("DELETE", f"/{tbl}?{col}=gte.{urllib.parse.quote(sentinel)}")

    # trades 적재 → _tid → 실제 id 매핑 (return=representation 으로 id 회수)
    tmap = {}
    for c in chunk(data["trades"]):
        payload = iso([{k: v for k, v in t.items() if k != "_tid"} for t in c])
        res = req("POST", "/trades", payload, prefer="return=representation")
        for t_in, t_out in zip(c, res):
            tmap[t_in["_tid"]] = t_out["id"]
    legs = [dict({k: v for k, v in lg.items() if k != "_tid"}, trade_id=tmap[lg["_tid"]])
            for lg in data["legs"]]
    for c in chunk(legs):
        if c:
            req("POST", "/trade_legs", iso(c))
    for tbl in ("executions", "position_snapshots", "daily_order_plan", "daily_candidates",
                "nav_daily", "monthly_stats", "daily_counts"):
        for c in chunk(data[tbl]):
            if c:
                req("POST", f"/{tbl}", iso(c))
    req("PATCH", "/meta?key=eq.last_eod_at", {"value": str(data["last_date"])})
    print(f"[supabase] 적재 완료 (기준일 {data['last_date']}): "
          f"trades {len(data['trades'])} · legs {len(legs)} · executions {len(data['executions'])} · "
          f"nav {len(data['nav_daily'])} · positions {len(data['position_snapshots'])} · "
          f"monthly {len(data['monthly_stats'])} · order_plan {len(data['daily_order_plan'])} · "
          f"candidates {len(data['daily_candidates'])} · counts {len(data['daily_counts'])}")


def notify_eod(data):
    """마감 결과 + 내일 세팅할 감시주문(실제 가격·수량)을 상세히 전송."""
    last = data["last_date"]
    nav = data["nav_daily"][-1]
    ACT = {"buy_new": "신규매수", "buy_add": "추가매수", "sell_1": "1차매도", "sell_2": "2차매도",
           "sell_3": "3차매도", "stop": "손절", "newlow_stop": "신저가손절"}
    le = [e for e in data["executions"] if e["d"] == last]
    filled = [e for e in le if not e["blocked_by_leverage"]]
    blocked = [e for e in le if e["blocked_by_leverage"]]

    lines = [f"✅ <b>[S2] {last} 마감 결과</b>",
             f"NAV {nav['nav']/1e8:.2f}억 · 보유 {nav['n_positions']}종목 · 레버 {nav['leverage']:.2f}배"]

    # 오늘 체결
    def pf(p):  # 포트% 표기
        return f" (포트 {p:.1f}%)" if p is not None else ""
    if filled:
        lines.append(f"\n📌 <b>오늘 체결 {len(filled)}건</b>")
        for e in filled[:12]:
            lines.append(f" · {ACT.get(e['action'], e['action'])} {e['name'][:6]} "
                         f"{e['fill_price']:,}원{pf(e.get('port_pct'))}")
        if len(filled) > 12:
            lines.append(f" · … 외 {len(filled)-12}건")
    else:
        lines.append("\n📌 오늘 체결 없음")
    if blocked:
        lines.append(f"⚠ 레버 한도 미체결 {len(blocked)}건: " + ", ".join(e["name"][:6] for e in blocked[:8]))

    # 보유 요약(평가손익)
    snaps = [s for s in data["position_snapshots"] if s["d"] == last]
    if snaps:
        lines.append(f"\n💼 <b>보유 {len(snaps)}종목</b>")
        for s in sorted(snaps, key=lambda s: -s["eval_amount"])[:8]:
            sign = "+" if s["eval_pnl"] >= 0 else ""
            lines.append(f" · {s['name'][:6]} 평단 {s['avg_buy']:,} → {s['last_close']:,} "
                         f"({sign}{s['ret_pct']:.1f}%)")

    # 내일 세팅 감시주문 (실제 가격·수량)
    plan = data["daily_order_plan"]
    if plan:
        lines.append(f"\n📋 <b>내일 세팅 감시주문</b>")
        bytk = {}
        for o in plan:
            bytk.setdefault(o["ticker"], []).append(o)
        for i, (tk, os_) in enumerate(bytk.items()):
            if i >= 15:
                lines.append(f" … 외 {len(bytk)-15}종목"); break
            lines.append(f"<b>{os_[0]['name'][:6]}</b>")
            for o in [x for x in os_ if x["order_type"] == "buy_add"]:
                lines.append(f"  · {o['stage']}차 매수 {o['trigger_price']:,}원{pf(o.get('port_pct'))}")
            sells = sorted([x for x in os_ if x["order_type"] == "sell"], key=lambda x: x["stage"])
            if sells:
                lines.append("  · 매도(10/10/80) " + " / ".join(
                    f"+{[3,5,7][o['stage']-1]}% {o['trigger_price']:,}" for o in sells))
            for o in [x for x in os_ if x["order_type"] in ("stop", "newlow_stop")]:
                lab = "손절" if o["order_type"] == "stop" else "신저가손절"
                lines.append(f"  · {lab} {o['trigger_price']:,}원")
    else:
        lines.append("\n📋 내일 감시주문 없음(보유 없음)")

    lines.append("\n🔗 상세: 홈 화면(동시호가 후보·감시주문·보유)")
    telegram_send("\n".join(lines))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--end", default=None, help="시뮬레이션 종료일 YYYY-MM-DD (기본 캐시 최신일)")
    ap.add_argument("--dry-run", action="store_true", help="Supabase 없이 로컬 CSV + 요약")
    ap.add_argument("--no-notify", action="store_true", help="텔레그램 알림 생략")
    args = ap.parse_args()

    cfg = Config(); cfg.lookback_days = WINDOW
    end = date.fromisoformat(args.end) if args.end else date.today()
    # 기준자본 — 환경변수 S2_BASE_CAP 으로 오버라이드 가능 (예: "100000000" = 1억).
    base_cap = float(os.environ.get("S2_BASE_CAP", "100000000"))
    print(f"S2 EOD 익스포터 — 종료일 {end}, 기준자본 {base_cap:,.0f}원")
    px, nmap, mmap, period_start, sm, smy = load(cfg, end)
    data = simulate(px, nmap, mmap, period_start, sm, smy, base_cap)

    if args.dry_run:
        dry_run_dump(data, base_cap)
    else:
        upsert_supabase(data)
        if not args.no_notify:
            notify_eod(data)
    print("DONE")


if __name__ == "__main__":
    main()
