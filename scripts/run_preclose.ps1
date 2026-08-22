# 15:10 장마감 전 — 라이브 스냅샷으로 동시호가 신규 매수 후보 산출 → Supabase + 텔레그램
$ErrorActionPreference = "Stop"
$root = (Get-Item $PSScriptRoot).Parent.Parent.FullName   # scripts → s2-trading-web → s2_method
Set-Location $root
$log = Join-Path $PSScriptRoot "preclose.log"
"`n===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') preclose =====" | Out-File -Append -Encoding utf8 $log
& C:\Python314\python.exe "s2-trading-web\scripts\export_preclose.py" *>> $log
