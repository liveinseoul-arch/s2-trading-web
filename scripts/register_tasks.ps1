# S2 자동 스케줄 등록 — 평일 15:10(후보) / 15:45(결과). 관리자 PowerShell에서 1회 실행.
# 해제: schtasks /delete /tn "S2_preclose" /f ;  schtasks /delete /tn "S2_eod" /f
$pre = Join-Path $PSScriptRoot "run_preclose.ps1"
$eod = Join-Path $PSScriptRoot "run_eod.ps1"
$days = "MON,TUE,WED,THU,FRI"

schtasks /create /tn "S2_preclose" /tr "powershell -NoProfile -ExecutionPolicy Bypass -File `"$pre`"" /sc weekly /d $days /st 15:10 /f
schtasks /create /tn "S2_eod"      /tr "powershell -NoProfile -ExecutionPolicy Bypass -File `"$eod`"" /sc weekly /d $days /st 15:45 /f

Write-Host "등록 완료. 확인: schtasks /query /tn S2_preclose ; schtasks /query /tn S2_eod"
Write-Host "수동 테스트: schtasks /run /tn S2_preclose"
