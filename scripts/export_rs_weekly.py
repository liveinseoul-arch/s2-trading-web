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
        entry = {"close": s2}
        # 거래량도 W-FRI 정규화해 유지 (매수가능 필터의 주간 거래대금 계산용)
        vol = v.get("volume") if isinstance(v, dict) else None
        if vol is not None and len(vol) > 0:
            vi = vol.index + pd.to_timedelta(4 - vol.index.weekday.values, unit="D")
            v2 = pd.Series(vol.values, index=pd.DatetimeIndex(vi))
            entry["volume"] = v2[~v2.index.duplicated(keep="last")].sort_index()
        norm[tk] = entry
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

# ── 매수가능(목록 표시) 필터 — 각 시장 스크리너의 4-필터와 동일 ──
# RS 백분위는 광의 유동주 전체로 계산하되, RS96+ 목록(rs_top_weekly)에는
# 매수 대상(필터 통과 종목)만 노출한다. 주차별로 그 주 기준으로 판정.
BUY_FILTER = {
    "US": {"min_price": 5.0,    "min_wk_dvol": 200_000_000},        # $5 · $200M
    "KR": {"min_price": 3000.0, "min_wk_dvol": 50_000_000_000},     # ₩3,000 · 500억
    # JP는 백테스트 진입 유니버스와 정합: 유동성(주간 ¥5억 ≈ 일 ¥1억)만 적용.
    # 52주고가·주가·상장기간 조건은 JP 전략 성과를 절반으로 깎아 제외 (2026-07-23 분해 검증).
    "JP": {"min_price": 0.0,    "min_wk_dvol": 500_000_000,
           "skip_high52": True, "min_listing": 13},
}
BUY_MIN_LISTING_WEEKS = 52     # 상장 52주 이상
BUY_MAX_FROM_HIGH = 0.30       # 52주 고가 대비 -30% 이내
BUY_LOOKBACK_VOL_WEEKS = 13    # 거래대금 13주 평균


def buyable_at(market, wdf, week_ts):
    """그 주차 기준 매수가능(스크리너 4-필터) 여부. 거래량 없으면 거래대금 필터 생략."""
    f = BUY_FILTER.get(market)
    if f is None:
        return True
    s = get_close_series(wdf)
    if s is None:
        return False
    sub = s[s.index <= week_ts].dropna()
    if len(sub) < f.get("min_listing", BUY_MIN_LISTING_WEEKS):
        return False
    # 그 주에 거래 봉이 없으면(거래정지·상폐 추정) 목록 비노출
    if sub.index[-1] < week_ts - pd.Timedelta(days=7):
        return False
    price = float(sub.iloc[-1])
    if price < f["min_price"]:
        return False
    if not f.get("skip_high52"):
        high52 = float(sub.tail(52).max())
        if high52 > 0 and price / high52 - 1 < -BUY_MAX_FROM_HIGH:
            return False
    vol = wdf.get("volume") if isinstance(wdf, dict) else None
    if vol is not None and len(vol) > 0:
        rc = sub.tail(BUY_LOOKBACK_VOL_WEEKS)
        rv = vol.reindex(rc.index).fillna(0)
        if float((rc * rv).mean()) < f["min_wk_dvol"]:
            return False
    return True

MARKETS_ALL = ("KR", "US", "JP")

# 시장별 시총 필터. KR/US/JP 모두 시총 상위 X% (KR 만 추가 절대 floor).
MKTCAP_TOP_PCT    = {"KR": 40,                    "US": 20,    "JP": 20}
# JP: 상위 20% 컷오프 ~1,174억보다 엄격한 1,500억엔 floor 추가 적용.
MKTCAP_MIN_NATIVE = {"KR": 500_000_000_000.0,   "US": None,  "JP": 150_000_000_000.0}

US_SHARES_PKL = "_bt_shares_us.pkl"
JP_SHARES_PKL = "_bt_shares_jp.pkl"
JP_MKTCAP_YAHOO_PKL = "_jp_mktcap_yahoo.pkl"   # finance.yahoo.co.jp 직접 시총(엔). 우선순위 1.
JP_MKTCAP_GOOGLE_PKL = "_jp_mktcap_google.pkl" # Google Finance 직접 시총(엔). 우선순위 2.
JP_WEEKLY_CACHE = "_jp_weekly_cache.pkl"
JP_TICKER_CACHE = "_jp_ticker_cache.pkl"
JP_NAMES_EN_PKL = "_jp_names_en.pkl"     # yfinance longName (정식 영문, 부분 커버)
JP_NAMES_KO_PKL = "_jp_names_ko.pkl"     # deep_translator JA→KO 번역 (나머지)


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


