# 15:45 장마감 후 — 캐시에 당일 EOD 저장 후 전구간 재계산 → Supabase + 텔레그램
$ErrorActionPreference = "Stop"
$root = (Get-Item $PSScriptRoot).Parent.Parent.FullName   # s2_method
Set-Location $root
$log = Join-Path $PSScriptRoot "eod.log"
"`n===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') eod =====" | Out-File -Append -Encoding utf8 $log
& C:\Python314\python.exe "main.py" --no-gsheets *>> $log               # 당일 EOD 캐시 갱신
$env:S2_TIME_STOP_DAYS = "15"                                          # 기간 손절 3주
$env:S2_SELL_TARGETS = "2,6,14"                                        # 분할매도 +2/+6/+14 (12y Calmar 1.00, 비용 적용)
$env:S2_COSTS = "1"                                                    # 매수 0.015% / 매도 0.265% 적용
& C:\Python314\python.exe "s2-trading-web\scripts\export_eod.py" *>> $log  # executions/보유/거래/카운트/후보 적재
