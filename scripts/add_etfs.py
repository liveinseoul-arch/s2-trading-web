#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""선두지기(96+) · ETF RS 값 추가.

US universe 는 시총 상위 20% 필터로 ETF 를 자동 제외하기 때문에 QQQ/SPY/SMH 등이
RS 조회에 안 나옴. 본 스크립트가 화이트리스트 ETF 들을 yfinance 로 가져와
같은 12·24·36·48 가중 composite return 으로 RS 를 계산, rs_universe_weekly 에 추가.

RS 계산법:
  comp_return 을 그 주차 US 전체 stock universe 의 comp_return 분포에서 percentile rank.
  (export_rs_weekly 의 quantile 기반 comp_to_rs 와 거의 동일 결과)

사용:
  python add_etfs.py                  # 화이트리스트 ETF 모두 (US 시장)
  python add_etfs.py --weeks 56       # 최근 N주

⚠ export_rs_weekly --market US 가 rs_universe_weekly 의 US 행 전체를 삭제 후 재적재
  하기 때문에 그 직후엔 본 스크립트도 다시 실행해야 합니다.

env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (.env.local)
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
import yfinance as yf

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)
from config import Config                                    # noqa: E402

# 보조 신호(정배열·거래량 이동평균) 공용 모듈 — C:\quantBacktest
QB_DIR = Path(r"C:\quantBacktest")
sys.path.insert(0, str(QB_DIR))
try:
    import rs_signal_cols as RSC                              # noqa: E402
except Exception as _e:                                       # pragma: no cover
    RSC = None
    print(f"⚠ rs_signal_cols 로드 실패 — ETF 보조신호 생략: {_e}")


def _sig_cols_exist():
    """rs_universe_weekly 에 신호 컬럼이 있는지 비치명적 확인 (없으면 ETF 신호 생략)."""
    try:
        base = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1"
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        url = base + "/rs_universe_weekly?select=align_weeks,vol_ma_4&limit=1"
        r = urllib.request.Request(url, headers={"apikey": key,
                                                 "Authorization": f"Bearer {key}"})
        with urllib.request.urlopen(r, timeout=30) as resp:
            resp.read()
        return True
    except Exception:
        return False

# ── ETF 화이트리스트 (시장별) ──────────────────────────────────
# name 은 yfinance 가 자동 채움, name_en 은 영문 (한국어 별칭) 형식.