def load_jp_localized_names():
    """JP 종목 → 표기 dict (name_en 컬럼 용).

    rule:
      - 영문 + 한국어 둘 다 있음 → "ENGLISH (한국어)" 합쳐 둘 다 ILIKE 검색 가능.
      - 영문만 있음 → 영문.
      - 한국어만 있음 → 한국어.
      - 둘 다 없음 → None (name_en NULL, 일본어 name 만 보임).
    """
    en = _load_pkl(Path(QB_SCREEN_DIR) / JP_NAMES_EN_PKL) or {}
    ko = _load_pkl(Path(QB_SCREEN_DIR) / JP_NAMES_KO_PKL) or {}
    merged = {}
    n_both = 0
    for tk in set(en) | set(ko):
        e = (en.get(tk) or "").strip()
        k = (ko.get(tk) or "").strip()
        if e and k and e.lower() != k.lower():
            merged[tk] = f"{e} ({k})"
            n_both += 1
        elif e:
            merged[tk] = e
        elif k:
            merged[tk] = k
    if merged:
        print(f"  JP name_en/ko 매핑: 영문 {len(en):,} + 한국어 {len(ko):,} → 통합 {len(merged):,} "
              f"(영+한 결합 {n_both:,})")
    return merged


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


def load_jp_shares():
    """{ticker → shares_outstanding(float)} . _bt_shares_jp.pkl
    파일 없으면 빈 dict — JP 시총 필터 자동 미적용 (Phase A 동작).
    """
    import pickle
    p = Path(QB_SCREEN_DIR) / JP_SHARES_PKL
    if not p.exists():
        print(f"  ⚠ {JP_SHARES_PKL} 없음 → JP 시총 필터 미적용 (Phase A fallback)")
        return {}
    with open(p, "rb") as f:
        d = pickle.load(f)
    print(f"  JP shares 캐시: {len(d):,}개 종목")
    return d


def load_jp_mktcap_yahoo():
    """yahoo Japan 직접 시총."""
    import pickle
    p = Path(QB_SCREEN_DIR) / JP_MKTCAP_YAHOO_PKL
    if not p.exists():
        return {}
    with open(p, "rb") as f:
        return pickle.load(f)


def load_jp_mktcap_google():
    """Google Finance 직접 시총."""
    import pickle
    p = Path(QB_SCREEN_DIR) / JP_MKTCAP_GOOGLE_PKL
    if not p.exists():
        return {}
    with open(p, "rb") as f:
        return pickle.load(f)


def load_jp_mktcap_combined():
    """yahoo + google 통합 dict. yahoo 우선 (같은 데이터일 경우)."""
    y = load_jp_mktcap_yahoo()
    g = load_jp_mktcap_google()
    merged = dict(g)            # google 먼저
    for tk, v in y.items():     # yahoo 가 같은 키면 덮어쓰기 (우선)
        merged[tk] = v
    if merged:
        print(f"  JP 직접 시총: yahoo {len(y):,} + google {len(g):,} → 통합 {len(merged):,}개")
    return merged


def make_mktcap_lookup(market, mktcap_cache, shares_map, yahoo_mktcap=None):
    """mktcap_lookup(ticker, week_ts, close_at_week) → float | NaN

    KR: shares_out × 그 주차 종가 (가격 변동 즉시 반영). 캐시는 28일 snapshot
        이라 mktcap 컬럼 자체는 stale → shares_out 만 뽑아 close 와 곱함.
        shares_out 없으면 snapshot mktcap fallback.
    US: shares × 그 주차 종가.
    JP: yahoo_mktcap dict 우선(정확) → shares × close (근사) → NaN.
    """
    if market == "KR":
        def lookup(tk, ts, close):
            df = mktcap_cache.get(tk)
            if df is not None and "shares_out" in getattr(df, "columns", []):
                sub = df[df.index <= pd.Timestamp(ts)]
                if len(sub) > 0:
                    sh = sub["shares_out"].iloc[-1]
                    if (not pd.isna(sh) and sh > 0 and
                            close is not None and not np.isnan(close)):
                        return float(sh) * float(close)
            # fallback — 옛 snapshot mktcap
            return lookup_mktcap_at(mktcap_cache, tk, ts)
        return lookup
    if market == "JP":
        # KR/US 와 동일 정책: shares × 그 주차 종가 우선 (가격 변동 즉시 반영).
        # yfinance.info.marketCap 은 일부 종목에서 stale (예: Tokyo Electron, Advantest, Murata 등)
        # 또는 데이터 버그가 있어 더 이상 우선하지 않음.
        # shares 없는 종목만 yahoo_mktcap fallback.
        yc = yahoo_mktcap or {}
        def lookup(tk, ts, close):
            sh = shares_map.get(tk)
            if sh and sh > 0 and close is not None and not np.isnan(close):
                return float(sh) * float(close)
            v = yc.get(tk)
            if v and v > 0:
                return float(v)
            return np.nan
        return lookup
    # US
    def lookup(tk, ts, close):
        sh = shares_map.get(tk)
        if not sh or sh <= 0 or close is None or np.isnan(close):
            return np.nan
        return float(sh) * float(close)
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


