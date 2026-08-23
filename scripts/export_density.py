#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""★★S2 진입 후보 밀도 → Supabase `s2_density` 적재 (과밀田 페이지 · 해달별님 B안)

[왜 이 단계인가]
 ★해달별님: 「과밀일 페이지가 ★일별로 갱신되도록 스케줄러에 포함되었으면 한다」.
 ★A안(정적 JSON + 매일 자동 커밋·push)과 ★B안(Supabase 적재 + 동적 페이지) 중 ★B를 골랐다 —
 ★매일 무인 push 는 되돌리기 어려운 외부 행위를 반복하고, ★실패해도 화면만 낡아
 ★조용한 실패가 된다(2026-08-23 하루에 그 유형 사고 2건).

[무엇을 세나 — ★정의를 베끼지 않는다]
 ★`update_env_density` 를 ★import 해 ★`MA`·`TV_MIN`·`BASE_EP`·`WIN`·`WARM`·`TOPQ`·`DB` 를
 ★그대로 쓴다. ★그래야 ★과밀일 맵(`s2_env_density_map.csv`)과 ★어긋날 수 없다.
 ★후보 1건 = 그날 ①`MA20` 있고 ②최근 20일 최대 거래대금 ≥ `TV_MIN`
   ③종가 < `MA20 x (1 − BASE_EP)` 인 ★종목-일.
 ★과밀일 = 그 건수의 15거래일 롤링 합(t−1 까지)이 확장 분위 상위 `TOPQ` 초과.

[★순서 계약] ★`update_env_density.py` ★뒤에 둔다 — 같은 맵·같은 `S2_ENV_TOPQ` 를 쓴다.
 ⚠️앞에 두면 ★어제 TOPQ 로 센 값이 화면에 간다.

[가드]
 ①★0건일 비율이 95% 를 넘으면 ★적재하지 않는다(오염 가드 — 2026-08-23 T1 사고 계열)
 ②★행수가 기존보다 ★줄면 ★적재하지 않는다(`--force` 로만 통과)
 ③★전삭제 → 재적재는 ★한 트랜잭션이 아니다 — ★새 데이터를 ★먼저 만들어 두고
   ★검사를 통과한 뒤에만 지운다(중간에 죽어도 빈 테이블이 안 남게)

[rc 계약] ★★**항상 0** — 이 단계가 EOD 체인을 끊으면 안 된다.
 ★실패는 ★사이드카(`results/.density_export_last.json`)와 ★로그 마커로 남긴다.
 ⚠️★조용히 넘어가지 않는다 — 실패 시 `⚠️★★[DENSITY] 실패` 를 stdout 에 찍는다.

usage:
    python s2-trading-web/scripts/export_density.py           # 적재
    python s2-trading-web/scripts/export_density.py --dry-run # 계산만
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

S2 = r"c:\AI파운더스\s2_method"
SIDECAR = os.path.join(S2, "results", ".density_export_last.json")
MAX_ZERO_RATIO = 0.95

sys.path.insert(0, S2)
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:                                                # noqa: BLE001
    pass

os.environ.setdefault("BT_READONLY_CACHE", "1")
os.environ.setdefault("BT_NO_FETCH", "1")


