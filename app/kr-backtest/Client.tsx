"use client";

import { useState } from "react";
import { Section } from "@/components/ui";
import { signClass } from "@/lib/format";
import detail from "./detail.json";

type SoldRow = [string, string, string, number, string]; // code, 매수일, 매도일, 수익률%, 사유
type HeldRow = [string, string, number | null, number | null];  // code, 매수일, 평가%, 비중%

const NAMES = detail.names as Record<string, string>;
const MDETAIL = detail.mdetail as unknown as Record<string, { sold: SoldRow[]; held: HeldRow[]; cash?: number | null }>;
const YDETAIL = detail.ydetail as unknown as Record<string, { sold: SoldRow[]; held: HeldRow[]; cash?: number | null }>;

// iret/imdd = KOSPI 동일 규칙(부분연도 반영, 연중 고점 대비 MDD)
const YEARLY: { year: number; ret: number; mdd: number; iret: number; imdd: number; n: number; win: number; avg: number }[] = [
  { year: 2017, ret: 5.0, mdd: -10.4, iret: 21.8, imdd: -5.4, n: 89, win: 21, avg: -2.1 },
  { year: 2018, ret: -5.9, mdd: -5.9, iret: -17.3, imdd: -23.2, n: 17, win: 35, avg: 0.9 },
  { year: 2019, ret: 0.4, mdd: -6.7, iret: 7.7, imdd: -14.6, n: 8, win: 50, avg: 2.8 },
  { year: 2020, ret: 20.6, mdd: -15.5, iret: 27.8, imdd: -34.5, n: 76, win: 28, avg: 2.0 },
  { year: 2021, ret: -15.8, mdd: -23.1, iret: 6.0, imdd: -11.9, n: 60, win: 18, avg: -2.4 },
  { year: 2022, ret: -26.3, mdd: -28.5, iret: -24.9, imdd: -27.9, n: 79, win: 16, avg: -5.2 },
  { year: 2023, ret: 60.9, mdd: -15.5, iret: 18.7, imdd: -12.8, n: 46, win: 28, avg: 13.8 },
  { year: 2024, ret: 8.6, mdd: -43.0, iret: -9.6, imdd: -17.5, n: 158, win: 22, avg: 1.0 },
  { year: 2025, ret: 27.2, mdd: -13.3, iret: 75.9, imdd: -12.3, n: 141, win: 30, avg: -0.2 },
  { year: 2026, ret: 118.2, mdd: -26.4, iret: 99.3, imdd: -15.9, n: 115, win: 40, avg: 19.1 },
];

const MONTHLY: Record<string, Record<number, number>> = {
  "2017": { 1: -1.4, 2: -2.2, 3: -3.4, 4: -1.6, 5: 1.4, 6: 14.2, 7: -2.4, 8: -0.3, 9: -4.9, 10: 2.2, 11: 10.3, 12: -5.2 },
  "2018": { 1: -2.4, 2: -1.0, 3: 0.0, 4: 0.0, 5: 0.0, 6: 0.0, 7: 0.0, 8: 0.0, 9: 0.0, 10: 0.0, 11: -1.9, 12: -0.7 },
  "2019": { 1: 0.3, 2: -0.4, 3: 0.0, 4: 0.0, 5: 0.0, 6: 0.0, 7: 0.0, 8: 0.0, 9: 0.2, 10: 4.4, 11: -4.0, 12: 0.0 },
  "2020": { 1: 0.0, 2: -0.8, 3: -2.0, 4: -0.6, 5: 3.3, 6: 4.0, 7: 11.2, 8: 13.3, 9: -11.2, 10: -1.3, 11: 0.8, 12: 4.3 },
  "2021": { 1: -10.4, 2: -1.2, 3: -1.2, 4: 0.0, 5: 0.0, 6: 0.0, 7: 0.0, 8: 0.0, 9: 6.1, 10: -10.0, 11: 2.1, 12: -1.3 },
  "2022": { 1: 0.0, 2: 0.0, 3: 2.1, 4: -5.3, 5: -6.8, 6: -7.1, 7: -2.0, 8: 2.2, 9: -4.3, 10: -1.0, 11: 0.2, 12: -7.4 },
  "2023": { 1: 0.6, 2: 14.6, 3: 17.6, 4: 11.1, 5: -9.6, 6: 10.8, 7: 20.9, 8: 1.8, 9: -7.7, 10: -8.0, 11: 1.1, 12: 0.7 },
  "2024": { 1: -1.6, 2: 22.8, 3: 6.0, 4: 4.3, 5: 14.9, 6: 11.4, 7: -5.0, 8: -20.1, 9: -4.8, 10: 2.8, 11: -14.2, 12: -0.3 },
  "2025": { 1: 0.5, 2: -3.2, 3: -2.6, 4: -1.6, 5: -0.2, 6: 16.1, 7: -4.1, 8: 5.7, 9: -0.7, 10: 21.0, 11: -6.8, 12: 3.5 },
  "2026": { 1: 22.6, 2: 30.8, 3: -18.5, 4: 14.5, 5: 42.2, 6: 2.6 },
};

