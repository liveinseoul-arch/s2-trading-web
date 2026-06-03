# 매주 토요일 02:00 — RS 캐시·테이블·Supabase 풀세트 갱신.
#
# 1) Rebuild_weekly_cache.py  : KR _bt_daily → _kr_weekly 재구성 + 자동 백업
# 2) 14_RS_KR_pykrx.py         : KR 종목·주간 OHLCV·RS 임계값 테이블 신선화
# 3) 13_RS_US_screen.py        : US 종목·주간 OHLCV·RS 임계값 테이블 신선화
# 4) export_rs_weekly.py       : 마감지기 Supabase rs_top_weekly/rs_history_weekly 동기화
#
# 인터랙티브 스크립트 13_/14_ 는 stdin 으로 빈 줄을 흘려 비대화식 실행:
# 기준일 enter(=오늘), ticker 캐시 enter(=유지), 종료 enter(=빈 티커).
#
# 각 단계를 try/catch 로 격리해 한 단계가 실패해도 다음 단계는 진행.
# 모든 stdout/stderr 는 rs_weekly.log 에 누적 기록.
$ErrorActionPreference = "Continue"
$root = (Get-Item $PSScriptRoot).Parent.Parent.FullName   # s2_method
Set-Location $root
$log = Join-Path $PSScriptRoot "rs_weekly.log"
$qb  = "C:\quantBacktest"
$env:BT_OUTPUT_DIR = "$qb\screen"

function Log($m) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" | Out-File -Append -Encoding utf8 $log
}

function Run($label, $script, $stdinLines) {
    Log "[$label] start  ($script)"
    try {
        if ($stdinLines) {
            $stdinLines | & C:\Python314\python.exe $script *>> $log
        } else {
            & C:\Python314\python.exe $script *>> $log
        }
        Log "[$label] done (exit=$LASTEXITCODE)"
    } catch {
        Log "[$label] FAILED: $_"
    }
}

"`n===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') rs_weekly start =====" | Out-File -Append -Encoding utf8 $log

Run "1/4 Rebuild"       "$qb\Rebuild_weekly_cache.py"               $null
Run "2/4 14_RS_KR"      "$qb\14_RS_KR_pykrx.py"                     "`n`n"
Run "3/4 13_RS_US"      "$qb\13_RS_US_screen.py"                    "`n`n`n"
Run "4/4 export"        "s2-trading-web\scripts\export_rs_weekly.py" $null

Log "===== rs_weekly done ====="
