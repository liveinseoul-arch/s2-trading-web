#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""마감지기 · 주간 RS96+ 종목 익스포터.

산출(두 테이블):
  1) rs_top_weekly       — 주차별 RS96+ 종목.
       KR: 시총 상위 40% AND 시총 ≥ 5,000억(KRW)
       US: 시총 상위 20%
  2) rs_history_weekly   — RS96+ 에 한 번이라도 들어간 종목의 N주 RS 시계열
                           (시총 필터 무관 — 종목 추이 자체가 목적)

사용:
  python export_rs_weekly.py                 # 양 시장 모두 적재
  python export_rs_weekly.py --market KR     # KR 만
  python export_rs_weekly.py --dry-run       # Supabase 없이 미리보기
  python export_rs_weekly.py --weeks 26      # 최근 26주만

설계 노트:
  - RS 정의는 quantBacktest 의 rs_query.py 헬퍼와 100% 동일.
  - KR 시총: collect_mktcap_kr_v2 가 만든 28일 간격 시점 캐시 (ref_date 이하 최근 행).
  - US 시총: _bt_shares_us.pkl (현재 shares 스냅샷) × 그 주차의 종가.
    과거 발행/자사주매입 보정 없음 — 상위 20% 필터에는 충분(대형주는 변동 작음).
  - 한 번의 종목 루프에서 top96 + 모든 RS 시계열 둘 다 누적,
    마지막에 RS96+ 종목 union 으로 시계열을 필터해 history 적재.
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
import pandas as pd


# 액면병합/분할로 추정되는 인접 주차 점프 임계. 1주에 ratio ≥ 2.5x 또는 ≤ 1/2.5x 면
# 실제 가격 등락 아닌 corporate action 으로 보고 backward 보정.
# (단주 +150% 급등은 매우 드물고 그런 종목은 보통 작전·합병 등으로 RS 룰 대상 외)
CORP_ACTION_RATIO = 2.5


def adjust_for_corporate_action(close_series):
    """인접 주차 ratio 가 CORP_ACTION_RATIO 이상/이하면 액면병합·분할로 추정,
    그 이전 가격을 ratio 로 곱해 backward 정렬. 여러 점프 누적 보정 지원.

    예: 신성이엔지 011930 — 2026-04-17 4,170 → 04-24 39,950 (x9.58, 10:1 액면병합).
    04-17 이전 모든 가격에 9.58 곱하면 이후와 연속. 52주 comp_return 정상화.
    """
    if len(close_series) < 2:
        return close_series
    vals = close_series.values.astype("float64").copy()
    # 뒤에서 앞으로 — 발견된 모든 점프를 누적 보정
    for i in range(len(vals) - 1, 0, -1):
        prev, curr = vals[i - 1], vals[i]
        if prev <= 0 or curr <= 0 or np.isnan(prev) or np.isnan(curr):
            continue
        ratio = curr / prev
        if ratio >= CORP_ACTION_RATIO or ratio <= 1.0 / CORP_ACTION_RATIO:
            vals[:i] = vals[:i] * ratio
    return pd.Series(vals, index=close_series.index)


def _normalize_weekly_cache(weekly_cache):
    """weekly_cache 의 각 close series 를:
    1) 인덱스를 그 주의 금요일(W-FRI)로 정규화 (KR 월/금 섞임, US 월~목 산포 해결)
    2) corporate action(액면병합·분할) backward 보정
    """
    norm = {}
    for tk, v in weekly_cache.items():
        s = get_close_series(v)
        if s is None or len(s) == 0:
            continue
        # 1) W-FRI 인덱스 정규화
        new_idx = s.index + pd.to_timedelta(4 - s.index.weekday.values, unit="D")
        s2 = pd.Series(s.values, index=pd.DatetimeIndex(new_idx))
        s2 = s2[~s2.index.duplicated(keep="last")].sort_index()
        # 2) corporate action 보정
        s2 = adjust_for_corporate_action(s2)
        norm[tk] = {"close": s2}
    return norm


