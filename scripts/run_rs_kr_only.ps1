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
# ★★[2026-10-24 · CAND-2026-10-24-1 · ★해달별님 승인] ★정본 런처와 ★동기한다.
#   ★`run_rs_kr_jp.ps1:259`·`:317` · `run_rs_us.ps1:95` 가 ★이미 `=1` 이다.
#   ⚠️★게이트 기본값이 ★off 라 ★이 수동 런처는 ★swap 없이 돌았다
#     ⇒ ★적재가 실패하면 ★그 시장 3표가 ★빈 채로 남는다.
#   ★되돌리기 = ★이 줄을 지운다(한 줄).
$env:S2_RS_SWAP = "1"
RunPy "4 export KR"   @("s2-trading-web\scripts\export_rs_weekly.py", "--market", "KR", "--weeks", "56", "--full-universe")
RunPy "6 add KR ETFs" @("s2-trading-web\scripts\add_etfs.py", "--market", "KR", "--weeks", "56")
# ★★[2026-09-18 · 해달별님 지시] ★이 런처는 ★스케줄러 미등록 = ★수동용이다.
#   ★그래서 ★flash 를 쓴다 — ★pro 는 ★스케줄 3잡(S2_rs_kr_jp · S2_rs_us)에만.
#   ★급하면 — $env:GEMINI_MODEL="gemini-2.5-pro" 한 줄로 덮는다.
$env:GEMINI_MODEL = "gemini-2.5-flash"
RunPy "7 classify KR" @("s2-trading-web\scripts\classify_rs96_gemini.py", "--market", "KR", "--weeks", "1")

Log "===== rs_kr_only done ====="
