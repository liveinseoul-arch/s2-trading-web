# 15:45 장마감 후 — 캐시에 당일 EOD 저장 후 전구간 재계산 → Supabase + 텔레그램
$ErrorActionPreference = "Stop"
$root = (Get-Item $PSScriptRoot).Parent.Parent.FullName   # s2_method
Set-Location $root
$log = Join-Path $PSScriptRoot "eod.log"
"`n===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') eod =====" | Out-File -Append -Encoding utf8 $log
& C:\Python314\python.exe "main.py" --no-gsheets *>> $log               # 당일 EOD 캐시 갱신
$env:S2_TIME_STOP_DAYS = "15"                                          # 기간 손절 3주
$env:S2_SELL_TARGETS = "3,5,7"                                         # 분할매도 +3/+5/+7 (분봉 재검증 채택: 넓은목표는 되밀림 손절多)
# ★2026-08-09 채택 — MA120 위 진입분만 +3/+6.5/+10. 아래(진입의 약 65%)는 위 3/5/7 그대로.
#   되돌리기: 이 한 줄만 지우면 원복(게이트 미설정 = 전 포지션 3/5/7).
#   ★1차 3.0% 를 안 바꾼 것이 핵심 — p["stop"]=1차목표가 이므로 손절 무장 시점이 불변이고,
#     그 뒤 2·3차만 넓히는 것은 이익 확정 손절이 이미 걸린 상태라 하방 위험이 안 늘어난다.
#   운영 dry-run: 결정창(-2024) Calmar 0.5316→0.5598 · 전구간 0.9315→0.9813 · MDD -13.43→-13.38 (양 창 개선)
#   분봉 실현율(MA120 위) 88.3%→90.7% · 3단계 +10% 는 82.9%→92.0% (목표가상 체류 30분→200분)
#   근거: quant_infra/2026-08/KR_S2_COND_SELL_ADOPT_2026-08-09.md
$env:S2_SELL_TARGETS_ABOVE = "3,6.5,10"
$env:S2_SELL_STAGE_PCT = "0.333"                                       # 33/33/33 프론트로딩 (분봉 실현 +0.06%p·승률↑; 일봉 열세는 +7 낙관 착시)
$env:S2_ADD_DROP = "0.07"                                              # 추가매수 -7% (Calmar 1.13)
$env:S2_SIZE_ABOVE = "0.18"                                            # 120일선 위 사이즈 18% NAV
$env:S2_SIZE_BELOW = "0.09"                                            # 120일선 아래 사이즈 9% NAV
$env:S2_MAX_LEV = "1.2"                                                # 레버리지 1.2 (1.3→1.2, 필터와 함께 CAGR·Calmar 유지·마진부담↓)
$env:S2_ENTRY_MIN_RET5 = "-0.30"                                       # 낙주필터: 최근5일 -30%↓ 급락종목 진입 skip (CAGR +1.2%p·Calmar 0.85→0.89)
$env:S2_COSTS = "1"                                                    # 매수 0.015% / 매도 0.265% 적용
& C:\Python314\python.exe "s2-trading-web\scripts\export_eod.py" *>> $log  # executions/보유/거래/카운트/후보 적재
