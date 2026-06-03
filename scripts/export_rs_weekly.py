#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""마감지기 · 주간 RS96+ 종목 익스포터.

quantBacktest 의 weekly_cache + RS 테이블을 읽어 두 테이블을 산출한다.
  1) rs_top_weekly       — 주차별 RS96+ 종목 (KR 시총 상위 40% / US 전체)
  2) rs_history_weekly   — RS96+ 에 한 번이라도 들어간 종목의 N주 RS 시계열
                           (시총 필터 무관 — 종목 추이 자체가 목적)

사용:
  python export_rs_weekly.py                 # 양 시장 모두 적재
  python export_rs_weekly.py --market KR     # KR 만
  python export_rs_weekly.py --dry-run       # Supabase 없이 미리보기
  python export_rs_weekly.py --weeks 26      # 최근 26주만

설계 노트:
  - quantBacktest 의 rs_query.py 헬퍼를 재사용 — RS 정의가 백테스트와 100% 동일.
  - weekly_cache·RS 테이블·시총 캐시는 시장당 1회 로드, 주차는 루프.
  - 한 번의 종목 루프에서 (1) top96 후보·(2) 모든 종목 RS 시계열 둘 다 누적,
    마지막에 RS96+ 종목 union 으로 시계열을 필터해 history 적재.
  - 멱등 적재: 적재 대상 주차 / 종목 범위만 전삭제 후 bulk insert.