US_ETFS = [
    # 대표 지수
    {"ticker": "SPY",  "name_en": "SPDR S&P 500 ETF (S&P 500)"},
    {"ticker": "QQQ",  "name_en": "Invesco QQQ Trust (나스닥 100)"},
    {"ticker": "DIA",  "name_en": "SPDR Dow Jones ETF (다우 30)"},
    {"ticker": "IWM",  "name_en": "iShares Russell 2000 (러셀 2000)"},
    {"ticker": "VTI",  "name_en": "Vanguard Total Stock Market (전체 미국)"},

    # 섹터 SPDR
    {"ticker": "XLK",  "name_en": "Technology Select Sector (기술주)"},
    {"ticker": "XLF",  "name_en": "Financial Select Sector (금융)"},
    {"ticker": "XLE",  "name_en": "Energy Select Sector (에너지)"},
    {"ticker": "XLI",  "name_en": "Industrial Select Sector (산업재)"},
    {"ticker": "XLV",  "name_en": "Health Care Select Sector (헬스케어)"},
    {"ticker": "XLY",  "name_en": "Consumer Discretionary (소비재)"},
    {"ticker": "XLP",  "name_en": "Consumer Staples (필수소비재)"},
    {"ticker": "XLU",  "name_en": "Utilities Select Sector (유틸리티)"},
    {"ticker": "XLB",  "name_en": "Materials Select Sector (소재)"},
    {"ticker": "XLRE", "name_en": "Real Estate Select Sector (리츠)"},
    {"ticker": "XLC",  "name_en": "Communication Services (통신)"},

    # 테마/산업
    {"ticker": "SMH",  "name_en": "VanEck Semiconductor (반도체)"},
    {"ticker": "SOXX", "name_en": "iShares Semiconductor (반도체)"},
    {"ticker": "ARKK", "name_en": "ARK Innovation (혁신)"},
    {"ticker": "ITA",  "name_en": "iShares Aerospace & Defense (방산우주)"},
    {"ticker": "IBB",  "name_en": "iShares Biotechnology (바이오)"},
    {"ticker": "KBE",  "name_en": "SPDR Bank ETF (은행)"},
    {"ticker": "KRE",  "name_en": "SPDR Regional Bank (지역 은행)"},
    {"ticker": "GDX",  "name_en": "VanEck Gold Miners (금 채굴)"},
    {"ticker": "IGV",  "name_en": "iShares Expanded Tech-Software (소프트웨어)"},

    # 채권·원자재
    {"ticker": "TLT",  "name_en": "iShares 20+ Yr Treasury (장기 국채)"},
    {"ticker": "IEF",  "name_en": "iShares 7-10 Yr Treasury (중기 국채)"},
    {"ticker": "GLD",  "name_en": "SPDR Gold (금)"},
    {"ticker": "SLV",  "name_en": "iShares Silver (은)"},
    {"ticker": "USO",  "name_en": "United States Oil Fund (WTI 원유)"},
    {"ticker": "UUP",  "name_en": "Invesco DB US Dollar (달러)"},

    # 국가
    {"ticker": "EEM",  "name_en": "iShares Emerging Markets (신흥국)"},
    {"ticker": "EWJ",  "name_en": "iShares Japan (일본)"},
    {"ticker": "EWY",  "name_en": "iShares Korea (한국)"},
    {"ticker": "EWT",  "name_en": "iShares Taiwan (대만)"},
    {"ticker": "FXI",  "name_en": "iShares China Large-Cap (중국 대형주)"},
    {"ticker": "INDA", "name_en": "iShares India (인도)"},
    {"ticker": "VGK",  "name_en": "Vanguard FTSE Europe (유럽)"},
]

