#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""선두지기(96+) · 한미일 통합 단일 호출 테마 분류.

목적:
  시장별로 따로 호출하면 같은 테마가 '반도체' / '반도체산업' / '반도체부문' 처럼
  미세하게 다른 라벨로 분류돼 머지에 정규화 헛수고가 발생. 한 호출 안에서
  한·미·일 RS96+ 종목 전체를 분류하면 라벨 일관성이 구조적으로 보장됨.

처리:
  1. 그 주차의 KR/US/JP RS96+ 종목 fetch
  2. 고정 캐논 테마 시드 + 모든 종목을 single prompt 로 Gemini 호출
  3. rs_global_theme_weekly 에 (week_date) 단위 upsert

사용:
  python classify_global_themes.py                   # 최신 1주차
  python classify_global_themes.py --week 2026-06-05
  python classify_global_themes.py --weeks 26        # 최근 N주차 백필

env:
  GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
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

MODEL_NAME = os.environ.get("GEMINI_MODEL", "gemini-2.5-pro")
MARKETS_ALL = ("KR", "US", "JP")
MARKET_LABEL = {"KR": "한국", "US": "미국", "JP": "일본"}


# ── 고정 캐논 테마 시드 ───────────────────────────────────────
# Gemini 에게 "가능하면 이 안에서 골라, 정 없으면 새로 만들어" 라고 제시.
# 반도체는 'big=반도체' 로 두고 세부는 small 로 분기하도록 유도.
# (예: big='반도체', small='메모리 IDM' / '팹리스' / '장비-전공정' / '소재' 등)
CANONICAL_THEMES = [
    "반도체",
    "AI 인프라",
    "데이터센터",
    "2차전지",
    "바이오",
    "방위산업",
    "조선해운",
    "원자력",
    "전력 인프라",
    "신재생에너지",
    "수소",
    "우주항공",
    "로봇",
    "자동차",
    "화학",
    "철강금속",
    "소재",
    "전자부품",
    "디스플레이",
    "게임 콘텐츠",
    "엔터테인먼트",
    "헬스케어",
    "리츠 부동산",
    "금융",
    "유통",
    "건설",
    "통신",
    "음식료",
    "지주사 기타",
]

# 반도체 안의 권장 'small' 세부 라벨 — 50+ 시 subdivide 가 사용.
SEMI_SMALL_HINTS = [
    "메모리 IDM (NAND/DRAM)",
    "로직 IDM/파운드리",
    "팹리스 (CPU/GPU/AI 칩)",
    "팹리스 (네트워킹/특수)",
    "장비 - 전공정 (노광/에칭/박막)",
    "장비 - 후공정 (테스트/OSAT/패키징)",
    "소재 - 웨이퍼/화학/타겟",
    "소재 - 마스크/EUV/포토",
    "부품/기판/모듈",
    "EDA/IP",
]


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


def fetch_top96(req, market, week):
    path = (f"/rs_top_weekly?market=eq.{urllib.parse.quote(market)}"
            f"&week_date=eq.{urllib.parse.quote(week)}"
            f"&select=ticker,name,name_en,rs,comp_return,mktcap,rank_in_week"
            f"&order=rank_in_week.asc")
    return req("GET", path, prefer="return=representation") or []


def fetch_weeks_with_data(req, weeks_back):
    """한 시장 이상이라도 rs_top_weekly 가 있는 distinct week_date 최신 N개."""
    weeks = set()
    for mk in MARKETS_ALL:
        # 1000행 캡 우회 — 적은 컬럼만 select 해도 캡은 유효하므로
        # 시장별로 따로 fetch (rs_top_weekly 시장당 ≤ 32주 × 30~150행 = 1000 안팎)
        path = (f"/rs_top_weekly?market=eq.{urllib.parse.quote(mk)}"
                f"&select=week_date&order=week_date.desc")
        rows = req("GET", path, prefer="return=representation") or []
        weeks.update(r["week_date"] for r in rows)
        # 1000행 캡에 걸려 누락된 더 오래된 주차도 별도 fetch
        if rows:
            min_seen = min(r["week_date"] for r in rows)
            path2 = (f"/rs_top_weekly?market=eq.{urllib.parse.quote(mk)}"
                     f"&week_date=lt.{urllib.parse.quote(min_seen)}"
                     f"&select=week_date&order=week_date.desc")
            rows2 = req("GET", path2, prefer="return=representation") or []
            weeks.update(r["week_date"] for r in rows2)
    return sorted(weeks, reverse=True)[:weeks_back]