DAILY_CACHE_FILE = {"KR": "_kr_daily_cache.pkl",
                    "US": "_us_daily_cache.pkl",
                    "JP": "_jp_daily_cache.pkl"}


def load_daily_cache(market):
    """일봉 EMA 계산용 캐시 로드 — 각 시장 RS86+ FTD 일봉(매주 갱신, 현재시점).
    파일 없으면 빈 dict → EMA 미적용(스냅샷에서 컬럼만 빠짐)."""
    p = Path(QB_SCREEN_DIR) / DAILY_CACHE_FILE.get(market, "")
    d = _load_pkl(p)
    if not isinstance(d, dict):
        print(f"  ⚠ {DAILY_CACHE_FILE.get(market)} 없음 → 일봉 EMA 미적용")
        return {}
    print(f"  일봉 캐시(EMA용): {len(d):,}개 종목 (RS86+ FTD, 현재시점)")
    return d


def build_daily_ema_lookup(daily_cache, weeks):
    """일봉 21/50 EMA 를 주차(금요일) as-of 로 정렬.
    반환 {ticker: {21: Series(idx=weeks), 50: Series(idx=weeks)}}.
    엔진(17_90)과 동일식. 일봉 데이터 없는 종목(비RS86+)은 빠짐 → 스냅샷에서 None."""
    try:
        import rs_signal_cols as RSC
    except Exception as e:
        print(f"  ⚠ rs_signal_cols 로드 실패 — 일봉 EMA 생략: {e}")
        return {}
    widx = pd.DatetimeIndex(sorted(weeks))
    out = {}
    for tk, v in daily_cache.items():
        c = get_close_series(v)
        if c is None or len(c) < 21:
            continue
        try:
            es = RSC.ema_daily_series(c)
            out[tk] = {n: s.reindex(widx, method="ffill") for n, s in es.items()}
        except Exception:
            continue
    return out


def fetch_daily_fallback(market, tickers, max_n=300):
    """일봉 캐시에 없는 표시 대상 종목의 일봉을 yfinance 로 소량 수집 (EMA 폴백).
    반환 {ticker: {'close': Series}} — build_daily_ema_lookup 호환."""
    try:
        import yfinance as yf
    except ImportError:
        print("  ⚠ yfinance 없음 — 일봉 EMA 폴백 생략")
        return {}

    def symbols(tk):
        if market == "KR":
            return [f"{tk}.KS", f"{tk}.KQ"]
        if market == "JP":
            if tk.endswith(".T"):
                base = tk[:-2]                     # 이미 야후 형식 ('8306.T')
            elif len(tk) == 5 and tk.endswith("0"):
                base = tk[:-1]                     # J-Quants 5자리 ('83060')
            else:
                base = tk
            return [f"{base}.T"]
        return [tk]

    out = {}
    for tk in tickers[:max_n]:
        for sym in symbols(tk):
            try:
                h = yf.Ticker(sym).history(period="15mo", interval="1d",
                                           auto_adjust=True)
                if h is not None and len(h) >= 21:
                    c = h["Close"].copy()
                    c.index = pd.to_datetime(c.index).tz_localize(None)
                    out[tk] = {"close": c}
                    break
            except Exception:
                continue
    if len(tickers) > max_n:
        print(f"  ⚠ EMA 폴백 대상 {len(tickers)}개 중 상위 {max_n}개만 수집")
    return out