# 한국 상장 ETF (KOSPI, .KS 접미사). 자산운용사: KODEX(삼성자산운용), TIGER(미래에셋자산운용).
KR_ETFS = [
    # ── KODEX (삼성자산운용)
    {"ticker": "069500.KS", "name_en": "KODEX 200 (코스피 200)"},
    {"ticker": "278530.KS", "name_en": "KODEX 200TR (코스피 200 토탈리턴)"},
    {"ticker": "229200.KS", "name_en": "KODEX 코스닥 150"},
    {"ticker": "114800.KS", "name_en": "KODEX 인버스"},
    {"ticker": "122630.KS", "name_en": "KODEX 레버리지"},
    {"ticker": "252670.KS", "name_en": "KODEX 200선물인버스2X"},
    {"ticker": "294400.KS", "name_en": "KODEX 코스피TR"},
    {"ticker": "379800.KS", "name_en": "KODEX 미국S&P500TR"},
    {"ticker": "379810.KS", "name_en": "KODEX 미국나스닥100TR"},
    {"ticker": "133690.KS", "name_en": "KODEX 미국나스닥100선물(H)"},
    {"ticker": "099140.KS", "name_en": "KODEX 차이나H"},
    {"ticker": "091160.KS", "name_en": "KODEX 반도체"},
    {"ticker": "091170.KS", "name_en": "KODEX 은행"},
    {"ticker": "091180.KS", "name_en": "KODEX 자동차"},
    {"ticker": "098560.KS", "name_en": "KODEX 미디어&엔터테인먼트"},
    {"ticker": "266360.KS", "name_en": "KODEX 한국대만IT프리미어"},
    {"ticker": "305720.KS", "name_en": "KODEX 2차전지산업"},
    {"ticker": "117460.KS", "name_en": "KODEX 에너지화학"},
    {"ticker": "117680.KS", "name_en": "KODEX 철강"},
    {"ticker": "117700.KS", "name_en": "KODEX 건설"},
    {"ticker": "132030.KS", "name_en": "KODEX 골드선물(H) (금)"},
    {"ticker": "153130.KS", "name_en": "KODEX 단기채권"},
    {"ticker": "114470.KS", "name_en": "KODEX 헬스케어"},
    {"ticker": "305540.KS", "name_en": "KODEX 2차전지 (배터리)"},

    # ── TIGER (미래에셋자산운용)
    {"ticker": "102110.KS", "name_en": "TIGER 200 (코스피 200)"},
    {"ticker": "232080.KS", "name_en": "TIGER 코스닥 150"},
    {"ticker": "360750.KS", "name_en": "TIGER 미국S&P500"},
    {"ticker": "133690.KS", "name_en": "TIGER 미국나스닥100"},
    {"ticker": "381180.KS", "name_en": "TIGER 미국필라델피아반도체나스닥"},
    {"ticker": "371460.KS", "name_en": "TIGER 차이나전기차SOLACTIVE (중국 전기차)"},
    {"ticker": "364980.KS", "name_en": "TIGER KRX2차전지K-뉴딜 (배터리)"},
    {"ticker": "396500.KS", "name_en": "TIGER Fn반도체TOP10 (반도체)"},
    {"ticker": "091160.KS", "name_en": "TIGER 반도체"},
    {"ticker": "143860.KS", "name_en": "TIGER 헬스케어"},
    {"ticker": "244580.KS", "name_en": "TIGER 바이오TOP10"},
    {"ticker": "210780.KS", "name_en": "TIGER 코스피고배당"},
    {"ticker": "329200.KS", "name_en": "TIGER 리츠부동산인프라"},
    {"ticker": "305080.KS", "name_en": "TIGER 미국채10년선물"},
    {"ticker": "319640.KS", "name_en": "TIGER 골드선물(H) (금)"},
    {"ticker": "228810.KS", "name_en": "TIGER 미디어컨텐츠"},
    {"ticker": "139660.KS", "name_en": "TIGER 200IT (정보기술)"},
    {"ticker": "139220.KS", "name_en": "TIGER 200건설"},
    {"ticker": "139250.KS", "name_en": "TIGER 200중공업"},
    {"ticker": "139270.KS", "name_en": "TIGER 200금융"},
    {"ticker": "150460.KS", "name_en": "TIGER 중국소비테마"},
    {"ticker": "157450.KS", "name_en": "TIGER 200에너지화학"},
    {"ticker": "157500.KS", "name_en": "TIGER 200철강소재"},
    {"ticker": "227560.KS", "name_en": "TIGER 200산업재"},
]

# ETF 가 등록된 시장 dict — 'market' 키를 강제로 박아 줌
ETFS_BY_MARKET = {
    "US": US_ETFS,
    "KR": KR_ETFS,
}


# ── 같은 composite_return 공식 (export_rs_weekly 와 일치) ─────
COMPOSITE = [(12, 2.0), (24, 1.0), (36, 1.0), (48, 1.0)]
TOTAL_WEIGHT = sum(w for _, w in COMPOSITE)


def composite_return(weekly_close: pd.Series, week) -> float:
    """w-FRI 기준 12·24·36·48 가중 누적수익률."""
    if week not in weekly_close.index:
        return np.nan
    idx = weekly_close.index.get_loc(week)
    cur = float(weekly_close.iloc[idx])
    if cur <= 0:
        return np.nan
    s = 0.0
    for n, w in COMPOSITE:
        j = idx - n
        if j < 0:
            return np.nan
        past = float(weekly_close.iloc[j])
        if past <= 0:
            return np.nan
        s += w * (cur / past - 1.0)
    return s / TOTAL_WEIGHT


