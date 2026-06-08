# 매주 토요일 02:00 — RS 캐시·테이블·Supabase 풀세트 갱신.
#
# 1) Rebuild_weekly_cache.py  : KR _bt_daily → _kr_weekly 재구성 + 자동 백업
# 2) 14_RS_KR_pykrx.py         : KR 종목·주간 OHLCV·RS 임계값 테이블 신선화
# 3) 13_RS_US_screen.py        : US 종목·주간 OHLCV·RS 임계값 테이블 신선화
# 4) 15_RS_JP_screen.py        : JP 종목·주간 OHLCV 신선화 (RS 테이블 없음 — export 시 임시 계산)
# 5) export_rs_weekly.py       : 마감지기 Supabase rs_top_weekly/rs_history_weekly 동기화
#
# 13_/14_/15_ 는 input() 사용. PS 5.1 stdin pipe 가 BOM 을 prepend 해 깨지는 문제 회피 위해
# silent_run.py wrapper 가 builtins.input 을 monkey-patch 한 뒤 모듈 import + main() 호출.
$ErrorActionPreference = "Continue"
$root = (Get-Item $PSScriptRoot).Parent.Parent.FullName   # s2_method
Set-Location $root
$log = Join-Path $PSScriptRoot "rs_weekly.log"
$qb  = "C:\quantBacktest"
$env:BT_OUTPUT_DIR = "$qb\screen"
$silent = "s2-trading-web\scripts\silent_run.py"

function Log($m) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" | Out-File -Append -Encoding utf8 $log
}

function RunPy($label, [string[]]$pyArgs) {
    Log "[$label] start  ($($pyArgs -join ' '))"
    try {
        & C:\Python314\python.exe @pyArgs *>> $log
        Log "[$label] done (exit=$LASTEXITCODE)"
    } catch {
        Log "[$label] FAILED: $_"
    }
}

"`n===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') rs_weekly start =====" | Out-File -Append -Encoding utf8 $log

RunPy "1/6 Rebuild"   @("$qb\Rebuild_weekly_cache.py")
RunPy "2/6 14_RS_KR"  @($silent, "$qb\14_RS_KR_pykrx.py")
RunPy "3/6 13_RS_US"  @($silent, "$qb\13_RS_US_screen.py")
RunPy "4/6 15_RS_JP"  @($silent, "$qb\15_RS_JP_screen.py")
RunPy "5/6 export"    @("s2-trading-web\scripts\export_rs_weekly.py")
# 매주 새 주차 1개만 Pro 모델로 분류 — Flash 보다 정밀한 카테고리·summary.
# 변경 시 이 env 만 갱신하면 됨.
$env:GEMINI_MODEL = "gemini-2.5-pro"
RunPy "6/6 classify"  @("s2-trading-web\scripts\classify_rs96_gemini.py", "--weeks", "1")

Log "===== rs_weekly done ====="
