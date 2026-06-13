#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""마감지기 · RS96+ 종목 Gemini 테마 분류기.

매주 자동 잡 또는 수동으로 실행:
  1. Supabase rs_top_weekly 에서 그 주차의 RS96+ 종목 fetch
  2. Gemini 2.5 Flash 에 structured JSON output 으로 분류 요청
  3. Supabase rs_theme_weekly 에 (market, week_date) 단위 upsert

사용:
  python classify_rs96_gemini.py                       # 모든 시장 · 최신 1주차
  python classify_rs96_gemini.py --week 2026-06-05     # 특정 주차
  python classify_rs96_gemini.py --weeks 4             # 최근 4주차
  python classify_rs96_gemini.py --market JP           # JP 만

env:
  GEMINI_API_KEY        — Google AI Studio 발급
  SUPABASE_URL          — Supabase 프로젝트 URL
  SUPABASE_SERVICE_ROLE_KEY — 서비스 키 (.env.local)
"""
from __future__ import annotations
import argparse
import json
import os
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
            with urllib.request.urlopen(r, timeout=60) as resp:
                txt = resp.read().decode("utf-8")
                return json.loads(txt) if txt.strip() else None
        except urllib.error.HTTPError as e:
            raise SystemExit(f"[supabase] {method} {path} 실패 {e.code}: "
                             f"{e.read().decode('utf-8')[:400]}")
    return req


def fetch_top96(req, market, week):
    """그 주차의 RS96+ 종목 목록."""
    path = (f"/rs_top_weekly?market=eq.{urllib.parse.quote(market)}"
            f"&week_date=eq.{urllib.parse.quote(week)}"
            f"&select=ticker,name,name_en,rs,comp_return,close,mktcap,rank_in_week"
            f"&order=rank_in_week.asc")
    return req("GET", path, prefer="return=representation") or []


def fetch_available_weeks(req, market):
    """그 시장의 분류 가능한 주차 (rs_top_weekly 기준 최신 → 과거)."""
    path = (f"/rs_top_weekly?market=eq.{urllib.parse.quote(market)}"
            f"&select=week_date&order=week_date.desc")
    # PostgREST 기본 limit 1000 회피 — 최대 1만 행 fetch 해서 distinct
    rows = req("GET", path, prefer="return=representation",
               range_header="0-9999") or []
    return sorted({r["week_date"] for r in rows}, reverse=True)


# ── Gemini 호출 ─────────────────────────────────────────────
def build_prompt(market, week, rows):
    lines = [
        f"시장: {MARKET_LABEL.get(market, market)} ({market}), 주차: {week}",
        f"RS96+ 통과 종목 {len(rows)}개. 모두 그 주에 시장 상위 4% 모멘텀.",
        "",
        "각 행: ticker | 회사명 | RS | 52주 모멘텀(%) | 시총",
    ]
    for r in rows[:300]:
        name = r.get("name_en") or r.get("name") or r["ticker"]
        comp = r.get("comp_return")
        comp_s = f"{comp*100:+.0f}%" if comp is not None else "-"
        mc = r.get("mktcap")
        if mc:
            if market == "KR":
                mc_s = f"{mc/1e8:,.0f}억"
            elif market == "JP":
                mc_s = f"¥{mc/1e8:,.0f}億"
            else:
                mc_s = f"${mc/1e9:.1f}B" if mc >= 1e9 else f"${mc/1e6:,.0f}M"
        else:
            mc_s = "-"
        lines.append(f"  {r['ticker']:<12} | {name[:30]:<30} | RS{r['rs']:>2} | {comp_s:>7} | {mc_s}")

    lines.extend([
        "",
        "위 종목을 산업/테마/공급망 관점으로 묶어 카테고리화해 주세요. 요구사항:",
        "  1) 큰 카테고리 'big' 은 한국어 (예: 반도체 소재, FA/로봇, AI 인프라).",
        "  2) 세부 'small' 은 선택 — 큰 카테고리 안에서 세분 필요 시 한국어로.",
        "  3) 각 카테고리에 속한 ticker 만 'tickers' 배열에 (yahoo format, 예: 7203.T).",
        "  4) 한 종목은 한 카테고리만 (가장 의미 있는 곳).",
        "  5) 의미 없는 카테고리(은행·기타)도 따로 묶지 말고 가능하면 '비반도체 — 기타' 같이 한 그룹.",
        "  6) summary: 이번 주 이 시장의 주된 테마/트렌드 1~2문장 한국어 인사이트.",
        "",
        "JSON 만 응답. 다른 텍스트 X.",
    ])
    return "\n".join(lines)


RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "summary": {"type": "STRING"},
        "categories": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "big":     {"type": "STRING"},
                    "small":   {"type": "STRING"},
                    "tickers": {"type": "ARRAY", "items": {"type": "STRING"}},
                },
                "required": ["big", "tickers"],
            },
        },
    },
    "required": ["summary", "categories"],
}


def call_gemini(market, week, rows, max_retries=5):
    from google import genai
    from google.genai import types

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise SystemExit("⚠ GEMINI_API_KEY 환경변수 없음. .env.local 에 추가하세요.")
    client = genai.Client(api_key=api_key)

    prompt = build_prompt(market, week, rows)
    cfg = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=RESPONSE_SCHEMA,
        temperature=0.3,
    )

    last_err = None
    for attempt in range(1, max_retries + 1):
        try:
            resp = client.models.generate_content(
                model=MODEL_NAME, contents=prompt, config=cfg)
            text = resp.text or "{}"
            return json.loads(text)
        except Exception as e:
            last_err = e
            msg = str(e)
            # 일시적 서버 오류만 재시도 (503·429·500·504·empty body 등)
            transient = any(k in msg for k in (
                "503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED",
                "500", "INTERNAL", "504", "DEADLINE_EXCEEDED"))
            if transient and attempt < max_retries:
                wait = attempt * 15      # 15, 30, 45, 60s — Gemini 과부하 해소에 충분
                print(f"  ⚠ {type(e).__name__} (시도 {attempt}/{max_retries}) "
                      f"{wait}s 후 재시도...", flush=True)
                time.sleep(wait)
                continue
            # JSON 파싱 실패만 별도 메시지
            if isinstance(e, json.JSONDecodeError):
                raise SystemExit(f"⚠ Gemini JSON 파싱 실패: {e}")
            raise SystemExit(f"⚠ Gemini 호출 실패: {type(e).__name__}: {msg[:200]}")
    raise SystemExit(f"⚠ Gemini 재시도 {max_retries}회 모두 실패: {last_err}")


# ── 메인 ────────────────────────────────────────────────────
def classify_one(req, market, week):
    rows = fetch_top96(req, market, week)
    if not rows:
        print(f"  [{market} {week}] RS96+ 종목 없음 — skip")
        return False
    print(f"  [{market} {week}] {len(rows)}종목 → Gemini 호출", flush=True)
    t0 = time.time()
    data = call_gemini(market, week, rows)
    dt = time.time() - t0

    cats = data.get("categories", [])
    n_classified = sum(len(c.get("tickers", [])) for c in cats)
    print(f"  [{market} {week}] {len(cats)}개 카테고리, "
          f"{n_classified}/{len(rows)} 분류 ({dt:.1f}s)")
    print(f"     요약: {data.get('summary','')[:120]}")

    # upsert
    req("DELETE", f"/rs_theme_weekly?market=eq.{urllib.parse.quote(market)}"
                  f"&week_date=eq.{urllib.parse.quote(week)}")
    row = {
        "market": market,
        "week_date": week,
        "summary": data.get("summary", ""),
        "categories": cats,
        "model": MODEL_NAME,
        "generated_at": datetime.now().isoformat(),
    }
    req("POST", "/rs_theme_weekly", [row])
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--market", choices=["KR", "US", "JP", "all"], default="all")
    ap.add_argument("--week", default=None, help="특정 주차 YYYY-MM-DD")
    ap.add_argument("--weeks", type=int, default=1, help="최신부터 N개 주차")
    args = ap.parse_args()

    Config()  # .env.local 로드 (SUPABASE_*, GEMINI_API_KEY)
    req = _sb_client()
    targets = MARKETS_ALL if args.market == "all" else (args.market,)

    total = 0
    for mk in targets:
        if args.week:
            weeks = [args.week]
        else:
            weeks = fetch_available_weeks(req, mk)[: args.weeks]
        for w in weeks:
            if classify_one(req, mk, w):
                total += 1
    print(f"\n총 {total}회 분류 완료 (model={MODEL_NAME})")


if __name__ == "__main__":
    main()