# ── Supabase REST ────────────────────────────────────────────
def _sb_client():
    base = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1"
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    H = {"apikey": key, "Authorization": f"Bearer {key}",
         "Content-Type": "application/json"}

    def req(method, path, body=None, prefer="return=minimal", range_header=None):
        h = dict(H); h["Prefer"] = prefer
        if range_header:
            h["Range-Unit"] = "items"
            h["Range"] = range_header
        data = json.dumps(body).encode("utf-8") if body is not None else None
        r = urllib.request.Request(base + path, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(r, timeout=120) as resp:
                txt = resp.read().decode("utf-8")
                return json.loads(txt) if txt.strip() else None
        except urllib.error.HTTPError as e:
            raise SystemExit(f"[supabase] {method} {path} 실패 {e.code}: "
                             f"{e.read().decode('utf-8')[:400]}")
    return req


# ★★★CAND-2026-10-20-8 — ★종목 범위 스테이징 swap.
#   ★보고 → quant_infra/2026-10/RS_SWAP_QUEUE_CLOSE_2026-10-23.md
#   ★마이그레이션 → supabase/migrations/2026-10-23_rs_universe_ticker_swap.sql
#   ★모체 → export_rs_weekly.py:1104-1168 (`S2_RS_SWAP` · 채택 2026-10-20)
#
#   ★★무엇이 문제였나 — `:369-372` 가 ★종목별로 `DELETE` 한 뒤 `POST` 한다.
#     ★그 사이에 죽으면 ★**그 1종목이 ★빈 채로 남는다**(`/rs96` 검색에 ★빈칸으로 보인다).
#   ⚠️★★여기에는 ★`export_rs_weekly` 의 ★재시도(`S2_SUPABASE_RETRY`)가 ★없다 —
#     ★`req()`(:213)는 ★`HTTPError` 를 ★`SystemExit` 으로 바꿔 ★한 번에 죽는다.
#     ★그리고 ★`SystemExit` 은 ★`Exception` 이 ★아니라서 ★`:419` 의 종목별
#     ★`except Exception` 을 ★통과해 ★스크립트 전체를 끝낸다.
#
#   ★★착상은 ★모체와 ★같다 — ★원자성은 ★「한 요청」이 아니라 ★「한 트랜잭션」에서 나온다.
#     ①★그 (시장, 종목)분 ★스테이징 잔해를 ★먼저 지운다
#     ②★행을 ★`rs_universe_weekly_staging` 에 ★올린다(★본표 무접촉)
#     ③★`rs_universe_ticker_swap(market, [ticker])` ★1회가 ★교체한다
#
#   ⚠️★★모체 함수(`rs_weekly_swap`)를 ★그대로 쓰면 ★안 된다 — ★그것은
#     ★`market = any(...)` 범위라 ★**그 시장 본표 전체**를 ★ETF 로 ★교체해 버린다.
#     ★그래서 ★(시장, 종목) 범위 함수를 ★하나 ★더 만들었다.
#
#   ★★스테이징 표는 ★**새로 만들지 않는다** — ★모체 마이그레이션이 만든 것을 쓴다.
#   ⚠️★그 표에는 ★주간 export 행이 ★남아 있다(모체가 ★끝에 비우지 않는 설계).
#     ★그래서 ★①의 ★(시장, 종목) 삭제가 ★선택이 아니라 ★**필수**다.
#
#   ★되돌리기 — `S2_ETF_SWAP=0`(★기본값) ★한 줄.
ETF_SWAP = os.environ.get("S2_ETF_SWAP", "0").strip() == "1"
ETF_STAGING_SUFFIX = "_staging"


def _etf_swap_body(market: str, tickers) -> dict:
    """★swap RPC 본문 — ★네트워크를 ★타지 않는 ★순수 함수.

    ★★분리한 이유는 ★모체 `_rs_swap_body` 와 ★같다 — ★off 재현 검증을 ★네트워크 없이
      하려면 ★본문 생성이 ★POST 와 ★분리돼 있어야 한다.
    ★★그리고 ★이 본문이 ★이 설계의 전부다 — ★**행이 한 건도 안 실린다.**
    ⚠️★`tickers` 를 ★sorted 로 고정한다 — ★집합 순회는 ★프로세스마다 다르다(PYTHONHASHSEED).
    """
    return {"p_market": market, "p_tickers": sorted(tickers)}


def _etf_swap_post(body: dict, sent: int) -> None:
    r"""★`public.rs_universe_ticker_swap` 를 ★1회 호출하고 ★행수로 검산한다.

    ★★분리한 이유 — ★모체 `_rs_swap_post` 와 ★같다. ★off 재현 하니스가 ★네트워크도
      ★env 도 ★안 타게 하려면 ★이 경계가 ★있어야 한다(★하니스가 ★이 함수를 통째로 교체한다).
    ⚠️★검산은 ★rc 가 아니라 ★함수가 돌려준 ★행수로 한다(모체 교훈 승계).
    """
    raw = json.dumps(body).encode("utf-8")
    base = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1"
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    h = {"apikey": key, "Authorization": f"Bearer {key}",
         "Content-Type": "application/json"}
    r = urllib.request.Request(base + "/rpc/rs_universe_ticker_swap", data=raw,
                               method="POST", headers=h)
    try:
        with urllib.request.urlopen(r, timeout=300) as resp:
            got = json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        _b = e.read().decode("utf-8")[:600]
        raise SystemExit(
            f"[supabase] POST /rpc/rs_universe_ticker_swap 실패 {e.code}: {_b}\n"
            f"   ★본표는 ★종전 상태 그대로다(트랜잭션 ROLLBACK) — ★빈 표가 ★아니다.\n"
            f"   ★함수가 없으면: "
            f"supabase/migrations/2026-10-23_rs_universe_ticker_swap.sql 을 적용할 것.\n"
            f"   ★되돌리기: S2_ETF_SWAP=0")
    except (urllib.error.URLError, OSError) as e:
        raise SystemExit(
            f"[supabase] POST /rpc/rs_universe_ticker_swap ★네트워크 실패: {e!r}\n"
            f"   ★본표는 ★종전 상태 그대로다(트랜잭션 미완 = ROLLBACK).\n"
            f"   ★되돌리기: S2_ETF_SWAP=0")

    if isinstance(got, list):          # PostgREST 가 배열로 싸는 경우
        got = got[0] if got else {}
    ins = (got.get("inserted") or {}).get("rs_universe_weekly")
    if ins != sent:
        raise SystemExit(
            "[supabase] ★swap 적재 행수 불일치 — 보냄 %d / DB %s\n"
            "   ★함수 정의를 확인할 것." % (sent, ins))
    _del = (got.get("deleted") or {}).get("rs_universe_weekly")
    print("  [swap] 교체 완료 · 행수 검산 통과 (삭제 %s · 적재 %s)" % (_del, ins))


def _etf_swap_load(req, market: str, ticker: str, rows: list) -> None:
    r"""★★CAND-2026-10-20-8 — ★스테이징 적재 + ★swap 1회.

    ★★요청 모양이 ★종전과 ★같다 — ★표 이름에 `_staging` 이 붙을 뿐이다.
      ★그래서 ★`req()` 를 ★그대로 쓴다(★청크 500 도 ★그대로).
    ⚠️★`--weeks 56` 이라 ★`len(rows) <= 56` 이고 ★청크는 ★사실상 ★항상 1개다 —
      ★즉 ★종전 경로에서도 ★**부분 적재는 원리적으로 안 난다.**
      ★★이 처치가 없애는 것은 ★「부분 적재」가 아니라 ★**DELETE 성공 뒤 POST 실패로
      ★그 1종목이 ★빈 채로 남는 창**이다.
    """
    S = ETF_STAGING_SUFFIX
    q = urllib.parse.quote(ticker)
    req("DELETE", f"/rs_universe_weekly{S}?market=eq.{market}&ticker=eq.{q}")
    for i in range(0, len(rows), 500):
        req("POST", f"/rs_universe_weekly{S}", rows[i:i + 500])
    _etf_swap_post(_etf_swap_body(market, [ticker]), len(rows))


def fetch_market_distribution(req, market: str, week: str) -> list[float]:
    """그 시장·주차 universe 종목들의 comp_return 분포 (RS 백분위 계산용)."""
    out: list[float] = []
    for page in range(10):
        from_ = page * 1000
        to = from_ + 999
        path = (f"/rs_universe_weekly?market=eq.{market}"
                f"&week_date=eq.{urllib.parse.quote(week)}"
                f"&select=comp_return&order=ticker.asc")
        rows = req("GET", path, prefer="return=representation",
                   range_header=f"{from_}-{to}") or []
        if not rows:
            break
        for r in rows:
            v = r.get("comp_return")
            if v is not None:
                out.append(float(v))
        if len(rows) < 1000:
            break
    return out


def fetch_market_weeks(req, market: str) -> list[str]:
    """그 시장 rs_top_weekly 의 distinct week_date 최신순."""
    seen = set()
    for page in range(20):
        from_ = page * 1000
        to = from_ + 999
        path = f"/rs_top_weekly?market=eq.{market}&select=week_date&order=week_date.desc"
        rows = req("GET", path, prefer="return=representation",
                   range_header=f"{from_}-{to}") or []
        if not rows:
            break
        for r in rows:
            seen.add(r["week_date"])
        if len(rows) < 1000:
            break
    return sorted(seen, reverse=True)


def percentile_rank(value: float, sorted_dist: list[float]) -> int:
    """RS = floor(rank / n * 100), max 99 (export_rs_weekly 의 quantile bucket 과 거의 동일)."""
    if value is None or np.isnan(value) or not sorted_dist:
        return -1
    import bisect
    rank = bisect.bisect_right(sorted_dist, value)
    n = len(sorted_dist)
    return min(int(rank / n * 100), 99)


# ── ETF 1개 처리 ─────────────────────────────────────────────
def process_etf(req, etf: dict, market: str, market_weeks: list[str],
                dist_cache: dict[tuple[str, str], list[float]], sig_ok: bool = False):
    ticker = etf["ticker"]
    name_en = etf["name_en"]
    print(f"\n[{market} {ticker}] yfinance fetch...")
    yh = yf.Ticker(ticker)
    info = yh.info or {}
    name = info.get("longName") or info.get("shortName") or ticker

    daily = yh.history(period="3y", interval="1d", auto_adjust=False)
    if daily.empty:
        print(f"  ⚠ 데이터 없음 — skip")
        return 0
    daily.index = daily.index.tz_localize(None)
    weekly = daily["Close"].resample("W-FRI").last().dropna()
    weekly_vol = ((daily["Volume"].resample("W-FRI").sum().reindex(weekly.index).fillna(0))
                  if "Volume" in daily.columns else None)
    print(f"  weekly {len(weekly)}주 · longName={name}")

    # 보조 신호 시계열 (정배열 / 클라이맥스 / 주가·거래량 이동평균)
    aw_s = since_s = None
    vma = {4: None, 13: None, 26: None}
    pma = {4: None, 13: None, 26: None, 52: None}
    if sig_ok and RSC is not None:
        try:
            aw_s = RSC.align_weeks_series(weekly)
            since_s = RSC.weeks_since_climax_series(weekly, weekly_vol)
            vma = RSC.vol_ma_series(weekly, weekly_vol)
            pma = RSC.price_ma_series(weekly)
        except Exception as e:
            print(f"  ⚠ 신호 계산 실패: {e}")

    rows = []
    for w in market_weeks:
        w_ts = pd.Timestamp(w)
        if w_ts not in weekly.index:
            continue
        comp = composite_return(weekly, w_ts)
        if np.isnan(comp):
            continue
        sorted_dist = dist_cache.get((market, w))
        if sorted_dist is None:
            dist = fetch_market_distribution(req, market, w)
            sorted_dist = sorted(dist)
            dist_cache[(market, w)] = sorted_dist
        if not sorted_dist:
            continue
        rs = percentile_rank(comp, sorted_dist)
        if rs < 0:
            continue
        close_val = float(weekly.loc[w_ts])
        row = {
            "market": market,
            "ticker": ticker,
            "week_date": w,
            "name": name,
            "name_en": name_en,
            "rs": rs,
            "comp_return": float(comp),
            "close": close_val,
            "mktcap": None,
        }
        if sig_ok:
            def _at(series):
                try:
                    val = series.loc[w_ts]
                    return None if pd.isna(val) else val
                except Exception:
                    return None
            if aw_s is not None:
                a = _at(aw_s)
                row["align_weeks"] = int(a) if a is not None else None
            if since_s is not None:
                sc = _at(since_s)
                row["climax_warn"] = bool(sc <= RSC.WARN_WITHIN) if sc is not None else None
            for n in (4, 13, 26):
                if vma.get(n) is not None:
                    x = _at(vma[n])
                    row[f"vol_ma_{n}"] = round(float(x), 0) if x is not None else None
            for n in (4, 13, 26, 52):
                if pma.get(n) is not None:
                    x = _at(pma[n])
                    row[f"price_ma_{n}"] = round(float(x), 2) if x is not None else None
        rows.append(row)
    if not rows:
        print(f"  ⚠ 적재 row 0개")
        return 0

    # ★★CAND-2026-10-20-8 — ★게이트 on 이면 ★스테이징 + swap(★기본 off = 종전 경로).
    if ETF_SWAP:
        _etf_swap_load(req, market, ticker, rows)
    else:
        req("DELETE",
            f"/rs_universe_weekly?market=eq.{market}&ticker=eq.{urllib.parse.quote(ticker)}")
        for i in range(0, len(rows), 500):
            req("POST", "/rs_universe_weekly", rows[i:i+500])
    latest_rs = rows[0]["rs"]
    print(f"  ✓ {len(rows)}주 적재 · 최신 RS{latest_rs}")
    return len(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weeks", type=int, default=56,
                    help="최근 N주 (기본 56)")
    ap.add_argument("--ticker", default=None,
                    help="특정 ticker 1개만 처리 (테스트용, --market 도 같이)")
    ap.add_argument("--market", default=None,
                    help="처리할 시장 (US|KR). 미지정 시 모두.")
    args = ap.parse_args()

    Config()
    req = _sb_client()

    sig_ok = (RSC is not None) and _sig_cols_exist()
    print(f"보조신호(정배열·거래량MA): {'ON' if sig_ok else 'OFF (모듈/컬럼 없음 — RS만 적재)'}")

    markets = [args.market.upper()] if args.market else list(ETFS_BY_MARKET.keys())

    dist_cache: dict[tuple[str, str], list[float]] = {}
    total_rows = 0
    for mk in markets:
        if mk not in ETFS_BY_MARKET:
            print(f"⚠ unknown market {mk} — skip")
            continue
        print(f"\n========== [{mk}] ==========")
        print(f"{mk} 주차 목록 fetch...")
        market_weeks = fetch_market_weeks(req, mk)[: args.weeks]
        if not market_weeks:
            print(f"⚠ {mk} rs_top_weekly 데이터 없음 — skip")
            continue
        print(f"  대상 {len(market_weeks)}주 ({market_weeks[-1]} ~ {market_weeks[0]})")

        if args.ticker:
            targets = [{"ticker": args.ticker, "name_en": args.ticker}]
        else:
            targets = ETFS_BY_MARKET[mk]
        print(f"  대상 ETF {len(targets)}개")

        for etf in targets:
            try:
                total_rows += process_etf(req, etf, mk, market_weeks, dist_cache, sig_ok)
            except Exception as e:
                print(f"  ⚠ {etf['ticker']} 처리 실패: {type(e).__name__}: {str(e)[:120]}")
                continue

    print(f"\n✅ 총 {total_rows}건 ETF 행 적재 완료.")
    print(f"   분포 캐시: {len(dist_cache)}개 (market, week)")


if __name__ == "__main__":
    main()
