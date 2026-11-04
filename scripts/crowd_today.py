#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""★15:10 알람용 「오늘은 과밀일인가」 판정 — `update_env_density.build()` 와 같은 식을 ★당일 하루에 적용한다.

★왜 — 20:30 EOD 는 과밀일 맵(`s2_env_density_map.csv` · ep 0.15)으로 진입선을 MA20 x 0.85 로 완화하는데
  15:10 알람은 늘 MA20 x 0.80 만 보아, 과밀일에 장부와 알람이 갈렸다(2026-11-03 신규 6건 중 5건 ·
  `CAND-2026-10-31-13`). ★해달별님 결정(2026-11-04) — 「과밀일이 예측되면 과밀일 기준 메시지를 별도로 표시해서 보낸다」.

★룩어헤드 없음 — 과밀 판정은 밀도 창을 t-1 까지(`shift(1)`) · 분위도 t-1 까지만 쓴다(`update_env_density.py:181` · `:183`).
  ⇒ 당일(target) 데이터 없이 ★전 거래일까지의 종가 · 거래대금만으로 오늘 값이 정해진다. 그래서 15:10 에 계산할 수 있다.

★파라미터는 맵 사이드카(`s2_env_density_map.meta.json`)에서 읽는다 — 맵을 만든 설정(topq · relax · win · warm · tv_min ·
  base_ep · 꼬리 on/off)과 ★같은 설정으로 판정해야 EOD 와 같은 날을 과밀로 본다.
★과밀 연속 상한 — `S2_ENV_DENS_STREAK_MAX`(EOD `backtest.py:949` 와 같은 규칙: 거래일 달력에서 연속된 과밀의
  N+1 번째 날부터 평소 진입선). 미설정이면 상한 없음.

