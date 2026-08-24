#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""S2 트레이딩 따라하기 · EOD 익스포터 (Phase 1).

기존 검증 엔진(s2_candidates.reconstruct 로직 = 무비용·0버퍼 손절·최종 운용안)을 시작자본부터
전 구간 시뮬레이션해, 웹 서비스용 데이터를 산출하고 Supabase에 적재한다.

산출(테이블): executions · position_snapshots · nav_daily · trades · trade_legs ·
             monthly_stats · daily_order_plan(최신일) · meta

사용:
  python export_eod.py --dry-run            # Supabase 없이 로컬 CSV(_dryrun/) + 요약만
  python export_eod.py --end 2026-05-27     # 특정일까지 시뮬레이션
  python export_eod.py                       # 전체 재계산 후 Supabase upsert(멱등)

환경변수(적재 모드): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (../.env.local 의 KRX_* 와 별도)
경로: s2_method/ 의 config.py·backtest.py 를 import 하므로 부모 폴더가 sys.path 에 있어야 함(자동 처리).
"""
from __future__ import annotations
import argparse, os, sys, json
from datetime import date
from pathlib import Path
import pandas as pd

# 부모(s2_method) 폴더의 엔진 모듈 import
ROOT = Path(__file__).resolve().parents[2]      # .../s2_method
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))  # scripts/ (notify)
from config import Config                         # noqa: E402

# ══════════════════════════════════════════════════════════════════════════════
# ★★★S2_CA_ADJUST(운영 이식) — 기업행위(CA) 보유 리스케일 채널①. 기본 off.
#
#   사양서: quant_infra/2026-08/SPEC_S2_OPS_CA_TRANSPLANT_2026-08-24.md
#   `backtest.py`의 CA_MAP 로더(:176-206)·리스케일 로직(:442-474, 채널①)을 그대로
#   재사용한다 — 새 로더 없음, `backtest.py` 무변경(import만). 진입차단(ca_block,
#   채널②)은 이 이식의 범위 밖(CAND-2026-08-22-21 별건).
#
#   ⚠️★S2_CA_FROM 하한 강제 — opsDB 는 2019-03-08 이전이 이미 수정주가라
#   S2_CA_ADJUST=1 을 그 이전까지 적용하면 이중 보정된다(CLAUDE.md §2 금지 조합).
#   `backtest.py` 는 import 시점에 S2_CA_FROM 을 읽어 CA_MAP 을 굳히므로, 이 가드는
#   반드시 `from backtest import ...`(아래) **이전**에 실행돼야 한다.
#   ★하드 플로어다 — 미설정이면 안전 기본값을 자동 주입하고, 그보다 이른 값을 명시하면
#   자동 보정하지 않고 즉시 죽는다(SystemExit). §3-4 실측(현재 표본 이중보정 미발현)과
#   무관하게 구조적 위험을 코드로 원천 차단하는 것이 목적.
# ══════════════════════════════════════════════════════════════════════════════
# ★★★[2026-08-25 신설 · SPEC_DUAL_WORLD_2026-08-24 §5 · CAND-2026-08-24-660/-661]
#   ★dry-run 산출 격리 가드 — ★두 겹이다.
#
#   ①[좁은 겹 · 08-25 최초 신설] S2_CA_DB(병설 연구 통로)가 새는 것만 막는다.
#   ②[넓은 겹 · 08-25 확장 · 해달별님 지시 "①-660 의 넓은 위험을 지금 막아줘"]
#     ★어떤 실험이든 ★비표준 S2_* env 조합으로 `--dry-run` 을 돌리면 ★같은 문제다 —
#     ★기본 `_dryrun/` 를 덮으면 ★그 디렉터리를 ★나중에 사람이 `kw_watchloop.py
#     --plan-csv` 로 ★수동으로 읽을 수 있다(★실측 확인 — `--run` 과 `--plan-csv` 는
#     ★코드로 ★막혀 있지 않다 · `load_plan()` 이 두 모드에 ★공용이다). ★"둘 다 사람이
#     하는 수동 조작"이라 ★자동 위험은 아니지만 ★사람의 실수 사슬은 ★막을 수 있다.
#
#   ★★판별 — ★`run_eod.ps1` 을 ★★정본으로 삼아 ★런타임에 파싱한다(하드코딩 금지 —
#   ★목록이 바뀌면 ★가드가 저절로 따라온다). ★그 파일이 ★설정한 것과 ★현재 환경이
#   ★다르면(빠졌거나 · 값이 다르거나 · ★거기 없는 `S2_` 변수가 더 있거나) ★"비표준"이다.
#   ★★`--end` 가 ★오늘이 아닌 날짜로 명시돼도 ★비표준이다(★`run_eod.ps1` 은 `--end` 를
#   ★아예 안 쓴다 — ops-recheck 관례가 `--dry-run --no-notify --end <과거일>` 이다).
#
#   ⚠️★왜 탈출구가 없는가 — ★`S2_CA_DB` 가드와 같은 이유. ★opt-in env 는 ★재검정마다
#   설정하는 습관이 되면 ★무력화된다. ★물리적 분리(디렉터리)만 ★조건으로 쓴다.
#   ★이 블록은 ★반드시 `from backtest import` **이전**에 실행한다(§3 코딩함정과 동일).
def _canon_s2_env():
    """★run_eod.ps1 이 실제로 설정하는 S2_* 를 ★런타임에 파싱한다. ★정본은 그 파일이다."""
    import re
    ps1 = Path(__file__).resolve().parent / "run_eod.ps1"
    out = {}
    try:
        text = ps1.read_text(encoding="utf-8-sig")
    except Exception:                                             # noqa: BLE001
        return out                                                # ★못 읽으면 ★검사를 건너뛴다(가용성 우선)
    for m in re.finditer(r'^\$env:(S2_\w+)\s*=\s*(.+?)\s*(?:#.*)?$', text, re.M):
        name, rhs = m.group(1), m.group(2).strip()
        if rhs == "$null":
            out[name] = None                                      # ★반드시 ★비어 있어야 한다
        elif rhs.startswith('"') and rhs.endswith('"'):
            out[name] = rhs[1:-1]                                 # ★리터럴 — ★값까지 정확히 대조
        else:
            out[name] = "__ANY__"                                 # ★계산식(예: S2_ENV_DENS_MAP 경로) — ★존재만 확인
    return out


def _nonstandard_s2_env():
    """★현재 환경이 ★run_eod.ps1 정본과 ★다른 점을 ★사람이 읽을 문자열로 돌려준다. ★없으면 ''."""
    canon = _canon_s2_env()
    if not canon:
        return ""                                                 # ★run_eod.ps1 을 못 읽었다 — 판단 보류
    bad = []
    for name, expected in canon.items():
        cur = os.environ.get(name)
        if expected is None:
            if cur not in (None, ""):
                bad.append(f"{name}={cur!r}(정본=비움)")
        elif expected == "__ANY__":
            if not cur:
                bad.append(f"{name}=(비어있음)(정본=값 필요)")
        else:
            if cur != expected:
                bad.append(f"{name}={cur!r}(정본={expected!r})")
    extra = sorted(k for k in os.environ if k.startswith("S2_") and k not in canon
                   and k not in ("S2_CA_DB", "S2_DRYRUN_DIR"))     # ★이 둘은 ★의도된 연구 게이트
    if extra:
        bad.append(f"정본에 없는 S2_* {len(extra)}개: {extra}")
    return " · ".join(bad)


_is_dry = "--dry-run" in sys.argv
if _is_dry:
    _dr_dir = os.environ.get("S2_DRYRUN_DIR", "").strip()
    _isolated = bool(_dr_dir) and _dr_dir != "_dryrun" and not _dr_dir.rstrip("/\\").endswith("_dryrun")

    # ── ①좁은 겹 — S2_CA_DB ──
    if os.environ.get("S2_CA_DB", "").strip() and not _isolated:
        raise SystemExit(
            "[export_eod] S2_CA_DB 가 설정돼 있다 — ★운영 경로는 병설 세계를 쓰지 않는다. "
            "연구용 CA 세계는 kr_s2_engine.py 로만 검증할 것(SPEC_DUAL_WORLD_2026-08-24 §5). "
            "★예외 없음 — --dry-run 이고 S2_DRYRUN_DIR 가 기본값 밖으로 분리됐을 때만 통과한다.")

    # ── ②넓은 겹 — 비표준 S2_* 조합 또는 비표준 --end ──
    _end_val = None
    for _i, _a in enumerate(sys.argv):
        if _a == "--end" and _i + 1 < len(sys.argv):
            _end_val = sys.argv[_i + 1]
        elif _a.startswith("--end="):
            _end_val = _a.split("=", 1)[1]
    _end_nonstd = bool(_end_val) and _end_val != date.today().isoformat()
    _env_bad = _nonstandard_s2_env()
    if (_env_bad or _end_nonstd) and not _isolated:
        raise SystemExit(
            "[export_eod] ★비표준 설정으로 --dry-run 을 시도했다 — 기본 _dryrun/ 디렉터리를 "
            f"덮을 수 없다(CAND-2026-08-24-660 넓은 겹 · 2026-08-25). env 불일치: {_env_bad or '(없음)'}"
            f"{' · --end=' + _end_val + '(정본은 --end 미사용=오늘)' if _end_nonstd else ''}\n"
            "  → S2_DRYRUN_DIR 를 기본값(_dryrun) 밖으로 지정해 물리적으로 분리할 것. "
            "예: $env:S2_DRYRUN_DIR='_dryrun_실험이름'")
    if os.environ.get("S2_CA_DB", "").strip() or _env_bad or _end_nonstd:
        print(f"  ⚠️[world-guard] 비표준 설정 감지 · 격리 디렉터리 확인됨({_dr_dir}) — "
              f"★연구 용도로만 통과시킨다. ★Supabase·kw_watchloop 소비 금지 경로다.")

_CA_FLOOR = "2019-03-11"        # ★CLAUDE.md §2 금지 조합 하한 — opsDB 전용, 하드코딩
if os.environ.get("S2_CA_ADJUST", "0") == "1":
    _ca_from_env = os.environ.get("S2_CA_FROM", "").strip()
    if not _ca_from_env:
        os.environ["S2_CA_FROM"] = _CA_FLOOR         # 미설정이면 안전 기본값 자동 주입
    elif _ca_from_env < _CA_FLOOR:
        raise SystemExit(
            f"[export_eod] S2_CA_ADJUST=1 인데 S2_CA_FROM={_ca_from_env} 이 {_CA_FLOOR} 보다 이르다 — "
            f"opsDB 2019-03-08 이전 이중보정 금지 조합(CLAUDE.md §2). "
            f"S2_CA_FROM 을 {_CA_FLOOR} 이상으로 설정할 것.")

from backtest import _prepare, CA_ADJUST, CA_FROM, CA_MAP  # noqa: E402
from notify import telegram_send                  # noqa: E402

if CA_ADJUST:
    print(f"[CA-ops] S2_CA_ADJUST=1 · S2_CA_FROM={CA_FROM or '(미설정→위 가드가 주입했어야 함)'} · "
          f"사건 {len(CA_MAP):,}건 (채널① 보유 리스케일만 — 진입차단 채널②는 이식 안 함)")

# ★★[2026-08-24 · CAND-2026-08-22-19 관문] CA 리스케일 ★발동 카운터.
#   ⚠️★왜 필요한가 — 게이트를 켰는데 산출이 비트 동일하면 ★두 가지가 구별되지 않는다:
#     ①「보유가 CA 를 관통하지 않아 표적이 정말 0건」  ②「코드가 안 돌아 0건」.
#   ★CLAUDE.md §4-1b(2026-08-24 신설) — ★측정 도구가 없으면 「효과 없음」이 아니라 「모른다」다.
#   ★§4-2d 관문 2 와 같은 계열(사문 + 발동 카운터).
#   ★비용은 dict 하나 — 게이트 off 면 아무도 안 건드린다.
CA_N = {"hit": 0, "rescale": 0, "delist": 0, "seen_pos_day": 0}

# ── 운용안 상수 (s2_candidates 와 동일) ──────────────────────────────
MUSEOB = 0.80   # 음봉 스파이크 시 사이즈 × 0.8
PROX = 0.05                      # 예비후보 근접 허용폭(지지선 위 5%까지 포함)
MA_LONG, WINDOW, NL_AFTER = 120, 60, 2
MAX_LEV = float(os.environ.get("S2_MAX_LEV", "1.3"))   # 1.3=30% 대출 허용 / 1.0=대출없음(현금한도)

# ══════════════════════════════════════════════════════════════════════════════
# ★★★S2_COMBO_RS — S2 + RS96 **공유 자본풀** 게이트. 기본 off (2026-08-11 신설)
#
#   사양서: quant_infra/2026-08/SPEC_S2RS_SHARED_CAPITAL_OPS_2026-08-11.md (v0.2)
#   근거  : quant_infra/2026-08/KR_S2RS_COMBO_OPTIMUM_2026-08-10.md §13
#
#   ★해달별님 확정(2026-08-11): MDD −25% 허용 → **C 원장 · cap 0.4125 · 무차입**
#     결정창 실측 CAGR 42.9506 / MDD −21.5916 / Calmar 1.9892 (S2 단독 16.58 / −16.54)
#
#   ★설계 원칙 4가지 — 이것을 깨면 백테스트가 무효가 된다
#     1. RS 포지션은 **별도 dict(`rs_pos`)** 에 둔다. S2 루프는 `positions` 만 순회하므로
#        **RS 가 S2 규칙(추가매수·분할매도·신저가손절)을 타지 않는다.**
#     2. `cur_hv` 가 **양쪽을 합산**한다 → `nav_today`·`lev_ok` 에 RS 가 반영된다.
#     3. ★**하루 순서 = S2 먼저, RS 나중**(엔진 `unified_engine_t1.run():620-626` 과 동일).
#        `lev_ok`/현금이 자본을 제한하므로 **누가 먼저 사느냐가 곧 누가 체결되느냐**다.
#     4. ★`nav_today` 는 **장 시작 시 1회 확정**하고 하루 고정. S2 가 현금을 쓰든 말든
#        RS 사이징 분모는 안 바뀐다(엔진과 동일). 이것이 재현성의 핵심이다.
#
#   ★`rs_cap` 은 **하드캡이 아니라 「진입 직전 게이트」**다(SPEC §10-E).
#     진입 시점에 RS 익스포저가 cap 미만이면 산다. 이미 든 것은 평가익으로 cap 위로 자란다
#     (실측 회귀계수 b_rs 0.859 @ cap 0.40). ★**넘었다고 임의로 팔지 않는다.**
#
#   ★RS 사이징 w = shares × entry_price / (그 시점 RS 단독 자산)  ← SPEC §10-A (a) 원장 리플레이
#     엔진 `unified_engine_t1.py:312` 와 같은 식. **RS 단독 원장을 그대로 재생**한다.
#
#   ⚠️**off 재현 계약** — `S2_COMBO_RS` 미설정이면 `rs_pos` 가 영원히 비어
#     `cur_hv` 가 0 을 더하고 RS 단계가 통째로 skip 된다. → **9개 CSV 가 SHA256 까지 동일해야 한다.**
#     기준선: CAGR 13.12% / MDD −13.38% / 완결 456 (2026-08-11 봉인 · `_dryrun_base_combo/`)
#
#   ⚠️**Supabase 스키마 불변** — RS 포지션은 9개 테이블에 안 넣는다. `rs_positions.csv`(10번째)에만 쓴다.
# ══════════════════════════════════════════════════════════════════════════════
COMBO_RS = os.environ.get("S2_COMBO_RS", "0") == "1"
COMBO_RS_CAP = float(os.environ.get("S2_COMBO_RS_CAP", "0.4125"))   # ★채택 밴드 0.41–0.51 의 한 점
COMBO_RS_GLOB = os.environ.get(                                      # ★C 원장(현행 운영 = 변경량 0)
    "S2_COMBO_RS_GLOB",
    r"C:\QuantBacktest\screen\experiments\EXP-*kr16_C_live-KR\*result.xlsx")
COMBO_RS_LAG = int(os.environ.get("S2_COMBO_RS_LAG", "1"))           # ★SPEC §10-D 다음 거래일 체결

# ══════════════════════════════════════════════════════════════════════════════
# ★S2_CASH_PARK — 유휴현금 파킹 (2026-08-12 해달별님 아이디어 · 기본 off)
#
#   [왜] ★S2 는 결정창 2,210일 중 **1,749일(79.1%)을 전액 현금**으로 논다.
#        평균 주식 투입 3.78% · ★**평균 유휴현금 96.2%**.
#        그 현금을 단기채권 ETF 또는 RP 에 넣으면 NAV 가 오른다.
#        오버레이 근사 실측: ΔCalmar **+0.2261**(무차입) — 상세 `BOND_OVERLAY_2026-08-12.md`
#
#   [무엇을 하나] 일말에 **전일말 현금** x 그날 파킹자산 수익률을 `cash` 에 더한다.
#        ★전일말 기준이라 룩어헤드가 없다. 차입(cash<0)일 때는 파킹 0.
#
#   [★두 가지 수단 — 해달별님 확인 2026-08-12]
#        ETF : 매도대금으로 **당일 매수 가능** → LAG=0 · 매매비용 FEE 부과
#        RP  : 예수금이 **2일 뒤 현금**이 되어야 매수 가능 → LAG=2 · 매매비용 0
#        ★즉 「D+2 지연 손실」 vs 「매매비용 0 이득」의 교환이다.
#
#   [가격 소스] ⚠️★**DB 의 ETF 는 2019-03-08 에서 끊긴다**(2019-03-11 수집 경로 전환).
#        그래서 `quant_infra/data/kr_bond_etf/<티커>_*.csv` 를 읽는다. **DB 는 건드리지 않는다.**
#
#   ⚠️**off 재현 계약** — 미설정이면 `PARK_TK` 가 빈 문자열이라 파킹 블록이 통째로 skip.
#        → **9개 CSV 가 SHA256 까지 동일해야 한다.**
# ══════════════════════════════════════════════════════════════════════════════
PARK_TK  = os.environ.get("S2_CASH_PARK", "").strip()          # "" = off · 예 "153130"
PARK_LAG = int(os.environ.get("S2_CASH_PARK_LAG", "0"))        # 0=ETF(당일) · 2=RP(D+2)
PARK_FEE = float(os.environ.get("S2_CASH_PARK_FEE", "0.0005")) # 잔고 변화분 왕복 비용
PARK_DIR = os.environ.get("S2_CASH_PARK_DIR",
                          r"c:\AI파운더스\quant_infra\data\kr_bond_etf")


def load_park_returns(all_dates):
    """★파킹자산 일별 수익률 {date: ret}. 결측일은 0.0(휴장·미상장)."""
    import glob as _g
    hits = _g.glob(os.path.join(PARK_DIR, "%s_*.csv" % PARK_TK))
    if not hits:
        raise SystemExit("★S2_CASH_PARK=%s 의 CSV 를 %s 에서 못 찾았다" % (PARK_TK, PARK_DIR))
    d = pd.read_csv(hits[0])
    d["date"] = pd.to_datetime(d["date"]).dt.date
    d = d[["date", "close"]].dropna().sort_values("date").reset_index(drop=True)
    d["ret"] = d["close"].pct_change()
    m = dict(zip(d["date"], d["ret"]))
    out, hit = {}, 0
    for dt in all_dates:
        k = dt.date() if hasattr(dt, "date") else dt
        r = m.get(k)
        # ★날짜가 있으면 매칭이다 — 수익률이 정확히 0 인 날(단기채권에 흔하다)도 매칭이다
        if r is None or r != r:
            out[dt] = 0.0
        else:
            out[dt] = float(r); hit += 1
    lo, hi = min(m), max(m)
    # ★주문계획용 — 자산명·최신 종가·그 날짜를 전역에 남긴다(스키마 불변)
    global PARK_NAME, PARK_LAST_PX, PARK_LAST_D
    _b = os.path.basename(hits[0])
    PARK_NAME = _b[len(PARK_TK) + 1:-4].replace("_", " ") if _b.startswith(PARK_TK) else PARK_TK
    PARK_LAST_PX = float(d["close"].iloc[-1])
    PARK_LAST_D = hi
    print("  ★파킹 %s(%s) · ★날짜매칭 %d/%d일(%.1f%%) · 자산기간 %s..%s · 최신종가 %s원 · LAG=%d · FEE=%.4f%%"
          % (PARK_TK, PARK_NAME, hit, len(all_dates),
             hit / len(all_dates) * 100, lo, hi, format(round(PARK_LAST_PX), ","),
             PARK_LAG, PARK_FEE * 100))
    if hit < len(all_dates) * 0.9:
        print("  ⚠️★매칭률이 90%% 미만이다 — 파킹 수익이 과소평가된다. 자산 기간을 확인할 것")
    return out


PARK_NAME = PARK_TK
PARK_LAST_PX = 0.0
PARK_LAST_D = None
# (실험) 현금제약 시 매수 우선순위. none=기존순서 / rise2w=최근2주 순방향 최대상승폭 큰 순.
BUY_PRIORITY = os.environ.get("S2_BUY_PRIORITY", "none").lower()
RISE2W_WIN   = int(os.environ.get("S2_RISE2W_WIN", "10"))   # 2주 ≈ 10 거래일
# (실험) 낙주 진입필터 — 진입일 5거래일 수익률 < 임계면 진입 skip. None=off. (예: -0.30)
_emr = os.environ.get("S2_ENTRY_MIN_RET5", "")
ENTRY_MIN_RET5 = float(_emr) if _emr not in ("", "off") else None
# 낙주 처리 모드: skip=진입 제외(기본) / deep=진입가를 3차매수 등가로 더 낮춰 1차매수(저가 진입)
#              / deep_blend=deep 진입 + 매도목표를 (1·2·3차) 블렌드 평단 기준으로(상단 더 먹기)
KNIFE_MODE   = os.environ.get("S2_KNIFE_MODE", "skip").lower()
KNIFE_DEEP_N = int(os.environ.get("S2_KNIFE_DEEP_N", "2"))   # 몇 단계(−7%) 더 깊게. 2=3차매수가
# deep_blend 목표배수: 저가진입가 대비 (가상 1·2·3차) 블렌드 평단 비율 = 목표를 그만큼 상향
_add = float(os.environ.get("S2_ADD_DROP", "0.07"))
KNIFE_TGT_MULT = (sum((1 - _add) ** j for j in range(KNIFE_DEEP_N + 1)) / (KNIFE_DEEP_N + 1)) / (1 - _add) ** KNIFE_DEEP_N
# 낙주(deep) 전용 매도목표 — 설정 시 저가 진입가 기준 이 목표 사용(deep_blend 배수 무시). 예: "5,8,11"
_kt = os.environ.get("S2_KNIFE_TARGETS", "")
KNIFE_TARGETS = tuple(float(x) / 100 for x in _kt.split(",")) if _kt else None
# (실험) 잠재력 종목 차등 목표가 — rise2w >= 임계 종목에 넓은 목표 적용. off=전종목 기본 S.
POTENTIAL_TARGETS = os.environ.get("S2_POTENTIAL_TARGETS", "off").lower()   # 예: "3,6,10"
POTENTIAL_RISE    = float(os.environ.get("S2_POTENTIAL_RISE", "0.07"))       # rise2w 임계(7%)
_WIDE_T = (tuple(float(x) / 100 for x in POTENTIAL_TARGETS.split(","))
           if POTENTIAL_TARGETS != "off" else None)
# ── 운용 파라미터 (2026-07-18 확정) ─────────────────────────────────
# 매도목표 3/5/7, 추가매수 -7%, 사이징 18/9, 기간손절 3주. (구 운영값은 -10%/15%(7.5)·기간손절 없음)
# 개선의 핵심은 매도목표가 아니라 **기간손절+추가매수+사이징**이다:
#   설정                                   CAGR    MDD      Calmar   (11.9년, 비용 0.215%)
#   3/5/7 · -10% · 15/7.5 · 손절없음(구)   4.59%  -33.82%   0.14
#   3/5/7 · -7%  · 18/9  · 기간손절 15d   11.15% -11.95%   0.93   ← 채택
#   2/6/14· -7%  · 18/9  · 기간손절 15d   16.05% -11.55%   1.39   ← 일봉상 최고이나 기각(아래)
# 하위기간(3/5/7·신): 전반 6.4년 큰 개선, 후반 견조. MDD 개선은 기간손절 기여가 지배적(구조적).
#
# ⚠ 2/6/14 기각 사유 (2026-07-18, 분봉 실측): 일봉의 2/6/14 우위(16.05% vs 3/5/7 11.15%)는
#   "터치=체결" 가정에 의존한다. 전 보유기간 분봉 재생(갭하락 손절 반영) 결과 두 규칙은 거의
#   동률(+0.21%p)이고, 2/6/14 의 +14% 3차완결이 분봉에선 절반만 실현(고가 스침≠지정가 체결).
#   3/5/7 은 +7% 라 확실히 체결돼 실현 가능성이 높다. → 실현성 우위로 3/5/7 채택.
#   (상세: quant_infra/IDEAS.md "2/6/14 의 우위는 터치=체결 가정에 의존")
S = tuple(float(x)/100 for x in os.environ.get("S2_SELL_TARGETS", "3,5,7").split(","))
# ★조건부 매도 (2026-08-09 채택) — MA120 **위** 진입분에만 다른 목표를 준다. 아래는 S 그대로.
#   env S2_SELL_TARGETS_ABOVE (예: "4,7,12"). **미설정이면 None = off → 전 포지션이 S 를 쓴다(종전 동작 완전 동일).**
#   되돌리기: run_eod.ps1 에서 이 줄 한 줄만 지우면 원복된다.
#   근거: quant_infra/2026-08/KR_S2_ADDROP_SELLTARGET_2D_2026-08-09.md
#     결정 창(–2024) 프로덕션 무차입 Calmar 0.8810 → 1.1649 · 검증 2025 유지 ·
#     블록 부트스트랩 12/12 유의 · F4′ 분봉 실현율 −1.3%p(위 포지션 A 87.7% vs D 86.3%).
#   ★한국은 MA120 위 진입이 35.96% 로 미국(5.45%)의 6.6배라 이 분기가 실제로 작동한다.
_sa = os.environ.get("S2_SELL_TARGETS_ABOVE", "").strip()
S_ABOVE = tuple(float(x)/100 for x in _sa.split(",")) if _sa else None
# (종목, 매도차수) -> 목표 수익률. 텔레그램 감시주문 라벨을 포지션별 목표로 찍기 위한 것.
# Supabase 스키마를 건드리지 않으려고 plan dict 에 필드를 늘리는 대신 이 맵을 쓴다.
ORD_TGT_PCT = {}
# 추가매수 drop: 직전 매수가 × (1 - ADD_DROP). env S2_ADD_DROP (예: 0.10 = -10%)
#   ★2026-08-09 운영 0.07 → 0.10 (canonical 과 일치). 조건부 매도와 **함께** 바꿔야 한다 —
#    0.07 에서는 조건부 매도가 Calmar 를 깎는다(두 축이 회전율을 공유해 상충).
#   ⚠️`add_drop` 자체는 **튜닝 대상이 아니다** — 0.100 → 0.105 한 스텝에 MDD −11.42 → −20.75.
ADD_DROP = float(os.environ.get("S2_ADD_DROP", "0.07"))
MAX_BUY = int(os.environ.get("S2_MAX_BUY", "3"))   # 1차 포함 총 매수 횟수(기본3=추가매수 2회)
# 사이징 (NAV %) — 120일선 위 SIZE_ABOVE / 아래 SIZE_BELOW. 기본 0.18 / 0.09.
# env S2_SIZE_ABOVE / S2_SIZE_BELOW (예: 0.15 / 0.075 = 구 설정)
SIZE_ABOVE = float(os.environ.get("S2_SIZE_ABOVE", "0.18"))
SIZE_BELOW = float(os.environ.get("S2_SIZE_BELOW", "0.09"))

# ★★★[2026-08-24 신설 · CAND-2026-08-24-240 · 해달별님 지시] 유동성 참여율 상한 — ★비례 축소.
#   ★해달별님: *"참여율이 걸리면 투입금액을 비례하여 줄이는 형태로 가면 더 좋을 것 같은데."*
#   ★T1 채택본(`T1_LIQ_DEN=med20` · `T1_LIQ_REALLOC=1.5` · 2026-08-24 운영 반영)의 ★S2 이식이다.
#
#   [무엇을] 하루에 한 종목에 넣는 금액을 ★`PART_MAX x med20` 로 ★깎는다(★차단이 아니다).
#     `med20` = 그 종목의 ★20거래일 거래대금 ★중앙값(★당일 포함 · `min_periods=1`)
#     — ⚠️★canonical 격자(`_2026_08_24_s2_qualgate_grid.py:53`)와 ★같은 정의여야 재현된다.
#
#   [왜 차단이 아니라 축소인가] 차단은 그 거래의 손익을 ★통째로 없애는데 축소는 ★크기만 줄인다.
#     ★T1 실측 — 차단형이 아니라 축소형이라 ★CAGR 을 ★잃지 않았다(13.92 → 14.07%).
#     ★그리고 문턱 벼랑(49억과 51억이 전혀 다른 처치가 되는 불연속)이 ★사라진다.
#
#   [표적 실측 — 결정창 운영 원장 · 고정NAV 14.10억 · 문턱 3%]
#     ★유형 A `med20=0` ★16 leg(14.25억) = ★**거래정지 중 매수**(정지봉 종가로 진입 · ★체결 불가).
#       ★일부는 ★액면분할·인적분할 ★직전 정지구간이다(`017670` `086520` 은 ★CA 사건일 ★당일).
#     ★유형 B ★5 leg = 재개 직후 초희소봉(`232830` 참여율 ★3,351 – 4,722%).
#     ★합계 ★21 leg · 깎이는 총액 ★17.22억 / 총매수 661.78억 = ★**2.60%**.
#
#   [게이트] `S2_LIQ_PART_MAX`(기본 ★0 = off = 종전 비트 동일).
#     `S2_LIQ_LEGS` — `all`(기본 · 신규+추가) · `new`(신규만).
#     `S2_LIQ_REALLOC` — ★깎인 금액을 ★같은 날 ★비구속 종목에 재배분할 ★트랜치 배수 상한 M.
#       ★0(기본)=재배분 없음 · ★1.5=채택 권고(T1 과 같은 값).
#   ★되돌리기 — `S2_LIQ_PART_MAX` 를 지운다(= 0 = off).
LIQ_PART_MAX = float(os.environ.get("S2_LIQ_PART_MAX", "0") or 0)
LIQ_ON = LIQ_PART_MAX > 0
LIQ_LEGS = (os.environ.get("S2_LIQ_LEGS", "all").strip().lower() or "all")
LIQ_RA = float(os.environ.get("S2_LIQ_REALLOC", "0") or 0)
LIQ_RA_ON = LIQ_ON and LIQ_RA > 1.0
# ★발동 카운터 — §4-2d 관문 2. ⚠️「효과 없음」과 「코드가 안 돌았다」를 가른다.
LIQ_N = {"eval": 0, "cut": 0, "zero": 0, "ra_in": 0, "ra_out": 0}
_LIQ_MED = {}          # (ticker, "YYYY-MM-DD") -> med20 (원). LIQ_ON 일 때만 채운다.


def _liq_prepare(px):
    """★(ticker, date) → med20. ★LIQ_ON 일 때만 호출된다(off 면 dict 가 빈 채로 남는다).

    ⚠️★★[2026-08-24 정정 · 해달별님이 차트로 잡았다] ★★**정지봉을 거래일로 세면 안 된다.**
      ★초판은 `px` 전체로 rolling median 을 냈다. ★그러면 ★거래정지 구간이 길었던 종목의
      ★재개 첫날 `med20` 이 ★**0** 이 되어 ★상한도 0 = ★사실상 차단이 된다.
      ★★**실측 반례 — `017670` SK텔레콤 2021-11-29**:
        · 2021-10-26 – 11-26 ★정지봉 **24개**(OHLC=0 · close 309,500 고정 · vol=0)
        · ★2021-11-29 ★**재상장 첫날** — open 53,400 · low **50,000** · ★거래대금 **6,195억**
        ★즉 ★그날은 ★거래가 ★폭발한 날이고 ★0.91억은 ★충분히 살 수 있다.
        ★그런데 정지봉을 세면 직전 20봉 중 19개가 tv=0 이라 ★중앙값이 0 이 된다.
      ★★**따라서 ★거래가 있던 봉만으로 센다** — ★T1 채택본이 이미 그렇게 한다
        (`t1_method/backtest.py::_build_liq_map` — `v = v[v["volume"] > 0]`).
      ★`min_periods=1` 이라 ★유효봉이 20개 미만이어도 있는 것으로 계산한다
      (★상장 직후·재개 직후를 ★결측으로 흘리지 않는다 — 그게 이 게이트의 표적이다).
      ⚠️★**따라서 canonical 격자(`_2026_08_24_s2_qualgate_grid.py:53`)와 ★정의가 다르다** —
        그쪽은 정지봉을 포함한다. ★재현이 아니라 ★**정정이다**. 결과 md 에 그렇게 적는다.
    """
    v = px[px["trading_value"].fillna(0) > 0]        # ★거래가 있던 봉만(정지봉 제외)
    g = v.groupby("ticker")["trading_value"]
    med = g.transform(lambda s: s.rolling(20, min_periods=1).median())
    for tk, dd, m in zip(v["ticker"].to_numpy(), v["date"].to_numpy(), med.to_numpy()):
        _LIQ_MED[(tk, str(dd)[:10])] = 0.0 if m != m else float(m)
    # ★정지봉 날짜는 맵에 ★안 넣는다 → `_liq_cap_krw` 가 None(무제한)을 돌려준다.
    #   ★정지봉에 사는 것은 ★이 게이트가 아니라 ★유효봉 가드(VALID_BAR)의 몫이다 — 축이 다르다.
    print("[LIQ] 참여율 상한 on — PART_MAX=%.4f · LEGS=%s · REALLOC=%s · med20 맵 %d"
          % (LIQ_PART_MAX, LIQ_LEGS, LIQ_RA, len(_LIQ_MED)))


def _liq_cap_krw(tk, d):
    """★그 종목-일에 ★넣을 수 있는 최대 금액(원). ★off 면 None(무제한)."""
    if not LIQ_ON:
        return None
    m = _LIQ_MED.get((tk, str(d)[:10]))
    if m is None:
        return None                      # ★맵에 없으면 제한하지 않는다(보수적으로 종전 동작)
    return LIQ_PART_MAX * m

# --- (실험) 변동성 국면 사이징 — 기본 off. S2_VOL_SIZING=highvol|lowvol|linear ---
# KOSPI 추세 변동성(과거만) 기준으로 진입 사이즈 배수. look-ahead 방지 위해 확장중앙값 사용.
VOL_SIZING = os.environ.get("S2_VOL_SIZING", "off").lower()
VOL_MULT   = float(os.environ.get("S2_VOL_MULT", "1.3"))
VOL_WIN    = int(os.environ.get("S2_VOL_WIN", "20"))
_VOLMULT = {}
if VOL_SIZING != "off":
    try:
        import FinanceDataReader as _fdr
        _ks = _fdr.DataReader("KS11", "2013-01-01")["Close"]
        _vol = _ks.pct_change().rolling(VOL_WIN).std() * (252 ** 0.5)
        _med = _vol.expanding(min_periods=60).median()   # 그 시점까지의 중앙값(누수 없음)
        for _dt, _v in _vol.items():
            _me = _med.get(_dt)
            if _v != _v or _me is None or _me != _me or _me == 0:
                continue
            _hi = _v >= _me
            _ds = _dt.strftime("%Y-%m-%d")
            if VOL_SIZING == "highvol":
                _VOLMULT[_ds] = VOL_MULT if _hi else 1.0
            elif VOL_SIZING == "lowvol":
                _VOLMULT[_ds] = VOL_MULT if not _hi else 1.0
            elif VOL_SIZING == "linear":
                _VOLMULT[_ds] = max(0.5, min(2.0, _v / _me))
        print(f"[vol-sizing] {VOL_SIZING} mult={VOL_MULT} win={VOL_WIN} → {len(_VOLMULT)}일 로드")
    except Exception as _e:
        print(f"[vol-sizing] 로드 실패 → off: {_e}")
        VOL_SIZING = "off"
# KR 거래비용 — 매수 수수료 0.015% / 매도 수수료 0.015% + 세금 0.20% = 0.215%
#   매도 세금 0.20% = 증권거래세 0.05% + 농어촌특별세 0.15%
# 환경변수 S2_COSTS=1 일 때만 적용 (기본 0 = 비활성, 백테스트 비교 호환성 유지).
COSTS_ON = os.environ.get("S2_COSTS", "0") == "1"
BUY_FEE  = 0.00015
SELL_FEE = 0.00015 + 0.0020
BUY_MULT  = 1 + BUY_FEE  if COSTS_ON else 1.0
SELL_MULT = 1 - SELL_FEE if COSTS_ON else 1.0
# 매도 차수별 비중 — 1차/2차는 SELL_STAGE_PCT, 3차는 잔량(=1 - 2*SELL_STAGE_PCT).
# 기본 10/10/80. 환경변수 S2_SELL_STAGE_PCT 로 변경 가능 (예: 0.30 → 30/30/40).
SELL_STAGE_PCT = float(os.environ.get("S2_SELL_STAGE_PCT", "0.10"))

# ── ★N단계 매도 일반화 (2026-08-21 신설, 기본 off = 구 동작 비트 동일) ──────────
#   [왜] `CAND-2026-08-20-24`(스톱 래칫) 채택 — 1·2·3차는 물량을 소량만(각기 다른
#     비율로) 팔아 손절선만 끌어올리고, 마지막(4차)에서 잔량 대부분을 판다.
#     기존 구조는 "1·2차는 같은 비율, 마지막(3차 고정)은 잔량"만 표현 가능해
#     이 구조를 담을 수 없었다 — 매도 단계 수 자체가 코드 여러 곳에 3으로 박혀 있었다
#     (`for stg in range(...,4)` · `stg==3` · `SELL_STAGE_PCT` 단일 float).
#   [무엇을 하나] env `S2_SELL_STAGE_PCTS`(콤마구분, 마지막 단계 전까지의 비율만 적는다.
#     마지막 단계는 항상 잔량)가 설정되면 그 값들을 쓰고, ★미설정이면 종전 그대로
#     (SELL_STAGE_PCT, SELL_STAGE_PCT) = "1·2차 동일비중·3차 잔량"이라 off 재현이 보장된다.
#   [단계 수] `len(SELL_STAGE_PCTS) + 1` = N_STAGES. `S2_SELL_TARGETS`(그리고 설정돼
#     있다면 `S2_SELL_TARGETS_ABOVE`)의 목표가 개수가 반드시 N_STAGES 와 일치해야 한다
#     — 안 맞으면 조용히 잘못된 결과를 내는 대신 즉시 죽는다(사문 관문).
#   되돌리기: `S2_SELL_STAGE_PCTS` 를 지우면 한 줄로 구 3단계 동작이 복원된다.
_ssps = os.environ.get("S2_SELL_STAGE_PCTS", "").strip()
SELL_STAGE_PCTS = (tuple(float(x) for x in _ssps.split(","))
                   if _ssps else (SELL_STAGE_PCT, SELL_STAGE_PCT))
N_STAGES = len(SELL_STAGE_PCTS) + 1
if len(S) != N_STAGES:
    raise SystemExit(
        f"★S2_SELL_TARGETS 개수({len(S)})와 매도 단계 수 N_STAGES({N_STAGES}, "
        f"S2_SELL_STAGE_PCTS={SELL_STAGE_PCTS})가 다르다 — env 를 맞출 것")
if S_ABOVE is not None and len(S_ABOVE) != N_STAGES:
    raise SystemExit(
        f"★S2_SELL_TARGETS_ABOVE 개수({len(S_ABOVE)})와 매도 단계 수 N_STAGES({N_STAGES})가 다르다")
if N_STAGES != 3:
    print(f"[stage] ★N단계 매도 = {N_STAGES}단계 · 비중 {tuple(round(p*100,3) for p in SELL_STAGE_PCTS)}"
          f"% + 잔량 {round((1-sum(SELL_STAGE_PCTS))*100,3)}%")


def _stage_qty(stg, total_qty, remaining_qty):
    """stg 번째(1-base) 매도 물량. 마지막 단계(N_STAGES)면 잔량 전부,
    아니면 SELL_STAGE_PCTS[stg-1] 비율(반올림) — 잔량을 넘지 않게 min 으로 자른다.
    N_STAGES=3·SELL_STAGE_PCTS=(SELL_STAGE_PCT,SELL_STAGE_PCT) 이면 종전 로직과 완전 동일."""
    if stg >= N_STAGES:
        return remaining_qty
    return min(round(total_qty * SELL_STAGE_PCTS[stg - 1]), remaining_qty)
# 기간 손절 — N영업일 경과해도 분할매도 한 단계도 못 찍으면 강제 청산.
# 기본 15(≈3주). 화석 포지션을 끊어 자본 회전 ↑ — MDD 개선의 지배적 요인
# (2/6/14·-7% 만으론 MDD -28.8%, 기간손절 추가 시 -11.6%). 0 = 비활성(구 설정).
TIME_STOP_DAYS = int(os.environ.get("S2_TIME_STOP_DAYS", "15"))
# 기간 손절 기준 시점: "entry" = 1차 매수일 (기본·엄격) / "last_buy" = 마지막 매수일 (매수마다 reset·관대)
TIME_STOP_REF = os.environ.get("S2_TIME_STOP_REF", "entry").lower()
# 신저가 손절 트리거 기준: "intraday" = 그날 lo (장중) / "close" = 그날 cl (종가만)
NEWLOW_TRIGGER = os.environ.get("S2_NEWLOW_TRIGGER", "intraday").lower()

# ── ★분할매도 후 잔량 손절선 버퍼 (2026-08-18 신설, 기본 0 = 구 동작) ──────────
# 이 스크립트는 분할매도가 나면 손절선을 **그 단계 목표가 그대로**(마진 0) 잡아 왔다
# (구 :534 · :606 의 `p["stop"] = t[stg-1]`). 목표가에 정확히 지정가를 걸어 두고
# 그 가격에 100% 체결된다고 가정하는 셈이라 **낙관적**이다 — 실계좌 감시주문은
# 트리거 이후 시장가/추격으로 나가므로 슬리피지가 생긴다.
#   · canonical 엔진 kr_s2_engine.py:77 은 같은 자리에 DAYBUF = 0.01 을 두고 있다.
#   · 2026-08-18 분봉 실측: 모델 B(감시주문) 중앙 -0.5277% · B-prime 자기정합 -1.2241%
#     · 1분봉 부분표본 -0.3268% → 진값 구간 [-1.22%, -0.33%] 안에 1.0% 가 들어온다.
# 해달별님 결정: 백테스트와 **실계좌 스톱 양쪽에** 동일하게 적용한다.
#   → 그래서 시뮬 전용 지역변수가 아니라 **`p["stop"]` 대입 지점**을 고친다.
#     `p["stop"]` 은 시뮬(:513 익일 · :611 당일)과 감시주문 플랜(:849 trigger_price)이
#     **공유하는 단일 변수**라, 대입 한 곳을 고치면 백테스트와 실주문이 동시에 바뀐다.
# ⚠️ canonical 과 의미 범위가 다르다 — canonical DAYBUF 는 `sold_today` **당일 한정**이고
#    익일 이후 갈래(:405-412)는 마진 0 이다. 여기서는 대입 지점을 고치므로 **상시**다.
#    실계좌 감시주문은 마감 후에 세팅해 익일부터 도는 주문이라 「당일 한정」에 대응하는
#    실주문이 존재하지 않는다. 「양쪽 동일 적용」을 실주문까지 관철하려면 상시여야 한다.
# 기본 "0" = 구 동작 비트 동일(§4-5 관문 #2). 되돌리기: env 한 줄 삭제.
DAY_BUF = float(os.environ.get("S2_DAY_BUF", "0"))
# ★발동 카운터 (CLAUDE.md §4-1b 사문 관문 #2) — 「0건이라 효과가 없다」와
#   「코드가 안 돌아 0건이다」를 구분하기 위해 실제 실행 횟수를 센다.
#   assign = 손절선을 마진 적용해 설정한 횟수 · lower = 그중 실제로 값이 내려간 횟수
#   hit_buf = 마진이 걸린 손절선에서 청산된 건수 · hit_gap = 갭하락 시가 체결(마진 무관)
DAY_BUF_N = {"assign": 0, "lower": 0, "hit_buf": 0, "hit_gap": 0}
if DAY_BUF > 0:
    print(f"[day-buf] 손절선 = 매도단계 목표가 x (1 - {DAY_BUF:g}) · 호가단위 floor "
          f"(시뮬 + 감시주문 동시 적용)")

# ── ★★체결 현실성 마진 2단 — 추정 참여율 비례 슬리피지 (2026-08-18 신설, 기본 off) ─────
#
# [무엇을 고치나] DAY_BUF 는 **상수 마진**이라 「그날 그 종목이 얼마나 말랐는지」를 못 본다.
#   2026-08-18 매도 참여율 진단(288건): 중앙 0.179% · 최대 17.275% ·
#   5% 초과 5건이 전부 **그날 거래대금 50억 미만 구간**에 몰려 있다.
#   그 5건에서 상수 1.0% 마진은 실제 시장충격을 한참 못 덮는다.
#
# [해달별님 결정 — 안2] 마진 = **max(DAY_BUF, min(CAP, K x 추정참여율))**
#   DAY_BUF 를 「상수 마진」이 아니라 **「하한 마진」**으로 재해석한다.
#   K = 0 이면 max( ) 의 오른쪽이 0 이라 **구 동작과 비트 동일**이다(§4-5 관문 #2).
#
# ★★[룩어헤드 차단 — 이 설계의 핵심 제약]
#   참여율의 분모인 「그날 거래대금」은 감시주문을 세팅하는 시점(전날 마감 후)에
#   **알 수 없다**. 진단에서 쓴 참여율은 전부 사후값이므로 그대로 실주문에 걸면 룩어헤드다.
#   → 그래서 분모는 반드시 **전일까지의 값**만 쓴다. 여기서는
#     **직전 SLIP_WIN(기본 5) 거래일 거래대금의 중앙값**(전부 `shift(1)`)이다.
#   ★사전 분모 후보 21종 실측 비교(results/s2_slipest_design_2026-08-18.csv):
#     med5_guard 는 최악 5건을 288건 중 rank 17/1/5/14/8 (상위 5.9%) 안에 전부 넣고
#     오경보(추정 5% 이상인데 실제 1% 미만)가 **0건**이다.
#     min5·min20·p25_20 은 창에 마른 하루가 하나만 껴도 분모가 오염돼
#     006740(2023-11-06)에서 실제 0.04% 를 8.73%·21.11% 로 **200-500배 과금**한다.
#     med20 은 감쇠를 못 따라가 최악 1위를 rank 249 로 놓친다.
#
# ★★[권리락 이음매 가드 — 조율 파라미터가 아니다]
#   실제 참여율 1위 2022-06-02 · 278650 · 17.27% 는 **직전 거래일 종가 69,500 → 10,000**
#   (비율 0.1439 · 주식수 불변 = 1:6 무상증자 권리락) 뒤였다.
#   CLAUDE.md §3-4 대로 무상증자 권리락은 corporate_actions.db 에 구조적으로 못 들어온다.
#   → 직전 창 안에 **일간 종가비율이 [1-G, 1+G] 밖인 날**이 있으면 분모가 구 가격체계라
#     통째로 못 쓴다. 그럴 때만 분모를 min(직전창 거래대금 최소, 직전창 거래량 최소 x 계획가)
#     로 **강등**한다. 이 가드 하나로 1위 추정 rank 가 **251 → 17** 로 올라온다.
#   ★문턱 G 는 0.65·0.69·0.70 어디에 둬도 발동 건수가 12 로 동일하다(실측 분포에 공백).
#     4연속 하한가(비율 정확히 0.7000)에는 발동하지 않는다 — 진짜 유동성 붕괴와 CA 를 가른다.
#
# ★★[적용 범위 = 변형 C] 하한(DAY_BUF)은 **DAYBUF 경로만** · K 항은 **전 매도경로**.
#   근거: DAY_BUF 는 `sell_count >= 1` 을 요구해 **newlow_stop 26건을 구조적으로 한 건도
#   못 잡는다**. 그 26건은 매도액의 13.7% 뿐인데 **할인 기여 33.07%** 이고 참여율 중앙
#   0.6256% 로 전 경로 최고다. 게다가 사전 추정자가 그 구간에서 **오히려 더 잘 맞는다**
#   (pearson(log) 0.935 = 전 경로 최고). 참여율 5% 초과 5건 중 3건이 DAYBUF 밖이다.
#   → S2_SLIP_SCOPE=daybuf 로 변형 A(DAYBUF 경로만)도 돌릴 수 있게 축으로 남긴다.
#   ⚠️변형 B(하한도 전 경로)는 **후보에서 제외**했다 — K=0 에서 이미 125건이 변해
#     「K=0 이면 비트 동일」 계약을 위반한다.
#
# ★★[마진을 거는 지점 = 체결가(fill)이지 트리거가 아니다]
#   DAY_BUF 는 `p["stop"]` **대입 지점**을 고쳐 감시주문 trigger_price 까지 내렸다.
#   K 항은 그렇게 하지 않는다. 이유 2가지:
#     ① `p["stop"]` 은 분할매도가 난 **그 날** 한 번 정해지고 며칠 뒤에 트리거될 수 있다.
#        그 사이 유동성이 마르면 대입 시점의 추정치는 이미 낡은 값이다(진단 2의 「썩은 자격」).
#     ② K 항이 모형화하는 것은 **트리거 이후 시장가/추격 주문의 시장충격**이지
#        「지정가를 어디에 걸까」가 아니다. 트리거를 그대로 두면 손절 발동 (날짜,종목)
#        집합이 불변이라 §4-3 규칙4(사건정렬) 비교가 유효하게 남는다.
#   → 따라서 daily_order_plan.csv 의 trigger_price 는 **K 와 무관하게 불변**이다.
#     실계좌 주문은 종전(목표가 -1%) 그대로이고, 백테스트 체결가만 현실화된다.
#
# [수량 단위] 종목-일 **누적** 매도금액(이번 leg 포함)을 분자로 쓴다.
#   다단계 동시청산(최악 1위가 그것)에서 마지막 leg 이 그날 총액 기준 추정치를 받는다.
#   ⚠️완전한 「종목-일 배치 합산」은 아니다 — 앞 leg 은 자기까지의 누적만 본다.
#
# [반올림] 마진 적용 후 호가단위 **floor**(_stop_px 와 같은 이유 — 실효 마진이 항상 의도 이상).
# 되돌리기: env 한 줄(S2_SLIP_K) 삭제. → K=0 → 아래 모든 분기가 죽는다.
SLIP_K     = float(os.environ.get("S2_SLIP_K", "0"))        # ★0 = off (구 동작 비트 동일)
SLIP_WIN   = int(os.environ.get("S2_SLIP_WIN", "5"))        # 사전 분모 창(거래일) · 전부 shift(1)
SLIP_CAP   = float(os.environ.get("S2_SLIP_CAP", "0.03"))   # 마진 상한(무제한 금지 — decay 계열 반례)
SLIP_SCOPE = os.environ.get("S2_SLIP_SCOPE", "all").strip().lower()   # all=변형C · daybuf=변형A
SLIP_GUARD = float(os.environ.get("S2_SLIP_GUARD", "0.31"))  # 권리락 이음매 문턱(0 = 가드 off)
SLIP_ON    = SLIP_K > 0
SLIP_PATHS = ({"stop_stage"} if SLIP_SCOPE == "daybuf"
              else {"stop_stage", "sell", "newlow_stop", "time_stop"})
# ★발동 카운터 (CLAUDE.md §4-1b 사문 관문 #2) — 「0건이라 효과가 없다」와
#   「코드가 안 돌아 0건이다」를 구분한다. eval = 마진 계산을 시도한 매도 leg 수 ·
#   fire = 실제로 체결가가 내려간 leg 수 · flat = 계산했으나 호가단위상 변화 0 ·
#   cap = 상한에 걸린 수 · seam = 이음매 가드가 분모를 강등한 수 · nodenom = 분모 결측.
SLIP_N = {"eval": 0, "fire": 0, "flat": 0, "cap": 0, "seam": 0, "nodenom": 0,
          "disc": 0.0, "amt": 0.0, "est_max": 0.0, "m_max": 0.0,
          "f_stop_stage": 0, "f_sell": 0, "f_newlow_stop": 0, "f_time_stop": 0}
if SLIP_ON:
    print(f"[slip] 매도 마진 = max(DAY_BUF {DAY_BUF:g}, min(cap {SLIP_CAP:g}, "
          f"K {SLIP_K:g} x 추정참여율)) · 분모 = 직전 {SLIP_WIN}거래일 거래대금 중앙값"
          f"(shift(1)) · 이음매가드 {SLIP_GUARD:g} · 범위 {SLIP_SCOPE} "
          f"({'변형A DAYBUF경로만' if SLIP_SCOPE == 'daybuf' else '변형C 전 매도경로'})")

# ── ★유효봉 가드 (2026-08-07 이식, 기본 on — backtest.py 와 동일) ───────────────
# 이 스크립트는 backtest.simulate_ticker 를 쓰지 않고 **자체 시뮬레이션**을 돈다
# (상단에서 _prepare 만 import). 그래서 backtest.py 의 S2_VALID_BAR 가드가
# **전파되지 않았다.** 2026-08-07 감사에서 발견해 이식한다.
#
# 거래정지·무거래 봉은 o/h/l 이 0 으로 들어온다(stock_cache.db 전 구간 111,337행,
# 2026년만 16,412행 · 405종목 — 현재진행형). 그 봉에서:
#   ① `lo <= p["stop"]`      → 0 <= stop 이 항상 참 → **가짜 손절**
#   ② `lo <= at`             → 0 <= at 이 항상 참 → **가짜 추가매수**
#   ③ `_trigger_px < min_low`→ 0 < min_low 가 항상 참 → **가짜 신저가 손절**
#   ④ `min_low = min(min_low, lo)` → **min_low 가 0 에 영구 고정**
#      → 이후 ③ 이 영원히 거짓 → ★**그 포지션의 신저가 손절이 영구 비활성화된다**
#
# 정의는 backtest.py:351 과 동일하게 둔다. S2_VALID_BAR=0 으로 구 동작 복원 가능.
# 매도 경로(op >= t · hi >= t)는 0 이면 자연히 거짓이라 별도 가드가 필요 없다.
VALID_BAR = os.environ.get("S2_VALID_BAR", "1") == "1"
VB_SKIP = {"stop": 0, "add": 0, "newlow": 0, "minlow": 0}   # 가드가 실제로 막은 횟수

# ── ★유령 체결 가드 (CAND-2026-08-23-126 · 기본 off = 종전 동작 비트 동일) ──────
#
#   막는 것 — p["last_buy"] 가 **구 스케일**로 박제된 채 만들어지는 추가매수 트리거.
#   근거   — quant_infra/2026-08/S2_PHANTOM_FILL_CA_2026-08-23.md
#            086520(에코프로) 5:1 분할 재개일 2024-04-25 에 481,000원 x 42주가 찍혔다.
#            그날 고가는 115,400원 = 4.1681배. 다음 날 447,500원으로 연쇄한다.
#
#   ⚠️★이 다리는 **다음 거래일 주문**이다 — 「그날 저가·고가」를 주문 시점에 알 수 없다.
#     그래서 판정에 **당일 봉을 쓰지 않는다.** 주문 시점에 있는 것 둘로만 판정한다:
#       A. 스케일 정합 — trigger / **직전 유효봉 종가** > PH_MAXR
#       B. 정지 재개  — 직전 봉이 **무효봉**(o/h/l=0)으로 PH_HALT 일 이상 연속
#
#   ⚠️★「주문가가 그날 [저가, 고가] 밖」은 **쓰면 안 된다** — 실측 유령 19건 중
#     15건(78.9%)이 **갭하락**이고 그것은 CLAUDE.md §8-1 규약 A 가 의도한 보수 기록이다.
#
#   S2_PHANTOM_GUARD = off(기본) | warn | block
#   S2_PHANTOM_MAXR  = 3.00   (배수 문턱. ★2026-08-24 재산정 · CAND-2026-08-24-201)
#     ⚠️★왜 1.30 이 아닌가 — 하한가(-30%) 다음날 트리거는 제도가 만드는 하한으로도
#       ratio_ref = ADD_DROP 잔존율(0.93) ÷ 0.70 = **1.3286** 이 되어 ★기본값 1.30 을
#       이미 넘는다(조율 파라미터가 아니라 산술이다). k 일 연속 하한가면
#       ratio_ref(k) = 0.93 / 0.70^k — 1일 1.3286 · 2일 1.8980 · 3일 2.7114 ·
#       4일 3.8734. ★실측 유령 사건(086520 5:1 분할)의 ratio_ref 는 4.0056·4.1397 로
#       4일 연속 하한가보다도 높다. ★재계량(2026-08-24 · results/
#       s2_ghostfill_target_2026-08-24_v2.csv 를 MAXR 스윕) — 결정창 표본에서 MAXR 을
#       1.25 – 4.0055 어디에 두어도 검출 2건(둘 다 진짜 유령)·정상(봉 안) 오탐 0건으로
#       ★동일하다(무변화 밴드). 그중 3.00 은 3일 연속 하한가(2.7114)를 10.6% 여유로
#       덮고 실측 유령 사건(4.0056)보다는 25.1% 낮다 — 4일 이상 연속 하한가는 그 자체가
#       실측 유령 사건과 구별이 어려워지므로(3.8734 vs 4.0056) 더 올리지 않았다.
#       ⚠️단 이 문턱은 검사 A(스케일) 전용이다 — 검사 B(정지 재개)는 ERA 게이트로 별도 관리.
#   S2_PHANTOM_HALT  = 1      (직전 정지봉 연속일 문턱. 0 이면 검사 B off)
#   S2_PHANTOM_RC    = 0      (1 이면 발동 시 종료코드 9. ⚠️기본 0 — EOD 체인을 세우지 않는다)
#   S2_PHANTOM_ERA   = ""     (빈 값 = 전 구간. 날짜를 넣으면 ★검사 B 를 그 날부터만 건다)
#     ⚠️★왜 필요한가 — 검사 B(정지 재개)는 「정지 중에 스케일이 바뀌었을 수 있다」의 ★대리
#       지표다. 그런데 이 DB 는 ★2019-03-08 이전이 ★이미 수정주가라(CLAUDE.md §3 무결성 1)
#       그 구간의 재개일에는 ★스케일이 안 튄다. 실측 — 018290 2016-01-08(13일 정지 후 감자·
#       병합 재개)에서 트리거 5,130 이 그날 봉 [4,707 – 7,166] ★안에 있었는데 검사 B 가 막아
#       ★CAGR 13.82 → 13.41%(−0.41%p)를 냈다.
#       ⚠️★[2026-08-24 정정 · CAND-2026-08-24-200] 종전 이 자리의 「즉 이 경계는 조율
#       파라미터가 아니라 데이터 출처 사실이다」는 ★틀렸다 — opsDB 는 2019-03-11 ★이전도
#       원주가 67.8%(362/534)라 그 구간에서도 스케일이 튄다. 018290 은 수정주가 쪽
#       32.2%(172건)에 우연히 속한 ★n=1 사례다. ★즉 이 경계는 ★「이 창에서 오탐 비용을
#       0 으로 만드는 사후 축」이지 「원리적 근거」가 아니다 — quant_infra/2026-08/
#       S2_GHOSTFILL_GATE_2026-08-24.md §5-c.
PH_MODE = os.environ.get("S2_PHANTOM_GUARD", "off").strip().lower()
PH_MAXR = float(os.environ.get("S2_PHANTOM_MAXR", "3.00"))
PH_HALT = int(os.environ.get("S2_PHANTOM_HALT", "1"))
PH_ERA = os.environ.get("S2_PHANTOM_ERA", "").strip()
PH_RC = os.environ.get("S2_PHANTOM_RC", "0") == "1"
PH_N = {"plan_scale": 0, "plan_halt": 0, "fill_scale": 0, "fill_halt": 0}
# ★CAND-2026-08-24-202 — 「검사 통과」(위 PH_N)와 「실제 차단」을 분리해서 센다.
#   ⚠️검사 B(정지 재개)는 정지 기간 내내 매일 발동하지만 그 날들은 대개 무효봉이라
#   VALID_BAR 가 이미 체결을 막고 있다 — 판정을 실제로 바꾸는 것은 재개 첫날뿐이다.
#   PH_N 만 읽으면 「발동 45건」을 위험 규모로 오인한다(실측 · 실제 차단 1건 = 2.2%).
PH_ACTUAL = {"plan_scale": 0, "plan_halt": 0, "fill_scale": 0, "fill_halt": 0}
PH_LOG = []          # (site, d, ticker, reason, trigger, ref, value)


def _phantom(p, trig, d, site, prev=False, would_fire=False):
    """주문 시점 정보만으로 유령 트리거를 판정한다. -> (막을까, 사유, 값)

    ⚠️당일 봉(o/h/l/c)을 **보지 않는다**. 다음날 주문이라 알 수 없기 때문이다.
    ★결측이면 발동하지 않는다(fail-open) — EOD 를 세우는 쪽이 더 비싸다(§4-5 ④).

    prev=True  원장 측(simulate) — 그 주문은 **어제 저녁에** 냈다. 그래서 어제까지의
               기준값(`ph_ref`·`ph_halt`)만 본다. ⚠️`ref_close`/`halt_n` 은 오늘 봉으로
               이미 갱신돼 있어 그것을 쓰면 **당일 종가를 미리 보는 것**이 된다.
    prev=False 주문 측(build_order_plan) — 마지막 처리일까지의 값이 곧 「어제」다.

    would_fire ★CAND-2026-08-24-202 — 이 가드가 없었다면 이 주문/체결이 실제로
               났을까를 ★호출부가 판단해서 넘긴다(bar_ok·lo<=at·기존 skip 여부는
               이 함수가 모른다). PH_MODE=="block" 이고 이 값이 True 일 때만
               PH_ACTUAL 을 올린다 — 「검사를 통과했다」(PH_N)와 「실제로 무언가를
               막았다」(PH_ACTUAL)를 가른다.
    """
    if PH_MODE == "off" or not trig or trig <= 0:
        return (False, "", 0.0)
    if prev:
        n_halt = int(p.get("ph_halt", 0) or 0)
        ref = float(p.get("ph_ref") or 0.0)
    else:
        n_halt = int(p.get("halt_n", 0) or 0)
        ref = float(p.get("ref_close") or 0.0)
    if PH_HALT and n_halt >= PH_HALT and (not PH_ERA or str(d) >= PH_ERA):   # 검사 B - 정지 재개
        PH_N[site + "_halt"] += 1
        if would_fire and PH_MODE == "block":
            PH_ACTUAL[site + "_halt"] += 1
        PH_LOG.append((site, str(d), p.get("tk"), "halt", trig, None, float(n_halt)))
        return (PH_MODE == "block", "halt", float(n_halt))
    if ref > 0 and trig / ref > PH_MAXR:                   # 검사 A - 스케일 정합
        PH_N[site + "_scale"] += 1
        if would_fire and PH_MODE == "block":
            PH_ACTUAL[site + "_scale"] += 1
        PH_LOG.append((site, str(d), p.get("tk"), "scale", trig, ref, trig / ref))
        return (PH_MODE == "block", "scale", trig / ref)
    return (False, "", 0.0)

MKT = {"KOSPI": "KS", "KOSDAQ": "KQ"}


# ── 호가단위 (KRX 2023-01-25 개정) ──────────────────────────────────
# 지정가 주문·체결은 호가단위의 배수여야 한다. 목표가/체결가를 이 단위로 맞춘다.
def _tick(price):
    p = float(price)
    if p < 2000:    return 1
    if p < 5000:    return 5
    if p < 20000:   return 10
    if p < 50000:   return 50
    if p < 200000:  return 100
    if p < 500000:  return 500
    return 1000


def _to_tick(price, mode="round"):
    """price 를 호가단위로. mode: round(반올림)/ceil(올림)/floor(내림)."""
    t = _tick(price)
    import math
    if mode == "ceil":
        return int(math.ceil(price / t) * t)
    if mode == "floor":
        return int(math.floor(price / t) * t)
    return int(round(price / t) * t)


def _stop_px(target_px):
    """분할매도 후 잔량 손절선 = 그 단계 목표가에서 DAY_BUF 만큼 아래.

    ★반올림 순서 — **마진을 먼저 적용하고 그 다음에 호가단위로 내림**한다.
      ① 마진 먼저 : 실계좌 지정가·감시주문은 호가단위의 배수여야 접수된다
         (KRX 호가단위 · supabase/schema.sql:56 `trigger_price bigint`).
         `t[stg-1]` 은 이미 tick 정렬돼 있지만 거기에 0.99 를 곱하면 배수가 깨진다
         (예 168,500 x 0.99 = 166,815 → 100원 단위 위반 → **주문 거부**).
         따라서 tick 정렬은 반드시 **마진 적용 뒤**에 와야 한다.
         tick 폭 자체도 가격대에 따라 달라지므로(_tick) 정렬 대상은 최종 주문가여야 맞다.
      ② round 가 아니라 floor : round 는 마진을 의도한 DAY_BUF **미만으로 되돌릴 수 있다**
         (예 100,500 x 0.99 = 99,495 → round 99,500 = 마진 0.995% · floor 99,400 = 1.094%).
         floor 면 실효 마진이 항상 DAY_BUF **이상**이고, 백테스트 쪽에서도 체결가가
         더 낮아지는 방향이라 **보수적**이다(성과를 부풀리지 않는다).

    DAY_BUF = 0 이면 입력을 **그대로** 돌려준다 — 구 동작 비트 동일 보장.
    (0 이어도 floor 결과는 같지만, 부동소수 경로를 아예 타지 않게 조기 반환한다.)
    """
    if DAY_BUF <= 0:
        return target_px
    out = _to_tick(target_px * (1 - DAY_BUF), mode="floor")
    DAY_BUF_N["assign"] += 1
    if out < target_px:
        DAY_BUF_N["lower"] += 1
    return out


def _slip_prepare(px):
    """★사전 분모 컬럼 2개를 px 에 붙인다 (SLIP_ON 일 때만 호출 — off 면 컬럼 자체가 안 생긴다).

    `_slip_den`  : 직전 SLIP_WIN 거래일 거래대금 **중앙값**(shift(1) — 오늘 미포함).
                   ★이음매 행에서는 **직전 창 거래대금 최소**로 강등해 둔다.
    `_slip_vmin` : 평시 NaN. ★이음매 행에서만 직전 창 **거래량 최소**.
                   체결 시점에 `min(_slip_den, _slip_vmin x 계획가)` 로 합쳐 쓴다
                   (권리락은 가격체계가 바뀌므로 원화 분모가 통째로 못 쓰게 된다 —
                    거래량 x 오늘 계획가로 원화 분모를 재구성하는 갈래를 함께 본다).

    ⚠️전부 `shift(1)` 이다. 오늘 거래대금은 감시주문 세팅 시점에 알 수 없다(룩어헤드).
    """
    px = px.sort_values(["ticker", "date"]).reset_index(drop=True)
    _tk = px["ticker"]
    _tvp = px.groupby("ticker", sort=False)["trading_value"].shift(1)
    _den = _tvp.groupby(_tk, sort=False).transform(
        lambda s: s.rolling(SLIP_WIN, min_periods=1).median())
    _tvmin = _tvp.groupby(_tk, sort=False).transform(
        lambda s: s.rolling(SLIP_WIN, min_periods=1).min())
    if "volume" in px.columns:
        _vp = px.groupby("ticker", sort=False)["volume"].shift(1)
        _vmin = _vp.groupby(_tk, sort=False).transform(
            lambda s: s.rolling(SLIP_WIN, min_periods=1).min())
    else:                                   # 정상 경로에는 항상 volume 이 있다(data_source.py:136)
        _vmin = pd.Series(float("nan"), index=px.index)
    if SLIP_GUARD > 0:
        _ratio = px["close"] / px.groupby("ticker", sort=False)["close"].shift(1)
        _seamf = ((_ratio < 1 - SLIP_GUARD) | (_ratio > 1 + SLIP_GUARD)).astype(float)
        # 직전 SLIP_WIN 일 안에 이음매가 하나라도 있으면 그 창의 분모는 구 가격체계다
        _seam = _seamf.groupby(_tk, sort=False).transform(
            lambda s: s.shift(1).rolling(SLIP_WIN, min_periods=1).max()).fillna(0.0) > 0
    else:
        _seam = pd.Series(False, index=px.index)
    px["_slip_den"] = _den.where(~_seam, _tvmin).astype(float)
    px["_slip_vmin"] = _vmin.where(_seam, float("nan")).astype(float)
    print(f"  [slip] 사전 분모 산출 {len(px):,}행 · 이음매 가드 행 {int(_seam.sum()):,}개 "
          f"(창 {SLIP_WIN}일 · 문턱 {SLIP_GUARD:g})", flush=True)
    return px


def _slip_fill(p, r, d, base_px, qty, buf_applied, path):
    """★추정 참여율 비례 슬리피지를 **체결가에만** 적용한다(트리거·수량 불변).

    반환 = 실제 체결가. off(K=0)이거나 경로가 범위 밖이면 `base_px` 를 **그대로** 돌려준다.

    `buf_applied` = 이 체결가에 **이미 박혀 있는 마진**. DAYBUF 손절선(p["stop"])에서
      체결될 때만 DAY_BUF 이고, 갭하락 시가 체결·목표가 매도·종가 청산은 0 이다.
      max(DAY_BUF, m) = DAY_BUF + max(0, m - DAY_BUF) 이므로 **초과분만** 더 깎는다.
    """
    if not SLIP_ON or path not in SLIP_PATHS or qty <= 0 or base_px <= 0:
        return base_px
    SLIP_N["eval"] += 1
    if p.get("_slip_d") != d:                       # 종목-일 누적 매도금액(이번 leg 포함)
        p["_slip_d"] = d
        p["_slip_amt"] = 0.0
    amt = p["_slip_amt"] + base_px * qty
    p["_slip_amt"] = amt
    den = r.get("_slip_den")
    vmin = r.get("_slip_vmin")
    if vmin is not None and vmin == vmin and vmin > 0:      # NaN 아님 = 이음매 가드 행
        _alt = vmin * base_px
        den = _alt if (den is None or den != den or den <= 0) else min(den, _alt)
        SLIP_N["seam"] += 1
    if den is None or den != den or den <= 0:               # 분모 결측 → 하한만(=K 항 0)
        SLIP_N["nodenom"] += 1
        return base_px
    est = amt / den
    m = SLIP_K * est
    if m > SLIP_CAP:
        m = SLIP_CAP
        SLIP_N["cap"] += 1
    SLIP_N["est_max"] = max(SLIP_N["est_max"], est)
    SLIP_N["m_max"] = max(SLIP_N["m_max"], m)
    extra = m - buf_applied
    if extra <= 0:                                          # 하한(DAY_BUF)이 이긴다
        return base_px
    out = _to_tick(base_px * (1 - extra), mode="floor")
    if out >= base_px:                                      # 호가단위 해상도상 변화 없음
        SLIP_N["flat"] += 1
        return base_px
    SLIP_N["fire"] += 1
    SLIP_N["f_" + path] += 1
    SLIP_N["disc"] += (base_px - out) * qty
    SLIP_N["amt"] += base_px * qty
    return out

# ── 체결시각 캐시 (2b) ──────────────────────────────────────────────
# 크레온 분봉으로 복원한 체결시각. 키=(ticker, 'YYYY-MM-DD', leg_type, round(price)) → 'HH:MM'.
# trade_legs 는 매일 전삭제·재적재되므로 DB 백필은 유지 안 됨 → export 가 매번 이 캐시에서 조회.
# 캐시에 없으면(2024 이전·신규 거래) None. 갱신: scratchpad/hhmm_build_cache.py + 크레온 분봉.
_HHMM = {}
try:
    _hp = Path(__file__).with_name("hhmm_cache.pkl")
    if _hp.exists():
        import pickle as _pk
        _HHMM = _pk.load(open(_hp, "rb"))
except Exception as _e:
    print(f"[hhmm] 캐시 로드 실패(무시): {_e}")


def _hhmm(ticker, d, leg_type):
    # 키=(ticker, date, leg_type). 같은날 같은 leg_type 은 유일하므로 가격 불필요(반올림 오차 회피).
    return _HHMM.get((str(ticker), str(d), leg_type))


def load(cfg: Config, end: date, start: date | None = None):
    """전 구간 px(지표 포함) + 이름/시장 맵 + 스파이크 맵 로드.

    ★`start` (2026-08-12 신설 · 기본 None = 종전과 완전 동일)
      시뮬레이션 **시작일**을 자른다. 재현 검증용 「스모크 창」(`smoke.py` SMOKE_A)을
      운영 익스포터에서도 만들 수 있게 하기 위한 것이다.
      ⚠️★**지표(MA20 · ma_long · 스파이크 맵)는 전 구간으로 계산한 뒤 잘라낸다** —
        먼저 자르면 워밍업이 사라져 다른 시스템이 된다.
      ★`--start` 를 주지 않으면 이 블록이 통째로 건너뛰어져 **한 줄로 구 동작이 복원**된다.
    """
    # days: 기본 4000(~11년). 환경변수 S2_LOOKBACK_DAYS 로 늘릴 수 있음 (예: 5000 ≈ 13.7년).
    days = int(os.environ.get("S2_LOOKBACK_DAYS", "4000"))
    px, nmap, mmap, period_start, meta = _prepare(cfg, days=days, end_date=end, fetch=False)
    px = px.sort_values(["ticker", "date"]).reset_index(drop=True)
    px["ma_long"] = px.groupby("ticker")["close"].transform(
        lambda s: s.rolling(MA_LONG, min_periods=MA_LONG).mean())
    thr = cfg.min_trading_value_krw
    sm, smy = {}, {}
    for tk, g in px.groupby("ticker"):
        ds = g["date"].tolist(); tv = g["trading_value"].tolist()
        op = g["open"].tolist(); cl = g["close"].tolist(); last = -10**9; ly = None
        for k in range(len(ds)):
            if pd.notna(tv[k]) and tv[k] >= thr:
                last = k; ly = bool(cl[k] > op[k])
            within = (k - last) < WINDOW
            sm[(tk, ds[k])] = ds[last] if within else None
            smy[(tk, ds[k])] = ly if within else None
    # ★시작일 절단 — 지표를 전부 계산한 **뒤에** 한다(위 주석 참조)
    if start is not None:
        _n0 = len(px)
        # ⚠️★`px["date"]` 는 **`datetime.date`** 다(Timestamp 아니다). 섞어 비교하면
        #   `TypeError: Cannot compare Timestamp with datetime.date` 로 죽는다(2026-08-12 실측).
        #   ★`period_start` 도 같은 타입이어야 한다 — :526 에서 `r["date"] >= period_start` 로 쓴다.
        px = px[px["date"].map(
            lambda d: (d.date() if hasattr(d, "date") else d) >= start
        )].reset_index(drop=True)
        if px.empty:
            raise ValueError(f"--start {start} 로 자르니 남는 행이 0개다")
        _first = px["date"].min()          # ★px 는 ticker 정렬이라 iloc[0] 이 아니라 min()
        if _first > period_start:
            period_start = _first
        print(f"[--start] 시뮬레이션 시작일 절단 {start} — 행 {_n0:,} → {len(px):,} · "
              f"period_start {period_start} · ★지표는 전 구간으로 계산됨")
    return px, nmap, mmap, period_start, sm, smy


def load_rs_ledger(all_dates):
    """★S2_COMBO_RS 전용 — RS96 단독 원장(xlsx)에서 진입·청산 이벤트를 읽는다.

    엔진 `unified_engine_t1.py:303-318` 과 **같은 식**이다:
        w = shares × entry_price / (진입 시점 RS 단독 자산)
    반환 (entries, exits)
        entries: {체결일(date) -> [(ticker, exit_date, w), ...]}
        exits  : {ticker -> exit_date}  (진입 시 포지션에 박아 둔다)

    ★`COMBO_RS_LAG` 만큼 **다음 거래일로 민다**(SPEC §10-D — 금 판정 → 월 종가 체결).
      lag=0 이면 엔진과 완전 동일(백테스트 대조용).
    """
    import glob as _glob
    hits = sorted(_glob.glob(COMBO_RS_GLOB))
    if not hits:
        raise FileNotFoundError(f"[S2_COMBO_RS] RS 원장 없음: {COMBO_RS_GLOB}")
    xl = pd.ExcelFile(hits[-1])
    tr = xl.parse("KR_거래")
    eq = xl.parse("KR_자산")
    eq["date"] = pd.to_datetime(eq["date"])
    eqs = pd.Series(eq["equity"].values, index=eq["date"]).sort_index()
    tr["entry_date"] = pd.to_datetime(tr["entry_date"])
    tr["exit_date"] = pd.to_datetime(tr["exit_date"])
    # ticker 정규화 — 엔진 _norm 과 같은 규칙(6자리 zero-pad, 접미사 제거)
    tr["tk"] = tr["ticker"].astype(str).str.split(".").str[0].str.zfill(6)

    def _eq_at(dt):
        s = eqs[eqs.index <= dt]
        return float(s.iloc[-1]) if len(s) else float("nan")

    tr["eq_e"] = tr["entry_date"].map(_eq_at)
    tr["w"] = tr["shares"] * tr["entry_price"] / tr["eq_e"]

    dl = [pd.Timestamp(d) for d in all_dates]                 # 거래일 인덱스(체결일 매핑용)
    ent, n_lag, n_drop = {}, 0, 0
    for r in tr.itertuples():
        w = float(r.w) if pd.notna(r.w) else 0.05             # 엔진과 동일한 기본값
        nxt = [x for x in dl if x >= r.entry_date]
        if not nxt:
            n_drop += 1
            continue
        i = dl.index(nxt[0]) + COMBO_RS_LAG                   # ★lag 거래일 뒤로
        if i >= len(dl):
            n_drop += 1
            continue
        if COMBO_RS_LAG:
            n_lag += 1
        ent.setdefault(dl[i].date(), []).append((r.tk, r.exit_date.date(), w))
    print(f"[S2_COMBO_RS] 원장 {os.path.basename(hits[-1])} · 거래 {len(tr)} · "
          f"진입일 {len(ent)} · lag {COMBO_RS_LAG}거래일({n_lag}건) · 창밖 폐기 {n_drop}")
    return ent


def simulate(px, nmap, mmap, period_start, sm, smy, start_cap):
    """전 구간 시뮬레이션 → 테이블별 row 리스트 반환."""
    # ★S2_SLIP_K — off 면 이 줄이 통째로 skip 되어 px 에 컬럼이 아예 안 생긴다(비트 동일 보장)
    if SLIP_ON:
        px = _slip_prepare(px)
    # ★★[CAND-2026-08-24-240] off 면 이 줄이 통째로 skip 되어 맵이 빈 채로 남는다(비트 동일)
    if LIQ_ON:
        _liq_prepare(px)
    all_dates = sorted(px["date"].unique())
    by_date = {d: {} for d in all_dates}
    for rec in px.to_dict("records"):
        by_date[rec["date"]][rec["ticker"]] = rec

    positions, last_exit = {}, {}
    cash = float(start_cap); peak = cash
    executions, trades, legs, nav_rows, snaps = [], [], [], [], []
    candidates, counts = [], []
    tid_seq = 0
    didx = {d: i for i, d in enumerate(all_dates)}

    # ★S2_COMBO_RS — RS 슬리브는 **별도 dict**. S2 루프가 positions 만 순회하므로
    #   RS 가 S2 규칙(추가매수·분할매도·신저가손절·기간손절)을 타지 않는다.
    rs_pos = {}                                   # ★off 면 영원히 빈 dict = 완전 무영향
    rs_entries = load_rs_ledger(all_dates) if COMBO_RS else {}
    rs_rows = []                                  # 10번째 산출(rs_positions.csv) — 9개 CSV 불변

    # ★S2_CASH_PARK — off 면 PARK_RET 이 None 이라 일말 블록이 통째로 skip
    PARK_RET = load_park_returns(all_dates) if PARK_TK else None
    park_bal = 0.0        # 전일말 파킹 잔고(= 오늘 수익을 받는 원금)
    park_hist = []        # 일말 cash 이력 — D+2 지연(RP) 판정용
    park_earn_tot = park_fee_tot = 0.0

    def _hv(pos, day):
        return sum(p["qty"] * (float(day[t]["close"]) if t in day else p["last_close"])
                   for t, p in pos.items())

    def cur_hv(day):
        # ★NAV·레버 판정에 RS 를 포함한다. off 면 rs_pos 가 비어 있어 종전과 완전 동일하다.
        hv = _hv(positions, day)
        return hv + _hv(rs_pos, day) if rs_pos else hv

    def lev_ok(day, cost):
        hv = cur_hv(day); nav = cash + hv
        return nav > 0 and (hv + cost) <= MAX_LEV * nav

    def ex(d, p, action, stage, price, qty, nav_today, blocked=False):
        executions.append(dict(d=d, ticker=p["tk"], name=p["name"], market=p["market"],
            action=action, stage=stage, fill_price=round(price), qty=int(qty),
            amount=round(price * qty), port_pct=round(price * qty / nav_today * 100, 2) if nav_today > 0 else None,
            ma120_above=p["entry_above"], prev_spike_bull=p["entry_bull"], blocked_by_leverage=blocked))

    def leg(p, d, leg_type, stage, price, qty, nav_today):
        p["legs"].append(dict(d=d, leg_type=leg_type, stage=stage, price=round(price), qty=int(qty),
            amount=round(price * qty), port_pct=round(price * qty / nav_today * 100, 2) if nav_today > 0 else None,
            hhmm=_hhmm(p["tk"], d, leg_type)))

    def close_trade(p, d, reason):
        trades.append(dict(_tid=p["tid"], ticker=p["tk"], name=p["name"], market=p["market"],
            entry_date=p["entry_date"], exit_date=d, buy_count=p["buy_count"],
            max_invested=round(p["cost"]), proceeds=round(p["proc"]),
            pnl=round(p["proc"] - p["cost"]),
            ret_pct=round((p["proc"] / p["cost"] - 1) * 100, 2) if p["cost"] > 0 else None,
            holding_days=didx[d] - didx[p["entry_date"]], exit_reason=reason, status="closed"))
        for lg in p["legs"]:
            legs.append(dict(_tid=p["tid"], **lg))

    # (실험) 낙주필터용 — 종목별 최근 5거래일 수익률 사전계산.
    _RET5 = {}
    if ENTRY_MIN_RET5 is not None:
        for _tk, _g in px.groupby("ticker"):
            _g = _g.sort_values("date")
            _c = _g["close"].to_numpy(); _D = _g["date"].to_numpy()
            for _e in range(5, len(_g)):
                if _c[_e - 5] > 0:
                    _RET5[(_tk, str(_D[_e])[:10])] = _c[_e] / _c[_e - 5] - 1
        print(f"[entry-filter] ret5<{ENTRY_MIN_RET5} 사전계산 {len(_RET5)}건")

    # (실험) 종목별 최근 RISE2W_WIN 거래일 순방향 최대상승폭(저점→이후고점) — 매수우선순위·차등목표 공용.
    _RISE2W = {}
    if BUY_PRIORITY == "rise2w" or _WIDE_T is not None:
        for _tk, _g in px.groupby("ticker"):
            _g = _g.sort_values("date")
            _H = _g["high"].to_numpy(); _L = _g["low"].to_numpy(); _D = _g["date"].to_numpy()
            for _e in range(len(_g)):
                _rm = None; _best = 0.0
                for _k in range(max(0, _e - RISE2W_WIN + 1), _e + 1):
                    _rm = _L[_k] if _rm is None else min(_rm, _L[_k])
                    if _rm and _rm > 0:
                        _best = max(_best, _H[_k] / _rm - 1)
                _RISE2W[(_tk, str(_D[_e])[:10])] = _best
        print(f"[buy-priority] rise2w 사전계산 {len(_RISE2W)}건 (win={RISE2W_WIN})")

    for d in all_dates:
        day = by_date[d]; nav_today = cash + cur_hv(day); closed = set()
        # ★★[CAND-2026-08-24-240] 재배분 풀 — ★그날 안에서만 산다(다음 날로 이월하지 않는다).
        #   ★off 면 이 변수는 만들어지되 아무도 안 건드린다(비용 = 대입 1회).
        _ra_pool = 0.0
        for tk in list(positions):
            if tk not in day:
                continue
            p = positions[tk]; r = day[tk]
            # ★기업행위(CA) 보유 리스케일 — S2_CA_ADJUST=1 일 때만. off 면 CA_ADJUST=False 라
            #   이 블록이 O(1) 조건 평가만 하고 통째로 스킵돼 off 재현이 비트 동일하다.
            #   (SPEC_S2_OPS_CA_TRANSPLANT_2026-08-24 §5-2 — backtest.py:442-474 채널①의 이식.
            #    채널②(ca_block 진입차단)는 이식하지 않는다 — CAND-2026-08-22-21 별건.
            #    그날 op/hi/lo/cl 을 꺼내기 **전에** 실행해 어제 스케일 필드와 오늘 새 스케일
            #    가격을 같은 날 섞어 비교하는 사고를 원천 차단한다 — 모체와 동일한 배치.)
            if CA_ADJUST:
                CA_N["seen_pos_day"] += 1                 # ★분모 — 보유 x 거래일 (표적 탐색 모집단)
                _ev = CA_MAP.get((tk, str(d)))            # d 는 datetime.date → str(d) = "YYYY-MM-DD"
                if _ev is not None:
                    CA_N["hit"] += 1                      # ★★실제 발동 — 보유 중에 CA 사건일을 만났다
                    _sr, _k = _ev
                    _nq = int(round(p["qty"] * _sr))
                    if _nq < 1:
                        # 단주 소멸 — 전일 종가(직전 루프까지 갱신된 last_close) x k x 잔여분을
                        #   현금 정산하고 포지션을 종료한다(backtest.py 와 동일한 처리).
                        # ★[2026-08-24 검토 수리] ex()/leg() 호출 추가 — 다른 모든 청산 경로(stop·newlow_stop·time_stop)와 같은 패턴을 따른다.
                        #   누락 시 이 분기가 발동한 거래는 executions.csv/legs.csv 에서 통째 사라진다
                        #   (trades.csv proceeds/pnl 합계는 맞아 NAV·CAGR 은 안 틀리지만 개별 거래 감사가 불가능해진다).
                        _frac = p["qty"] * _sr
                        _px = p["last_close"] * _k
                        ex(d, p, "ca_delist", None, _px, _frac, nav_today)
                        leg(p, d, "ca_delist", None, _px, _frac, nav_today)
                        _net = _frac * _px * SELL_MULT
                        cash += _net; p["proc"] += _net; p["qty"] = 0
                        CA_N["delist"] += 1
                        close_trade(p, d, "기업행위 단주소멸")
                        del positions[tk]; closed.add(tk); last_exit[tk] = d
                        continue
                    CA_N["rescale"] += 1
                    p["total_qty"] = max(1, int(round(p["total_qty"] * _sr)))
                    p["qty"] = _nq
                    p["avg_buy"] *= _k; p["last_buy"] *= _k; p["min_low"] *= _k
                    if p["stop"] is not None:
                        p["stop"] *= _k
            op, hi, lo, cl = float(r["open"]), float(r["high"]), float(r["low"]), float(r["close"])
            p["last_close"] = cl
            # ★유효봉 판정 — 거래정지·무거래 봉(o/h/l = 0)을 저가 기반 로직에서 배제
            bar_ok = (not VALID_BAR) or (op > 0 and hi > 0 and lo > 0)
            # ★유령 가드용 기준값 — **유효봉의** 종가와 정지 연속일. off 여도 유지 비용은 상수다.
            #   ⚠️VALID_BAR 와 따로 판정한다 — S2_VALID_BAR=0 이어도 기준은 유효봉이어야 한다.
            #   ⚠️★`ph_*` 는 **갱신 직전 값**(= 어제까지)이다. 오늘 체결되는 주문은 어제 저녁에
            #     냈으므로 원장 측 판정은 반드시 이 쪽을 본다(당일 종가 선취 금지).
            p["ph_ref"] = p.get("ref_close"); p["ph_halt"] = int(p.get("halt_n", 0) or 0)
            if op > 0 and hi > 0 and lo > 0:
                p["ref_close"] = cl; p["halt_n"] = 0
            else:
                p["halt_n"] = p["ph_halt"] + 1
            # 매도단계 후 손절 (장초 갭 포함)
            if p["sell_count"] >= 1 and p["qty"] > 0 and not bar_ok and lo <= p["stop"]:
                VB_SKIP["stop"] += 1
            if p["sell_count"] >= 1 and p["qty"] > 0 and bar_ok and lo <= p["stop"]:
                px_ = op if op < p["stop"] else p["stop"]
                if DAY_BUF > 0:                       # ★발동 카운터 (§4-1b #2)
                    DAY_BUF_N["hit_gap" if px_ < p["stop"] else "hit_buf"] += 1
                # ★slip — 갭하락 시가 체결은 DAY_BUF 가 만든 가격이 아니므로 buf_applied = 0
                px_ = _slip_fill(p, r, d, px_, p["qty"],
                                 DAY_BUF if px_ >= p["stop"] else 0.0, "stop_stage")
                ex(d, p, "stop", p["sell_count"], px_, p["qty"], nav_today)
                leg(p, d, "stop", p["sell_count"], px_, p["qty"], nav_today)
                _net = p["qty"] * px_ * SELL_MULT
                cash += _net; p["proc"] += _net; p["qty"] = 0
                close_trade(p, d, "stop"); del positions[tk]; closed.add(tk); last_exit[tk] = d; continue

            # [옵션 B] 시초 분할매도 — 시가(op) 가 목표가(호가단위 반올림) 이상이면 시초에 체결.
            # 갭업이면 지정가(목표가)가 아니라 '시가'에 체결된다(더 유리). 예: 목표 168,500 인데
            # 시가 175,700 으로 갭업 → 175,700 에 팔림. 손절이 갭하락 시 시가로 체결되는 것과 대칭.
            # high/low 순서가 모호한 일봉 시뮬 결함 회피 — 시초 매도 후엔 추가매수 차단(sell_count≥1).
            t = [_to_tick(p["avg_buy"] * p.get("tgt_mult", 1.0) * (1 + s)) for s in p.get("targets", S)]   # 목표가 호가단위 반올림(포지션별)
            for stg in range(p["sell_count"] + 1, N_STAGES + 1):
                if op >= t[stg - 1] and p["qty"] > 0:
                    fill = max(op, t[stg - 1])          # 갭업이면 시가, 아니면 목표가
                    sq = _stage_qty(stg, p["total_qty"], p["qty"])
                    # ★slip — 목표가 매도에는 하한이 없다(DAY_BUF 는 손절선 전용). buf_applied = 0
                    #   ★p["stop"] 은 **마진 전 목표가**로 계속 잡는다(트리거 불변)
                    fill = _slip_fill(p, r, d, fill, sq, 0.0, "sell")
                    ex(d, p, f"sell_{stg}", stg, fill, sq, nav_today)
                    leg(p, d, f"sell_{stg}", stg, fill, sq, nav_today)
                    _net = sq * fill * SELL_MULT
                    cash += _net; p["proc"] += _net
                    p["qty"] -= sq; p["sell_count"] = stg; p["stop"] = _stop_px(t[stg - 1])
                else:
                    break

            bought = False
            # 추가매수 — buy_count < MAX_BUY. 단 buy_count >= NL_AFTER 이고 추가매수 가격이
            # 직전 최저가 이하면 신저가 손절 발동 시점이 더 빠르므로 추가매수 skip (broker 동일 정책).
            if p["sell_count"] == 0 and p["buy_count"] < MAX_BUY and not p.get("knife"):
                at = _to_tick(p["last_buy"] * (1 - ADD_DROP))   # 추가매수가 호가단위 반올림
                _skip = (p["buy_count"] >= NL_AFTER and at <= p["min_low"])
                # ★유령 가드 — 원장 측. ⚠️plan 측과 **같은 술어 · 같은 시점**을 쓴다.
                #   ★`prev=True` — 오늘 체결되는 이 주문은 **어제 저녁 계획**의 산물이므로
                #     어제까지의 기준값(`ph_ref`·`ph_halt`)으로 판정한다. 그래서 정지 재개일에는
                #     검사 B 가 여기서도 산다(어제가 정지봉이었다는 사실은 오늘 아침에 안다).
                _ph_block, _ph_why, _ph_v = _phantom(
                    p, at, d, "fill", prev=True,
                    would_fire=(not _skip and bar_ok and lo <= at))   # §CAND-2026-08-24-202
                if _ph_block:
                    _skip = True
                if not _skip and not bar_ok and lo <= at:
                    VB_SKIP["add"] += 1
                if not _skip and bar_ok and lo <= at:
                    _amt_a = float(p["tranche"])
                    # ★★[CAND-2026-08-24-240] 추가매수도 같은 상한. LEGS=new 면 건너뛴다.
                    if LIQ_LEGS != "new":
                        _cap_a = _liq_cap_krw(tk, d)
                        if _cap_a is not None:
                            LIQ_N["eval"] += 1
                            if _amt_a > _cap_a:
                                LIQ_N["cut"] += 1
                                if _cap_a <= 0:
                                    LIQ_N["zero"] += 1
                                if LIQ_RA_ON:
                                    _ra_pool += (_amt_a - _cap_a)
                                    LIQ_N["ra_in"] += 1
                                _amt_a = _cap_a
                    sh = int(_amt_a // at)
                    if sh > 0 and lev_ok(day, sh * at):
                        _net = sh * at * BUY_MULT
                        cash -= _net; p["cost"] += _net
                        p["avg_buy"] = (p["avg_buy"] * p["total_qty"] + at * sh) / (p["total_qty"] + sh)
                        p["total_qty"] += sh; p["qty"] += sh; p["last_buy"] = at; p["buy_count"] += 1; bought = True
                        p["last_buy_idx"] = didx[d]            # 기간 손절 reset 기준 (옵션 B)
                        ex(d, p, "buy_add", p["buy_count"], at, sh, nav_today)
                        leg(p, d, "buy_add", p["buy_count"], at, sh, nav_today)
                    elif sh > 0:
                        ex(d, p, "buy_add", p["buy_count"] + 1, at, sh, nav_today, blocked=True)
            _trigger_px = lo if NEWLOW_TRIGGER == "intraday" else cl
            _nl_cond = (p["sell_count"] == 0 and (p["buy_count"] >= NL_AFTER or p.get("knife"))
                        and not bought and _trigger_px < p["min_low"])
            if _nl_cond and not bar_ok:
                VB_SKIP["newlow"] += 1
            if _nl_cond and bar_ok:
                # ★slip — ★DAY_BUF 가 구조적으로 못 덮는 구멍이다(sell_count >= 1 요구).
                #   26건 · 매도액 13.7% 인데 할인 기여 33.07% · 참여율 중앙 0.6256%(전 경로 최고).
                _nlpx = _slip_fill(p, r, d, cl, p["qty"], 0.0, "newlow_stop")
                ex(d, p, "newlow_stop", None, _nlpx, p["qty"], nav_today)
                leg(p, d, "newlow_stop", None, _nlpx, p["qty"], nav_today)
                _net = p["qty"] * _nlpx * SELL_MULT
                cash += _net; p["proc"] += _net; p["qty"] = 0
                close_trade(p, d, "newlow_stop"); del positions[tk]; closed.add(tk); last_exit[tk] = d
                if bar_ok:
                    p["min_low"] = min(p["min_low"], lo)
                continue
            # ★min_low 갱신 — 이것이 가장 중요하다.
            #   가드 없이 lo=0 을 한 번 먹으면 min_low 가 0 에 고정되고
            #   그 포지션의 신저가 손절이 **영구 비활성화**된다.
            if bar_ok:
                p["min_low"] = min(p["min_low"], lo)
            elif lo < p["min_low"]:
                VB_SKIP["minlow"] += 1

            # 기간 손절 — TIME_STOP_DAYS 영업일 경과 + 분할매도 한 단계도 못 찍었으면 종가 강제 청산
            # 기준: TIME_STOP_REF = "entry" (1차 매수일) | "last_buy" (마지막 매수일)
            _ref_idx = p["last_buy_idx"] if TIME_STOP_REF == "last_buy" else didx[p["entry_date"]]
            if (TIME_STOP_DAYS > 0 and p["sell_count"] == 0
                    and (didx[d] - _ref_idx) >= TIME_STOP_DAYS):
                _tspx = _slip_fill(p, r, d, cl, p["qty"], 0.0, "time_stop")   # ★slip
                ex(d, p, "stop", None, _tspx, p["qty"], nav_today)
                leg(p, d, "stop", None, _tspx, p["qty"], nav_today)
                _net = p["qty"] * _tspx * SELL_MULT
                cash += _net; p["proc"] += _net; p["qty"] = 0
                close_trade(p, d, f"time_stop({TIME_STOP_DAYS}d)")
                del positions[tk]; closed.add(tk); last_exit[tk] = d
                continue

            # [옵션 B] 추가매수 발생일은 hi 기반 분할매도 검사 보류 —
            # high 가 추가매수 전이었는지 후였는지 일봉으로 알 수 없어 보수적 처리.
            # 시초 매도(op) 와 다음 영업일 hi 기반 매도는 그대로 작동.
            if not bought:
                # 평단 갱신됐을 수 있으므로 t 재계산
                t = [_to_tick(p["avg_buy"] * p.get("tgt_mult", 1.0) * (1 + s)) for s in p.get("targets", S)]   # 목표가 호가단위 반올림(포지션별)
                for stg in range(p["sell_count"] + 1, N_STAGES + 1):
                    if hi >= t[stg - 1] and p["qty"] > 0:
                        sq = _stage_qty(stg, p["total_qty"], p["qty"])
                        # ★slip — 최악 참여율 1위(2022-06-02 278650 17.27%)가 이 경로의
                        #   3단 동시청산이다. p["stop"] 은 아래에서 **마진 전 목표가**로 잡는다.
                        _sfill = _slip_fill(p, r, d, t[stg - 1], sq, 0.0, "sell")
                        ex(d, p, f"sell_{stg}", stg, _sfill, sq, nav_today)
                        leg(p, d, f"sell_{stg}", stg, _sfill, sq, nav_today)
                        _net = sq * _sfill * SELL_MULT
                        cash += _net; p["proc"] += _net
                        p["qty"] -= sq; p["sell_count"] = stg; p["stop"] = _stop_px(t[stg - 1])
                    else:
                        break
            if p["sell_count"] >= 1 and p["qty"] > 0 and not bar_ok and lo <= p["stop"]:
                VB_SKIP["stop"] += 1
            if p["sell_count"] >= 1 and p["qty"] > 0 and bar_ok and lo <= p["stop"]:
                if DAY_BUF > 0:                       # ★발동 카운터 (§4-1b #2)
                    DAY_BUF_N["hit_buf"] += 1
                # ★slip — 이 자리는 DAY_BUF 가 이미 박힌 손절선에서의 체결이라 buf_applied = DAY_BUF
                _stpx = _slip_fill(p, r, d, p["stop"], p["qty"], DAY_BUF, "stop_stage")
                ex(d, p, "stop", p["sell_count"], _stpx, p["qty"], nav_today)
                leg(p, d, "stop", p["sell_count"], _stpx, p["qty"], nav_today)
                _net = p["qty"] * _stpx * SELL_MULT
                cash += _net; p["proc"] += _net; p["qty"] = 0
                close_trade(p, d, "stop"); del positions[tk]; closed.add(tk); last_exit[tk] = d
            elif tk in positions and p["qty"] == 0:
                close_trade(p, d, f"sell_{N_STAGES}"); del positions[tk]; closed.add(tk); last_exit[tk] = d
        # 예비후보 스캔(근접 포함) + 신규 진입(지지선 이하만 체결)
        n_cand = n_reached = n_bought = n_blocked = 0
        _reached = []                                  # (tk, price, sz, above, bull) — 체결 대상 수집
        for tk, r in day.items():
            if tk in positions or tk in closed:
                continue
            if not (pd.notna(r["ma20"]) and r["date"] >= period_start):
                continue
            support = float(r["support"]); price = float(r["close"]); _is_knife = False
            # 낙주(최근5일 급락) 처리 — skip: 진입 제외 / deep·deep_blend: 진입가를 3차매수 등가로 낮춰 단발 저가진입
            if ENTRY_MIN_RET5 is not None and _RET5.get((tk, str(d)[:10]), 0.0) < ENTRY_MIN_RET5:
                if KNIFE_MODE in ("deep", "deep_blend"):
                    support = support * (1 - ADD_DROP) ** KNIFE_DEEP_N
                    _is_knife = True
                else:
                    continue
            if price > support * (1 + PROX):          # 지지선에서 너무 멀면 후보 아님
                continue
            rs = sm.get((tk, d))
            if rs is None or (tk in last_exit and not (rs > last_exit[tk])):
                continue
            ml = r.get("ma_long"); above = bool(pd.notna(ml) and price > ml); bull = smy.get((tk, d))
            sz = SIZE_ABOVE if above else SIZE_BELOW
            if bull is False:
                sz *= MUSEOB
            if VOL_SIZING != "off":
                sz *= _VOLMULT.get(str(d)[:10], 1.0)   # d 는 datetime64 → 문자열 정규화
            reached = price < support
            candidates.append(dict(d=d, ticker=tk, kind="new", name=nmap.get(tk, ""),
                market=MKT.get(mmap.get(tk, ""), mmap.get(tk, "")), current_price=round(price),
                order_price=int(support), port_pct=round(sz * 100, 2), ma120_above=above,
                prev_spike_bull=bull, stage=1, reached=reached,
                drop_to_pct=round((support / price - 1) * 100, 2), snapshot_at=f"{d}T15:30:00+09:00"))
            n_cand += 1
            if not reached:                            # 근접(지지선 위) → 후보만, 체결 안 함
                continue
            _reached.append((tk, price, sz, above, bull, _is_knife))
        # 현금제약 시 우선순위 정렬 — rise2w 큰 종목 먼저 매수 (none=수집순=기존 동작)
        if BUY_PRIORITY == "rise2w":
            _dk = str(d)[:10]
            _reached.sort(key=lambda x: _RISE2W.get((x[0], _dk), -1.0), reverse=True)
        for tk, price, sz, above, bull, _kn in _reached:
            n_reached += 1
            amt = sz * nav_today
            # ★★[CAND-2026-08-24-240] 참여율 상한 — ★비례 축소(차단 아님). off 면 cap=None.
            _cap = _liq_cap_krw(tk, d)
            if _cap is not None:
                LIQ_N["eval"] += 1
                if amt > _cap:
                    LIQ_N["cut"] += 1
                    if _cap <= 0:
                        LIQ_N["zero"] += 1
                    if LIQ_RA_ON:
                        _ra_pool += (amt - _cap)      # ★깎인 금액을 풀로
                        LIQ_N["ra_in"] += 1
                    amt = _cap
            sh = int(amt // price)
            if sh <= 0:
                continue
            # ★재배분 — 비구속(상한에 안 걸린) 종목이 풀에서 인출한다.
            #   ★한 종목이 하루에 살 수 있는 상한 = LIQ_RA x (원래 사이징 금액).
            if LIQ_RA_ON and _ra_pool > 0 and (_cap is None or sz * nav_today <= _cap):
                _room = (LIQ_RA - 1.0) * (sz * nav_today)
                if _cap is not None:
                    _room = min(_room, max(0.0, _cap - sh * price))
                _add = min(_ra_pool, _room, max(0.0, cash - sh * price * BUY_MULT))
                _ai = int(_add // price)
                if _ai > 0:
                    sh += _ai
                    _ra_pool -= _ai * price
                    LIQ_N["ra_out"] += 1
            stub = dict(tk=tk, name=nmap.get(tk, ""), market=MKT.get(mmap.get(tk, ""), mmap.get(tk, "")),
                        entry_above=above, entry_bull=bull, buy_count=1)
            if not lev_ok(day, sh * price):
                ex(d, stub, "buy_new", 1, price, sh, nav_today, blocked=True)
                n_blocked += 1
                continue
            tid_seq += 1
            _cost = sh * price * BUY_MULT
            cash -= _cost
            # ★조건부 매도 — MA120 위 진입분은 S_ABOVE. off(None)면 S 라 종전과 동일.
            _base_t = S_ABOVE if (above and S_ABOVE is not None) else S
            # 잠재력 종목(2주 순방향 상승 rise2w >= 임계)이면 넓은 목표가, 아니면 기본
            if _WIDE_T is not None and _RISE2W.get((tk, str(d)[:10]), 0.0) >= POTENTIAL_RISE:
                _tgts = _WIDE_T
            else:
                _tgts = _base_t
            _tmult = 1.0
            if _kn:                                        # 낙주 deep 진입: 전용 목표/배수
                if KNIFE_TARGETS is not None:
                    _tgts = KNIFE_TARGETS
                elif KNIFE_MODE == "deep_blend":
                    _tmult = KNIFE_TGT_MULT
            p = dict(tk=tk, name=stub["name"], market=stub["market"], entry_date=d,
                last_buy_idx=didx[d], targets=_tgts,
                knife=_kn, tgt_mult=_tmult,
                tranche=amt, avg_buy=price, last_buy=price, buy_count=1, sell_count=0, stop=None,
                qty=sh, total_qty=sh, min_low=price, last_close=price,
                entry_above=above, entry_bull=bull, tid=tid_seq, cost=_cost, proc=0.0, legs=[])
            positions[tk] = p
            ex(d, p, "buy_new", 1, price, sh, nav_today)
            leg(p, d, "buy_new", 1, price, sh, nav_today)
            n_bought += 1
        counts.append(dict(d=d, n_candidates=n_cand, n_reached=n_reached,
                           n_bought=n_bought, n_blocked=n_blocked))

        # ══ ★S2_COMBO_RS — RS 슬리브. **S2 다음**(엔진 run():620-626 순서) ══
        #    off 면 COMBO_RS 가 False 라 이 블록 전체가 skip 된다 → 완전 무영향.
        if COMBO_RS:
            # ① 청산 — exit_date 경과분 전부(휴장 등 날짜 불일치 방지. 엔진 rs_step:554)
            for tk in [t for t, p in rs_pos.items() if p["exit_date"] <= d]:
                p = rs_pos.pop(tk)
                px_out = float(day[tk]["close"]) if tk in day else p["last_close"]
                _net = p["qty"] * px_out * SELL_MULT
                cash += _net
                rs_rows.append(dict(d=d, tk=tk, action="sell", qty=p["qty"], price=px_out,
                                    amount=round(_net), entry_date=p["entry_date"],
                                    exit_date=p["exit_date"], w=p["w"],
                                    pnl=round(_net - p["cost"])))
            # ② 진입 — ★rs_cap 은 「진입 직전 게이트」. 이미 든 것은 cap 위로 자란다(SPEC §10-E)
            for (tk, xd, w) in rs_entries.get(d, []):
                if tk not in day or tk in rs_pos:
                    continue
                if _hv(rs_pos, day) >= COMBO_RS_CAP * nav_today:
                    continue                                  # ★cap 이상이면 신규만 막는다
                price = float(day[tk]["close"])
                if not (price > 0):
                    continue
                sh = int((w * nav_today) // price)
                _c0 = sh * price * BUY_MULT
                if sh <= 0 or _c0 > cash:                     # ★RS 는 무레버(현금 한도). 엔진 rs_step:570
                    continue
                cash -= _c0
                rs_pos[tk] = dict(qty=sh, entry_date=d, exit_date=xd, w=w,
                                  last_close=price, cost=_c0)
                rs_rows.append(dict(d=d, tk=tk, action="buy", qty=sh, price=price,
                                    amount=round(_c0), entry_date=d, exit_date=xd, w=w, pnl=0))
            for tk, p in rs_pos.items():                      # 마크투마켓
                if tk in day:
                    p["last_close"] = float(day[tk]["close"])

        # ★S2_CASH_PARK — 일말 파킹 정산 (NAV 계산 「직전」)
        #   ① 전일말 파킹 잔고에 오늘 수익률을 적용한다(★전일 기준 = 룩어헤드 없음)
        #   ② 오늘말 파킹 가능 잔고를 다시 잡는다 — LAG 만큼의 최근 최소 현금
        #      (RP: 매도로 늘어난 현금은 D+2 뒤에야 파킹된다 / ETF: LAG=0 이라 전액 즉시)
        #   ③ 잔고 변화분에 매매비용(ETF 만. RP 는 FEE=0)
        if PARK_RET is not None:
            _earn = park_bal * PARK_RET[d]
            cash += _earn
            park_earn_tot += _earn
            park_hist.append(cash)
            _new = max(0.0, min(park_hist[-(PARK_LAG + 1):]))
            _fee = abs(_new - park_bal) * PARK_FEE
            cash -= _fee
            park_fee_tot += _fee
            park_bal = min(_new, max(0.0, cash))

        # 일말: NAV·스냅샷
        hv = cur_hv(day); nav = cash + hv; peak = max(peak, nav)
        dd = (nav / peak - 1) * 100 if peak > 0 else 0.0
        lev = (hv + max(0.0, -cash)) / nav if nav > 0 else 0.0   # gross/nav 근사
        nav_rows.append(dict(d=d, nav=round(nav), cash=round(cash), stock_value=round(hv),
            leverage=round(min(lev, 9.999), 3), dd_pct=round(dd, 2), n_positions=len(positions)))
        for tk, p in positions.items():
            curp = float(day[tk]["close"]) if tk in day else p["last_close"]
            snaps.append(dict(d=d, ticker=tk, name=p["name"], market=p["market"], entry_date=p["entry_date"],
                buy_count=p["buy_count"], sell_count=p["sell_count"], qty=p["qty"], avg_buy=round(p["avg_buy"]),
                last_close=round(curp), eval_amount=round(p["qty"] * curp), eval_pnl=round(p["qty"] * (curp - p["avg_buy"])),
                ret_pct=round((curp / p["avg_buy"] - 1) * 100, 2),
                port_pct=round(p["qty"] * curp / nav * 100, 2) if nav > 0 else None))

    # 미청산 포지션 → trades open
    last_d = all_dates[-1]
    for tk, p in positions.items():
        trades.append(dict(_tid=p["tid"], ticker=tk, name=p["name"], market=p["market"],
            entry_date=p["entry_date"], exit_date=None, buy_count=p["buy_count"], max_invested=round(p["cost"]),
            proceeds=None, pnl=None, ret_pct=None, holding_days=None, exit_reason="open", status="open"))
        for lg in p["legs"]:
            legs.append(dict(_tid=p["tid"], **lg))

    if PARK_RET is not None:
        # ⚠️`%` 포맷은 `%+,.0f` 를 못 쓴다(ValueError). f-string 으로 쓴다.
        print(f"  ★파킹 누적 수익 {park_earn_tot:+,.0f}원 · 누적 비용 {park_fee_tot:,.0f}원 · "
              f"순 {park_earn_tot - park_fee_tot:+,.0f}원 · 최종 파킹잔고 {park_bal:,.0f}원")

    order_plan = build_order_plan(positions, last_d, cash + cur_hv(by_date[last_d]),
                                  park_bal if PARK_RET is not None else None)
    monthly = build_monthly(trades, nav_rows)
    # ★S2_COMBO_RS — 잔여 RS 포지션을 마지막 날 종가로 청산(엔진 run():634 과 동일)
    if COMBO_RS and rs_pos:
        ld = by_date[all_dates[-1]]
        for tk in list(rs_pos):
            p = rs_pos.pop(tk)
            mp = float(ld[tk]["close"]) if tk in ld else p["last_close"]
            _net = p["qty"] * mp * SELL_MULT
            cash += _net
            rs_rows.append(dict(d=all_dates[-1], tk=tk, action="sell_final", qty=p["qty"],
                                price=mp, amount=round(_net), entry_date=p["entry_date"],
                                exit_date=p["exit_date"], w=p["w"], pnl=round(_net - p["cost"])))

    return dict(executions=executions, trades=trades, legs=legs, nav_daily=nav_rows,
                position_snapshots=snaps, daily_order_plan=order_plan, monthly_stats=monthly,
                daily_candidates=candidates, daily_counts=counts, last_date=last_d,
                rs_positions=rs_rows)   # ★10번째. 9개 CSV·Supabase 스키마는 불변이다


# ── ★daily_order_plan 일별 아카이브 (CAND-2026-08-24-203 · 기본 off) ──────────
#   [왜] Supabase daily_order_plan 은 매 런 전삭제 후 재적재라(del_filter) 사후 감사가
#     안 되고, dry-run CSV 도 outdir 안에 ★마지막 날 한 줄뿐이다(build_order_plan 이
#     last_d 에 1회만 돈다). 그래서 이번 라운드는 plan-time 모집단을 executions.csv 에서
#     근사 복원해야 했다(archive/_2026-08-24_ghostfill_target_size.py · quant_infra/
#     2026-08/S2_GHOSTFILL_GATE_2026-08-24.md §4). 상시 아카이브가 있으면 그 근사가
#     필요 없어진다.
#   S2_PLAN_ARCHIVE_DIR = ""(기본 off) — 비우면 종전 동작(★새 파일을 하나도 안 만든다).
#     채우면 그 디렉터리 아래 "{기준일}.csv" 로 그날의 daily_order_plan 을 남긴다.
#     ⚠️★날짜별 새 파일이다 — 기존 파일을 덮어쓰지 않는다(CLAUDE.md §0-4). 스케줄러가
#     매일 도니 하루에 한 파일씩 쌓인다("스케줄러 로테이션") — 지우거나 합치는 것은
#     별도 결정이다.
#   ⚠️★운영(run_eod.ps1) 점화는 §4-6 「새 파일 신설」 승인 대상이다 — 이 라운드는
#     코드만 넣고 기본 off 로 둔다(해달별님 결정 대기).
PLAN_ARCHIVE_DIR = os.environ.get("S2_PLAN_ARCHIVE_DIR", "").strip()


def archive_order_plan(plan, d, outdir_str=None):
    """★plan-time 모집단을 날짜별 CSV 로 남긴다. outdir_str(또는 S2_PLAN_ARCHIVE_DIR)이
    비어 있거나 plan 이 비면 아무 것도 안 한다 — ★기본 동작은 종전과 비트 동일이다."""
    outdir_str = (PLAN_ARCHIVE_DIR if outdir_str is None else outdir_str).strip()
    if not outdir_str or not plan:
        return
    outdir = Path(outdir_str)
    outdir.mkdir(parents=True, exist_ok=True)
    dest = outdir / f"{d}.csv"
    pd.DataFrame(plan).to_csv(dest, index=False, encoding="utf-8-sig")
    print(f"  ★[plan_archive] {dest} ({len(plan)}행)")


def build_order_plan(positions, d, nav, park_amount=None):
    """최신일 보유 포지션 → 다음 거래일 세팅할 감시주문 세트.

    ★park_amount 가 주어지면(= `S2_CASH_PARK` on) **현금 파킹 목표 줄**을 하나 얹는다.
      ⚠️★Supabase `daily_order_plan.order_type` 에 CHECK 제약이 있다 —
        `supabase/migrations/2026-08-12_cash_park.sql` 를 **먼저** 적용해야 적재된다.
    """
    plan = []
    # ★현금 파킹 목표 — 종목 주문보다 먼저 보이도록 맨 앞에 넣는다
    if park_amount is not None and park_amount > 0:
        _px = PARK_LAST_PX
        _qty = int(park_amount // _px) if _px > 0 else 0
        _stale = ""
        if PARK_LAST_D is not None and hasattr(d, "toordinal"):
            _gap = (d - PARK_LAST_D).days if hasattr(PARK_LAST_D, "toordinal") else None
            if _gap is not None and _gap > 5:
                _stale = f" ⚠️가격이 {_gap}일 오래됐다({PARK_LAST_D}) — 금액 기준으로 실행할 것"
        plan.append(dict(d=d, ticker=PARK_TK, name=PARK_NAME, market="KOSPI",
            order_type="cash_park", stage=None, trigger_price=round(_px), qty=_qty,
            port_pct=round(park_amount / nav * 100, 2) if nav > 0 else None, diff="keep",
            note=(f"★유휴현금 {round(park_amount):,}원 파킹 — 목표 보유 {_qty:,}주"
                  f"(종가 {round(_px):,}원 기준). ★매수 신호가 뜨면 필요한 만큼 먼저 매도한다."
                  f"{_stale}")))
    for tk, p in positions.items():
        is_new = (p["entry_date"] == d)
        diff = "new" if is_new else "keep"
        # 추가매수 감시 — buy_count < MAX_BUY 일 때 표시.
        # 단 buy_count >= NL_AFTER (2 이후) 신저가 손절 활성 상태에서 추가매수 가격이 신저가 손절
        # 가격 이하면 broker 충돌 (신저가 손절 먼저 발동 후 추가매수 잘못 체결) → 표시 skip.
        if p["sell_count"] == 0 and p["buy_count"] < MAX_BUY:
            at = _to_tick(p["last_buy"] * (1 - ADD_DROP))   # 추가매수가 호가단위 반올림
            skip_conflict = (p["buy_count"] >= NL_AFTER and at <= p["min_low"])
            # ★유령 가드 — **주문 측**. 이 자리가 실주문이 나가는 다리다.
            #   block: 그 감시주문 줄을 아예 내지 않는다(거부).  warn: note 에 표시만 한다.
            #   ⚠️★클램프(가격을 바꿔서 낸다)는 채택하지 않는다 — 올바른 신 스케일 가격을
            #     주문 시점에 알 방법이 없고, 바꾼 가격은 백테스트가 검증한 규칙이 아니다.
            _ph_block, _ph_why, _ph_v = _phantom(
                p, at, d, "plan", would_fire=(not skip_conflict))   # §CAND-2026-08-24-202
            if _ph_block:
                skip_conflict = True
            if not skip_conflict:
                sh = int(p["tranche"] // at)
                _note = f"{p['buy_count']+1}차 매수(직전매수가 -{ADD_DROP*100:g}%)"
                if _ph_why:
                    _note = f"⚠️★유령 의심({_ph_why} {_ph_v:.4f}) — 확인 전 집행 금지. " + _note
                plan.append(dict(d=d, ticker=tk, name=p["name"], market=p["market"], order_type="buy_add",
                    stage=p["buy_count"] + 1, trigger_price=round(at), qty=sh,
                    port_pct=round(p["tranche"] / nav * 100, 2) if nav > 0 else None, diff=diff,
                    note=_note))
        _tp = p.get("targets", S)                                     # ★포지션별 목표(조건부 매도 반영)
        t = [_to_tick(p["avg_buy"] * p.get("tgt_mult", 1.0) * (1 + s)) for s in _tp]   # 목표가 호가단위 반올림(포지션별)                       # 매도 감시(미체결 단계)
        for stg in range(p["sell_count"] + 1, N_STAGES + 1):
            sq = _stage_qty(stg, p["total_qty"], p["qty"])
            ORD_TGT_PCT[(tk, stg)] = _tp[stg - 1]                     # ★텔레그램 라벨용(스키마 불변)
            plan.append(dict(d=d, ticker=tk, name=p["name"], market=p["market"], order_type="sell",
                stage=stg, trigger_price=round(t[stg - 1]), qty=int(sq),
                port_pct=round(sq * t[stg - 1] / nav * 100, 2) if nav > 0 else None, diff=diff,
                note=f"{stg}차 매도(+{_tp[stg-1]*100:g}%)"))
        if p["sell_count"] >= 1:                                      # 손절 감시
            plan.append(dict(d=d, ticker=tk, name=p["name"], market=p["market"], order_type="stop",
                stage=p["sell_count"], trigger_price=round(p["stop"]), qty=int(p["qty"]),
                port_pct=None, diff=diff,
                note=("손절(직전 매도단계가 이탈 시 잔량 전량)" if DAY_BUF <= 0 else
                      f"손절(직전 매도단계가 -{DAY_BUF*100:g}% 이탈 시 잔량 전량)")))
        elif p["buy_count"] >= NL_AFTER:                              # 신저가 손절 감시
            plan.append(dict(d=d, ticker=tk, name=p["name"], market=p["market"], order_type="newlow_stop",
                stage=None, trigger_price=round(p["min_low"]), qty=int(p["qty"]),
                port_pct=None, diff=diff, note="신저가 손절(직전 최저가 하향 시 종가청산)"))
    return plan


def build_monthly(trades, nav_rows):
    closed = [t for t in trades if t["status"] == "closed"]
    nav = pd.DataFrame(nav_rows)
    if nav.empty:
        return []
    nav["month"] = pd.to_datetime(nav["d"]).dt.strftime("%Y-%m")
    out = []
    tr = pd.DataFrame(closed)
    if not tr.empty:
        tr["month"] = pd.to_datetime(tr["exit_date"]).dt.strftime("%Y-%m")
    for m, g in nav.groupby("month"):
        gn = g.sort_values("d")
        run_peak = gn["nav"].cummax()
        mdd = ((gn["nav"] / run_peak - 1) * 100).min()
        tg = tr[tr["month"] == m] if not tr.empty else pd.DataFrame()
        nstart, nend = int(gn["nav"].iloc[0]), int(gn["nav"].iloc[-1])
        out.append(dict(month=m, num_trades=int(len(tg)),
            win_rate=round((tg["pnl"] > 0).mean() * 100, 2) if len(tg) else 0.0,
            avg_ret=round(tg["ret_pct"].mean(), 2) if len(tg) else 0.0,
            realized_pnl=int(tg["pnl"].sum()) if len(tg) else 0,
            nav_start=nstart, nav_end=nend,
            return_pct=round((nend / nstart - 1) * 100, 2) if nstart else 0.0,
            mdd_pct=round(float(mdd), 2)))
    return out


# ── 출력 ─────────────────────────────────────────────────────────────
def dry_run_dump(data, base_cap):
    # ★S2_DRYRUN_DIR — 병렬 셀이 서로 덮어쓰지 않게 출력 디렉터리를 바꾼다(기본 `_dryrun` 불변)
    outdir = Path(os.environ.get("S2_DRYRUN_DIR", "").strip()
                  or (Path(__file__).resolve().parent / "_dryrun"))
    outdir.mkdir(parents=True, exist_ok=True)
    for name in ("executions", "trades", "legs", "nav_daily", "position_snapshots",
                 "daily_order_plan", "monthly_stats", "daily_candidates", "daily_counts"):
        df = pd.DataFrame(data[name])
        df.to_csv(outdir / f"{name}.csv", index=False, encoding="utf-8-sig")
    nav = pd.DataFrame(data["nav_daily"]); tr = pd.DataFrame(data["trades"])
    closed = tr[tr["status"] == "closed"] if not tr.empty else tr
    final_nav = nav["nav"].iloc[-1]; mdd = nav["dd_pct"].min()
    yrs = (pd.to_datetime(nav["d"].iloc[-1]) - pd.to_datetime(nav["d"].iloc[0])).days / 365.25
    cagr = ((final_nav / base_cap) ** (1 / yrs) - 1) * 100 if yrs > 0 else 0
    print(f"[dry-run] CSV → {outdir}")
    print(f"  기간 {nav['d'].iloc[0]} ~ {nav['d'].iloc[-1]} ({yrs:.1f}년)")
    print(f"  최종 NAV {final_nav:,.0f} (시작 {base_cap:,.0f}, {final_nav/base_cap*100-100:+.1f}%) | "
          f"CAGR {cagr:.2f}% | MDD {mdd:.2f}%")
    print(f"  체결 {len(data['executions'])} (미체결 {sum(1 for e in data['executions'] if e['blocked_by_leverage'])}) | "
          f"완결거래 {len(closed)} | 미청산 {len(tr)-len(closed)} | 월 {len(data['monthly_stats'])}")
    if len(closed):
        print(f"  완결 평균수익률 {closed['ret_pct'].mean():+.2f}% | 승률 {(closed['pnl']>0).mean()*100:.1f}%")
    print(f"  최신 감시주문 플랜 {len(data['daily_order_plan'])}건 (기준일 {data['last_date']})")
    # ★S2_COMBO_RS — 10번째 파일. ★off 면 안 만든다(9개 CSV 목록·해시 불변 계약)
    if COMBO_RS:
        rs = pd.DataFrame(data.get("rs_positions") or [])
        rs.to_csv(outdir / "rs_positions.csv", index=False, encoding="utf-8-sig")
        nb = int((rs["action"] == "buy").sum()) if len(rs) else 0
        ns = len(rs) - nb
        print(f"  ★[S2_COMBO_RS] cap {COMBO_RS_CAP} · lag {COMBO_RS_LAG} · "
              f"RS 진입 {nb} · 청산 {ns} · 실현손익 {rs['pnl'].sum():,.0f}원" if len(rs) else
              f"  ★[S2_COMBO_RS] cap {COMBO_RS_CAP} · RS 거래 0건")


def upsert_supabase(data):
    """전체 재계산본을 멱등 적재: 각 테이블 전삭제 후 insert. trade_legs 는 trade_id FK 매핑 후.
    외부 의존성 없이 stdlib(urllib)로 Supabase REST(PostgREST) 직접 호출."""
    import urllib.request, urllib.parse, urllib.error
    base = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1"
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    HBASE = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    def req(method, path, body=None, prefer="return=minimal"):
        h = dict(HBASE); h["Prefer"] = prefer
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        r = urllib.request.Request(base + path, data=payload, method=method, headers=h)
        try:
            with urllib.request.urlopen(r, timeout=60) as resp:
                txt = resp.read().decode("utf-8")
                return json.loads(txt) if txt.strip() else None
        except urllib.error.HTTPError as e:
            raise SystemExit(f"[supabase] {method} {path} 실패 {e.code}: {e.read().decode('utf-8')[:500]}")

    def iso(rows):  # date 객체 → 'YYYY-MM-DD'
        return [{k: (str(v) if isinstance(v, date) else v) for k, v in r.items()} for r in rows]

    def _column_exists(table, col):
        # 해당 컬럼만 select 시도 → 성공하면 존재. (없으면 PostgREST 400)
        try:
            req("GET", f"/{table}?select={col}&limit=0")
            return True
        except SystemExit:
            return False

    def chunk(rows, n=500):
        for i in range(0, len(rows), n):
            yield rows[i:i + n]

    # FK 안전 순서로 전삭제 (각 테이블의 항상-참 필터)
    del_filter = {
        "trade_legs": ("id", "0"), "trades": ("id", "0"), "executions": ("id", "0"),
        "daily_order_plan": ("id", "0"),
        "position_snapshots": ("d", "1900-01-01"), "nav_daily": ("d", "1900-01-01"),
        "monthly_stats": ("month", "0"), "daily_counts": ("d", "1900-01-01"),
        "daily_candidates": ("d", "1900-01-01"),
    }
    for tbl in ("trade_legs", "trades", "executions", "daily_order_plan", "daily_candidates",
                "position_snapshots", "nav_daily", "monthly_stats", "daily_counts"):
        col, sentinel = del_filter[tbl]
        req("DELETE", f"/{tbl}?{col}=gte.{urllib.parse.quote(sentinel)}")

    # trades 적재 → _tid → 실제 id 매핑 (return=representation 으로 id 회수)
    tmap = {}
    for c in chunk(data["trades"]):
        payload = iso([{k: v for k, v in t.items() if k != "_tid"} for t in c])
        res = req("POST", "/trades", payload, prefer="return=representation")
        for t_in, t_out in zip(c, res):
            tmap[t_in["_tid"]] = t_out["id"]
    legs = [dict({k: v for k, v in lg.items() if k != "_tid"}, trade_id=tmap[lg["_tid"]])
            for lg in data["legs"]]
    # hhmm 컬럼이 DB 에 아직 없으면(대시보드에서 add column 전) 제거 — 400 방지.
    if not _column_exists("trade_legs", "hhmm"):
        for l in legs:
            l.pop("hhmm", None)
        print("[hhmm] trade_legs.hhmm 컬럼 없음 → 시각 미적재. "
              "Supabase SQL: alter table trade_legs add column if not exists hhmm text;")
    for c in chunk(legs):
        if c:
            req("POST", "/trade_legs", iso(c))
    # ★daily_order_plan 의 `cash_park` 는 CHECK 제약을 푸는 마이그레이션이 필요하다
    #   (`supabase/migrations/2026-08-12_cash_park.sql`). 안 풀린 상태에서 켜면 400 이 나는데,
    #   ★그것 때문에 EOD 전체가 죽으면 안 된다 — 파킹 행만 빼고 재시도한다.
    #   `_column_exists` 와 같은 degrade 정신이다.
    _park_rows = [o for o in data["daily_order_plan"] if o.get("order_type") == "cash_park"]
    if _park_rows:
        try:
            req("POST", "/daily_order_plan", iso(_park_rows))
        except SystemExit as e:
            data["daily_order_plan"] = [o for o in data["daily_order_plan"]
                                        if o.get("order_type") != "cash_park"]
            print("⚠️★[cash_park] 적재 거부 — 파킹 %d행을 빼고 진행한다. 나머지 EOD 는 정상이다.\n"
                  "   원인일 가능성: daily_order_plan.order_type CHECK 제약이 아직 안 풀렸다.\n"
                  "   조치: supabase/migrations/2026-08-12_cash_park.sql 을 적용할 것.\n"
                  "   ⚠️★그때까지 파킹 지시가 웹앱·텔레그램에 안 나온다 — 수동 파킹이 필요하다.\n"
                  "   응답: %s" % (len(_park_rows), str(e)[:200]))
        else:
            data["daily_order_plan"] = [o for o in data["daily_order_plan"]
                                        if o.get("order_type") != "cash_park"]
            print("  ★[cash_park] 파킹 목표 %d행 적재 완료" % len(_park_rows))
    for tbl in ("executions", "position_snapshots", "daily_order_plan", "daily_candidates",
                "nav_daily", "monthly_stats", "daily_counts"):
        for c in chunk(data[tbl]):
            if c:
                req("POST", f"/{tbl}", iso(c))
    # ★요약·텔레그램용 복원 — 적재 성패와 무관하게 파킹 지시는 해달별님께 보여야 한다
    data["daily_order_plan"] = _park_rows + data["daily_order_plan"]
    req("PATCH", "/meta?key=eq.last_eod_at", {"value": str(data["last_date"])})
    print(f"[supabase] 적재 완료 (기준일 {data['last_date']}): "
          f"trades {len(data['trades'])} · legs {len(legs)} · executions {len(data['executions'])} · "
          f"nav {len(data['nav_daily'])} · positions {len(data['position_snapshots'])} · "
          f"monthly {len(data['monthly_stats'])} · order_plan {len(data['daily_order_plan'])} · "
          f"candidates {len(data['daily_candidates'])} · counts {len(data['daily_counts'])}")


def notify_eod(data):
    """마감 결과 + 내일 세팅할 감시주문(실제 가격·수량)을 상세히 전송."""
    last = data["last_date"]
    nav = data["nav_daily"][-1]
    ACT = {"buy_new": "신규매수", "buy_add": "추가매수", "stop": "손절", "newlow_stop": "신저가손절"}
    ACT.update({f"sell_{i}": f"{i}차매도" for i in range(1, N_STAGES + 1)})   # ★N단계 일반화
    le = [e for e in data["executions"] if e["d"] == last]
    filled = [e for e in le if not e["blocked_by_leverage"]]
    blocked = [e for e in le if e["blocked_by_leverage"]]

    lines = [f"✅ <b>[S2] {last} 마감 결과</b>",
             f"NAV {nav['nav']/1e8:.2f}억 · 보유 {nav['n_positions']}종목 · 레버 {nav['leverage']:.2f}배"]

    # 오늘 체결
    def pf(p):  # 포트% 표기
        return f" (포트 {p:.1f}%)" if p is not None else ""
    if filled:
        lines.append(f"\n📌 <b>오늘 체결 {len(filled)}건</b>")
        for e in filled[:12]:
            lines.append(f" · {ACT.get(e['action'], e['action'])} {e['name'][:6]} "
                         f"{e['fill_price']:,}원{pf(e.get('port_pct'))}")
        if len(filled) > 12:
            lines.append(f" · … 외 {len(filled)-12}건")
    else:
        lines.append("\n📌 오늘 체결 없음")
    if blocked:
        lines.append(f"⚠ 레버 한도 미체결 {len(blocked)}건: " + ", ".join(e["name"][:6] for e in blocked[:8]))

    # 보유 요약(평가손익)
    snaps = [s for s in data["position_snapshots"] if s["d"] == last]
    if snaps:
        lines.append(f"\n💼 <b>보유 {len(snaps)}종목</b>")
        for s in sorted(snaps, key=lambda s: -s["eval_amount"])[:8]:
            sign = "+" if s["eval_pnl"] >= 0 else ""
            lines.append(f" · {s['name'][:6]} 평단 {s['avg_buy']:,} → {s['last_close']:,} "
                         f"({sign}{s['ret_pct']:.1f}%)")

    # 내일 세팅 감시주문 (실제 가격·수량)
    plan = data["daily_order_plan"]
    # ★현금 파킹 목표 — 종목 주문과 섞이지 않게 따로 먼저 알린다
    _pk = [o for o in plan if o["order_type"] == "cash_park"]
    if _pk:
        o = _pk[0]
        lines.append(f"\n🏦 <b>현금 파킹</b>")
        lines.append(f" · {o['name'][:12]}({o['ticker']}) 목표 {o['qty']:,}주"
                     f" ≈ {o['trigger_price'] * o['qty']:,}원{pf(o.get('port_pct'))}")
        lines.append(f" · 매수 신호가 뜨면 필요한 만큼 <b>먼저 매도</b>한다")
    if plan:
        lines.append(f"\n📋 <b>내일 세팅 감시주문</b>")
        bytk = {}
        for o in plan:
            if o["order_type"] == "cash_park":
                continue                      # ★위에서 따로 냈다
            bytk.setdefault(o["ticker"], []).append(o)
        for i, (tk, os_) in enumerate(bytk.items()):
            if i >= 15:
                lines.append(f" … 외 {len(bytk)-15}종목"); break
            lines.append(f"<b>{os_[0]['name'][:6]}</b>")
            for o in [x for x in os_ if x["order_type"] == "buy_add"]:
                lines.append(f"  · {o['stage']}차 매수 {o['trigger_price']:,}원{pf(o.get('port_pct'))}")
            sells = sorted([x for x in os_ if x["order_type"] == "sell"], key=lambda x: x["stage"])
            if sells:
                # ★N단계 일반화 — 마지막 단계(잔량)까지 포함해 전 단계 비중을 나열한다.
                _pcts = [round(x * 100, 3) for x in SELL_STAGE_PCTS]
                _pcts.append(round(100 - sum(_pcts), 3))
                _plabel = "/".join(f"{x:g}" for x in _pcts)
                # ★조건부 매도 대응 — 전역 S 가 아니라 **그 포지션의 목표**를 표시한다.
                #   안 고치면 MA120 위 종목이 가격은 맞는데 라벨만 +3/+5/+7 로 틀리게 나간다.
                lines.append(f"  · 매도({_plabel}) " + " / ".join(
                    f"+{ORD_TGT_PCT.get((o['ticker'], o['stage']), S[o['stage']-1])*100:g}%"
                    f" {o['trigger_price']:,}" for o in sells))
            for o in [x for x in os_ if x["order_type"] in ("stop", "newlow_stop")]:
                lab = "손절" if o["order_type"] == "stop" else "신저가손절"
                lines.append(f"  · {lab} {o['trigger_price']:,}원")
    else:
        lines.append("\n📋 내일 감시주문 없음(보유 없음)")

    lines.append("\n🔗 상세: 홈 화면(동시호가 후보·감시주문·보유)")
    telegram_send("\n".join(lines))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--end", default=None, help="시뮬레이션 종료일 YYYY-MM-DD (기본 캐시 최신일)")
    ap.add_argument("--start", default=None,
                    help="★시뮬레이션 시작일 YYYY-MM-DD (기본 없음 = 종전 = 전 구간). "
                         "재현 검증용 스모크 창(smoke.py SMOKE_A = 2021-01-01..2022-12-31)에 쓴다. "
                         "지표는 전 구간으로 계산한 뒤 잘라내므로 워밍업은 보존된다")
    ap.add_argument("--dry-run", action="store_true", help="Supabase 없이 로컬 CSV + 요약")
    ap.add_argument("--no-notify", action="store_true", help="텔레그램 알림 생략")
    args = ap.parse_args()

    cfg = Config(); cfg.lookback_days = WINDOW
    end = date.fromisoformat(args.end) if args.end else date.today()
    start = date.fromisoformat(args.start) if args.start else None
    # 기준자본 — 환경변수 S2_BASE_CAP 으로 오버라이드 가능 (예: "100000000" = 1억).
    base_cap = float(os.environ.get("S2_BASE_CAP", "100000000"))
    print(f"S2 EOD 익스포터 — 종료일 {end}, 기준자본 {base_cap:,.0f}원")
    px, nmap, mmap, period_start, sm, smy = load(cfg, end, start)
    data = simulate(px, nmap, mmap, period_start, sm, smy, base_cap)

    # ★유효봉 가드가 실제로 막은 횟수 (2026-08-07 이식)
    _tot = sum(VB_SKIP.values())
    print(f"[유효봉 가드] {'ON' if VALID_BAR else 'OFF(S2_VALID_BAR=0)'} · "
          f"차단 {_tot}건 — 손절 {VB_SKIP['stop']} · 추가매수 {VB_SKIP['add']} · "
          f"신저가손절 {VB_SKIP['newlow']} · min_low오염 {VB_SKIP['minlow']}")
    if VB_SKIP["minlow"]:
        print(f"  ★min_low 오염 차단 {VB_SKIP['minlow']}건 — 막지 않았다면 "
              f"그 포지션들의 신저가 손절이 영구 비활성화됐다.")

    # ★유령 체결 가드 발동 카운터 (§4-2d #2 — 「0건이라 효과 없음」과 「코드가 안 돌아 0건」을 가른다)
    if PH_MODE != "off":
        _pt = sum(PH_N.values())
        _pa = sum(PH_ACTUAL.values())   # ★CAND-2026-08-24-202 — 「검사통과」와 「실제차단」분리
        print(f"[GUARD:PHANTOM] MODE={PH_MODE} · MAXR={PH_MAXR:g} · HALT={PH_HALT} · "
              f"ERA={PH_ERA or '전구간'} · "
              f"검사통과 {_pt}건(주문측 스케일 {PH_N['plan_scale']} / 정지 {PH_N['plan_halt']} · "
              f"원장측 스케일 {PH_N['fill_scale']} / 정지 {PH_N['fill_halt']}) · "
              f"★실제차단 {_pa}건(주문측 스케일 {PH_ACTUAL['plan_scale']} / 정지 {PH_ACTUAL['plan_halt']} · "
              f"원장측 스케일 {PH_ACTUAL['fill_scale']} / 정지 {PH_ACTUAL['fill_halt']})")
        for _r in PH_LOG[:20]:
            _ref = "-" if _r[5] is None else format(_r[5], ",.0f")
            print(f"  ★{_r[0]} {_r[1]} {_r[2]} {_r[3]} trigger={_r[4]:,} ref={_ref} 값={_r[6]:.4f}")
        if PH_RC and _pt:
            print("  ⚠️★S2_PHANTOM_RC=1 — 종료코드 9 로 끕난다(감사 경로 전용).")
            import atexit
            atexit.register(lambda: os._exit(9))

    # ★★유동성 참여율 상한 발동 카운터 (§4-2d 관문 2 · CAND-2026-08-24-240)
    #   ⚠️★cut = 0 이면 「효과 없음」이 아니라 ★먼저 「eval 이 0인가」를 본다 —
    #     eval 이 0이면 ★맵이 안 채워진 것(코드가 안 돌았다)이고, eval 이 크고 cut 이 0이면
    #     ★진짜로 상한에 걸린 매수가 없는 것이다.
    if LIQ_ON:
        print("[LIQ] ★평가 %d건 → ★축소 %d건 (그중 상한 0 = %d) · "
              "재배분 적립 %d · 인출 %d · PART_MAX=%.4f · LEGS=%s · REALLOC=%s"
              % (LIQ_N["eval"], LIQ_N["cut"], LIQ_N["zero"],
                 LIQ_N["ra_in"], LIQ_N["ra_out"], LIQ_PART_MAX, LIQ_LEGS, LIQ_RA))

    # ★★CA 리스케일 발동 카운터 (§4-2d 관문 2 · CAND-2026-08-22-19) — 게이트 on 일 때만 출력
    #   ⚠️★hit = 0 이면 「효과 없음」이 아니라 ★먼저 「표적이 정말 없는가」를 묻는다.
    #     분모(보유x거래일)가 함께 나오므로 「코드가 안 돌았다」와 구별된다 —
    #     ★분모가 0 이면 루프 자체를 안 탄 것이고, 분모가 크고 hit 이 0 이면 진짜 표적 0 이다.
    if CA_ADJUST:
        print(f"[CA-ops] ★발동 {CA_N['hit']}건 "
              f"(리스케일 {CA_N['rescale']} · 단주소멸 {CA_N['delist']}) / "
              f"탐색 모집단 {CA_N['seen_pos_day']:,} 보유x거래일 · CA사건 사전 {len(CA_MAP):,}건")

    # ★손절선 버퍼 발동 카운터 (§4-1b 사문 관문 #2) — DAY_BUF > 0 일 때만 출력
    if DAY_BUF > 0:
        print(f"[day-buf] 손절선 설정 {DAY_BUF_N['assign']}회 "
              f"(실제 하향 {DAY_BUF_N['lower']}회) · "
              f"손절 청산 {DAY_BUF_N['hit_buf'] + DAY_BUF_N['hit_gap']}건 = "
              f"버퍼선 체결 {DAY_BUF_N['hit_buf']} + 갭하락 시가 체결 {DAY_BUF_N['hit_gap']}(마진 무관)")

    # ★참여율 마진 발동 카운터 (§4-1b 사문 관문 #2) — SLIP_K > 0 일 때만 출력
    #   ⚠️fire = 0 이면 「효과가 없다」가 아니라 ★「코드가 안 돌았다」를 먼저 의심한다.
    #     eval(계산 시도) 대비 fire(실제 하향) / flat(호가단위상 무변화) / nodenom(분모 결측)
    #     의 내역이 함께 나오므로 둘을 구분할 수 있다.
    if SLIP_ON:
        print(f"[slip] 마진 계산 {SLIP_N['eval']}건 → ★체결가 하향 {SLIP_N['fire']}건 "
              f"(호가단위상 무변화 {SLIP_N['flat']} · 분모결측 {SLIP_N['nodenom']} · "
              f"상한 {SLIP_N['cap']} · 이음매가드 {SLIP_N['seam']})")
        print(f"[slip] 경로별 하향 — 손절선(DAYBUF) {SLIP_N['f_stop_stage']} · "
              f"목표가매도 {SLIP_N['f_sell']} · 신저가손절 {SLIP_N['f_newlow_stop']} · "
              f"기간손절 {SLIP_N['f_time_stop']}")
        print(f"[slip] 추가 할인 누적 {SLIP_N['disc']:,.0f}원 "
              f"(하향된 leg 의 마진 전 매도액 {SLIP_N['amt']:,.0f}원 대비 "
              f"{(SLIP_N['disc'] / SLIP_N['amt'] * 100) if SLIP_N['amt'] > 0 else 0:.3f}%) · "
              f"최대 추정참여율 {SLIP_N['est_max'] * 100:.3f}% · 최대 마진 {SLIP_N['m_max'] * 100:.3f}%")

    # ── ★★[2026-08-24 신설 · CAND-2026-08-24-2] ★용량 지표 — 체결 현실성의 1차 판정자
    #   [왜] §4-1b 면제 2(체결 현실성) 후보의 성공 기준은 ★「CAGR 이 오른다」가 아니라
    #     ★「백테스트 수치가 ★실제로 달성 가능해진다」다. ★그 자가 없어서
    #     `CAND-2026-08-23-125`(T1)가 ★목적을 못 재고 ★잘못 기각됐다(해달별님이 잡았다).
    #     ★S2 에도 같은 벽에 막힌 후보가 셋 — `-23-126` · `-19-9` · `-19-18`.
    #   [정의] 한 거래의 ★누적 매수액(`max_invested`) ÷ ★진입일 ★med20 거래대금
    #     = ★「이 거래에 넣은 돈이 ★진입일 그 종목 ★하루 거래대금의 몇 %인가」.
    #   ⚠️★★T1 은 `med20 거래량 x 진입가`로 ★추정한다(그 DB 에 거래대금 열이 없다).
    #     ★★S2 는 `trading_value` 가 ★직접 있어 ★추정이 필요 없다 — ★분모 정의가 ★다르다.
    #     ★로그에 `(tv)` 를 붙여 구분한다. ⚠️★두 시스템의 `cum_max` 를 ★나란히 비교하지 말 것.
    #   [게이트] `S2_CAPACITY_LOG=1` — ★미설정 = off = ★비트 동일(계산 자체를 안 한다).
    #   [계약] rc 를 안 바꾸고 예외를 밖으로 안 내보낸다. ★진입 집합을 안 건드린다.
    #     ⚠️★`rc` 를 신호로 쓰지 않는다 — `run_eod.ps1:247` 이 `$LASTEXITCODE` 를 안 잡는다.
    #   ⚠️★`shift(1)` 이 핵심 — 당일 거래대금을 쓰면 ★룩어헤드다.
    if os.environ.get("S2_CAPACITY_LOG", "").strip() in ("1", "on", "true"):
        try:
            _ct = pd.DataFrame(data["trades"])
            _ct = _ct[_ct["status"] == "closed"] if not _ct.empty else _ct
            if len(_ct) and "trading_value" in px.columns:
                _cq = px[["ticker", "date", "trading_value"]].copy()
                _cq["date"] = _cq["date"].astype(str).str[:10]
                _cq["tv20"] = (_cq.groupby("ticker", sort=False)["trading_value"]
                               .transform(lambda s: s.shift(1)
                                          .rolling(20, min_periods=20).median()))
                _tv = dict(zip(_cq["ticker"].astype(str) + "|" + _cq["date"], _cq["tv20"]))
                _rr = []
                for _t in _ct.itertuples(index=False):
                    _d = _tv.get("%s|%s" % (_t.ticker, str(_t.entry_date)[:10]))
                    if _d is None or not (_d > 0):
                        continue
                    _rr.append((float(_t.max_invested) / float(_d) * 100.0, float(_d)))
                if _rr:
                    # ⚠️★★[2026-08-24 보강] ★최댓값만 찍으면 ★오독한다 —
                    #   ★후행 `med20` 분모는 ★★유동성 국면이 ★끊기는 지점에서 ★깨진다.
                    #   ★실측 — `232830`(2023-06-29)은 ★진입 전 20일 med20 ★**127만원**이다가
                    #   ★진입일에 ★**6,595억**으로 폭발했다(신규·재상장형).
                    #   ★★그 한 건이 최댓값을 4567% 로 만들고
                    #   ★★**나머지 134건의 진짜 분포(최대 1.94%)를 통째 가린다.**
                    #   ★따라서 p99 · 분모 미달 건수를 함께 찍어 자가진단하게 한다.
                    _s = pd.Series([x for x, _ in _rr])
                    _lo = sum(1 for _, _d2 in _rr if _d2 < 1e8)
                    _hi = pd.Series([x for x, _d2 in _rr if _d2 >= 1e8])
                    print("  [GUARD:CAPACITY] ★cum_max %.3f%% (tv) · p99 %.3f%% · "
                          ">7.5%% %d · >10%% %d · 중앙 %.3f%% · "
                          "거래 %d/%d"
                          % (_s.max(), _s.quantile(0.99), int((_s > 7.5).sum()),
                             int((_s > 10).sum()), _s.median(), len(_s), len(_ct)))
                    print("  [GUARD:CAPACITY] ★분모<1억 %d건 제외 "
                          "★최대 %s · >7.5%% %s"
                          % (_lo, ("%.3f%%" % _hi.max()) if len(_hi) else "-",
                             ("%d" % int((_hi > 7.5).sum())) if len(_hi) else "-"))
                else:
                    print("  [GUARD:CAPACITY] SKIP - med20 \ubd84\ubaa8 0\uac74")
            else:
                print("  [GUARD:CAPACITY] SKIP - closed %d \u00b7 tv\uc5f4 %s"
                      % (len(_ct), "trading_value" in px.columns))
        except Exception as _ce:                                 # noqa: BLE001
            print("  [GUARD:CAPACITY] SKIP %s: %s" % (type(_ce).__name__, _ce))

    # ★CAND-2026-08-24-203 — daily_order_plan 일별 아카이브(기본 off · env 로 켠다)
    #   ⚠️dry-run·live 양쪽에 적용 — Supabase 전삭제-재적재로 사라지는 이력을 로컬에 남긴다.
    archive_order_plan(data["daily_order_plan"], data["last_date"])

    if args.dry_run:
        dry_run_dump(data, base_cap)
    else:
        upsert_supabase(data)
        if not args.no_notify:
            notify_eod(data)
    print("DONE")


if __name__ == "__main__":
    main()
