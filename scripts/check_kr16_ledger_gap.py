#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# [2026-08-16 랙 수리] kr16 주간 원장 랙 감지 (신설 · run_kr_perf_weekly.ps1 [3b gap check])
#
# 무엇: 최신 EXP-*kr16_perf_live-KR 원장의 KR_자산 마지막 date 와 「직전 금요일」의 격차를 재고,
#       7일 초과면 exit 1 (호출한 ps1 이 텔레그램 알림 + 잡 실패 처리).
#       기준: 정상 주기는 격차 0일(토 08:00 실행 · 전날 금요일 마감 데이터).
#             한 주 밀림(= 7일)까지는 휴장 등으로 허용, 초과는 랙으로 판정.
#       실측 사고: 2026-07-25 – 08-15 4런이 전부 KR_자산 last = 2026-07-17 로 동결됐는데
#       exit 0 완주라 4주 무감지였다(RS_LEDGER_LAG_2026-08-16.md §0 「침묵 요인」).
#       ⚠️읽기 전용 — 원장·캐시를 절대 수정하지 않는다.
#
# 실행: C:/quantBacktest/venv/Scripts/python.exe check_kr16_ledger_gap.py
# 되돌리기: 이 파일 삭제 + run_kr_perf_weekly.ps1 의 [3b gap check] 블록 삭제.
# 승인: 해달별님 2026-08-16 「전체 패키지」
# [2026-08-16 랙 수리] 끝
import glob
import os
import sys
from datetime import date, timedelta

import pandas as pd

# rs_pyramid_signal.py · unified_engine_t1 과 동일한 글롭 패턴 (sorted[-1] = 최신)
EXP_GLOB = r"C:\QuantBacktest\screen\experiments\EXP-*kr16_perf_live-KR"
MAX_GAP_DAYS = 7   # ★7일 = 정확히 한 주 밀림 = ★이미 이상이다(경계 포함으로 잡는다)
#   ⚠️★[2026-08-23 수리 · CAND-2026-08-22-115] 종전 `gap > MAX_GAP_DAYS` 라
#     ★정확히 7일이 ★OK 로 통과했다(2026-08-22 08:17 실측 로그 「격차=7일 (기준 <= 7) OK」).
#     ★한 주 낡은 원장이 통과하면 감지기가 있으나 마나다. → ★`>=` 로 고쳤다.


def prev_friday(today):
    """오늘보다 엄격히 이전인 가장 최근 금요일."""
    off = (today.weekday() - 4) % 7
    return today - timedelta(days=off or 7)


def main():
    dirs = sorted(glob.glob(EXP_GLOB))
    if not dirs:
        print("FAIL: kr16_perf_live 원장 디렉토리 없음: " + EXP_GLOB)
        sys.exit(1)
    # ⚠️★★[2026-08-23 신설 · CAND-2026-08-22-116] ★글롭 폴백
    #   ★최신 디렉터리에 result.xlsx 가 없으면 ★한 칸씩 뒤로 내려간다.
    #   ★실측 — EXP-kr16_perf_live-KR 11개 중 ★3개에 result.xlsx 가 ★없다.
    #     ★하나가 맨 뒤에 생기면 ★그날 ★신호와 ★랭 감지가 ★동시에 죽었다.
    #   ⚠️★★폴백은 ★반드시 시끄럽게 한다 — ★조용히 낡은 원장으로
    #     내려가면 ★죽는 것보다 ★더 위험하다(★모르고 쓴다).
    xs = []
    for _i in range(len(dirs) - 1, -1, -1):
        xs = glob.glob(dirs[_i] + r"\*result.xlsx")
        if xs:
            if _i != len(dirs) - 1:
                _sk = [os.path.basename(x) for x in dirs[_i + 1:]]
                print("⚠️★글롭 폴백 — result.xlsx 가 없는 디렉터리 %d개를 건넌다: %s"
                      % (len(_sk), ", ".join(_sk)), flush=True)
                print("   ★읽은 원장 = %s (★최신이 아니다)"
                      % os.path.basename(dirs[_i]), flush=True)
            break
    if not xs:
        print("FAIL: result.xlsx 가 단 하나도 없음(디렉터리 %d개 전수): %s" % (len(dirs), EXP_GLOB))
        sys.exit(1)
    eq = pd.read_excel(xs[0], sheet_name="KR_자산")
    last = pd.to_datetime(eq["date"]).max().date()
    today = date.today()
    fri = prev_friday(today)
    gap = (fri - last).days
    print("원장: %s" % xs[0])
    print("KR_자산 마지막 date=%s · 직전 금요일=%s · 격차=%d일 (기준 < %d)"
          % (last, fri, gap, MAX_GAP_DAYS))
    if gap >= MAX_GAP_DAYS:
        print("FAIL: 원장 랙 감지 — 격차 %d일 >= %d일(★한 주 밀림)" % (gap, MAX_GAP_DAYS))
        sys.exit(1)
    print("OK")
    sys.exit(0)


if __name__ == "__main__":
    main()