★자가 검증 — `python crowd_today.py --selfcheck` : 과거 전 구간 판정을 운영 맵과 날짜 단위로 맞대어 ★완전 일치해야 한다.
★읽기 전용 — DB 는 `mode=ro` 로만 연다. 쓰는 파일 없음.
"""
from __future__ import annotations

import io
import json
import os
import sqlite3
import sys
from datetime import date

import pandas as pd

S2 = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # s2_method
CANON_DB = os.path.join(S2, "stock_cache_full3_2026-08-07.db")
OPS_DB = os.path.join(S2, "stock_cache.db")
MAP_CSV = os.path.join(S2, "s2_env_density_map.csv")
MAP_META = os.path.join(S2, "s2_env_density_map.meta.json")


def _read(db, where=""):
    con = sqlite3.connect("file:%s?mode=ro" % db.replace("\\", "/"), uri=True)
    try:
        return pd.read_sql_query(
            "SELECT date,ticker,close,trading_value FROM prices WHERE trading_value IS NOT NULL " + where, con)
    finally:
        con.close()


def load_meta():
    return json.loads(io.open(MAP_META, encoding="utf-8").read())


def load_prices(before: str, meta: dict) -> pd.DataFrame:
    """canonical + (맵이 꼬리를 썼으면) 운영 DB 꼬리 — ★`before` 미만 날짜만."""
    px = _read(CANON_DB, "AND date < '%s' " % before)
    canon_max = str(px["date"].astype(str).str[:10].max())
    if meta.get("tail_enabled"):
        tail = _read(OPS_DB, "AND date > '%s' AND date < '%s' " % (canon_max, before))
        px = pd.concat([px, tail], ignore_index=True)
    return px


def crowded_series(px: pd.DataFrame, meta: dict, extra_date: str | None = None) -> pd.Series:
    """`update_env_density.build()` 와 같은 식 — 날짜별 과밀 여부(bool). `extra_date` 는 데이터 없는 당일 행을 덧붙인다."""
    WIN, WARM = int(meta["win"]), int(meta["warm"])
    TOPQ, TV_MIN, BASE_EP = float(meta["topq"]), float(meta["tv_min"]), float(meta["base_ep"])
    px = px.copy()
    px["ticker"] = px["ticker"].astype(str).str.zfill(6)
    px["date"] = px["date"].astype(str).str[:10]
    px = px.sort_values(["ticker", "date"]).reset_index(drop=True)
    g = px.groupby("ticker", sort=False)
    px["ma20"] = g["close"].transform(lambda s: s.rolling(20, min_periods=20).mean())
    px["tv"] = g["trading_value"].transform(lambda s: s.rolling(20, min_periods=1).max())
    px["gap"] = px["close"] / px["ma20"] - 1
    qual = px["ma20"].notna() & (px["tv"] >= TV_MIN)
    dates = sorted(px["date"].unique())
    if extra_date and extra_date not in dates:
        dates.append(extra_date)
    alld = pd.Index(dates)
    dens = (px.loc[qual & (px["gap"] < -BASE_EP)].groupby("date").size()
            .reindex(alld, fill_value=0).astype(float))
    roll = dens.rolling(WIN, min_periods=WIN).sum().shift(1)
    pos = roll.where(roll > 0)
    thr = pos.shift(1).expanding(min_periods=WARM).quantile(1.0 - TOPQ)
    return ((roll >= thr) & thr.notna() & (roll > 0)).fillna(False)


def streak_at(sel: pd.Series, day: str) -> int:
    """거래일 달력(sel 의 인덱스)에서 `day` 까지 이어진 과밀 연속 일수(그날 과밀이 아니면 0)."""
    k = 0
    for d, v in sel.items():
        if d > day:
            break
        k = k + 1 if bool(v) else 0
    return k


def judge(target: date | str) -> dict:
    """반환 {crowded, ep, streak, streak_max, capped, base_ep, relax, why}. ★실패하면 crowded=False + why."""
    t = str(target)[:10]
    try:
        meta = load_meta()
        px = load_prices(t, meta)
        sel = crowded_series(px, meta, extra_date=t)
        k = streak_at(sel, t)
        smax_raw = os.environ.get("S2_ENV_DENS_STREAK_MAX", "").strip()
        smax = int(smax_raw) if smax_raw else None
        raw = bool(sel.get(t, False))
        capped = bool(raw and smax is not None and k > smax)
        return dict(crowded=bool(raw and not capped), raw=raw, ep=float(meta["relax"]),
                    base_ep=float(meta["base_ep"]), streak=k, streak_max=smax, capped=capped,
                    prev_date=str(max(d for d in sel.index if d < t)), why="")
    except Exception as e:                                   # noqa: BLE001 — 알람은 종전대로 나가야 한다
        return dict(crowded=False, raw=False, why="%s: %s" % (type(e).__name__, str(e)[:120]))


def selfcheck() -> int:
    """과거 전 구간을 운영 맵과 맞댄다 — ★완전 일치해야 통과."""
    meta = load_meta()
    last = str(meta["last_date"])
    px = load_prices("9999-12-31", meta)
    px = px[px["date"].astype(str).str[:10] <= last]
    sel = crowded_series(px, meta)
    mine = set(d for d, v in sel.items() if v)
    mp = pd.read_csv(MAP_CSV, dtype={"date": str})
    theirs = set(mp["date"].astype(str).str[:10])
    only_m, only_t = sorted(mine - theirs), sorted(theirs - mine)
    print("[selfcheck] 재계산 %d일 · 맵 %d일 · 재계산에만 %d · 맵에만 %d"
          % (len(mine), len(theirs), len(only_m), len(only_t)))
    if only_m or only_t:
        print("  재계산에만", only_m[:10], " 맵에만", only_t[:10])
        return 1
    print("  ★완전 일치")
    return 0


if __name__ == "__main__":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", line_buffering=True)
    if "--selfcheck" in sys.argv:
        raise SystemExit(selfcheck())
    d = sys.argv[1] if len(sys.argv) > 1 else str(date.today())
    print(json.dumps(judge(d), ensure_ascii=False))
