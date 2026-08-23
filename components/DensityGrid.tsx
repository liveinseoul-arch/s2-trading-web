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

const PITCH = 14; // 셀 12px + gap 2px

type Tip = { x: number; y: number; cell: Cell } | null;

function YearRow({ g, perf }: { g: YearGrid; perf?: YearPerf }) {
  const [tip, setTip] = useState<Tip>(null);
  const boxRef = useRef<HTMLDivElement>(null);

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

  const onEnter = useCallback((e: React.MouseEvent, c: Cell) => {
    const r = boxRef.current?.getBoundingClientRect();
    setTip({ x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0), cell: c });
  }, []);

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
                    return (
                      <i
                        key={row}
                        className="h-3 w-3 cursor-pointer rounded-[2.5px] transition-transform hover:scale-[1.4]"
                        style={{
                          background: `var(--dens-${lv})`,
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
            className="pointer-events-none absolute z-20 max-w-[260px] rounded-lg border border-[var(--color-borderc)] bg-bg px-3 py-2 text-xs shadow-lg"
            style={{ left: tip.x + 14, top: tip.y + 14 }}
            role="status"
          >
            <div className="tnum mb-1 text-[13px] font-semibold">
              {tip.cell.date} ({WD[tip.cell.row]})
            </div>
            <div className="flex justify-between gap-4 text-muted">
              <span>발생 건수</span>
              <b className="tnum font-medium text-textc">{tip.cell.n}건</b>
            </div>
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
}: {
  grids: YearGrid[];
  perf: Record<string, YearPerf>;
}) {
  return (
    <div className="flex flex-col">
      {grids.map((g) => (
        <YearRow key={g.year} g={g} perf={perf[String(g.year)]} />
      ))}
    </div>
  );
}
