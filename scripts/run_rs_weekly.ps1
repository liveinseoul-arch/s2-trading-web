# 매주 토요일 02:00 — quantBacktest 의 weekly cache 에서 RS96+ 종목을 추출해
# Supabase rs_top_weekly / rs_history_weekly 에 적재.
#
# 주의:
#   quantBacktest 의 weekly_cache 자체가 갱신돼 있어야 최신 주차가 잡힌다.
#   캐시 갱신은 별도 잡(quantBacktest 의 14_RS_KR_pykrx.py / 13_RS_US_screen.py)으로 운영.
#   이 스크립트는 적재만 수행한다.
$ErrorActionPreference = "Stop"
$root = (Get-Item $PSScriptRoot).Parent.Parent.FullName   # s2_method
Set-Location $root
$log = Join-Path $PSScriptRoot "rs_weekly.log"
"`n===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') rs_weekly =====" | Out-File -Append -Encoding utf8 $log
& C:\Python314\python.exe "s2-trading-web\scripts\export_rs_weekly.py" *>> $log
