# S2 동시호가 신규 매수 후보 — ★13:30 예비 실행(잡 `S2_preclose_1330` · 평일 13:30)
# ★[2026-11-05 · 해달별님 결정 「15:12 에 처음 돌리면 늦다 · 13:30 에 추가로 · 별도 잡 + 메시지 머리표 · 과밀일 메시지도 함께」]
#   ★무엇 — `run_preclose.ps1` 을 ★그대로 부르고 머리표 env 하나만 더 켠다 ⇒ 텔레그램 첫 줄에 「⏰ 13:30 예비 …」.
#     env · 과밀일 메시지 · EOD 라벨은 15:10 판과 ★같다(런처 한 벌을 공유하므로 어긋날 수 없다).
#   ★Supabase — 13:30 판도 `daily_candidates` 에 적재하나 15:10 `S2_preclose` 가 같은 날짜를 DELETE 뒤 다시 적재 ⇒ 웹 화면의 최종값은 15:10 판이다.
#   ⚠️13:30 판은 ★장중 가격 기준이라 15:10 판과 후보가 다를 수 있다(머리표에 적는다).
#   ★로그 — `preclose.log` 를 함께 쓴다. 이 판의 시작 줄을 따로 남겨 구분한다.
#   ★되돌리기 — `Disable-ScheduledTask S2_preclose_1330`(머리표만 빼려면 아래 env 줄 삭제)
$log = Join-Path $PSScriptRoot "preclose.log"
"$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  ===== preclose 13:30 예비 start =====" | Out-File -Append -Encoding utf8 $log
$env:S2_PRECLOSE_LABEL = "13:30 예비 (장중 가격 기준 · 15:10 판이 최종)"
& (Join-Path $PSScriptRoot "run_preclose.ps1")
