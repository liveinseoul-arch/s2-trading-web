"use client";
// S2 급락 후보 잔디밭 — 연도별 52×5 달력 격자.
//
// 한 칸이 하루. 세로 5칸이 월–금, 가로 한 칸이 한 주.
// 연도는 최근이 위, 한 해 안에서는 왼쪽이 1월.
//
// ★색은 로그 구간이다(1 / 2 / 3–4 / 5–8 / 9+) — 0건인 날이 82%라
//   선형으로 칠하면 거의 다 같은 색으로 보인다.
// ★과밀일은 빨간 테두리 + 주별 띠. 한국식 색관례상 빨강은 상승이지만
//   여기서는 「그날은 진입 문턱이 완화된다」는 표시다(해달별님 지정).
import { useCallback, useRef, useState } from "react";
import { levelOf, colsInYear, WD, type YearGrid, type Cell } from "@/lib/s2Density";
import type { YearPerf } from "@/lib/s2YearPerf";
import type { EntryReturn } from "@/lib/s2EntryReturn";

const PITCH = 14; // 셀 12px + gap 2px

type Tip = { x: number; y: number; cell: Cell } | null;

function YearRow({
  g,
  perf,
  ret,
  day,
}: {
  g: YearGrid;
  perf?: YearPerf;
  ret: Record<string, EntryReturn>;
  day: Record<string, { lev: number; nPos: number }>;
}) {
  const [tip, setTip] = useState<Tip>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  // (col,row) → 셀
  const byPos = new Map<string, Cell>();
  for (const c of g.cells) byPos.set(`${c.col}:${c.row}`, c);
  const last = g.cells[g.cells.length - 1]?.date ?? "";
  const cols = colsInYear(g.year);

  // 주별 과밀일 수 → 띠 농도
  const bandLv = (col: number) => {
    let k = 0;
    for (let r = 0; r < 5; r++) if (byPos.get(`${col}:${r}`)?.crowded) k++;
    return k === 0 ? 0 : k === 1 ? 1 : k <= 3 ? 2 : 3;
  };

  // 월 눈금 — 그 달의 첫 셀 위치
  const monthTicks: Array<{ m: number; left: number }> = [];
  const seen = new Set<string>();
  for (const c of [...g.cells].sort((a, b) => a.date.localeCompare(b.date))) {
    const mm = c.date.slice(5, 7);
    if (seen.has(mm)) continue;
    seen.add(mm);
    monthTicks.push({ m: +mm, left: c.col * PITCH });
  }

  // ★★툴팁은 ★뷰포트 기준(fixed)으로 띄운다.
  //   ⚠️격자가 `overflow-x-auto` 안에 있어 ★absolute 로 두면 ★잘린다(2026-08-23 해달별님 지적).
  //   ★그래서 clientX/clientY 를 그대로 쓰고, ★화면 끝에서는 반대쪽으로 접는다.
  const onEnter = useCallback((e: React.MouseEvent, c: Cell) => {
    setTip({ x: e.clientX, y: e.clientY, cell: c });
  }, []);

  // ★툴팁 위치 — 오른쪽/아래로 14px 띄우되 ★화면을 넘으면 반대쪽으로 접는다.
  //   ★높이는 렌더 뒤에야 알 수 있으므로 ★실측값이 있으면 쓰고 없으면 보수적으로 어림한다.
  const TIP_W = 240;
  const TIP_H = tipRef.current?.offsetHeight ?? 150;
  const vw = typeof window === "undefined" ? 1200 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const tipPos = tip
    ? {
        left: tip.x + 14 + TIP_W > vw - 8 ? Math.max(8, tip.x - 14 - TIP_W) : tip.x + 14,
        top: tip.y + 14 + TIP_H > vh - 8 ? Math.max(8, tip.y - 14 - TIP_H) : tip.y + 14,
      }
    : undefined;

  const rp = perf?.retPct;

  return (
    <section className="grid grid-cols-1 gap-2 border-t border-[var(--color-borderc)] py-3 lg:grid-cols-[150px_1fr] lg:gap-4">
      <div className="flex items-baseline gap-3 lg:flex-col lg:items-start lg:gap-0.5 lg:pt-3.5">
        <b className="tnum text-xl font-semibold leading-none">{g.year}</b>
        {rp != null && (
          <span className="flex flex-nowrap items-baseline gap-1.5 whitespace-nowrap">
            <span className={`tnum text-sm font-semibold ${rp >= 0 ? "text-up" : "text-down"}`}>
              {rp >= 0 ? "+" : ""}
              {rp.toFixed(1)}%
            </span>
            <span className="tnum text-[11px] text-muted">MDD {perf!.mddPct.toFixed(1)}%</span>
            {perf!.partial && (
              <span className="rounded border border-[var(--color-borderc)] px-1 text-[9px] text-muted">부분</span>
            )}
          </span>
        )}
        <span className="text-[11px] leading-relaxed text-muted">
          <em className="tnum not-italic font-medium text-textc">{g.total.toLocaleString()}</em>건 · 발생{" "}
          <em className="tnum not-italic font-medium text-textc">{g.hitDays}</em>일
          <br className="hidden lg:block" />
          <span className="lg:hidden"> · </span>
          최대 <em className="tnum not-italic font-medium text-textc">{g.maxN}</em>건 · 과밀{" "}
          <em className="tnum not-italic font-medium text-textc">{g.crowdedDays}</em>일
        </span>
      </div>

      <div ref={boxRef} className="relative overflow-x-auto pb-0.5">
        <div className="flex min-w-max flex-col gap-1">
          {/* 월 눈금 */}
          <div className="relative h-3.5 pl-[18px]">
            {monthTicks.map((t) => (
              <span
                key={t.m}
                className="absolute whitespace-nowrap text-[10px] text-muted"
                style={{ left: t.left }}
              >
                {t.m}월
              </span>
            ))}
          </div>

          <div className="flex gap-0.5">
            {/* 요일 라벨 */}
            <div className="flex flex-col gap-0.5 pr-1.5">
              {WD.map((w) => (
                <i key={w} className="h-3 w-3 text-right text-[9px] not-italic leading-3 text-muted">
                  {w}
                </i>
              ))}
            </div>

            {/* 격자 */}
            <div className="flex gap-0.5">
              {Array.from({ length: cols }, (_, col) => (
                <div key={col} className="flex flex-col gap-0.5">
                  {Array.from({ length: 5 }, (_, row) => {
                    const c = byPos.get(`${col}:${row}`);
                    if (!c) {
                      // 그 해에 없는 날 / 아직 오지 않은 날 / 휴장일
                      const w0 = (new Date(Date.UTC(g.year, 0, 1)).getUTCDay() + 6) % 7;
                      const doy = col * 7 + row - w0 + 1;
                      const nd = Math.round(
                        (Date.UTC(g.year, 11, 31) - Date.UTC(g.year, 0, 1)) / 86400000,
                      ) + 1;
                      if (doy < 1 || doy > nd)
                        return <i key={row} className="h-3 w-3" aria-hidden="true" />;
                      const iso = new Date(Date.UTC(g.year, 0, 1) + (doy - 1) * 86400000)
                        .toISOString()
                        .slice(0, 10);
                      return iso > last ? (
                        <i
                          key={row}
                          className="h-3 w-3 rounded-[2.5px] border border-dashed border-[var(--color-borderc)]"
                          aria-hidden="true"
                        />
                      ) : (
                        <i
                          key={row}
                          className="h-3 w-3 rounded-[2.5px]"
                          style={{
                            background: "var(--dens-off)",
                            outline: "1px solid var(--dens-line)",
                            outlineOffset: "-1px",
                          }}
                          aria-hidden="true"
                        />
                      );
                    }
                    const lv = levelOf(c.n);
                    // ★★후보는 떴는데 ★진입이 0건인 날 — ★빨간 대각선으로 긋는다(해달별님 요청).
                    //   ⚠️★라벨을 「현금부족」으로 달지 않는다 — ★원인이 하나가 아니다.
                    //     실측 반례: 2026-06-29 는 ★전액 현금(보유 0종목)인데도 진입이 0이었다.
                    //     ★보이는 사실만 적는다 — 「후보 있었는데 못 샀다」.
                    const noEntry = c.n > 0 && !ret[c.date]?.n;
                    // ★색을 두 갈래로 — ★과밀일은 빨강 · ★비과밀일은 검정(해달별님 지정).
                    //   ★과밀일은 이미 빨간 테두리가 있어 ★같은 빨강이 한 덩어리로 읽히고,
                    //   ★비과밀일은 테두리가 없어 ★검정이 더 또렷하다.
                    const dc = c.crowded ? "var(--color-up)" : "var(--color-textc)";
                    const diag =
                      `linear-gradient(to bottom right, transparent calc(50% - 0.7px), ` +
                      `${dc} calc(50% - 0.7px), ${dc} calc(50% + 0.7px), ` +
                      `transparent calc(50% + 0.7px))`;
                    return (
                      <i
                        key={row}
                        className="h-3 w-3 cursor-pointer rounded-[2.5px] transition-transform hover:scale-[1.4]"
                        style={{
                          background: noEntry
                            ? `${diag}, var(--dens-${lv})`
                            : `var(--dens-${lv})`,
                          // ★0건인 날도 칸이 보이도록 옅은 윤곽(해달별님 요청).
                          //   ⚠️과밀일은 inset 테두리를 쓰므로 그때는 윤곽을 얹지 않는다(겹쳐 두꺼워진다).
                          outline: c.crowded ? undefined : "1px solid var(--dens-line)",
                          outlineOffset: "-1px",
                          boxShadow: c.crowded ? "inset 0 0 0 1.5px var(--color-up)" : undefined,
                        }}
                        onMouseEnter={(e) => onEnter(e, c)}
                        onMouseMove={(e) => onEnter(e, c)}
                        onMouseLeave={() => setTip(null)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* 과밀 주별 띠 */}
          <div className="flex gap-0.5 pl-[18px]">
            {Array.from({ length: cols }, (_, col) => {
              const lv = bandLv(col);
              return (
                <i
                  key={col}
                  className="block h-1 w-3 rounded-sm"
                  style={{
                    background:
                      lv === 0
                        ? "transparent"
                        : lv === 1
                          ? "color-mix(in srgb, var(--color-up) 17%, transparent)"
                          : lv === 2
                            ? "color-mix(in srgb, var(--color-up) 42%, transparent)"
                            : "var(--color-up)",
                  }}
                />
              );
            })}
          </div>
        </div>

        {tip && (
          <div
            ref={tipRef}
            className="pointer-events-none fixed z-50 w-[240px] rounded-lg border border-[var(--color-borderc)] bg-bg px-3 py-2 text-xs shadow-lg"
            style={tipPos}
            role="status"
          >
            <div className="tnum mb-1 text-[13px] font-semibold">
              {tip.cell.date} ({WD[tip.cell.row]})
            </div>
            <div className="flex justify-between gap-4 text-muted">
              <span>발생 건수</span>
              <b className="tnum font-medium text-textc">{tip.cell.n}건</b>
            </div>
            {(() => {
              // ★그날 ★진입한 거래의 수익률 — 실현손익 ÷ 1차매수 금액(해달별님 요구).
              //   ⚠️「발생」은 후보이고 「진입」은 그중 통과분이라 ★수가 다르다.
              //   ★★진입이 0 이어도 ★줄을 지우지 않는다 — 지우면
              //     「후보는 있었는데 못 샀다」와 「후보가 애초에 0건」이 ★구분이 안 된다
              //     (2026-08-23 해달별님 지적: 2026-06-08 후보 14건인데 수익률이 안 나왔다).
              const r = ret[tip.cell.date];
              const dd = day[tip.cell.date];
              if (!r && tip.cell.n === 0) return null;   // 후보도 진입도 0 — 보여줄 게 없다
              return (
                <>
                  <div className="flex justify-between gap-4 text-muted">
                    <span>진입 / 완결</span>
                    <b className="tnum font-medium text-textc">
                      {r ? `${r.n}건 / ${r.closed}건` : "0건"}
                    </b>
                  </div>
                  {dd && (
                    <div className="flex justify-between gap-4 text-muted">
                      <span>그날 레버 / 보유</span>
                      <b className={`tnum font-medium ${dd.lev > 1.2 ? "text-up" : "text-textc"}`}>
                        {dd.lev.toFixed(3)} / {dd.nPos}종목
                      </b>
                    </div>
                  )}
                  {!r && tip.cell.n > 0 && (
                    <div className="mt-1.5 border-t border-[var(--color-borderc)] pt-1 text-[11px] text-muted">
                      후보 {tip.cell.n}건인데 <b className="text-up">진입 0건</b>
                      {dd && dd.lev > 1.2 ? " — 레버 한도 초과" : ""}
                      <span className="block text-muted">격자에 빨간 대각선으로 표시된다.</span>
                    </div>
                  )}
                  {r && (
                  <div className="flex justify-between gap-4 text-muted">
                    <span>수익률</span>
                    {r.retPct == null ? (
                      <b className="tnum font-medium text-muted">미완결</b>
                    ) : (
                      <b className={`tnum font-semibold ${r.retPct >= 0 ? "text-up" : "text-down"}`}>
                        {r.retPct >= 0 ? "+" : ""}
                        {r.retPct.toFixed(2)}%
                      </b>
                    )}
                  </div>
                  )}
                  {r && r.retPct != null && (
                    <div className="flex justify-between gap-4 text-muted">
                      <span>실현손익</span>
                      <b className="tnum font-medium text-textc">
                        {Math.round(r.pnl / 1e4).toLocaleString("ko-KR")}만원
                      </b>
                    </div>
                  )}
                </>
              );
            })()}
            {tip.cell.roll >= 0 && (
              <div className="flex justify-between gap-4 text-muted">
                <span>15거래일 누적</span>
                <b className="tnum font-medium text-textc">{tip.cell.roll}건</b>
              </div>
            )}
            {tip.cell.thr >= 0 && (
              <div className="flex justify-between gap-4 text-muted">
                <span>과밀 문턱</span>
                <b className="tnum font-medium text-textc">{tip.cell.thr.toFixed(1)}</b>
              </div>
            )}
            {tip.cell.crowded && (
              <div className="mt-1.5 border-t border-[var(--color-borderc)] pt-1 text-[11px] font-semibold text-up">
                ★ 과밀일 — 진입 문턱 0.20 → 0.15 완화
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export function DensityGrid({
  grids,
  perf,
  ret,
  day,
}: {
  grids: YearGrid[];
  perf: Record<string, YearPerf>;
  ret: Record<string, EntryReturn>;
  day: Record<string, { lev: number; nPos: number }>;
}) {
  return (
    <div className="flex flex-col">
      {grids.map((g) => (
        <YearRow key={g.year} g={g} perf={perf[String(g.year)]} ret={ret} day={day} />
      ))}
    </div>
  );
}