"""
from __future__ import annotations
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]   # s2_method
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.chdir(ROOT)

QB_DIR = Path(r"C:\quantBacktest")
sys.path.insert(0, str(QB_DIR))
os.environ.setdefault("BT_OUTPUT_DIR", str(QB_DIR / "screen"))

from config import Config                                            # noqa: E402
from rs_query import (                                                # noqa: E402
    composite_return_weekly,
    comp_to_rs,
    compute_mktcap_percentile_threshold,
    get_close_series,
    get_threshold_row,
    load_mktcap_cache,
    load_rs_table,
    load_ticker_names,
    load_weekly_cache,
    lookup_mktcap_at,
)

WEEKS_BACK_DEFAULT = 52
RS_MIN = 96
MKTCAP_TOP_KR = 40           # KR: 시총 상위 40% 만 (백테스트와 동일)


def extract_week(week_ts, market, rs_table, weekly_cache, ticker_names,
                 mktcap_cache, mktcap_top):
    """한 주차에 대해 두 종류 row 산출.

    Returns
    -------
    (top96_rows, all_rs_rows)
        top96_rows  : RS≥96 + (KR 한정) 시총 상위 mktcap_top% 통과 종목.
                      rs_top_weekly 적재용. rank_in_week 매김.
        all_rs_rows : RS 계산이 가능한 모든 종목의 그 주차 row.
                      시총 필터 무관 — 종목 시계열용.
    """
    threshold_row, _src = get_threshold_row(rs_table, week_ts, weekly_cache, market)
    if threshold_row is None:
        return [], []

    mktcap_threshold = np.nan
    if mktcap_cache and mktcap_top is not None:
        mktcap_threshold, _ = compute_mktcap_percentile_threshold(
            mktcap_cache, week_ts, mktcap_top)

    week_str = week_ts.date().isoformat()
    top96_rows = []
    all_rs_rows = []

    for tk, wdf in weekly_cache.items():
        s = get_close_series(wdf)
        if s is None:
            continue
        comp = composite_return_weekly(s, week_ts)
        if np.isnan(comp):
            continue
        rs = comp_to_rs(comp, threshold_row)
        if np.isnan(rs):
            continue
        sub = s[s.index <= week_ts]
        last_close = float(sub.iloc[-1]) if len(sub) > 0 else None

        # 시계열용 — 모든 RS 계산 가능 종목 (시총 필터 무관)
        all_rs_rows.append({
            "market": market,
            "ticker": tk,
            "week_date": week_str,
            "rs": int(rs),
            "comp_return": float(comp),
            "close": last_close,
        })

        if rs < RS_MIN:
            continue

        # KR 시총 필터
        mc_val = lookup_mktcap_at(mktcap_cache, tk, week_ts) if mktcap_cache else np.nan
        if mktcap_cache and mktcap_top is not None and not np.isnan(mktcap_threshold):
            if np.isnan(mc_val) or mc_val < mktcap_threshold:
                continue

        top96_rows.append({
            "market": market,
            "week_date": week_str,
            "ticker": tk,
            "name": ticker_names.get(tk, "") or "",
            "rs": int(rs),
            "comp_return": float(comp),
            "close": last_close,
            "mktcap_krw": float(mc_val) if not np.isnan(mc_val) else None,
        })

    top96_rows.sort(key=lambda r: (-r["rs"], -r["comp_return"]))
    for i, r in enumerate(top96_rows, 1):
        r["rank_in_week"] = i
    return top96_rows, all_rs_rows


def fetch_market(market, weeks_back, mktcap_top=None):
    print(f"\n[{market}] 데이터 로드")
    rs_table = load_rs_table(market)
    weekly_cache = load_weekly_cache(market)
    ticker_names = load_ticker_names(market)
    mktcap_cache = load_mktcap_cache(market) if mktcap_top else {}
    print(f"  weekly_cache: {len(weekly_cache):,}개 · RS 테이블: {len(rs_table):,}주 · "
          f"이름 매핑: {len(ticker_names):,}개"
          + (f" · 시총: {len(mktcap_cache):,}개" if mktcap_cache else ""))

    all_weeks = set()
    for v in weekly_cache.values():
        s = get_close_series(v)
        if s is not None:
            all_weeks.update(s.index)
    weeks = sorted(all_weeks)[-weeks_back:]
    print(f"  대상 주차 {len(weeks)}개: {weeks[0].date()} ~ {weeks[-1].date()}")

    top96_all = []
    hist_by_ticker = {}                       # ticker -> list of week rows
    rs96_tickers = set()                       # RS96+ 에 한 번이라도 들어간 종목

    for i, w in enumerate(weeks, 1):
        top96, all_rs = extract_week(w, market, rs_table, weekly_cache,
                                     ticker_names, mktcap_cache, mktcap_top)
        top96_all.extend(top96)
        for r in top96:
            rs96_tickers.add(r["ticker"])
        for r in all_rs:
            hist_by_ticker.setdefault(r["ticker"], []).append(r)
        if i % 10 == 0 or i == len(weeks):
            print(f"  진행 {i}/{len(weeks)}주 · top96 누적 {len(top96_all):,}건",
                  flush=True)

    # 시계열은 RS96+ 종목 union 만
    hist_rows = []
    for tk in rs96_tickers:
        hist_rows.extend(hist_by_ticker.get(tk, []))
    # 표시 순서를 위해 ticker × week 정렬
    hist_rows.sort(key=lambda r: (r["ticker"], r["week_date"]))

    print(f"  [{market}] top96 {len(top96_all):,}건 · "
          f"history {len(hist_rows):,}건 ({len(rs96_tickers):,}종목)")
    return top96_all, hist_rows, sorted(rs96_tickers)


# ─── Supabase REST 클라이언트 ─────────────────────────────────────────
def _supabase_client():
    base = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1"
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    H = {"apikey": key, "Authorization": f"Bearer {key}",
         "Content-Type": "application/json"}

    def req(method, path, body=None, prefer="return=minimal"):
        h = dict(H); h["Prefer"] = prefer
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        r = urllib.request.Request(base + path, data=payload, method=method, headers=h)
        try:
            with urllib.request.urlopen(r, timeout=120) as resp:
                resp.read()
        except urllib.error.HTTPError as e:
            raise SystemExit(f"[supabase] {method} {path} 실패 {e.code}: "
                             f"{e.read().decode('utf-8')[:500]}")
    return req


def _chunk(rows, n=500):
    for i in range(0, len(rows), n):
        yield rows[i:i + n]


def upsert_supabase(top_rows, hist_rows, rs96_tickers_by_market):
    req = _supabase_client()

    # rs_top_weekly: (market, week_date) 단위 전삭제 후 insert
    weeks_per_market = {}
    for r in top_rows:
        weeks_per_market.setdefault(r["market"], set()).add(r["week_date"])
    for mk, ws in weeks_per_market.items():
        in_w = ",".join(f'"{w}"' for w in sorted(ws))
        req("DELETE",
            f"/rs_top_weekly?market=eq.{urllib.parse.quote(mk)}"
            f"&week_date=in.({urllib.parse.quote(in_w)})")
    for c in _chunk(top_rows):
        req("POST", "/rs_top_weekly", c)
    print(f"[supabase] rs_top_weekly {len(top_rows):,}건 적재 완료")

    # rs_history_weekly: (market, ticker) 단위 전삭제 후 insert
    for mk, tks in rs96_tickers_by_market.items():
        if not tks:
            continue
        # 종목 수가 많으면 IN 필터 길이 제한 — 청크 처리
        for tk_chunk in _chunk(list(tks), 200):
            in_t = ",".join(f'"{t}"' for t in tk_chunk)
            req("DELETE",
                f"/rs_history_weekly?market=eq.{urllib.parse.quote(mk)}"
                f"&ticker=in.({urllib.parse.quote(in_t)})")
    for c in _chunk(hist_rows):
        req("POST", "/rs_history_weekly", c)
    print(f"[supabase] rs_history_weekly {len(hist_rows):,}건 적재 완료")

    req("PATCH", "/meta?key=eq.last_rs_weekly_at",
        {"value": datetime.now().isoformat()})


def preview(top_rows, hist_rows):
    for mk in ("KR", "US"):
        sub = [r for r in top_rows if r["market"] == mk]
        if not sub:
            continue
        weeks_n = len({r["week_date"] for r in sub})
        last = max(r["week_date"] for r in sub)
        last_rows = [r for r in sub if r["week_date"] == last]
        print(f"\n[{mk}] {weeks_n}주 · 마지막 주차 {last} 상위 10:")
        for r in last_rows[:10]:
            mc = f" · 시총 {r['mktcap_krw']/1e8:,.0f}억" if r.get("mktcap_krw") else ""
            print(f"  {r['rank_in_week']:>3} {r['ticker']:<14} RS{r['rs']} "
                  f"{(r['name'] or '')[:25]:<25} {r['comp_return']*100:+6.1f}%{mc}")
        print(f"  ... (그 주 총 {len(last_rows)}건)")

    # history 미리보기 — 첫 종목의 추이 일부
    if hist_rows:
        first_tk = hist_rows[0]["ticker"]
        first_mk = hist_rows[0]["market"]
        sample = [r for r in hist_rows if r["ticker"] == first_tk and r["market"] == first_mk]
        sample = sample[-12:]
        print(f"\n[history 샘플 — {first_mk} {first_tk}] 최근 12주:")
        for r in sample:
            print(f"  {r['week_date']}  RS{r['rs']:>3}  comp {r['comp_return']*100:+6.1f}%")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--market", choices=["KR", "US", "both"], default="both")
    ap.add_argument("--weeks", type=int, default=WEEKS_BACK_DEFAULT,
                    help=f"최근 N주 적재 (기본 {WEEKS_BACK_DEFAULT})")
    ap.add_argument("--dry-run", action="store_true",
                    help="Supabase 적재 없이 미리보기")
    args = ap.parse_args()

    Config()  # .env.local 로드

    top_all, hist_all = [], []
    rs96_tickers_by_market = {}
    if args.market in ("KR", "both"):
        t, h, tks = fetch_market("KR", args.weeks, mktcap_top=MKTCAP_TOP_KR)
        top_all.extend(t); hist_all.extend(h); rs96_tickers_by_market["KR"] = tks
    if args.market in ("US", "both"):
        t, h, tks = fetch_market("US", args.weeks, mktcap_top=None)
        top_all.extend(t); hist_all.extend(h); rs96_tickers_by_market["US"] = tks

    print(f"\n총 top96 {len(top_all):,}건 · history {len(hist_all):,}건")

    if args.dry_run:
        preview(top_all, hist_all)
    else:
        if top_all or hist_all:
            upsert_supabase(top_all, hist_all, rs96_tickers_by_market)
        else:
            print("적재할 row 없음 — Supabase 호출 생략")
    print("DONE")


if __name__ == "__main__":
    main()
