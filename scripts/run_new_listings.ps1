# 매주 목요일 20:00 KST — 신규 상장 · 상장폐지 · 거래정지 탐지 (KR/US/JP).
#
# 티커 리스트를 무료 소스(네이버 KR / FDR US / JPX 엑셀 JP)에서 새로 수집해
# 스크리너 티커 캐시를 갱신한다. 금요일 본 루틴(13_/14_/15_)이 갱신된 리스트의
# 신규 종목 주가를 자동 수집(new_tks)하고, 13주 데이터 축적 후 RS 모집단에 포함.
# 상폐 종목은 리스트에서 제거하되 주간 캐시의 과거 데이터는 보존(RS 이력 유지).
# 결과 diff 는 C:\quantBacktest\screen\_listing_changes.log 에 누적 기록.

$ErrorActionPreference = "Continue"
$log = Join-Path $PSScriptRoot "new_listings.log"
$qb  = "C:\quantBacktest"
$env:PYTHONUTF8 = "1"

"`n===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') new_listings start =====" | Out-File -Append -Encoding utf8 $log
& "$qb\venv\Scripts\python.exe" "$qb\refresh_listings.py" --market all *>> $log
"===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') new_listings done (exit=$LASTEXITCODE) =====" | Out-File -Append -Encoding utf8 $log