def build_signal_lookup(raw_cache, weeks):
    """주차별 보조신호(align_weeks, climax_warn) as-of 조회용 사전계산.
    반환: {ticker: (aw_series, warn_series)} — 인덱스 weeks 로 ffill 정렬.
    raw_cache 는 정규화 전 {close, volume} dict (climax 에 volume 필요)."""
    try:
        import rs_signal_cols as RSC
    except Exception as e:
        print(f"  ⚠ rs_signal_cols 로드 실패 — 보조 컬럼 생략: {e}")
        return {}
    widx = pd.DatetimeIndex(sorted(weeks))
    out = {}
    for tk, wdf in raw_cache.items():
        c = get_close_series(wdf)
        if c is None or len(c) < 5:
            continue
        v = wdf.get("volume") if isinstance(wdf, dict) else None
        try:
            aw = RSC.align_weeks_series(c).reindex(widx, method="ffill").fillna(0)
            since = RSC.weeks_since_climax_series(c, v).reindex(widx, method="ffill")
            warn = (since <= RSC.WARN_WITHIN).fillna(False)
            vg = RSC.vol_gap_series(c, v).reindex(widx, method="ffill")
            vg13 = RSC.vol_gap_13_26_series(c, v).reindex(widx, method="ffill")
            pma = {n: s2.reindex(widx, method="ffill")
                   for n, s2 in RSC.price_ma_series(c).items()}
            vma = {n: s2.reindex(widx, method="ffill")
                   for n, s2 in RSC.vol_ma_series(c, v).items()}
            cd = {k: s2.reindex(widx, method="ffill")
                  for k, s2 in RSC.recent_climax_detail_series(c, v).items()}
            out[tk] = (aw, warn, vg, pma, vma, cd, vg13)
        except Exception:
            continue
    return out