# ── Gemini ─────────────────────────────────────────────────
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


def _fmt_mktcap(mc, market):
    if not mc:
        return "-"
    if market == "KR":
        return f"{mc/1e8:,.0f}억"
    if market == "JP":
        return f"¥{mc/1e8:,.0f}億"
    return f"${mc/1e9:.1f}B" if mc >= 1e9 else f"${mc/1e6:,.0f}M"


def build_global_prompt(week, market_rows, existing_cats=None):
    lines = [
        f"한미일 통합 RS96+ 모멘텀 종목 분류 — 주차: {week}",
        f"한국 {len(market_rows['KR'])}종목 + 미국 {len(market_rows['US'])}종목 + "
        f"일본 {len(market_rows['JP'])}종목 = 총 "
        f"{sum(len(v) for v in market_rows.values())}종목.",
        "",
        "이 종목들을 산업/테마/공급망 관점의 통합 카테고리로 묶어주세요.",
        "**중요**: 같은 테마는 시장 무관하게 **반드시 같은 'big' 라벨**을 써야 함.",
        "예) 한국 반도체 종목과 일본 반도체 종목과 미국 반도체 종목 모두 big='반도체' 로 통일.",
        "",
        "고정 캐논 테마 (가능하면 이 리스트 안에서 'big' 을 선택. 정 안 맞으면 새로 만들어도 됨):",
    ]
    for t in CANONICAL_THEMES:
        lines.append(f"  · {t}")
    lines.extend([
        "",
        "반도체 카테고리 안의 권장 'small' 세부 라벨 (big='반도체' 일 때 사용 권장,",
        "특히 메모리·장비·소재·팹리스 등 명확한 경우 small 에 명시):",
    ])
    for s in SEMI_SMALL_HINTS:
        lines.append(f"  · {s}")
    lines.extend([
        "",
        "각 행: ticker | 회사명 | 시장 | RS | 52주 모멘텀(%) | 시총",
    ])

    for mk in MARKETS_ALL:
        rows = market_rows[mk]
        if not rows:
            continue
        lines.append(f"\n[{MARKET_LABEL[mk]} {mk}]")
        for r in rows[:300]:
            name = r.get("name_en") or r.get("name") or r["ticker"]
            comp = r.get("comp_return")
            comp_s = f"{comp*100:+.0f}%" if comp is not None else "-"
            mc_s = _fmt_mktcap(r.get("mktcap"), mk)
            lines.append(f"  {r['ticker']:<12} | {name[:30]:<30} | {mk} | "
                         f"RS{r['rs']:>2} | {comp_s:>7} | {mc_s}")

    # ★★[2026-09-06 신설 · CAND-2026-09-06-1] 보충 호출 — 앞 호출이 빠뜨린 종목만 다시 묻는다.
    #   ★기존 카테고리를 알려 줘야 ★같은 테마가 새 라벨로 갈라지지 않는다.
    if existing_cats:
        labels = []
        for c in existing_cats:
            lab = c.get("big", "")
            if c.get("small"):
                lab += f" / {c['small']}"
            if lab:
                labels.append(lab)
        lines.extend([
            "",
            "⚠️ 이번 호출은 **앞 호출이 빠뜨린 종목만** 분류하는 보충 호출입니다.",
            "이미 만들어진 카테고리는 아래와 같습니다 — **가능하면 이 라벨을 그대로 재사용**하세요"
            "(같은 테마가 다른 이름으로 갈라지면 안 됩니다):",
        ])
        for lab in labels:
            lines.append(f"  · {lab}")

    lines.extend([
        "",
        "요구사항:",
        "  1) 'big' 카테고리는 한국어. 시장 무관하게 같은 산업은 같은 라벨로.",
        "  2) 'small' 은 선택 — 큰 카테고리 안에서 더 세분 필요 시 한국어로.",
        "  3) 각 카테고리 'tickers' 는 그 카테고리에 속한 모든 ticker (yahoo format 그대로,"
        " 예: 005930.KS, AAPL, 7203.T).",
        "  4) 한 종목은 한 카테고리만.",
        "  5) ★모든 종목을 빠짐없이 분류 (애매하면 '지주사 기타' 같은 큰 카테고리로).",
        "     ★★한 시장이라도 통째로 누락하면 안 됩니다 — 위에 제시된 "
        f"**{sum(len(v) for v in market_rows.values())}개 ticker 가 "
        "빠짐없이 어딘가의 tickers 배열에 한 번씩** 들어가야 합니다.",
        "  6) summary: 이번 주 한미일 전반의 메인 트렌드 1~2문장 한국어.",
        "",
        "JSON 만 응답. 다른 텍스트 X.",
    ])
    return "\n".join(lines)