def load_env_local():
    """★.env.local 을 환경변수로(§7-4 — 루트 상대경로)."""
    p = os.path.join(S2, ".env.local")
    if not os.path.exists(p):
        return
    for ln in open(p, encoding="utf-8"):
        ln = ln.strip()
        if ln.startswith("#") or "=" not in ln:
            continue
        k, v = ln.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def build():
    """★일별 후보 수 + 과밀일. `update_env_density` 의 상수를 그대로 쓴다."""
    import pandas as pd
    import update_env_density as U                              # noqa: E402

    print("  [정의] MA=%d · TV_MIN=%s · BASE_EP=%s · WIN=%d · WARM=%d · TOPQ=%s"
          % (U.MA, format(U.TV_MIN, ","), U.BASE_EP, U.WIN, U.WARM, U.TOPQ), flush=True)

    px, src = U.load_source()
    px = px.copy()
    px["ticker"] = px["ticker"].astype(str).str.zfill(6)
    px["date"] = px["date"].astype(str).str[:10]
    px = px.sort_values(["ticker", "date"]).reset_index(drop=True)
    g = px.groupby("ticker", sort=False)
    px["ma20"] = g["close"].transform(lambda s: s.rolling(U.MA, min_periods=U.MA).mean())
    px["tv"] = g["trading_value"].transform(lambda s: s.rolling(U.MA, min_periods=1).max())
    px["gap"] = px["close"] / px["ma20"] - 1
    qual = px["ma20"].notna() & (px["tv"] >= U.TV_MIN)

    alld = pd.Index(sorted(px["date"].unique()))
    dens = (px.loc[qual & (px["gap"] < -U.BASE_EP)].groupby("date").size()
            .reindex(alld, fill_value=0).astype(int))
    roll = dens.astype(float).rolling(U.WIN, min_periods=U.WIN).sum().shift(1)
    pos = roll.where(roll > 0)
    thr = pos.shift(1).expanding(min_periods=U.WARM).quantile(1.0 - U.TOPQ)
    crowded = ((roll >= thr) & thr.notna() & (roll > 0)).fillna(False)

    # ★첫 발생 연도부터 — 앞쪽 빈 해는 데이터에서 유도해 자른다(하드코딩 금지)
    first = min((int(d[:4]) for d in alld if dens.loc[d] > 0), default=int(alld[0][:4]))
    keep = [d for d in alld if int(d[:4]) >= first]

    rows = []
    for d in keep:
        rl = roll.loc[d]
        th = thr.loc[d]
        rows.append({"d": str(d), "n": int(dens.loc[d]),
                     "crowded": bool(crowded.loc[d]),
                     "roll15": (None if pd.isna(rl) else int(rl)),
                     "thr": (None if pd.isna(th) else round(float(th), 1))})
    meta = {"first": rows[0]["d"], "last": rows[-1]["d"], "days": len(rows),
            "zeroDays": sum(1 for r in rows if r["n"] == 0),
            "crowdedDays": sum(1 for r in rows if r["crowded"]),
            "totalN": sum(r["n"] for r in rows),
            "maxN": max(r["n"] for r in rows),
            "firstYear": first, "db": src["canon"]["db"],
            "defn": {"ma": U.MA, "tv_min": U.TV_MIN, "base_ep": U.BASE_EP,
                     "win": U.WIN, "warm": U.WARM, "topq": U.TOPQ, "relax": U.RELAX}}
    return rows, meta


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="★행수 감소 가드 무시")
    a = ap.parse_args()
    t0 = time.time()
    print("★[DENSITY] 과밀田 데이터 적재 — %s" % ("dry-run" if a.dry_run else "실적재"), flush=True)
    rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "ok": False, "why": ""}

    def finish(ok, why=""):
        rec["ok"] = ok
        rec["why"] = why
        try:
            os.makedirs(os.path.dirname(SIDECAR), exist_ok=True)
            json.dump(rec, open(SIDECAR, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        except Exception:                                        # noqa: BLE001
            pass
        if not ok:
            print("⚠️★★[DENSITY] 실패 — %s" % why, flush=True)
        print("[DENSITY %.0fs] %s" % (time.time() - t0, why or "완료"), flush=True)
        return 0            # ★★항상 0 — 체인을 안 끊는다

    try:
        rows, m = build()
    except Exception as e:                                       # noqa: BLE001
        return finish(False, "계산 실패 %s: %s" % (type(e).__name__, str(e)[:140]))

    zr = m["zeroDays"] / max(1, m["days"])
    print("  일수 %d (%s – %s) · 0건일 %.1f%% · 과밀 %d · 총 %s건 · 최대 %d"
          % (m["days"], m["first"], m["last"], 100 * zr, m["crowdedDays"],
             format(m["totalN"], ","), m["maxN"]), flush=True)
    rec.update({k: m[k] for k in ("days", "first", "last", "crowdedDays", "totalN")})

    if zr > MAX_ZERO_RATIO:                                      # ★가드 ①
        return finish(False, "0건일 %.1f%% > %.0f%% — 오염 의심" % (100 * zr, 100 * MAX_ZERO_RATIO))

    if a.dry_run:
        return finish(True, "dry-run(적재 안 함)")

    load_env_local()
    U = os.environ.get("SUPABASE_URL", "").rstrip("/")
    K = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not (U and K):
        return finish(False, "SUPABASE_URL / SERVICE_ROLE_KEY 없음")
    base = U + "/rest/v1"
    H = {"apikey": K, "Authorization": "Bearer " + K, "Content-Type": "application/json"}

    def req(method, path, body=None, prefer="return=minimal", timeout=90):
        h = dict(H)
        h["Prefer"] = prefer
        r = urllib.request.Request(
            base + path, data=(json.dumps(body).encode() if body is not None else None),
            method=method, headers=h)
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            t = resp.read().decode("utf-8")
            return resp, (json.loads(t) if t.strip() else None)

    # ★가드 ② — 기존 행수보다 줄면 안 쓴다
    try:
        h = dict(H)
        h["Prefer"] = "count=exact"
        h["Range"] = "0-0"
        r = urllib.request.Request(base + "/s2_density?select=d&limit=1", headers=h)
        with urllib.request.urlopen(r, timeout=30) as resp:
            old = resp.headers.get("content-range", "*/0").split("/")[-1]
        old_n = int(old) if old.isdigit() else 0
    except Exception:                                            # noqa: BLE001
        old_n = 0
    if old_n and len(rows) < old_n and not a.force:
        return finish(False, "행수 감소 %d → %d (--force 로만)" % (old_n, len(rows)))

    # ★가드 ③ — 전삭제는 ★검사를 다 통과한 뒤에만
    try:
        req("DELETE", "/s2_density?d=gte.1900-01-01")
        for i in range(0, len(rows), 500):
            req("POST", "/s2_density", rows[i:i + 500])
    except urllib.error.HTTPError as e:
        return finish(False, "적재 실패 %d: %s" % (e.code, e.read().decode("utf-8")[:200]))
    except Exception as e:                                       # noqa: BLE001
        return finish(False, "적재 실패 %s: %s" % (type(e).__name__, str(e)[:140]))

    # ★재검증
    try:
        h = dict(H)
        h["Prefer"] = "count=exact"
        h["Range"] = "0-0"
        r = urllib.request.Request(base + "/s2_density?select=d&limit=1", headers=h)
        with urllib.request.urlopen(r, timeout=30) as resp:
            got = resp.headers.get("content-range", "*/0").split("/")[-1]
        if int(got) != len(rows):
            return finish(False, "적재 행수 불일치 %s 대 %d" % (got, len(rows)))
        print("  ★적재 %s행 확인" % got, flush=True)
    except Exception as e:                                       # noqa: BLE001
        return finish(False, "재검증 실패 %s" % type(e).__name__)

    return finish(True, "적재 %d행 (%s – %s · 과밀 %d)"
                  % (len(rows), m["first"], m["last"], m["crowdedDays"]))


if __name__ == "__main__":
    sys.exit(main())