def extract_week(week_ts, market, rs_table, weekly_cache, ticker_names,
                 mktcap_lookup, mktcap_top, mktcap_min, names_en=None,
                 signal_lookup=None, ema_lookup=None):
    """한 주차 → (top96 후보, 모든 RS row, universe row).

    top96     : RS ≥ 96 AND (mktcap 필터 통과) AND (매수가능 4-필터 통과 — 목록 노출용)
    all_rs    : 모든 종목의 RS (mktcap 필터 없음) — RS96+ tracking 용
    universe  : mktcap 필터 통과한 모든 종목 (RS 컷오프 없음) — RS 조회 검색용
    """
    threshold_row, _src = get_threshold_row(rs_table, week_ts, weekly_cache, market)
    if threshold_row is None:
        return [], [], []

    pct_threshold = np.nan
    if mktcap_top is not None:
        pct_threshold, _ = compute_threshold(week_ts, weekly_cache, mktcap_lookup, mktcap_top)

    week_str = week_ts.date().isoformat()
    top96_rows = []
    all_rs_rows = []
    universe_rows = []

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

        # 보조 신호 (표시용) — 정배열 / 클라이맥스 / 거래량 갭(4-26·13-26) / 이동평균 (사전계산)
        aw_val, cw_val, vg_val, vg13_val = 0, False, None, None
        cx_week, cx_vmult, cx_ret = None, None, None
        pma_val = {4: None, 13: None, 26: None, 52: None}
        vma_val = {4: None, 13: None, 26: None}
        if signal_lookup is not None:
            sig = signal_lookup.get(tk)
            if sig is not None:
                a = sig[0].get(week_ts)
                c2 = sig[1].get(week_ts)
                g = sig[2].get(week_ts) if len(sig) > 2 else None
                aw_val = int(a) if a is not None and not pd.isna(a) else 0
                cw_val = bool(c2) if c2 is not None and not pd.isna(c2) else False
                vg_val = round(float(g), 1) if g is not None and not pd.isna(g) else None
                g13 = sig[6].get(week_ts) if len(sig) > 6 else None
                vg13_val = round(float(g13), 1) if g13 is not None and not pd.isna(g13) else None
                # 클라이맥스 진단 — warn 일 때 가장 최근 클라이맥스 주의 3조건 수치
                if cw_val and len(sig) >= 6:
                    cd = sig[5]
                    dv = cd["date"].get(week_ts)
                    if dv is not None and not pd.isna(dv):
                        cx_week = pd.Timestamp(int(dv)).date().isoformat()
                    x = cd["vol_mult"].get(week_ts)
                    cx_vmult = round(float(x), 2) if x is not None and not pd.isna(x) else None
                    x = cd["week_ret"].get(week_ts)
                    cx_ret = round(float(x), 2) if x is not None and not pd.isna(x) else None
                if len(sig) >= 5:
                    for n in (4, 13, 26, 52):
                        x = sig[3][n].get(week_ts)
                        pma_val[n] = round(float(x), 2) if x is not None and not pd.isna(x) else None
                    for n in (4, 13, 26):
                        x = sig[4][n].get(week_ts)
                        vma_val[n] = round(float(x), 0) if x is not None and not pd.isna(x) else None

        # 일봉 21/50 EMA (미너비니 트레일링 기준선, 스냅샷) — RS86+ 종목만 가용
        ema21_val = ema50_val = None
        if ema_lookup is not None:
            em = ema_lookup.get(tk)
            if em is not None:
                x = em[21].get(week_ts)
                ema21_val = round(float(x), 2) if x is not None and not pd.isna(x) else None
                x = em[50].get(week_ts)
                ema50_val = round(float(x), 2) if x is not None and not pd.isna(x) else None

        all_rs_rows.append({
            "market": market,
            "ticker": tk,
            "week_date": week_str,
            "rs": int(rs),
            "comp_return": float(comp),
            "close": last_close,
            "align_weeks": aw_val,
            "vol_gap_4_26": vg_val,
            "vol_gap_13_26": vg13_val,
        })

        # mktcap 필터 — universe 통과 여부
        mc_val = mktcap_lookup(tk, week_ts, last_close)
        if mktcap_top is not None and not np.isnan(pct_threshold):
            if np.isnan(mc_val) or mc_val < pct_threshold:
                continue
        if mktcap_min is not None:
            if np.isnan(mc_val) or mc_val < mktcap_min:
                continue

        # universe 통과 — RS 컷오프 무관하게 저장
        name = ticker_names.get(tk, "") or ""
        name_en = (names_en.get(tk) if names_en else None) or None
        mc_clean = float(mc_val) if not np.isnan(mc_val) else None
        universe_rows.append({
            "market": market,
            "ticker": tk,
            "week_date": week_str,
            "name": name,
            "name_en": name_en,
            "rs": int(rs),
            "comp_return": float(comp),
            "close": last_close,
            "mktcap": mc_clean,
            "align_weeks": aw_val,
            "climax_warn": cw_val,
            "vol_ma_4": vma_val[4],
            "vol_ma_13": vma_val[13],
            "vol_ma_26": vma_val[26],
            "price_ma_4": pma_val[4],
            "price_ma_13": pma_val[13],
            "price_ma_26": pma_val[26],
            "price_ma_52": pma_val[52],
            "ema_21": ema21_val,
            "ema_50": ema50_val,
            "climax_week": cx_week,
            "climax_vol_mult": cx_vmult,
            "climax_ret": cx_ret,
        })

        if rs < RS_MIN:
            continue

        # 매수 대상 아님(스크리너 4-필터 탈락) → 목록 페이지 비노출
        if not buyable_at(market, wdf, week_ts):
            continue

        top96_rows.append({
            "market": market,
            "week_date": week_str,
            "ticker": tk,
            "name": name,
            "name_en": name_en,
            "rs": int(rs),
            "comp_return": float(comp),
            "close": last_close,
            "mktcap": mc_clean,
            "align_weeks": aw_val,
            "climax_warn": cw_val,
            "price_ma_4": pma_val[4], "price_ma_13": pma_val[13],
            "price_ma_26": pma_val[26], "price_ma_52": pma_val[52],
            "vol_ma_4": vma_val[4], "vol_ma_13": vma_val[13], "vol_ma_26": vma_val[26],
            "ema_21": ema21_val, "ema_50": ema50_val,
            "climax_week": cx_week, "climax_vol_mult": cx_vmult, "climax_ret": cx_ret,
        })

    top96_rows.sort(key=lambda r: (-r["rs"], -r["comp_return"]))
    for i, r in enumerate(top96_rows, 1):
        r["rank_in_week"] = i
    return top96_rows, all_rs_rows, universe_rows


