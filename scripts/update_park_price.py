# -*- coding: utf-8 -*-
r"""★파킹 자산 가격 CSV 갱신 — run_eod.ps1 이 export_eod.py 「앞에서」 부른다 (2026-08-12)

[왜 필요한가] `export_eod.py` 의 `S2_CASH_PARK` 는 가격을
 `quant_infra/data/kr_bond_etf/<티커>_*.csv` 에서 읽는다.
 ⚠️★**DB 를 못 쓰는 이유** — `stock_cache*.db` 의 ETF 는 **2019-03-08 에서 끊긴다**
 (2019-03-11 수집 경로 전환 때 적재 필터가 ETF 를 배제. 생존편향과 같은 뿌리).

[설계 원칙] ★**실패해도 EOD 를 죽이지 않는다.**
 네트워크·FDR 이 안 되면 **기존 CSV 를 그대로 두고 rc=0 으로 끝낸다.**
 가격이 낡으면 `export_eod.py` 가 주문계획 note 에 경고를 붙인다(5일 초과).

[안전] ★기존 CSV 를 덮어쓰기 전에 **행이 줄지 않았는지** 확인한다.
 줄었으면 쓰지 않는다(부분 응답으로 이력을 날리는 것을 막는다).
"""
import io
import os
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", line_buffering=True)

TK = os.environ.get("S2_CASH_PARK", "").strip()
DIR = os.environ.get("S2_CASH_PARK_DIR", r"c:\AI파운더스\quant_infra\data\kr_bond_etf")
START = "2014-01-01"

if not TK:
    print("  [park-price] S2_CASH_PARK 미설정 — skip")
    raise SystemExit(0)

try:
    import glob

    import pandas as pd

    hits = glob.glob(os.path.join(DIR, "%s_*.csv" % TK))
    if not hits:
        print("  ⚠️[park-price] %s 의 CSV 가 %s 에 없다 — skip" % (TK, DIR))
        raise SystemExit(0)
    path = hits[0]
    old = pd.read_csv(path)
    old["date"] = pd.to_datetime(old["date"])

    import FinanceDataReader as fdr
    new = fdr.DataReader(TK, START)
    if new is None or not len(new):
        print("  ⚠️[park-price] FDR 빈 응답 — 기존 CSV 유지(%d행, %s)"
              % (len(old), str(old["date"].max())[:10]))
        raise SystemExit(0)
    new = new.reset_index()
    dc = new.columns[0]
    new = new.rename(columns={dc: "date"})
    new["date"] = pd.to_datetime(new["date"])
    new.columns = [str(c).lower() for c in new.columns]

    # ★행이 줄면 쓰지 않는다 — 부분 응답으로 이력을 날리지 않기 위해
    if len(new) < len(old):
        print("  ⚠️[park-price] 응답 %d행 < 기존 %d행 — ★쓰지 않는다(기존 유지)"
              % (len(new), len(old)))
        raise SystemExit(0)

    new.to_csv(path, index=False, encoding="utf-8-sig")
    print("  [park-price] %s %d행 → %d행 · 최신 %s 종가 %s원"
          % (TK, len(old), len(new), str(new["date"].max())[:10],
             format(round(float(new["close"].iloc[-1])), ",")))
except SystemExit:
    raise
except Exception as e:
    # ★어떤 예외도 EOD 를 죽이지 않는다
    print("  ⚠️[park-price] 갱신 실패(%s: %s) — 기존 CSV 로 진행한다"
          % (type(e).__name__, str(e)[:80]))
