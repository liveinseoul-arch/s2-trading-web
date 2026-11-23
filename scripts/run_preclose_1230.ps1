# S2 동시호가 신규 매수 후보 — ★12:30 예비 실행(잡 `S2_preclose_1230` · 평일 12:30)
# ★[2026-11-23 · 해달별님 지시 「1:30 잡에 더해 12:30 에도 추가로 윈도우즈 스케줄 잡에 걸어줘」]
#   ★무엇 — `run_preclose_1330.ps1` 과 같은 형태. `run_preclose.ps1` 을 ★그대로 부르고 머리표 env 하나만 더 켠다 ⇒ 텔레그램 첫 줄에 「⏰ 12:30 예비 …」.
#     env · 과밀일 메시지 · EOD 라벨은 13:30 · 15:10 판과 ★같다(런처 한 벌을 공유하므로 어긋날 수 없다).
#   ★Supabase — 12:30 판도 `daily_candidates` 에 적재하나 13:30 · 15:10 이 같은 날짜를 DELETE 뒤 다시 적재 ⇒ 웹 화면의 최종값은 15:10 판이다.
#   ⚠️12:30 판은 ★장중 가격 기준이라 15:10 판과 후보가 다를 수 있다(머리표에 적는다).
#   ★로그 — `preclose.log` 를 함께 쓴다. 이 판의 시작 줄을 따로 남겨 구분한다.
#   ★되돌리기 — `Disable-ScheduledTask S2_preclose_1230`(머리표만 빼려면 아래 env 줄 삭제)
$log = Join-Path $PSScriptRoot "preclose.log"
"$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  ===== preclose 12:30 예비 start =====" | Out-File -Append -Encoding utf8 $log
$env:S2_PRECLOSE_LABEL = "12:30 예비 (장중 가격 기준 · 15:10 판이 최종)"
# ★[2026-11-23 · 해달별님 지시] 검출 0건(평소 · 과밀일)이면 텔레그램을 보내지 않는다 · 15:10 판은 이 env 가 없어 종전대로 · 되돌리기 = 이 줄 삭제
$env:S2_PRECLOSE_SKIP_EMPTY = "1"
& (Join-Path $PSScriptRoot "run_preclose.ps1")