def fetch_market(market, weeks_back):
    mktcap_top = MKTCAP_TOP_PCT.get(market)
    mktcap_min = MKTCAP_MIN_NATIVE.get(market)
    print(f"\n[{market}] 데이터 로드  (시총 상위 {mktcap_top}%"
          + (f" + 최소 {mktcap_min/1e8:,.0f}억" if mktcap_min and market == 'KR' else "")
          + ")")
    names_en_map = None
    yahoo_mktcap = None
    if market == "JP":
        rs_table = pd.DataFrame()                                 # 테이블 없음 — 매 주차 임시 계산
        raw_cache = load_jp_weekly_cache()
        weekly_cache = _normalize_weekly_cache(raw_cache)
        ticker_names = load_jp_ticker_names()
        names_en_map = load_jp_localized_names()
        mktcap_cache = {}
        shares_map = load_jp_shares()
        yahoo_mktcap = load_jp_mktcap_combined()
        # 통합 커버리지 = yahoo 직접 + shares 추정 (둘 중 하나라도 있으면 시총 산출 가능)
        with_data = set(yahoo_mktcap.keys()) | set(shares_map.keys())
        coverage = len(with_data) / max(len(weekly_cache), 1)
        print(f"  weekly_cache: {len(weekly_cache):,}개 · RS 테이블 없음(매 주차 임시 계산) · "
              f"이름 매핑: {len(ticker_names):,}개 · "
              f"시총 통합 커버: {len(with_data):,}개 ({coverage*100:.0f}%)")
        # 통합 커버리지가 너무 낮으면 시총 필터 미적용 (왜곡 방지). 30% 이상이면 적용.
        if mktcap_top is not None and coverage < 0.30:
            print(f"  ⚠ JP 시총 통합 커버 {coverage*100:.1f}% < 30% — 시총 필터 미적용")
            mktcap_top = None
            mktcap_min = None
    elif market == "KR":
        rs_table = _normalize_rs_table(load_rs_table("KR"))
        raw_cache = load_weekly_cache("KR")
        weekly_cache = _normalize_weekly_cache(raw_cache)
        ticker_names = load_ticker_names("KR")
        mktcap_cache = load_mktcap_cache("KR")
        shares_map = {}
        print(f"  weekly_cache: {len(weekly_cache):,}개 · RS 테이블: {len(rs_table):,}주 · "
              f"이름 매핑: {len(ticker_names):,}개 · 시총 캐시: {len(mktcap_cache):,}개  "
              f"(인덱스 W-FRI 정규화 완료)")
    else:  # US
        rs_table = _normalize_rs_table(load_rs_table("US"))
        raw_cache = load_weekly_cache("US")
        weekly_cache = _normalize_weekly_cache(raw_cache)
        ticker_names = load_ticker_names("US")
        mktcap_cache = {}
        shares_map = load_us_shares()
        print(f"  weekly_cache: {len(weekly_cache):,}개 · RS 테이블: {len(rs_table):,}주 · "
              f"이름 매핑: {len(ticker_names):,}개  (인덱스 W-FRI 정규화 완료)")

    mktcap_lookup = make_mktcap_lookup(market, mktcap_cache, shares_map,
                                       yahoo_mktcap=yahoo_mktcap)

    all_weeks = set()
    for v in weekly_cache.values():
        s = get_close_series(v)
        if s is not None:
            all_weeks.update(s.index)
    weeks = sorted(all_weeks)[-weeks_back:]
    print(f"  대상 주차 {len(weeks)}개: {weeks[0].date()} ~ {weeks[-1].date()}")

    signal_lookup = build_signal_lookup(raw_cache, weeks)
    print(f"  보조신호 사전계산: {len(signal_lookup):,}종목 (align_weeks · climax_warn)")

    daily_cache = load_daily_cache(market)
    ema_lookup = build_daily_ema_lookup(daily_cache, weeks)
    print(f"  일봉 EMA 사전계산: {len(ema_lookup):,}종목 (21/50일 EMA, 금요일 as-of)")

    top96_all = []
    hist_by_ticker = {}
    rs96_tickers = set()
    universe_all = []

    for i, w in enumerate(weeks, 1):
        top96, all_rs, universe = extract_week(w, market, rs_table, weekly_cache,
                                               ticker_names, mktcap_lookup,
                                               mktcap_top, mktcap_min,
                                               names_en=names_en_map,
                                               signal_lookup=signal_lookup,
                                               ema_lookup=ema_lookup)
        top96_all.extend(top96)
        universe_all.extend(universe)
        for r in top96:
            rs96_tickers.add(r["ticker"])
        for r in all_rs:
            hist_by_ticker.setdefault(r["ticker"], []).append(r)
        if i % 10 == 0 or i == len(weeks):
            print(f"  진행 {i}/{len(weeks)}주 · top96 누적 {len(top96_all):,}건 · "
                  f"universe 누적 {len(universe_all):,}건", flush=True)

    # ── 일봉 EMA 폴백 — 표시 대상(RS96 이력 + 최신주 RS86+) 중 일봉 캐시 결측분 ──
    latest_str = weeks[-1].date().isoformat()
    need = set(rs96_tickers)
    for r in universe_all:
        if r["week_date"] == latest_str and r["rs"] >= 86:
            need.add(r["ticker"])
    missing = sorted(tk for tk in need if tk not in ema_lookup)
    if missing:
        fb_daily = fetch_daily_fallback(market, missing)
        fb_lookup = build_daily_ema_lookup(fb_daily, weeks)
        patched = 0
        for rows in (top96_all, universe_all):
            for r in rows:
                em = fb_lookup.get(r["ticker"])
                if em is None or r.get("ema_21") is not None:
                    continue
                wts = pd.Timestamp(r["week_date"])
                x21 = em[21].get(wts)
                x50 = em[50].get(wts)
                r["ema_21"] = round(float(x21), 2) if x21 is not None and not pd.isna(x21) else None
                r["ema_50"] = round(float(x50), 2) if x50 is not None and not pd.isna(x50) else None
                if r["ema_21"] is not None:
                    patched += 1
        print(f"  일봉 EMA 폴백: 결측 {len(missing)}개 → {len(fb_lookup)}개 수집 · {patched}행 보강")

    hist_rows = []
    for tk in rs96_tickers:
        hist_rows.extend(hist_by_ticker.get(tk, []))
    hist_rows.sort(key=lambda r: (r["ticker"], r["week_date"]))
    universe_all.sort(key=lambda r: (r["ticker"], r["week_date"]))

    print(f"  [{market}] top96 {len(top96_all):,}건 · "
          f"history {len(hist_rows):,}건 ({len(rs96_tickers):,}종목) · "
          f"universe {len(universe_all):,}건")
    return top96_all, hist_rows, sorted(rs96_tickers), universe_all


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