def call_gemini(week, market_rows, max_retries=5, existing_cats=None):
    from google import genai
    from google.genai import types

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise SystemExit("⚠ GEMINI_API_KEY 환경변수 없음.")
    client = genai.Client(api_key=api_key)
    prompt = build_global_prompt(week, market_rows, existing_cats=existing_cats)
    cfg = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=RESPONSE_SCHEMA,
        temperature=0.2,
        # ★★[2026-09-06] 출력 절단 방어 — 150종목 x 카테고리면 기본 한도에 닿을 수 있다.
        #   ★08-21 에 KR 44 + JP 63 이 통째로 빠진 것이 이 층일 개연성이 있다.
        max_output_tokens=int(os.environ.get("RS_THEME_MAX_TOKENS", "32768")),
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
def _merge_categories(cats, extra):
    """★보충 호출 결과를 ★기존 카테고리에 병합한다.

    ★같은 (big, small) 이면 ★tickers 를 합치고, ★없으면 새 카테고리로 추가한다.
    ⚠️★요구사항 4)「한 종목은 한 카테고리만」을 지키려고 ★이미 배정된 ticker 는 건너뛴다.
    """
    seen = {t for c in cats for t in c.get("tickers", [])}
    index = {(c.get("big", ""), c.get("small") or ""): c for c in cats}
    for e in extra or []:
        fresh = [t for t in e.get("tickers", []) if t not in seen]
        if not fresh:
            continue
        seen.update(fresh)
        keyc = (e.get("big", ""), e.get("small") or "")
        if keyc in index:
            index[keyc]["tickers"].extend(fresh)
        else:
            new = {"big": e.get("big", ""), "tickers": fresh}
            if e.get("small"):
                new["small"] = e["small"]
            cats.append(new)
            index[keyc] = new
    return cats


def _missing_report(market_rows, cats):
    """★시장별 누락을 센다 — 반환 (누락 ticker 집합, {시장: (분류수, 원본수)})."""
    got = {t for c in cats for t in c.get("tickers", [])}
    missing, per = set(), {}
    for mk in MARKETS_ALL:
        src = {r["ticker"] for r in market_rows[mk]}
        per[mk] = (len(src & got), len(src))
        missing |= (src - got)
    return missing, per


