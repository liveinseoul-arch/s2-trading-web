#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""선두지기(96+) · JP 누락 종목 캐시 패치.

용도: quantBacktest 의 JP universe scraper 가 누락한 종목(주로 신규 IPO) 을
      yfinance 로 직접 가져와 4개 캐시(_jp_weekly_cache, _jp_ticker_cache,
      _jp_mktcap_yahoo, _bt_shares_jp)에 주입.

사용:
  python patch_jp_ticker.py 285A.T "KIOXIA HOLDINGS, INC." "キオクシアホールディングス"
  python patch_jp_ticker.py 6920.T "Lasertec Corp" "レーザーテック"

  # 적용 후 JP 만 재실행:
  python export_rs_weekly.py --market JP --weeks 56 --full-universe

env: 별도 없음. 기존 캐시 파일은 백업 (.bak) 후 덮어씀.
"""
from __future__ import annotations
import argparse
import pickle
import shutil
import sys
from pathlib import Path

import pandas as pd
import yfinance as yf

CACHE_DIR = Path(r"C:\quantBacktest\screen")
FILES = {
    "weekly": CACHE_DIR / "_jp_weekly_cache.pkl",
    "ticker": CACHE_DIR / "_jp_ticker_cache.pkl",
    "mktcap_yahoo": CACHE_DIR / "_jp_mktcap_yahoo.pkl",
    "shares": CACHE_DIR / "_bt_shares_jp.pkl",
    "names_en": CACHE_DIR / "_jp_names_en.pkl",
    "names_ko": CACHE_DIR / "_jp_names_ko.pkl",
}


def load(path: Path):
    if not path.exists():
        return None
    with open(path, "rb") as f:
        return pickle.load(f)


def save(path: Path, obj):
    bak = path.with_suffix(path.suffix + ".bak")
    if path.exists() and not bak.exists():
        shutil.copyfile(path, bak)
        print(f"  backup: {bak.name}")
    with open(path, "wb") as f:
        pickle.dump(obj, f)


def fetch_yahoo(ticker_full: str):
    """yfinance 로 다일/주간 데이터 + 기본 info 가져옴."""
    print(f"[{ticker_full}] yfinance fetch...")
    yh = yf.Ticker(ticker_full)
    info = yh.info or {}
    daily = yh.history(period="max", interval="1d", auto_adjust=False)
    if daily.empty:
        raise SystemExit(f"⚠ {ticker_full}: yahoo 에서 데이터 없음")
    # W-FRI 주간 종가/거래량
    daily.index = daily.index.tz_localize(None)        # tz 제거
    close_w = daily["Close"].resample("W-FRI").last().dropna()
    vol_w = daily["Volume"].resample("W-FRI").last().fillna(0)
    name_en = info.get("longName") or info.get("shortName") or ticker_full
    mktcap = info.get("marketCap")
    shares = info.get("sharesOutstanding")
    print(f"  daily {len(daily)}일 ({daily.index[0].date()} ~ {daily.index[-1].date()})")
    print(f"  weekly {len(close_w)}주 · longName={name_en} · mktcap={mktcap} · shares={shares}")
    return {
        "close_w": close_w,
        "volume_w": vol_w,
        "name_en": name_en,
        "mktcap": float(mktcap) if mktcap else None,
        "shares": float(shares) if shares else None,
        "info_market": info.get("market") or info.get("exchange") or "",
    }


def patch(ticker_full: str, name_ja: str | None, name_ko: str | None,
          name_en_override: str | None):
    code = ticker_full.replace(".T", "")
    data = fetch_yahoo(ticker_full)
    name_en = name_en_override or data["name_en"]

    # 1) weekly_cache
    wc = load(FILES["weekly"]) or {}
    wc[ticker_full] = {"close": data["close_w"], "volume": data["volume_w"]}
    save(FILES["weekly"], wc)
    print(f"  ✓ weekly_cache 적재 (총 {len(wc)} → {ticker_full} 포함)")

    # 2) ticker_cache — tuple 의 [1] dict 에 ticker code → meta
    tc = load(FILES["ticker"])
    if not isinstance(tc, tuple) or len(tc) < 2:
        raise SystemExit("⚠ ticker_cache 구조 예외")
    lst, info_dict, base = tc
    info_dict[code] = {
        "name": name_ja or name_en,
        "market": "プライム（内国株式）",
        "yahoo": ticker_full,
    }
    if code not in lst:
        lst.append(code)
    save(FILES["ticker"], (lst, info_dict, base))
    print(f"  ✓ ticker_cache 적재 ({code} → {info_dict[code]['name']})")

    # 3) yahoo mktcap
    if data["mktcap"]:
        ym = load(FILES["mktcap_yahoo"]) or {}
        ym[ticker_full] = data["mktcap"]
        save(FILES["mktcap_yahoo"], ym)
        print(f"  ✓ mktcap_yahoo {data['mktcap']/1e8:,.0f}억엔")

    # 4) shares
    if data["shares"]:
        sh = load(FILES["shares"]) or {}
        sh[ticker_full] = data["shares"]
        save(FILES["shares"], sh)
        print(f"  ✓ shares {data['shares']:,.0f}주")

    # 5) names_en (yfinance longName 형 영문 cache)
    en_map = load(FILES["names_en"]) or {}
    en_map[ticker_full] = name_en
    save(FILES["names_en"], en_map)
    print(f"  ✓ names_en '{name_en}'")

    # 6) names_ko (한국어 번역) — 옵셔널
    if name_ko:
        ko_map = load(FILES["names_ko"]) or {}
        ko_map[ticker_full] = name_ko
        save(FILES["names_ko"], ko_map)
        print(f"  ✓ names_ko '{name_ko}'")

    print(f"\n✅ 패치 완료. 이제 JP 재실행:")
    print(f"   python export_rs_weekly.py --market JP --weeks 56 --full-universe")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ticker", help="yahoo ticker (예: 285A.T)")
    ap.add_argument("name_ja", nargs="?", default=None, help="일본어 회사명 (옵션)")
    ap.add_argument("name_ko", nargs="?", default=None, help="한국어 회사명 (옵션, 검색용)")
    ap.add_argument("--name-en", default=None,
                    help="영문 회사명 강제 (기본: yfinance longName)")
    args = ap.parse_args()
    if not args.ticker.endswith(".T"):
        print("⚠ JP ticker 는 .T 접미사 필요. 예: 285A.T")
        sys.exit(1)
    patch(args.ticker, args.name_ja, args.name_ko, args.name_en)


if __name__ == "__main__":
    main()