const TH = "px-2 py-1.5 text-right font-medium whitespace-nowrap";
const TD = "px-2 py-1.5 text-right whitespace-nowrap tnum";
const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
const nm = (code: string) => {
  const n = NAMES[code];
  const c6 = code.replace(/\.(KS|KQ)$/, "");
  if (!n) return c6;
  const short = n.length > 10 ? n.slice(0, 10) + "…" : n;
  return `${short} (${c6})`;
};

const dshort = (d: string, y?: string) => (y ? d.slice(5) : d);   // 연도 패널: 항상 MM-DD

function HeldTable({ rows, stripYear }: { rows: HeldRow[]; stripYear?: string }) {
  if (!rows.length) return <div className="text-xs text-muted">없음</div>;
  const wsum = rows.reduce((s, h) => s + (h[3] ?? 0), 0);
  return (
    <div className="max-h-80 overflow-auto">
      <table className="w-full text-xs text-muted">
        <thead>
          <tr className="border-b border-[var(--color-borderc)]">
            <th className="px-2 py-1 text-left font-medium">종목</th>
            <th className={TH}>매수일</th>
            <th className={TH}>평가 (%)</th>
            <th className={TH}>비중 (%)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h, i) => (
            <tr key={i} className="border-b border-[var(--color-borderc)] last:border-0">
              <td className="px-2 py-1 whitespace-nowrap">{nm(h[0])}</td>
              <td className={TD}>{dshort(h[1], stripYear)}</td>
              <td className={`${TD} ${signClass(h[2] ?? 0)}`}>{fmt(h[2])}</td>
              <td className={`${TD} font-medium`}>{h[3] === null ? "—" : h[3].toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-[var(--color-borderc)]">
            <td className="px-2 py-1 text-muted" colSpan={3}>표시 보유 합계</td>
            <td className={`${TD} font-medium`}>{wsum.toFixed(1)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function SoldTable({ rows, stripYear }: { rows: SoldRow[]; stripYear?: string }) {
  if (!rows.length) return <div className="text-xs text-muted">없음</div>;
  return (
    <div className="max-h-80 overflow-auto">
      <table className="w-full text-xs text-muted">
        <thead>
          <tr className="border-b border-[var(--color-borderc)]">
            <th className="px-2 py-1 text-left font-medium">종목</th>
            <th className={TH}>매수일</th>
            <th className={TH}>매도일</th>
            <th className={TH}>수익률 (%)</th>
            <th className="px-2 py-1 text-left font-medium">사유</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => (
            <tr key={i} className="border-b border-[var(--color-borderc)] last:border-0">
              <td className="px-2 py-1 whitespace-nowrap">{nm(s[0])}</td>
              <td className={TD}>{dshort(s[1], stripYear)}</td>
              <td className={TD}>{dshort(s[2], stripYear)}</td>
              <td className={`${TD} ${signClass(s[3])}`}>{fmt(s[3])}</td>
              <td className="px-2 py-1 whitespace-nowrap">{s[4]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CashLine({ cash }: { cash?: number | null }) {
  if (cash === undefined || cash === null) return null;
  return (
    <div className="mb-1 text-xs text-muted">
      기말 현금 비중: <span className="tnum font-medium">{cash.toFixed(1)}%</span>
      {cash < 0 && " (마진 차입 사용 중)"}
    </div>
  );
}

function DetailPanel({ title, d, variant, year }: { title: string; d: { sold: SoldRow[]; held: HeldRow[]; cash?: number | null }; variant: "month" | "year"; year?: string }) {
  const wins = d.sold.filter((s) => s[3] > 0);
  const losses = d.sold.filter((s) => s[3] <= 0);
  return (
    <div className="mt-3 rounded-xl border border-[var(--color-borderc)] bg-surface p-3">
      <div className="mb-2 text-sm font-bold text-accent">{title}</div>
      {variant === "month" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-medium text-muted">
              월말 보유 종목 ({d.held.length}) — 평가는 매수가 대비 월말 종가
            </div>
            <CashLine cash={d.cash} />
            <HeldTable rows={d.held} stripYear={year} />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-muted">청산 거래 ({d.sold.length})</div>
            <SoldTable rows={d.sold} stripYear={year} />
          </div>
        </div>
      ) : (
        <>
          <div className="mb-1 text-xs font-medium text-muted">
            기말 보유 종목 ({d.held.length}) — 평가는 매수가 대비 기말 종가
          </div>
          <CashLine cash={d.cash} />
          <HeldTable rows={d.held} stripYear={year} />
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-medium text-muted">수익 청산 ({wins.length})</div>
              <SoldTable rows={wins} stripYear={year} />
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-muted">손실 청산 ({losses.length})</div>
              <SoldTable rows={losses} stripYear={year} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function KrBacktestClient() {
  const [selYear, setSelYear] = useState<string | null>(null);
  const [selMonth, setSelMonth] = useState<string | null>(null);
  const years = Object.keys(MONTHLY).sort().reverse();
  const yd = selYear ? YDETAIL[selYear] : null;
  const md = selMonth ? MDETAIL[selMonth] : null;

  return (
    <>
      <Section title="연도별 성과" sub="연도를 클릭하면 그 해의 거래기록·연말 보유 현황. 2017·2026은 부분연도.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-muted">
            <thead>
              <tr className="border-b border-[var(--color-borderc)] text-accent">
                <th className="px-2 py-1.5 text-left font-medium">연도</th>
                <th className={TH}>수익률 (%)</th>
                <th className={TH}>연중 MDD (%)</th>
                <th className={TH}>KOSPI (%)</th>
                <th className={TH}>지수 MDD (%)</th>
                <th className={TH}>거래수</th>
                <th className={TH}>승률 (%)</th>
                <th className={TH}>평균수익 (%)</th>
              </tr>
            </thead>
            <tbody>
              {[...YEARLY].reverse().map((y) => (
                <tr
                  key={y.year}
                  onClick={() => { setSelYear(selYear === String(y.year) ? null : String(y.year)); setSelMonth(null); }}
                  className={`cursor-pointer border-b border-[var(--color-borderc)] last:border-0 hover:bg-bg ${selYear === String(y.year) ? "bg-bg" : ""}`}
                >
                  <td className="px-2 py-1.5 font-medium text-accent">{y.year}</td>
                  <td className={`${TD} ${signClass(y.ret)}`}>{fmt(y.ret)}</td>
                  <td className={TD}>{y.mdd.toFixed(1)}</td>
                  <td className={`${TD} ${signClass(y.iret)}`}>{fmt(y.iret)}</td>
                  <td className={TD}>{y.imdd.toFixed(1)}</td>
                  <td className={TD}>{y.n}</td>
                  <td className={TD}>{y.win}</td>
                  <td className={`${TD} ${signClass(y.avg)}`}>{fmt(y.avg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {yd && selYear && (
          <DetailPanel variant="year" year={selYear} title={`${selYear}년 거래기록 · ${selYear === "2026" ? "2026-06-30" : "연말"} 보유`} d={yd} />
        )}
      </Section>

      <Section title="월별 수익률 (%)" sub="월 수익률을 클릭하면 그 달의 매도 종목·월말 보유 현황. 월말 평가자산 기준.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-muted">
            <thead>
              <tr className="border-b border-[var(--color-borderc)] text-accent">
                <th className="px-2 py-1.5 text-left font-medium">연도</th>
                {Array.from({ length: 12 }, (_, i) => (
                  <th key={i} className={TH}>{i + 1}월</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {years.map((y) => (
                <tr key={y} className="border-b border-[var(--color-borderc)] last:border-0">
                  <td className="px-2 py-1.5">{y}</td>
                  {Array.from({ length: 12 }, (_, i) => {
                    const v = MONTHLY[y][i + 1];
                    const key = `${y}-${String(i + 1).padStart(2, "0")}`;
                    const clickable = v !== undefined;
                    return (
                      <td
                        key={i}
                        onClick={() => { if (clickable) { setSelMonth(selMonth === key ? null : key); setSelYear(null); } }}
                        className={`${TD} ${v === undefined ? "" : signClass(v)} ${clickable ? "cursor-pointer hover:bg-bg" : ""} ${selMonth === key ? "bg-bg font-bold" : ""}`}
                      >
                        {fmt(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {md && selMonth && <DetailPanel variant="month" year={selMonth.slice(0, 4)} title={`${selMonth} 보유·청산`} d={md} />}
      </Section>
    </>
  );
}