def _columns_exist(table, cols):
    """table 에 cols 가 모두 존재하면 True. 없으면(400) False — 적재 전 방어용."""
    base = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1"
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    url = f"{base}/{table}?select={','.join(cols)}&limit=1"
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    r = urllib.request.Request(url, headers=h, method="GET")
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            resp.read()
        return True
    except Exception:
        return False


def _chunk(rows, n=500):
    for i in range(0, len(rows), n):
        yield rows[i:i + n]


def upsert_supabase(top_rows, hist_rows, rs96_tickers_by_market, universe_rows=None):
    req = _supabase_client()

    # 새 보조 컬럼이 테이블에 아직 없으면 strip — ALTER 전이어도 적재 안 깨짐
    if top_rows and "align_weeks" in top_rows[0]:
        if not _columns_exist("rs_top_weekly", ["align_weeks", "climax_warn"]):
            print("[supabase] rs_top_weekly 에 align_weeks/climax_warn 컬럼 없음 "
                  "— 이번엔 생략(ALTER 실행 후 다음 적재부터 표시)")
            for r in top_rows:
                r.pop("align_weeks", None)
                r.pop("climax_warn", None)
    _MA_COLS = ("price_ma_4", "price_ma_13", "price_ma_26", "price_ma_52",
                "vol_ma_4", "vol_ma_13", "vol_ma_26")
    if top_rows and "price_ma_4" in top_rows[0]:
        if not _columns_exist("rs_top_weekly", ["price_ma_4"]):
            print("[supabase] rs_top_weekly 에 이동평균(price_ma_*/vol_ma_*) 컬럼 없음 "
                  "— 이번엔 생략(ALTER 실행 후 다음 적재부터 표시)")
            for r in top_rows:
                for k in _MA_COLS:
                    r.pop(k, None)
    if top_rows and "ema_21" in top_rows[0]:
        if not _columns_exist("rs_top_weekly", ["ema_21", "ema_50"]):
            print("[supabase] rs_top_weekly 에 일봉 EMA(ema_21/ema_50) 컬럼 없음 "
                  "— 이번엔 생략(ALTER 실행 후 다음 적재부터 표시)")
            for r in top_rows:
                r.pop("ema_21", None)
                r.pop("ema_50", None)
    _CX_COLS = ("climax_week", "climax_vol_mult", "climax_ret")
    if top_rows and "climax_week" in top_rows[0]:
        if not _columns_exist("rs_top_weekly", ["climax_week"]):
            print("[supabase] rs_top_weekly 에 클라이맥스 진단 컬럼 없음 "
                  "— 이번엔 생략(ALTER 실행 후 다음 적재부터 표시)")
            for r in top_rows:
                for k in _CX_COLS:
                    r.pop(k, None)
    if hist_rows and "align_weeks" in hist_rows[0]:
        if not _columns_exist("rs_history_weekly", ["align_weeks", "vol_gap_4_26"]):
            print("[supabase] rs_history_weekly 에 align_weeks/vol_gap_4_26 컬럼 없음 "
                  "— 이번엔 생략(ALTER 실행 후 다음 적재부터 표시)")
            for r in hist_rows:
                r.pop("align_weeks", None)
                r.pop("vol_gap_4_26", None)
    if hist_rows and "vol_gap_13_26" in hist_rows[0]:
        if not _columns_exist("rs_history_weekly", ["vol_gap_13_26"]):
            print("[supabase] rs_history_weekly 에 vol_gap_13_26 컬럼 없음 "
                  "— 이번엔 생략(ALTER 실행 후 다음 적재부터 표시)")
            for r in hist_rows:
                r.pop("vol_gap_13_26", None)
    if universe_rows and "align_weeks" in universe_rows[0]:
        if not _columns_exist("rs_universe_weekly",
                              ["align_weeks", "vol_ma_4", "price_ma_4"]):
            print("[supabase] rs_universe_weekly 에 신호/이평 컬럼 없음 "
                  "— 이번엔 생략(ALTER 실행 후 다음 적재부터 표시)")
            for r in universe_rows:
                for k in ("align_weeks", "climax_warn",
                          "vol_ma_4", "vol_ma_13", "vol_ma_26",
                          "price_ma_4", "price_ma_13", "price_ma_26", "price_ma_52"):
                    r.pop(k, None)
    if universe_rows and "ema_21" in universe_rows[0]:
        if not _columns_exist("rs_universe_weekly", ["ema_21", "ema_50"]):
            print("[supabase] rs_universe_weekly 에 일봉 EMA 컬럼 없음 "
                  "— 이번엔 생략(ALTER 실행 후 다음 적재부터 표시)")
            for r in universe_rows:
                r.pop("ema_21", None)
                r.pop("ema_50", None)
    if universe_rows and "climax_week" in universe_rows[0]:
        if not _columns_exist("rs_universe_weekly", ["climax_week"]):
            print("[supabase] rs_universe_weekly 에 클라이맥스 진단 컬럼 없음 "
                  "— 이번엔 생략(ALTER 실행 후 다음 적재부터 표시)")
            for r in universe_rows:
                for k in ("climax_week", "climax_vol_mult", "climax_ret"):
                    r.pop(k, None)

    # 시장 전체 삭제 후 재적재 — 옛 stale 주차(예: 월요일 timestamp) row 동시 정리.
    markets = set(rs96_tickers_by_market.keys()) | {r["market"] for r in top_rows}
    for mk in markets:
        req("DELETE", f"/rs_top_weekly?market=eq.{urllib.parse.quote(mk)}")
        req("DELETE", f"/rs_history_weekly?market=eq.{urllib.parse.quote(mk)}")
        if universe_rows is not None:
            req("DELETE", f"/rs_universe_weekly?market=eq.{urllib.parse.quote(mk)}")

    for c in _chunk(top_rows):
        req("POST", "/rs_top_weekly", c)
    print(f"[supabase] rs_top_weekly {len(top_rows):,}건 적재 완료")

    for c in _chunk(hist_rows):
        req("POST", "/rs_history_weekly", c)
    print(f"[supabase] rs_history_weekly {len(hist_rows):,}건 적재 완료")

    if universe_rows:
        for c in _chunk(universe_rows, n=1000):
            req("POST", "/rs_universe_weekly", c)
        print(f"[supabase] rs_universe_weekly {len(universe_rows):,}건 적재 완료")

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
            v = r.get("mktcap")
            if v:
                if mk == "KR":
                    mc = f" · 시총 {v/1e8:,.0f}억"
                elif mk == "JP":
                    mc = f" · 시총 ¥{v/1e8:,.0f}億"
                else:  # US
                    mc = f" · 시총 ${v/1e9:.1f}B" if v >= 1e9 else f" · 시총 ${v/1e6:,.0f}M"
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
    ap.add_argument("--full-universe", action="store_true",
                    help="rs_universe_weekly 에 mktcap 필터 통과 모든 종목의 RS 도 적재 "
                         "(RS 조회 검색용)")
    args = ap.parse_args()

    Config()  # .env.local 로드

    top_all, hist_all, universe_all = [], [], []
    rs96_tickers_by_market = {}
    targets = MARKETS_ALL if args.market == "all" else (args.market,)
    for mk in targets:
        t, h, tks, u = fetch_market(mk, args.weeks)
        top_all.extend(t); hist_all.extend(h); rs96_tickers_by_market[mk] = tks
        if args.full_universe:
            universe_all.extend(u)

    print(f"\n총 top96 {len(top_all):,}건 · history {len(hist_all):,}건"
          + (f" · universe {len(universe_all):,}건" if args.full_universe else ""))

    if args.dry_run:
        preview(top_all, hist_all)
    else:
        if top_all or hist_all or universe_all:
            upsert_supabase(top_all, hist_all, rs96_tickers_by_market,
                            universe_rows=universe_all if args.full_universe else None)
        else:
            print("적재할 row 없음 — Supabase 호출 생략")
    print("DONE")


if __name__ == "__main__":
    main()
