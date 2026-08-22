# 주간 RS 파이프라인 Windows 작업 스케줄러 등록 (관리자 권한 필요).
#
# 변경 사항:
#   - 기존 S2_rs_weekly (토 02:00 KST, 순차 154분) — 미국 장중이라 부정확
#   - 신규 1: S2_rs_kr_jp (금 18:00 KST) — KR + JP 병렬, ~45분
#   - 신규 2: S2_rs_us    (토 07:00 KST) — US + 한미일 통합, ~80분
#
# 사용:
#   powershell -ExecutionPolicy Bypass -File register_rs_tasks.ps1

$root = (Get-Item $PSScriptRoot).Parent.Parent.FullName
$krJP = Join-Path $PSScriptRoot "run_rs_kr_jp.ps1"
$us   = Join-Path $PSScriptRoot "run_rs_us.ps1"

# 기존 S2_rs_weekly 제거
schtasks /delete /tn "S2_rs_weekly" /f 2>$null

# S2_rs_kr_jp — 매주 금요일 18:00 KST
schtasks /create /tn "S2_rs_kr_jp" `
    /tr "powershell -NoProfile -ExecutionPolicy Bypass -File `"$krJP`"" `
    /sc weekly /d FRI /st 18:00 /f
Write-Host "✓ S2_rs_kr_jp 등록 — 매주 금 18:00 KST"

# S2_rs_us — 매주 토요일 07:00 KST
schtasks /create /tn "S2_rs_us" `
    /tr "powershell -NoProfile -ExecutionPolicy Bypass -File `"$us`"" `
    /sc weekly /d SAT /st 07:00 /f
Write-Host "✓ S2_rs_us 등록 — 매주 토 07:00 KST"

Write-Host "`n현재 등록된 S2_* 작업:"
schtasks /query /tn "S2_rs_kr_jp" /fo TABLE 2>$null
schtasks /query /tn "S2_rs_us"    /fo TABLE 2>$null
