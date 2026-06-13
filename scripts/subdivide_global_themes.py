#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""선두지기(96+) · 한미일 통합 테마 서브디비전.

목적:
  /global 화면에서 한 테마(예: '반도체')가 50종목 넘게 묶이면 가독성이 떨어진다.
  3국 합쳐서 total >= 50 이면 Gemini 를 한 번 더 호출해 그 테마 안을 4~8개 서브카테고리로 다시 분할.

처리:
  1. rs_theme_weekly 에서 (KR/US/JP) × 주차 의 categories[].big 을 정규화 + 머지
     (lib/globalTheme.ts 의 normalizeBig 와 동일 룰)
  2. 머지 결과 total >= MIN_FOR_SUBDIVIDE 인 그룹만 Gemini 에게 세분 요청
  3. rs_subtheme_global_weekly 에 (week_date, theme_key) 단위 upsert

사용:
  python subdivide_global_themes.py                       # 모든 시장 최신 주차
  python subdivide_global_themes.py --week 2026-06-12
  python subdivide_global_themes.py --weeks 26            # 최근 26주차 백필
  python subdivide_global_themes.py --min 40              # 컷오프 변경 (기본 50)

env:
  GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (.env.local)
"""
from __future__ import annotations
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)
from config import Config                                    # noqa: E402

MODEL_NAME = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
MARKETS_ALL = ("KR", "US", "JP")
MARKET_LABEL = {"KR": "한국", "US": "미국", "JP": "일본"}
DEFAULT_MIN = 50


# ── Supabase REST ────────────────────────────────────────────
def _sb_client():
    base = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1"
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    H = {"apikey": key, "Authorization": f"Bearer {key}",
         "Content-Type": "application/json"}

    def req(method, path, body=None, prefer="return=minimal"):
        h = dict(H); h["Prefer"] = prefer
        data = json.dumps(body).encode("utf-8") if body is not None else None
        r = urllib.request.Request(base + path, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(r, timeout=60) as resp:
                txt = resp.read().decode("utf-8")
                return json.loads(txt) if txt.strip() else None
        except urllib.error.HTTPError as e:
            raise SystemExit(f"[supabase] {method} {path} 실패 {e.code}: "
                             f"{e.read().decode('utf-8')[:400]}")
    return req


# ── 정규화 (lib/globalTheme.ts 와 동일) ──────────────────────
_REPLACEMENTS = [
    (re.compile(r"ai인프라(스트럭처)?"), "ai인프라"),
    (re.compile(r"ai반도체"), "ai반도체"),
    (re.compile(r"반도체장비"), "반도체장비"),
    (re.compile(r"데이터센터"), "데이터센터"),
    (re.compile(r"원자력|원전"), "원자력"),
    (re.compile(r"전력|전기인프라"), "전력인프라"),
    (re.compile(r"방위산업|국방|방산"), "방위산업"),
    (re.compile(r"조선|해운"), "조선해운"),
    (re.compile(r"2차전지|배터리"), "2차전지"),
    (re.compile(r"바이오|제약"), "바이오"),
    (re.compile(r"로봇|로보틱스"), "로봇"),
    (re.compile(r"우주|항공우주"), "우주항공"),
]


def normalize_big(s: str) -> str:
    v = s.strip().lower()
    v = re.sub(r"[\s\-_/·、]+", "", v)
    for pat, rep in _REPLACEMENTS:
        v = pat.sub(rep, v)
    return v


# ── 데이터 로드 ───────────────────────────────────────────────
def fetch_theme(req, market, week):
    path = (f"/rs_theme_weekly?market=eq.{urllib.parse.quote(market)}"
            f"&week_date=eq.{urllib.parse.quote(week)}"
            f"&select=categories,summary")
    rows = req("GET", path, prefer="return=representation") or []
    return rows[0] if rows else None


def fetch_top96(req, market, week):
    path = (f"/rs_top_weekly?market=eq.{urllib.parse.quote(market)}"
            f"&week_date=eq.{urllib.parse.quote(week)}"
            f"&select=ticker,name,name_en,rs,comp_return,mktcap,rank_in_week"
            f"&order=rank_in_week.asc")
    return req("GET", path, prefer="return=representation") or []


def fetch_weeks_with_themes(req, weeks_back):
    """rs_theme_weekly 의 distinct week_date 최신순 N개."""
    path = "/rs_theme_weekly?select=week_date&order=week_date.desc"
    rows = req("GET", path, prefer="return=representation") or []
    return list(dict.fromkeys(r["week_date"] for r in rows))[:weeks_back]


def _market_of(tk):
    if tk.endswith(".KS") or tk.endswith(".KQ"):
        return "KR"
    if tk.endswith(".T"):
        return "JP"
    return "US"


def fetch_unified(req, week):
    """rs_global_theme_weekly (단일 호출 통합 분류) — 있으면 우선 사용."""
    path = (f"/rs_global_theme_weekly?week_date=eq.{urllib.parse.quote(week)}"
            f"&select=categories")
    try:
        rows = req("GET", path, prefer="return=representation") or []
    except SystemExit:
        return None
    return rows[0] if rows else None


def aggregate_global(req, week):
    """그 주차의 한미일 테마 머지 결과: {theme_key: {label, stocks: [(ticker, ...)...]}}.

    rs_global_theme_weekly (통합 단일 호출) 이 있으면 그것을 우선 사용.
    없으면 per-market rs_theme_weekly 들을 normalizeBig 으로 머지.
    """
    groups = {}            # key → {label_counts, stocks}
    market_data = {}       # market → ticker lookup
    for mk in MARKETS_ALL:
        rows = fetch_top96(req, mk, week)
        market_data[mk] = {r["ticker"]: r for r in rows}

    # 1) 통합 우선
    unified = fetch_unified(req, week)
    if unified and unified.get("categories"):
        for cat in unified["categories"]:
            big = (cat.get("big") or "").strip()
            if not big:
                continue
            key = normalize_big(big)
            if not key:
                continue
            g = groups.setdefault(key, {"label_counts": {}, "stocks": []})
            g["label_counts"][big] = g["label_counts"].get(big, 0) + 1
            for tk in cat.get("tickers", []):
                mk = _market_of(tk)
                r = market_data.get(mk, {}).get(tk)
                if not r:
                    continue
                g["stocks"].append({
                    "market": mk,
                    "ticker": tk,
                    "name": r.get("name_en") or r.get("name") or tk,
                    "name_local": r.get("name"),
                    "rs": r.get("rs"),
                    "comp_return": r.get("comp_return"),
                    "mktcap": r.get("mktcap"),
                })
        out = []
        for key, g in groups.items():
            if not g["stocks"]:
                continue
            label = max(g["label_counts"].items(), key=lambda x: x[1])[0]
            out.append({"key": key, "label": label, "stocks": g["stocks"], "total": len(g["stocks"])})
        out.sort(key=lambda x: -x["total"])
        return out

    # 2) Fallback — per-market merge
    for mk in MARKETS_ALL:
        t = fetch_theme(req, mk, week)
        if not t:
            continue
        cats = t.get("categories", [])
        rows_lookup = market_data[mk]
        for cat in cats:
            big = (cat.get("big") or "").strip()
            if not big:
                continue
            key = normalize_big(big)
            if not key:
                continue
            g = groups.setdefault(key, {
                "label_counts": {},
                "stocks": [],
            })
            g["label_counts"][big] = g["label_counts"].get(big, 0) + 1
            for tk in cat.get("tickers", []):
                r = rows_lookup.get(tk)
                if not r:
                    continue
                g["stocks"].append({
                    "market": mk,
                    "ticker": tk,
                    "name": r.get("name_en") or r.get("name") or tk,
                    "name_local": r.get("name"),
                    "rs": r.get("rs"),
                    "comp_return": r.get("comp_return"),
                    "mktcap": r.get("mktcap"),
                })

    out = []
    for key, g in groups.items():
        if not g["stocks"]:
            continue
        # 대표 라벨 = 가장 자주 쓰인 big
        label = max(g["label_counts"].items(), key=lambda x: x[1])[0]
        out.append({
            "key": key,
            "label": label,
            "stocks": g["stocks"],
            "total": len(g["stocks"]),
        })
    out.sort(key=lambda x: -x["total"])
    return out


# ── Gemini ─────────────────────────────────────────────────
SUBDIVIDE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "subcategories": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "label": {"type": "STRING"},
                    "tickers": {"type": "ARRAY", "items": {"type": "STRING"}},
                },
                "required": ["label", "tickers"],
            },
        },
    },
    "required": ["subcategories"],
}


def build_subdivide_prompt(theme_label, stocks):
    lines = [
        f"테마: {theme_label}",
        f"이 테마로 분류된 한·미·일 RS96+ 종목 {len(stocks)}개. 너무 크니 4~8개 서브카테고리로 다시 세분해 주세요.",
        "",
        "종목 목록 (ticker | 회사명 | 시장 | RS | 52주 모멘텀):",
    ]
    for s in stocks:
        comp = s.get("comp_return")
        comp_s = f"{comp*100:+.0f}%" if comp is not None else "-"
        name = s["name"] or s["ticker"]
        lines.append(f"  {s['ticker']:<12} | {name[:30]:<30} | {s['market']} | RS{s['rs']:>2} | {comp_s}")
    lines.extend([
        "",
        "요구사항:",
        "  1) 서브카테고리는 큰 테마 안에서 의미 있는 세분 (예: '반도체' → '메모리 IDM', '장비-전공정', '장비-후공정', '소재', '설계/IDM').",
        "  2) 'label' 은 한국어로 짧게 (예: '메모리 IDM', '장비 - 전공정', '소재 - 식각/박막').",
        "  3) 한 종목은 한 서브카테고리만.",
        "  4) 모든 종목을 빠짐없이 분류 (애매하면 '기타' 서브 만들기).",
        "  5) 4~8개 서브카테고리 권장 (종목이 적으면 4개, 많으면 8개까지).",
        "",
        "JSON 만 응답. 다른 텍스트 X.",
    ])
    return "\n".join(lines)


def call_gemini_subdivide(theme_label, stocks, max_retries=5):
    from google import genai
    from google.genai import types

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise SystemExit("⚠ GEMINI_API_KEY 환경변수 없음.")
    client = genai.Client(api_key=api_key)
    prompt = build_subdivide_prompt(theme_label, stocks)
    cfg = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=SUBDIVIDE_SCHEMA,
        temperature=0.3,
    )

    last_err = None
    for attempt in range(1, max_retries + 1):
        try:
            resp = client.models.generate_content(model=MODEL_NAME, contents=prompt, config=cfg)
            return json.loads(resp.text or "{}")
        except Exception as e:
            last_err = e
            msg = str(e)
            transient = any(k in msg for k in (
                "503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED",
                "500", "INTERNAL", "504", "DEADLINE_EXCEEDED"))
            if transient and attempt < max_retries:
                wait = attempt * 15
                print(f"  ⚠ {type(e).__name__} 재시도 {wait}s 후...", flush=True)
                time.sleep(wait)
                continue
            raise SystemExit(f"⚠ Gemini 실패: {type(e).__name__}: {msg[:200]}")
    raise SystemExit(f"⚠ 재시도 {max_retries}회 모두 실패: {last_err}")


# ── 메인 ────────────────────────────────────────────────────
def subdivide_one(req, week, min_for_subdivide):
    groups = aggregate_global(req, week)
    if not groups:
        print(f"[{week}] 테마 데이터 없음 — skip")
        return 0
    big_groups = [g for g in groups if g["total"] >= min_for_subdivide]
    if not big_groups:
        print(f"[{week}] {min_for_subdivide}+ 종목 테마 없음 (최대 {groups[0]['total']}) — skip")
        return 0

    print(f"[{week}] {min_for_subdivide}+ 테마 {len(big_groups)}개: "
          + ", ".join(f"{g['label']}({g['total']})" for g in big_groups))

    n_ok = 0
    for g in big_groups:
        print(f"  → '{g['label']}' {g['total']}종목 세분화 중...", flush=True)
        t0 = time.time()
        data = call_gemini_subdivide(g["label"], g["stocks"])
        dt = time.time() - t0
        subs = data.get("subcategories", [])
        n_classified = sum(len(s.get("tickers", [])) for s in subs)
        print(f"     {len(subs)}개 서브 · {n_classified}/{g['total']} 매핑 ({dt:.1f}s)")

        # upsert
        req("DELETE",
            f"/rs_subtheme_global_weekly?week_date=eq.{urllib.parse.quote(week)}"
            f"&theme_key=eq.{urllib.parse.quote(g['key'])}")
        req("POST", "/rs_subtheme_global_weekly", [{
            "week_date": week,
            "theme_key": g["key"],
            "theme_label": g["label"],
            "total_stocks": g["total"],
            "subcategories": subs,
            "model": MODEL_NAME,
            "generated_at": datetime.now().isoformat(),
        }])
        n_ok += 1
    return n_ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--week", default=None, help="특정 주차 YYYY-MM-DD")
    ap.add_argument("--weeks", type=int, default=1, help="최신부터 N주차")
    ap.add_argument("--min", type=int, default=DEFAULT_MIN, help="세분화 컷오프 종목 수")
    args = ap.parse_args()

    Config()
    req = _sb_client()

    if args.week:
        weeks = [args.week]
    else:
        weeks = fetch_weeks_with_themes(req, args.weeks)
    print(f"대상 주차 {len(weeks)}개 · 컷오프 {args.min}+ · model={MODEL_NAME}\n")

    total = 0
    for w in weeks:
        total += subdivide_one(req, w, args.min)
    print(f"\n총 {total}개 테마 세분화 완료.")


if __name__ == "__main__":
    main()