def classify_one(req, week):
    market_rows = {mk: fetch_top96(req, mk, week) for mk in MARKETS_ALL}
    total = sum(len(v) for v in market_rows.values())
    if total == 0:
        print(f"[{week}] RS96+ 종목 없음 — skip")
        return False
    print(f"[{week}] KR={len(market_rows['KR'])} · US={len(market_rows['US'])} · "
          f"JP={len(market_rows['JP'])} = 총 {total}종목 → Gemini 호출", flush=True)
    t0 = time.time()
    data = call_gemini(week, market_rows)
    dt = time.time() - t0

    cats = data.get("categories", [])
    n_classified = sum(len(c.get("tickers", [])) for c in cats)
    print(f"  → {len(cats)}개 카테고리, {n_classified}/{total} 분류 ({dt:.1f}s)")
    print(f"     요약: {data.get('summary','')[:140]}")

    # ══════════════════════════════════════════════════════════════════
    # ★★[2026-09-06 신설 · CAND-2026-09-06-1] ★완전성 관문
    #
    # ⚠️★★왜 — ★종전에는 ★위 `n_classified/total` 을 ★**출력만 하고 그대로 적재**했다.
    #   ★실측 누락(웹앱 「한미일 테마」에서 해달별님이 발견):
    #     ★`2026-08-21` — ★KR **0/44** · JP **0/63** 누락(US 27 만 분류 · 총 27/134)
    #     ★`2026-08-28` — ★JP **0/67** 누락(총 79/146)
    #   ★★그리고 ★그 누락이 ★**다음 주 「전주 대비 증감」을 통째로 왜곡**했다 —
    #     ★09-04 는 정상(145/145)인데 ★전주가 비어 ★반도체가 ★「총 12 ▼43」처럼 찍혔다.
    #   ★★즉 ★한 주의 누락이 ★두 주를 망친다.
    #
    # ★처치 3단 — ①누락분만 보충 호출(기존 라벨 재사용) ②그래도 남으면 판정 ③치명이면 적재 거부.
    # ★되돌리기 — `RS_THEME_STRICT=0` ★한 줄(종전처럼 검증 없이 적재).
    # ══════════════════════════════════════════════════════════════════
    strict = os.environ.get("RS_THEME_STRICT", "1") != "0"
    max_fill = int(os.environ.get("RS_THEME_MAX_FILL", "2"))

    missing, per = _missing_report(market_rows, cats)
    for attempt in range(1, max_fill + 1):
        if not missing:
            break
        print(f"  ⚠️★누락 {len(missing)}종목 — 보충 호출 {attempt}/{max_fill} "
              f"({' · '.join(f'{mk} {a}/{b}' for mk, (a, b) in per.items())})", flush=True)
        sub = {mk: [r for r in market_rows[mk] if r["ticker"] in missing] for mk in MARKETS_ALL}
        try:
            extra = call_gemini(week, sub, existing_cats=cats)
            cats = _merge_categories(cats, extra.get("categories", []))
        except SystemExit as e:
            print(f"  ⚠️보충 호출 실패 — {e}", flush=True)
            break
        missing, per = _missing_report(market_rows, cats)

    detail = " · ".join(f"{mk} {a}/{b}" for mk, (a, b) in per.items())
    if missing:
        # ★시장이 통째로 빠졌나 — 「일부 누락」과 ★「한 시장 실종」은 ★심각도가 다르다
        dead = [mk for mk, (a, b) in per.items() if b > 0 and a == 0]
        ratio = len(missing) / total
        if strict and (dead or ratio > float(os.environ.get("RS_THEME_MAX_MISS", "0.10"))):
            raise SystemExit(
                f"⚠️★★[{week}] 분류 완전성 관문 실패 — 적재하지 않는다.\n"
                f"   누락 {len(missing)}/{total}종목({ratio:.1%}) · {detail}\n"
                + (f"   ★★시장 통째 누락: {', '.join(dead)}\n" if dead else "")
                + f"   ★누락 예시: {', '.join(sorted(missing)[:10])}\n"
                f"   ★되돌리기(검증 끄기): RS_THEME_STRICT=0")
        # ★문턱 안의 잔여 누락은 ★「미분류」로 ★명시해 남긴다(★조용히 사라지지 않게)
        print(f"  ⚠️★잔여 누락 {len(missing)}종목 → '미분류' 카테고리로 적재 · {detail}")
        cats.append({"big": "미분류", "tickers": sorted(missing)})
    else:
        print(f"  ★완전성 관문 통과 — {total}/{total} 전량 분류 · {detail}")

    # upsert
    req("DELETE", f"/rs_global_theme_weekly?week_date=eq.{urllib.parse.quote(week)}")
    req("POST", "/rs_global_theme_weekly", [{
        "week_date": week,
        "summary": data.get("summary", ""),
        "categories": cats,
        "model": MODEL_NAME,
        "generated_at": datetime.now().isoformat(),
    }])
    return True


def fetch_existing_weeks(req):
    """rs_global_theme_weekly 에 이미 분류된 주차 집합."""
    path = "/rs_global_theme_weekly?select=week_date"
    rows = req("GET", path, prefer="return=representation") or []
    return {r["week_date"] for r in rows}


def _page(req, path):
    """⚠️★PostgREST 는 ★1000행에서 잘린다 — ★적재된 주차가 늘면 ★조용히 일부만 읽는다.

    ★실측(2026-09-06) — ★이 캡 때문에 ★감사 첫 시도가 ★최근 5개월을 ★통째로 못 봤다.
    """
    out, step, off = [], 1000, 0
    while True:
        rows = req("GET", f"{path}&limit={step}&offset={off}",
                   prefer="return=representation") or []
        out += rows
        if len(rows) < step:
            return out
        off += step