def _normalize_rs_table(rs_table):
    """rs_table 인덱스도 같은 W-FRI 정규화 — get_threshold_row 캐시 적중률 유지."""
    if rs_table is None or len(rs_table) == 0:
        return rs_table
    new_idx = rs_table.index + pd.to_timedelta(4 - rs_table.index.weekday, unit="D")
    rs2 = rs_table.copy()
    rs2.index = pd.DatetimeIndex(new_idx)
    rs2 = rs2[~rs2.index.duplicated(keep="last")].sort_index()
    return rs2

ROOT = Path(__file__).resolve().parents[2]   # s2_method
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.chdir(ROOT)

QB_DIR = Path(r"C:\quantBacktest")
sys.path.insert(0, str(QB_DIR))
os.environ.setdefault("BT_OUTPUT_DIR", str(QB_DIR / "screen"))

from config import Config                                            # noqa: E402
from rs_query import (                                                # noqa: E402
    OUTPUT_DIR as QB_SCREEN_DIR,
    composite_return_weekly,
    comp_to_rs,
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

MARKETS_ALL = ("KR", "US", "JP")

# 시장별 시총 필터. JP 는 shares/시총 데이터 없어 None — 추후 collect_shares_jp 도입 시 변경.
MKTCAP_TOP_PCT  = {"KR": 40,                    "US": 20,    "JP": None}
MKTCAP_MIN_NATIVE = {"KR": 500_000_000_000.0,   "US": None,  "JP": None}

US_SHARES_PKL = "_bt_shares_us.pkl"
JP_WEEKLY_CACHE = "_jp_weekly_cache.pkl"
JP_TICKER_CACHE = "_jp_ticker_cache.pkl"


def _load_pkl(path):
    import pickle
    if not path.exists():
        return None
    with open(path, "rb") as f:
        return pickle.load(f)


def load_jp_weekly_cache():
    d = _load_pkl(Path(QB_SCREEN_DIR) / JP_WEEKLY_CACHE)
    return d if isinstance(d, dict) else {}


def load_jp_ticker_names():
    """JP _jp_ticker_cache.pkl 의 (list, info, base_str) tuple 에서 yahoo→name 매핑."""
    raw = _load_pkl(Path(QB_SCREEN_DIR) / JP_TICKER_CACHE)
    if not isinstance(raw, tuple) or len(raw) < 2 or not isinstance(raw[1], dict):
        return {}
    nm = {}
    for code, meta in raw[1].items():
        if not isinstance(meta, dict):
            continue
        n = meta.get("name", "") or ""
        y = meta.get("yahoo") or f"{code}.T"
        nm[y] = n
    return nm


def load_us_shares():
    """{ticker → shares_outstanding(float)} . _bt_shares_us.pkl"""
    import pickle
    p = Path(QB_SCREEN_DIR) / US_SHARES_PKL
    if not p.exists():
        print(f"  ⚠ {US_SHARES_PKL} 없음 → US 시총 필터 미적용")
        return {}
    with open(p, "rb") as f:
        d = pickle.load(f)
    print(f"  US shares 캐시: {len(d):,}개 종목")
    return d


def make_mktcap_lookup(market, mktcap_cache, us_shares):
    """mktcap_lookup(ticker, week_ts, close_at_week) → float | NaN

    KR: collect_mktcap_kr_v2 캐시에서 ref_date 이하 최근 값.
    US: shares × 그 주차 종가.
    JP: 데이터 없음 — NaN.
    """
    if market == "KR":
        def lookup(tk, ts, close):
            return lookup_mktcap_at(mktcap_cache, tk, ts)
        return lookup
    if market == "US":
        def lookup(tk, ts, close):
            sh = us_shares.get(tk)
            if not sh or sh <= 0 or close is None or np.isnan(close):
                return np.nan
            return float(sh) * float(close)
        return lookup
    # JP (or any other market without mktcap data)
    def lookup(tk, ts, close):
        return np.nan
    return lookup


def compute_threshold(week_ts, weekly_cache, mktcap_lookup, top_pct):
    """그 주차의 모든 종목 시총 백분위 컷오프(top_pct%). 표본 부족 시 NaN."""
    values = []
    for tk, wdf in weekly_cache.items():
        s = get_close_series(wdf)
        if s is None:
            continue
        sub = s[s.index <= week_ts]
        if len(sub) == 0:
            continue
        close = float(sub.iloc[-1])
        v = mktcap_lookup(tk, week_ts, close)
        if not np.isnan(v) and v > 0:
            values.append(v)
    if len(values) < 50:
        return np.nan, len(values)
    cutoff = 100.0 - float(top_pct)
    return float(np.percentile(values, cutoff)), len(values)


def extract_week(week_ts, market, rs_table, weekly_cache, ticker_names,
                 mktcap_lookup, mktcap_top, mktcap_min):
    """한 주차 → (top96 후보, 모든 RS row).

    top96: RS ≥ 96 AND (mktcap_top 컷오프 통과) AND (mktcap_min 통과)
    """
    threshold_row, _src = get_threshold_row(rs_table, week_ts, weekly_cache, market)
    if threshold_row is None:
        return [], []

    pct_threshold = np.nan
    if mktcap_top is not None:
        pct_threshold, _ = compute_threshold(week_ts, weekly_cache, mktcap_lookup, mktcap_top)

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

        mc_val = mktcap_lookup(tk, week_ts, last_close)
        if mktcap_top is not None and not np.isnan(pct_threshold):
            if np.isnan(mc_val) or mc_val < pct_threshold:
                continue
        if mktcap_min is not None:
            if np.isnan(mc_val) or mc_val < mktcap_min:
                continue

        top96_rows.append({
            "market": market,
            "week_date": week_str,
            "ticker": tk,
            "name": ticker_names.get(tk, "") or "",
            "rs": int(rs),
            "comp_return": float(comp),
            "close": last_close,
            "mktcap": float(mc_val) if not np.isnan(mc_val) else None,
        })

    top96_rows.sort(key=lambda r: (-r["rs"], -r["comp_return"]))
    for i, r in enumerate(top96_rows, 1):
        r["rank_in_week"] = i
    return top96_rows, all_rs_rows


def fetch_market(market, weeks_back):
    mktcap_top = MKTCAP_TOP_PCT.get(market)
    mktcap_min = MKTCAP_MIN_NATIVE.get(market)
    print(f"\n[{market}] 데이터 로드  (시총 상위 {mktcap_top}%"
          + (f" + 최소 {mktcap_min/1e8:,.0f}억" if mktcap_min and market == 'KR' else "")
          + ")")
    if market == "JP":
        rs_table = pd.DataFrame()                                 # 테이블 없음 — 매 주차 임시 계산
        weekly_cache = _normalize_weekly_cache(load_jp_weekly_cache())
        ticker_names = load_jp_ticker_names()
        mktcap_cache, us_shares = {}, {}
        print(f"  weekly_cache: {len(weekly_cache):,}개 · RS 테이블 없음(매 주차 임시 계산) · "
              f"이름 매핑: {len(ticker_names):,}개  (시총 데이터 없음 — 필터 미적용)")
    elif market == "KR":
        rs_table = _normalize_rs_table(load_rs_table("KR"))
        weekly_cache = _normalize_weekly_cache(load_weekly_cache("KR"))
        ticker_names = load_ticker_names("KR")
        mktcap_cache = load_mktcap_cache("KR")
        us_shares = {}
        print(f"  weekly_cache: {len(weekly_cache):,}개 · RS 테이블: {len(rs_table):,}주 · "
              f"이름 매핑: {len(ticker_names):,}개 · 시총 캐시: {len(mktcap_cache):,}개  "
              f"(인덱스 W-FRI 정규화 완료)")
    else:  # US
        rs_table = _normalize_rs_table(load_rs_table("US"))
        weekly_cache = _normalize_weekly_cache(load_weekly_cache("US"))
        ticker_names = load_ticker_names("US")
        mktcap_cache = {}
        us_shares = load_us_shares()
        print(f"  weekly_cache: {len(weekly_cache):,}개 · RS 테이블: {len(rs_table):,}주 · "
              f"이름 매핑: {len(ticker_names):,}개  (인덱스 W-FRI 정규화 완료)")

    mktcap_lookup = make_mktcap_lookup(market, mktcap_cache, us_shares)

    all_weeks = set()
    for v in weekly_cache.values():
        s = get_close_series(v)
        if s is not None:
            all_weeks.update(s.index)
    weeks = sorted(all_weeks)[-weeks_back:]
    print(f"  대상 주차 {len(weeks)}개: {weeks[0].date()} ~ {weeks[-1].date()}")

    top96_all = []
    hist_by_ticker = {}
    rs96_tickers = set()

    for i, w in enumerate(weeks, 1):
        top96, all_rs = extract_week(w, market, rs_table, weekly_cache,
                                     ticker_names, mktcap_lookup,
                                     mktcap_top, mktcap_min)
        top96_all.extend(top96)
        for r in top96:
            rs96_tickers.add(r["ticker"])
        for r in all_rs:
            hist_by_ticker.setdefault(r["ticker"], []).append(r)
        if i % 10 == 0 or i == len(weeks):
            print(f"  진행 {i}/{len(weeks)}주 · top96 누적 {len(top96_all):,}건", flush=True)

    hist_rows = []
    for tk in rs96_tickers:
        hist_rows.extend(hist_by_ticker.get(tk, []))
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

    # 시장 전체 삭제 후 재적재 — 옛 stale 주차(예: 월요일 timestamp) row 동시 정리.
    markets = set(rs96_tickers_by_market.keys()) | {r["market"] for r in top_rows}
    for mk in markets:
        req("DELETE", f"/rs_top_weekly?market=eq.{urllib.parse.quote(mk)}")
        req("DELETE", f"/rs_history_weekly?market=eq.{urllib.parse.quote(mk)}")

    for c in _chunk(top_rows):
        req("POST", "/rs_top_weekly", c)
    print(f"[supabase] rs_top_weekly {len(top_rows):,}건 적재 완료")

    for c in _chunk(hist_rows):
        req("POST", "/rs_history_weekly", c)
    print(f"[supabase] rs_history_weekly {len(hist_rows):,}건 적재 완료")

    req("PATCH", "/meta?key=eq.last_rs_weekly_at",
        {"value": datetime.now().isoformat()})


def preview(top_rows, hist_rows):
    for mk in MARKETS_ALL:
        sub = [r for r in top_rows if r["market"] == mk]
        if not sub:
            continue
        weeks_n = len({r["week_date"] for r in sub})
        last = max(r["week_date"] for r in sub)
        last_rows = [r for r in sub if r["week_date"] == last]
        print(f"\n[{mk}] {weeks_n}주 · 마지막 주차 {last} 상위 10:")
        for r in last_rows[:10]:
            if r.get("mktcap"):
                if mk == "KR":
                    mc = f" · 시총 {r['mktcap']/1e8:,.0f}억"
                else:
                    v = r["mktcap"]
                    mc = (f" · 시총 ${v/1e9:.1f}B" if v >= 1e9 else f" · 시총 ${v/1e6:,.0f}M")
            else:
                mc = ""
            print(f"  {r['rank_in_week']:>3} {r['ticker']:<14} RS{r['rs']} "
                  f"{(r['name'] or '')[:25]:<25} {r['comp_return']*100:+6.1f}%{mc}")
        print(f"  ... (그 주 총 {len(last_rows)}건)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--market", choices=["KR", "US", "JP", "all"], default="all")
    ap.add_argument("--weeks", type=int, default=WEEKS_BACK_DEFAULT,
                    help=f"최근 N주 적재 (기본 {WEEKS_BACK_DEFAULT})")
    ap.add_argument("--dry-run", action="store_true",
                    help="Supabase 적재 없이 미리보기")
    args = ap.parse_args()

    Config()  # .env.local 로드

    top_all, hist_all = [], []
    rs96_tickers_by_market = {}
    targets = MARKETS_ALL if args.market == "all" else (args.market,)
    for mk in targets:
        t, h, tks = fetch_market(mk, args.weeks)
        top_all.extend(t); hist_all.extend(h); rs96_tickers_by_market[mk] = tks

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
