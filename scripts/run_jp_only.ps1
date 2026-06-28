# JP 전용 수동 실행 — 15_RS_JP 병렬화 버전 검증/재실행용.
# run_rs_kr_jp.ps1 의 JP 단계만 미러링 (KR 제외). JP 는 ETF 화이트리스트 없음.

$ErrorActionPreference = "Continue"
$root = (Get-Item $PSScriptRoot).Parent.Parent.FullName   # s2_method
Set-Location $root
$log = Join-Path $PSScriptRoot "rs_jp_only.log"
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

"`n===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') rs_jp_only start (FETCH_WORKERS=$env:FETCH_WORKERS) =====" | Out-File -Append -Encoding utf8 $log

RunPy "3 15_RS_JP"   @($silent, "$qb\15_RS_JP_screen.py")
RunPy "5 export JP"  @("s2-trading-web\scripts\export_rs_weekly.py", "--market", "JP", "--weeks", "56", "--full-universe")
$env:GEMINI_MODEL = "gemini-2.5-pro"
RunPy "8 classify JP" @("s2-trading-web\scripts\classify_rs96_gemini.py", "--market", "JP", "--weeks", "1")

Log "===== rs_jp_only done ====="