def audit_weeks(req):
    """★★[2026-09-06 신설 · CAND-2026-09-06-1] ★전 주차 완전성 감사 — ★Gemini 호출 0회.

    ★반환: [(week, 판정, 누락수, 총수, {시장: (분류, 원본)})] ★최신순.
    ★`ok` 가 아닌 주차가 ★`--refill` 의 대상이 된다.
    """
    src = {}
    for mk in MARKETS_ALL:
        path = (f"/rs_top_weekly?market=eq.{urllib.parse.quote(mk)}"
                f"&select=week_date,ticker")
        for r in _page(req, path):
            src.setdefault(r["week_date"], {}).setdefault(mk, set()).add(r["ticker"])
    themes = {r["week_date"]: (r.get("categories") or [])
              for r in _page(req, "/rs_global_theme_weekly?select=week_date,categories")}

    max_miss = float(os.environ.get("RS_THEME_MAX_MISS", "0.10"))
    out = []
    for w in sorted(src, reverse=True):
        if w not in themes:
            out.append((w, "분류행 없음", None, None, {}))
            continue
        got = {t for c in themes[w] for t in c.get("tickers", [])}
        per, miss, tot = {}, 0, 0
        for mk in MARKETS_ALL:
            s = src[w].get(mk, set())
            per[mk] = (len(s & got), len(s))
            miss += len(s - got)
            tot += len(s)
        dead = [mk for mk, (a, b) in per.items() if b > 0 and a == 0]
        if dead:
            verdict = "시장 실종: " + ",".join(dead)
        elif tot and miss / tot > max_miss:
            verdict = f"누락 {miss / tot:.0%}"
        else:
            verdict = "ok"
        out.append((w, verdict, miss, tot, per))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--week", default=None, help="특정 주차 YYYY-MM-DD")
    ap.add_argument("--weeks", type=int, default=1, help="최신부터 N주차")
    ap.add_argument("--skip-existing", action="store_true",
                    help="이미 rs_global_theme_weekly 에 있는 주차는 건너뛰기 (백필 재실행 시)")
    ap.add_argument("--audit", action="store_true",
                    help="★전 주차 완전성 감사만 하고 끝낸다(Gemini 호출 0회 · 쓰기 0회)")
    ap.add_argument("--refill", action="store_true",
                    help="★감사에서 불합격한 주차만 재분류한다(--audit 의 보수판)")
    args = ap.parse_args()

    Config()
    req = _sb_client()

    if args.audit or args.refill:
        rep = audit_weeks(req)
        bad = [r for r in rep if r[1] != "ok"]
        print(f"★완전성 감사 — 주차 {len(rep)}개 중 ★불합격 {len(bad)}건\n")
        print("%-12s %-28s %-6s %s" % ("주차", "시장별 분류/원본", "누락", "판정"))
        for w, v, miss, tot, per in rep:
            d = " ".join(f"{mk}{a}/{b}" for mk, (a, b) in per.items()) or "-"
            mark = "  " if v == "ok" else "⚠️"
            print("%s%-10s %-28s %-6s %s" % (mark, w, d, "-" if miss is None else miss, v))
        if not args.refill:
            print(f"\n★불합격 {len(bad)}건. ★재분류하려면 --refill")
            return
        if not bad:
            print("\n★불합격 0건 — 재분류할 것이 없다.")
            return
        weeks = [r[0] for r in bad]
        print(f"\n★--refill — 불합격 {len(weeks)}주차를 재분류한다.\n")
    elif args.week:
        weeks = [args.week]
    else:
        weeks = fetch_weeks_with_data(req, args.weeks)

    if args.skip_existing:
        existing = fetch_existing_weeks(req)
        before = len(weeks)
        weeks = [w for w in weeks if w not in existing]
        print(f"대상 {before}주 중 {before - len(weeks)}주 기존 분류 존재 → 건너뜀.")

    print(f"대상 주차 {len(weeks)}개 · 캐논 시드 {len(CANONICAL_THEMES)}개 · model={MODEL_NAME}\n")

    total_ok = 0
    for w in weeks:
        if classify_one(req, w):
            total_ok += 1
    print(f"\n총 {total_ok}회 통합 분류 완료.")


if __name__ == "__main__":
    main()
