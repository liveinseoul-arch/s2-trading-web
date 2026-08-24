# 15:10 장마감 전 — 라이브 스냅샷으로 동시호가 신규 매수 후보 산출 → Supabase + 텔레그램
$ErrorActionPreference = "Stop"
$root = (Get-Item $PSScriptRoot).Parent.Parent.FullName   # scripts → s2-trading-web → s2_method
Set-Location $root
$log = Join-Path $PSScriptRoot "preclose.log"
"`n===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') preclose =====" | Out-File -Append -Encoding utf8 $log
& C:\Python314\python.exe "s2-trading-web\scripts\export_preclose.py" *>> $log
# ★★[2026-08-24 · CAND-2026-08-23-630] rc 를 로그에 남긴다(로그만 더한다 · ps1 rc 불변).
# ★★★[2026-08-24 신설 · CAND-2026-08-24-520] 아래 [RC] 줄을 ★try/catch 로 감싼다.
#   ★문제 — 이 ps1 은 `$ErrorActionPreference = "Stop"` 이라
#     ★맨몸 `Out-File` 이 ★새 ★중단 지점이다(디스크 가득 · 파일 잠김 · 경로 소실 · 권한).
#     ★★그 중단이 ★뒷 단계 ★앞에서 나면 ★그 단계가 통째로 안 돌고,
#     ★맨 끝에서 나면 ★성공한 실행이 ★rc=1 로 보인다 — ★둘 다 ★로그 한 줄 때문이다.
#   ★★해달별님 결정(2026-08-24) — ★`$ErrorActionPreference` 는 ★Stop ★유지하고
#     ★대신 [RC] 줄만 감싼다. ★근거 — export_eod.py 를 --dry-run 없이 돌리면
#     ★Supabase 9테이블을 ★전삭제 후 재적재한다. ★★중간에 죽는 것보다 ★안 시작하는 것이 안전하다.
#     ★즉 ★Stop 은 ★설계이고, ★고칠 것은 ★「로그가 새 중단 지점이 된 것」 하나다.
#   ⚠️★★rc 는 ★먼저 변수에 담는다 — ★try 안에 나중에 네이티브 호출이 끼면 ★값이 밀린다.
#   ★★ps1 의 자기 exit code 는 ★안 바뀐다 — ★로그만이다.
#   ★되돌리기 — 각 사이트에서 `$rc... = $LASTEXITCODE` · `try {` · `} catch { ... }` 세 줄을 지우고
#     [RC] 줄의 `$rc...` 를 `$LASTEXITCODE` 로 되돌린다(★다른 변경 없음).
#   근거: quant_infra/2026-08/OPS_RC_TRYCATCH_2026-08-24.md
$rcPre = $LASTEXITCODE
try {
"$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  [RC] export_preclose.py=$rcPre" | Out-File -Append -Encoding utf8 $log
} catch { Write-Host "[RC] 로그 기록 실패(export_preclose.py): $($_.Exception.Message)" }
# ★[2026-08-24 · 검토가 잡은 회귀 수리] ★맨몸 카나리아 — 위 [RC] 가 try/catch 안이라
#   ★로그 쓰기 실패를 ★삼킬 수 있다(rc 탐지 채널 1 → 0). ★이 줄로 ★그 채널을 되살린다
#   (run_eod.ps1 의 "===== eod done =====" 과 같은 설계 · 의도적으로 감싸지 않는다).
"$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  ===== preclose done =====" | Out-File -Append -Encoding utf8 $log
