# KR 전용 수동 실행 — 14_RS_KR 병렬화 버전 검증/재실행용.
# run_rs_kr_jp.ps1 의 KR 단계만 미러링 (JP 제외). Supabase 푸시는 export 단계 내부에서 수행.

$ErrorActionPreference = "Continue"
$root = (Get-Item $PSScriptRoot).Parent.Parent.FullName   # s2_method
Set-Location $root
$log = Join-Path $PSScriptRoot "rs_kr_only.log"
$qb  = "C:\quantBacktest"
$env:BT_OUTPUT_DIR = "$qb\screen"
$env:FETCH_WORKERS = "8"
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

"`n===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') rs_kr_only start (FETCH_WORKERS=$env:FETCH_WORKERS) =====" | Out-File -Append -Encoding utf8 $log

RunPy "1 Rebuild"     @("$qb\Rebuild_weekly_cache.py")
RunPy "2 14_RS_KR"    @($silent, "$qb\14_RS_KR_pykrx.py")
RunPy "4 export KR"   @("s2-trading-web\scripts\export_rs_weekly.py", "--market", "KR", "--weeks", "56", "--full-universe")
RunPy "6 add KR ETFs" @("s2-trading-web\scripts\add_etfs.py", "--market", "KR", "--weeks", "56")
$env:GEMINI_MODEL = "gemini-2.5-pro"
RunPy "7 classify KR" @("s2-trading-web\scripts\classify_rs96_gemini.py", "--market", "KR", "--weeks", "1")

Log "===== rs_kr_only done ====="
