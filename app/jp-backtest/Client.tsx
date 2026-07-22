"use client";

import { useState } from "react";
import { Section } from "@/components/ui";
import { signClass } from "@/lib/format";
import detail from "./detail.json";

type SoldRow = [string, string, string, number, string]; // code, 매수일, 매도일, 수익률%, 사유
type HeldRow = [string, string, number | null];          // code, 매수일, 평가수익률%

const NAMES = detail.names as Record<string, string>;
const MDETAIL = detail.mdetail as unknown as Record<string, { sold: SoldRow[]; held: HeldRow[]; cash?: number | null }>;
const YDETAIL = detail.ydetail as unknown as Record<string, { sold: SoldRow[]; held: HeldRow[]; cash?: number | null }>;

// iret/imdd = 니케이225 동일 규칙(부분연도 반영, 연중 고점 대비 MDD)
const YEARLY: { year: number; ret: number; mdd: number; iret: number; imdd: number; n: number; win: number; avg: number }[] = [
  { year: 2017, ret: 3.0, mdd: -5.2, iret: 15.6, imdd: -4.0, n: 11, win: 45, avg: 3.0 },
  { year: 2018, ret: -9.2, mdd: -14.7, iret: -12.1, imdd: -21.1, n: 35, win: 17, avg: -2.9 },
  { year: 2019, ret: 7.8, mdd: -5.6, iret: 18.2, imdd: -9.2, n: 34, win: 44, avg: 1.1 },
  { year: 2020, ret: 4.0, mdd: -10.9, iret: 16.0, imdd: -31.3, n: 45, win: 33, avg: 1.9 },
  { year: 2021, ret: -8.7, mdd: -17.4, iret: 4.9, imdd: -11.3, n: 52, win: 25, avg: -1.6 },
  { year: 2022, ret: -1.0, mdd: -10.4, iret: -9.4, imdd: -15.7, n: 46, win: 28, avg: 1.8 },
  { year: 2023, ret: 6.9, mdd: -13.0, iret: 28.2, imdd: -9.6, n: 38, win: 32, avg: 0.6 },
  { year: 2024, ret: 22.1, mdd: -9.5, iret: 19.2, imdd: -25.5, n: 58, win: 45, avg: 4.4 },
  { year: 2025, ret: 26.4, mdd: -15.3, iret: 26.2, imdd: -22.3, n: 55, win: 33, avg: 3.3 },
  { year: 2026, ret: 59.3, mdd: -17.6, iret: 39.2, imdd: -13.2, n: 46, win: 46, avg: 19.7 },
];

const MONTHLY: Record<string, Record<number, number>> = {
  "2017": { 9: -0.3, 10: 2.5, 11: 6.5, 12: -5.2 },
  "2018": { 1: -0.8, 2: -0.2, 3: -1.0, 4: 0.6, 5: 4.7, 6: 0.1, 7: -2.1, 8: -1.8, 9: 4.3, 10: -5.5, 11: -0.7, 12: -6.6 },
  "2019": { 1: 0.5, 2: -1.9, 3: 0.5, 4: 2.7, 5: -5.6, 6: 1.4, 7: 2.8, 8: 1.2, 9: 3.4, 10: 5.4, 11: -3.3, 12: 0.8 },
  "2020": { 1: 1.1, 2: -6.1, 3: -2.4, 4: 0.6, 5: 9.0, 6: 2.9, 7: -2.0, 8: 1.9, 9: 0.9, 10: -1.8, 11: 0.6, 12: -0.2 },
  "2021": { 1: 1.1, 2: -1.4, 3: -1.6, 4: -0.3, 5: -2.5, 6: -0.5, 7: -4.3, 8: -3.1, 9: 1.8, 10: 0.3, 11: -0.3, 12: 2.1 },
  "2022": { 1: -2.8, 2: 0.6, 3: 13.0, 4: -8.5, 5: 0.2, 6: 0.5, 7: 0.3, 8: 1.5, 9: -4.0, 10: 1.7, 11: 0.5, 12: -2.7 },
  "2023": { 1: -0.7, 2: 0.6, 3: 2.1, 4: -4.1, 5: 2.0, 6: 8.4, 7: 0.5, 8: 0.5, 9: 1.2, 10: -5.2, 11: 4.4, 12: -2.3 },
  "2024": { 1: 0.1, 2: 14.1, 3: 4.7, 4: -8.4, 5: 5.0, 6: 2.6, 7: -3.9, 8: 2.0, 9: 3.6, 10: -3.0, 11: 1.6, 12: 3.4 },
  "2025": { 1: -4.1, 2: -1.8, 3: -0.8, 4: -4.1, 5: 6.6, 6: 6.8, 7: 0.7, 8: 3.9, 9: 5.2, 10: 30.6, 11: -11.2, 12: -3.1 },
  "2026": { 1: 15.2, 2: 35.0, 3: -10.4, 4: -4.6, 5: 22.0, 6: -1.7 },
};

const TH = "px-2 py-1.5 text-right font-medium whitespace-nowrap";
const TD = "px-2 py-1.5 text-right whitespace-nowrap tnum";
const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
const nm = (code: string) => {
  const n = NAMES[code];
  const c4 = code.replace(/0$/, "");
  if (!n) return c4;
  const short = n.length > 10 ? n.slice(0, 10) + "…" : n;
  return `${short} (${c4})`;
};

const dshort = (d: string, y?: string) => (y ? d.slice(5) : d);   // 연도 패널: 항상 MM-DD

function HeldTable({ rows, stripYear }: { rows: HeldRow[]; stripYear?: string }) {
  if (!rows.length) return <div className="text-xs text-muted">없음</div>;
  return (
    <div className="max-h-80 overflow-auto">
      <table className="w-full text-xs text-muted">
        <thead>
          <tr className="border-b border-[var(--color-borderc)]">
            <th className="px-2 py-1 text-left font-medium">종목</th>
            <th className={TH}>매수일</th>
            <th className={TH}>평가 (%)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h, i) => (
            <tr key={i} className="border-b border-[var(--color-borderc)] last:border-0">
              <td className="px-2 py-1 whitespace-nowrap">{nm(h[0])}</td>
              <td className={TD}>{dshort(h[1], stripYear)}</td>
              <td className={`${TD} ${signClass(h[2] ?? 0)}`}>{fmt(h[2])}</td>
            </tr>
          ))}
        </tbody>
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

export default function JpBacktestClient() {
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
                <th className={TH}>니케이225 (%)</th>
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
