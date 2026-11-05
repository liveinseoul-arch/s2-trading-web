#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""S2 트레이딩 따라하기 · 장마감 전 동시호가 후보 익스포터.

s2_candidates 의 [A] 신규 진입 후보(지지선 지정가, 근접 포함) 로직을 재사용해 daily_candidates 에 적재.
홈 화면의 '오늘 동시호가 신규 매수 후보' 섹션 데이터.

사용:
  python export_preclose.py                 # 오늘(장중이면 실시간 스냅샷, 아니면 캐시 최신)
  python export_preclose.py --date 2026-05-27   # 특정일(캐시 EOD) 기준 후보 적재
  python export_preclose.py --dry-run       # Supabase 없이 후보만 출력
env(적재): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY(= sb_secret_ 키)
"""
from __future__ import annotations
import argparse, os, sys, json
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]   # s2_method
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))  # scripts/ (notify)
os.chdir(ROOT)                                            # 상대경로(stock_cache.db, .env.local)가 항상 s2_method 루트 기준
import s2_candidates as sc                     # noqa: E402
from config import Config                       # noqa: E402
from notify import telegram_send                # noqa: E402

# ★[2026-11-05 · 해달별님 결정 「13:30 추가 실행 · 별도 잡 + 메시지 머리표」] 15:10 판보다 먼저 보는 ★예비 알림.
#   ★잡 `S2_preclose_1330` → `run_preclose_1330.ps1` 이 이 env 만 더 켜고 `run_preclose.ps1` 을 그대로 부른다.
#   ★켜면 이 프로세스의 ★모든 텔레그램(평소 · 과밀일 · KRX 실패) 첫 줄에 머리표가 붙는다 · Supabase 는 그대로(15:10 이 날짜별 DELETE 뒤 다시 적재).
#   ★게이트 `S2_PRECLOSE_LABEL`(기본 "" = off) — off 면 ★종전 바이트 동일.
PRECLOSE_LABEL = os.environ.get("S2_PRECLOSE_LABEL", "").strip()
if PRECLOSE_LABEL:
    _telegram_send_raw = telegram_send

    def telegram_send(text):
        return _telegram_send_raw(f"⏰ <b>{PRECLOSE_LABEL}</b>\n" + text)

MKT ={"KOSPI": "KS", "KOSDAQ": "KQ"}

# ★★[CAND-2026-10-20-35 · 해달별님 결정 2026-10-31 「선택지 B」] 「EOD 에서 막힐 후보」 라벨.
#   ★게이트는 ★`s2_candidates.EOD_LABEL`(`S2_ALARM_EOD_LABEL` · 기본 "0") 하나다.
#   ★off 면 ★이 dict 가 ★영원히 비어 ★알림 · dry-run 출력이 ★종전 바이트 동일이다.
#   ⚠️★라벨은 ★Supabase 행(`rows`)에 ★넣지 않는다 — ★`daily_candidates` 에 그 열이 없어 ★POST 가 깨진다(스키마 변경 금지).
_EOD_BLOCK = {}         # ticker -> [사유, ...]  ★build() 가 채운다(on 일 때만)

# ★★[2026-11-04 · CAND-2026-10-31-13 · ★해달별님 결정 「과밀일이 예측되면 과밀일 기준 메시지를 별도로 표시해서 보낸다」]
#   ★왜 — 20:30 EOD 는 과밀일에 진입선을 MA20 x 0.85 로 완화하는데(`S2_ENV_DENS_MAP`) 이 알람은 늘 x 0.80 이라
#     2026-11-03 EOD 신규 6건 중 5건(금호건설 · 대원전선 · 우리기술 · 성호전자 · LG전자)이 알람에 없었다.
#   ★무엇 — 오늘이 과밀일이면(`crowd_today.judge` · 전 거래일까지의 데이터만 · 운영 맵과 168/168 일치)
#     과밀일 진입선으로 [A] 를 한 번 더 뽑아 ★별도 텔레그램 메시지로 보낸다. ★평소 기준 메시지 · Supabase 적재는 그대로.
#   ★게이트 `S2_ALARM_CROWD`(기본 "0") — off 면 아래 블록을 안 타 ★알림 · dry-run 출력이 종전 바이트 동일.
#   ★되돌리기 = `run_preclose.ps1` 의 `S2_ALARM_CROWD` 줄을 "0" 으로(또는 삭제).
CROWD_ON = os.environ.get("S2_ALARM_CROWD", "0").strip().lower() in ("1", "true", "yes", "on")
_CROWD = {}             # ★build() 가 채운다(on 일 때만) — info · rows · block · footer


def _to_rows(new_cand, target, now):
    return [dict(
        d=str(target), ticker=c["tk"], kind="new", name=c["name"],
        market=MKT.get(c["market"], c["market"]),
        current_price=round(c["price"]), order_price=round(c["order"]),
        port_pct=round(c["pct"], 2), ma120_above=bool(c["above"]),
        prev_spike_bull=(None if c["bull"] is None else bool(c["bull"])),
        stage=1, reached=bool(c["reached"]), drop_to_pct=round(c["drop_to"] * 100, 2),
        snapshot_at=now,
    ) for c in new_cand]


def build_crowd(target, px, nmap, mmap, positions, last_exit, cash, cfg, now):
    """★on 일 때만 부른다. 과밀일이면 과밀일 진입선으로 [A] 를 다시 뽑는다.
    ⚠️★`extract()` 는 꼬리말 상태(META)를 덮어쓴다 ⇒ 평소 기준 메시지의 꼬리말이 바뀌지 않게 ★저장 · 복원한다."""
    import crowd_today as ct
    _CROWD.clear()
    info = ct.judge(target)
    _CROWD["info"] = info
    if not info.get("crowded"):
        return
    keep = [(d, dict(d)) for d in (sc.REENTRY_SIDECAR_META, sc.EOD_LABEL_META, sc._RSC_CUR)]
    px2 = px.copy()
    px2["support"] = px2["ma20"] * (1 - info["ep"])
    try:
        nc, _a, _n, _h = sc.extract(px2, target, positions, last_exit, cash, nmap, mmap, cfg)
        foot = []
        if getattr(sc, "EOD_LABEL", False):
            foot += sc.eod_label_footer()
        if getattr(sc, "REENTRY_SIDECAR", "") in ("label", "gate"):
            foot += sc.reentry_sidecar_footer()
    finally:
        for d, v in keep:
            d.clear()
            d.update(v)
    _CROWD["rows"] = _to_rows(nc, target, now)
    _CROWD["block"] = {c["tk"]: c["eod_block"] for c in nc if c.get("eod_block")}
    _CROWD["footer"] = foot


def _crowd_lab(r):
    why = _CROWD.get("block", {}).get(r["ticker"])
    return f" ⛔EOD차단:{'·'.join(why)}" if why else ""


def crowd_lines(target, base_rows):
    """★과밀일 기준 메시지 본문(줄 목록) — 과밀일이 아니면 빈 목록. 판정 실패 · 연속 상한 초과는 한 줄로 알린다."""
    info = _CROWD.get("info") or {}
    if info.get("why"):
        return [f"⚠️ <b>[S2] {target} 과밀일 판정 실패</b> — {info['why']}",
                "오늘 20:30 EOD 가 과밀일 진입선(20일선 −15%)으로 살 수 있습니다. 위 평소 기준 메시지만으로는 다를 수 있음."]
    if info.get("capped"):
        return [f"ⓘ [S2] {target} 과밀 연속 {info['streak']}일째 — 상한 {info['streak_max']}일을 넘어 "
                "20:30 EOD 도 평소 진입선(20일선 −20%)을 씁니다. 위 평소 기준 메시지 그대로입니다."]
    if not info.get("crowded"):
        return []
    rows = _CROWD.get("rows", [])
    base = {r["ticker"] for r in base_rows}
    ep = info["ep"] * 100
    lines = [f"🟣 <b>[S2] {target} 과밀일 기준 신규 매수 후보 {len(rows)}건</b>",
             f"오늘은 과밀일(연속 {info['streak']}일째 · 전 거래일 {info['prev_date']}까지로 판정)입니다.",
             f"20:30 EOD 장부는 진입선을 20일선 −{ep:.0f}%(평소 −20%)로 잡습니다.",
             f"아래 지정가는 과밀일 진입선입니다 — 위 평소 기준 메시지와 종목·지정가가 다릅니다(★= 과밀일에만 후보)."]
    reached = [r for r in rows if r["reached"]]
    near = [r for r in rows if not r["reached"]]
    star = lambda r: "" if r["ticker"] in base else "★"
    if reached:
        lines.append("● 과밀일 진입선 도달(체결 예상):")
        for r in reached[:12]:
            lines.append(f"  · {star(r)}{r['name'][:6]} {r['order_price']:,}원 (포트 {r['port_pct']}%)" + _crowd_lab(r))
    if near:
        lines.append("○ 근접(더 내리면 체결):")
        for r in sorted(near, key=lambda x: x["drop_to_pct"], reverse=True)[:12]:
            lines.append(f"  · {star(r)}{r['name'][:6]} {r['order_price']:,}원 "
                         f"({r['drop_to_pct']:.1f}% · 포트 {r['port_pct']}%)" + _crowd_lab(r))
    if not rows:
        lines.append("과밀일 진입선 기준으로도 신규 진입 후보 없음.")
    lines.extend(_CROWD.get("footer", []))
    return lines


def _eod_lab(r):
    """★off 면 빈 문자열 ⇒ ★종전 바이트 동일."""
    why = _EOD_BLOCK.get(r["ticker"])
    return f" ⛔EOD차단:{'·'.join(why)}" if why else ""


def notify_preclose(target, rows):
    reached = [r for r in rows if r["reached"]]
    near = [r for r in rows if not r["reached"]]
    lines = [f"📋 <b>[S2] {target} 동시호가 신규 매수 후보 {len(rows)}건</b>",
             "15:20~15:30 동시호가에 '지지선 지정가' 매수주문을 제출하세요."]
    if reached:
        lines.append("● 지지선 도달(체결 예상):")
        for r in reached[:10]:
            lines.append(f"  · {r['name'][:6]} {r['order_price']:,}원 (포트 {r['port_pct']}%)" + _eod_lab(r))
    if near:
        # ★★[2026-10-21 · 해달별님 지시] ①종목당 ★한 줄 + ★주문가·비중 병기(도달 줄과 같은 꼴)
        #   ②★가까운 것(덜 내려도 되는 것)부터 — `drop_to_pct` 는 ★음수라 ★내림차순이 가까운 순이다.
        #   ⚠️★정렬은 ★이 메시지 안에서만 한다 — `s2_candidates.py:298` 의 전역 정렬은 ★건드리지 않는다
        #     (웹앱 `daily_candidates` 적재 순서·`export_eod.py`·CLI 출력이 ★그것을 공유한다).
        #   ★`[:12]` 는 ★정렬 ★뒤에 자른다 ⇒ ★「가까운 12개」가 남는다(종전에는 ★먼 12개였다).
        lines.append("○ 근접(더 내리면 체결):")
        for r in sorted(near, key=lambda x: x["drop_to_pct"], reverse=True)[:12]:
            lines.append(f"  · {r['name'][:6]} {r['order_price']:,}원 "
                         f"({r['drop_to_pct']:.1f}% · 포트 {r['port_pct']}%)" + _eod_lab(r))
    if not rows:
        lines.append("오늘 신규 진입 후보 없음.")
    if getattr(sc, "EOD_LABEL", False):     # ★[CAND-2026-10-20-35] off 면 한 줄도 안 붙는다
        lines.extend(sc.eod_label_footer())
    if getattr(sc, "REENTRY_SIDECAR", "") in ("label", "gate"):   # ★[2026-10-31 · CAND-2026-10-31-11] 재진입 사이드카 꼬리말 — off · shadow 면 안 붙는다
        lines.extend(sc.reentry_sidecar_footer())                 # ★되돌리기 = run_preclose.ps1 `S2_ALARM_REENTRY_SIDECAR` "0"
    telegram_send("\n".join(lines))


def notify_preclose_fail(today_str, last_cached_str):
    """KRX 라이브 스냅샷 실패 시 — 폴백 데이터로 동일 메시지를 반복 발송하지 않고 실패를 명시 통보."""
    lines = [
        f"⚠️ <b>[S2] {today_str} KRX 데이터 갱신 실패</b>",
        "KRX 로그인이 거부되어 오늘 시세를 받지 못했습니다. 후보 산출을 건너뜁니다.",
        "",
        "📌 점검 항목:",
        "1) <a href='https://data.krx.co.kr'>data.krx.co.kr</a> 직접 로그인으로 자격증명 확인",
        "2) 비밀번호 만료/계정 잠금 여부 점검",
        "3) 필요 시 .env.local 의 KRX_PW 갱신 후 main.py 1회 수동 실행",
        "",
        f"마지막 캐시 갱신일: {last_cached_str}",
        "복구되면 다음 거래일 15:10 자동 알림이 정상 발송됩니다.",
    ]
    telegram_send("\n".join(lines))


def build(target_date, live):
    # ★★[CAND-2026-10-24-21] 15:10 알람을 20:30 계획과 맞춘다 — ★`S2_CAND_SYNC_OPS` off 면 ★종전 비트동일.
    cfg = sc.apply_ops_sync(Config()); cfg.lookback_days = sc.WINDOW
    requested_live = bool(live)                     # 폴백 감지용: 호출 시점에 live 모드를 요청했는지
    px, nmap, mmap, target, live_out = sc.prepare(cfg, target_date, live)
    fallback = requested_live and not live_out      # 라이브 요청 → 캐시로 떨어졌으면 KRX 실패
    positions, last_exit, cash, _ = sc.reconstruct(px, target, nmap, mmap, cfg, 5e8)
    new_cand, _add, nav, _hv = sc.extract(px, target, positions, last_exit, cash, nmap, mmap, cfg)
    _EOD_BLOCK.clear()                      # ★[CAND-2026-10-20-35] off 면 `eod_block` 키가 없어 비어 있다
    _EOD_BLOCK.update({c["tk"]: c["eod_block"] for c in new_cand if c.get("eod_block")})
    now = datetime.now().isoformat()
    if CROWD_ON:                            # ★[CAND-2026-10-31-13] off 면 안 탄다 ⇒ 종전 바이트 동일
        build_crowd(target, px, nmap, mmap, positions, last_exit, cash, cfg, now)
    rows = [dict(
        d=str(target), ticker=c["tk"], kind="new", name=c["name"],
        market=MKT.get(c["market"], c["market"]),
        current_price=round(c["price"]), order_price=round(c["order"]),
        port_pct=round(c["pct"], 2), ma120_above=bool(c["above"]),
        prev_spike_bull=(None if c["bull"] is None else bool(c["bull"])),
        stage=1, reached=bool(c["reached"]), drop_to_pct=round(c["drop_to"] * 100, 2),
        snapshot_at=now,
    ) for c in new_cand]
    return str(target), rows, fallback


def upsert(target, rows):
    import urllib.request, urllib.parse, urllib.error
    base = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1"
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    H = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
         "Prefer": "return=minimal"}

    def req(method, path, body=None):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        r = urllib.request.Request(base + path, data=data, method=method, headers=H)
        try:
            with urllib.request.urlopen(r, timeout=60) as resp:
                resp.read()
        except urllib.error.HTTPError as e:
            raise SystemExit(f"[supabase] {method} {path} 실패 {e.code}: {e.read().decode()[:400]}")

    req("DELETE", f"/daily_candidates?d=eq.{urllib.parse.quote(target)}&kind=eq.new")
    if rows:
        req("POST", "/daily_candidates", rows)
    req("PATCH", "/meta?key=eq.last_preclose_at", {"value": datetime.now().isoformat()})
    print(f"[supabase] daily_candidates 적재 완료 ({target}, 신규 후보 {len(rows)}건)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=None, help="기준일 YYYY-MM-DD (미입력=오늘)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-notify", action="store_true", help="텔레그램 알림 생략")
    args = ap.parse_args()
    Config()  # .env.local 로드(SUPABASE_*/TELEGRAM_* 환경변수 주입)
    target_date = date.fromisoformat(args.date) if args.date else None
    live = target_date is None
    target, rows, fallback = build(target_date, live)
    if args.dry_run:
        note = " [⚠ KRX 라이브 실패 → 캐시 폴백]" if fallback else ""
        print(f"[dry-run] {target} 신규 동시호가 후보 {len(rows)}건{note}")
        for r in rows[:30]:
            reach = "●도달" if r["reached"] else f"{r['drop_to_pct']:.1f}%"
            updown = "UP" if r["ma120_above"] else "DOWN"
            print(f"  {r['name'][:6]:<8}{r['market']:<3}{r['ticker']:<8} 현재가 {r['current_price']:>9,} "
                  f"주문가(지지선) {r['order_price']:>9,} {reach:>7} 포트{r['port_pct']}% {updown}" + _eod_lab(r))
        if CROWD_ON:                        # ★[CAND-2026-10-31-13] off 면 한 줄도 안 찍는다
            print(f"[dry-run] 과밀일 판정 {_CROWD.get('info')}")
            for ln in crowd_lines(target, rows):
                print("  " + ln)
    elif fallback:
        # KRX 실패 → 폴백 데이터는 적재·정상 알림 모두 생략, 실패 알림만 발송
        today_str = str(date.today())
        print(f"[KRX 실패] 라이브 스냅샷 실패 → 캐시({target})로 폴백. Supabase 적재·정상 알림 생략, 실패 알림 발송.")
        if not args.no_notify:
            notify_preclose_fail(today_str, target)
    else:
        upsert(target, rows)
        if not args.no_notify:
            notify_preclose(target, rows)
            if CROWD_ON:                    # ★[CAND-2026-10-31-13] 과밀일이면 ★별도 메시지(평소 기준 메시지 뒤)
                _cl = crowd_lines(target, rows)
                if _cl:
                    telegram_send("\n".join(_cl))
    print("DONE")


if __name__ == "__main__":
    main()
