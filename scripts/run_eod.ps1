# 15:45 장마감 후 — 캐시에 당일 EOD 저장 후 전구간 재계산 → Supabase + 텔레그램
$ErrorActionPreference = "Stop"
$root = (Get-Item $PSScriptRoot).Parent.Parent.FullName   # s2_method
Set-Location $root
$log = Join-Path $PSScriptRoot "eod.log"
"`n===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') eod =====" | Out-File -Append -Encoding utf8 $log
& C:\Python314\python.exe "main.py" --no-gsheets *>> $log               # 당일 EOD 캐시 갱신
$env:S2_TIME_STOP_DAYS = "15"                                          # 기간 손절 3주
$env:S2_SELL_TARGETS = "3,5,7"                                         # 분할매도 +3/+5/+7 (분봉 재검증 채택: 넓은목표는 되밀림 손절多)
$env:S2_SELL_STAGE_PCT = "0.333"                                       # 33/33/33 프론트로딩 (분봉 실현 +0.06%p·승률↑; 일봉 열세는 +7 낙관 착시)
$env:S2_ADD_DROP = "0.07"                                              # 추가매수 -7% (Calmar 1.13)
$env:S2_SIZE_ABOVE = "0.18"                                            # 120일선 위 사이즈 18% NAV
$env:S2_SIZE_BELOW = "0.09"                                            # 120일선 아래 사이즈 9% NAV
$env:S2_MAX_LEV = "1.2"                                                # 레버리지 1.2 (1.3→1.2, 필터와 함께 CAGR·Calmar 유지·마진부담↓)
$env:S2_ENTRY_MIN_RET5 = "-0.30"                                       # 낙주필터: 최근5일 -30%↓ 급락종목 진입 skip (CAGR +1.2%p·Calmar 0.85→0.89)
$env:S2_COSTS = "1"                                                    # 매수 0.015% / 매도 0.265% 적용
& C:\Python314\python.exe "s2-trading-web\scripts\export_eod.py" *>> $log  # executions/보유/거래/카운트/후보 적재
