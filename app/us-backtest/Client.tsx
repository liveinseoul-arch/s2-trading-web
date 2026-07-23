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

// iret/imdd = S&P500 동일 규칙(부분연도 반영, 연중 고점 대비 MDD)
const YEARLY: { year: number; ret: number; mdd: number; iret: number; imdd: number; n: number; win: number; avg: number }[] = [
  { year: 2002, ret: -11.1, mdd: -11.1, iret: -25.3, imdd: -31.7, n: 19, win: 5, avg: -7.4 },
  { year: 2003, ret: 6.4, mdd: -3.5, iret: 25.2, imdd: -10.6, n: 23, win: 48, avg: 3.5 },
  { year: 2004, ret: 15.0, mdd: -12.1, iret: 10.6, imdd: -8.0, n: 24, win: 21, avg: -2.8 },
  { year: 2005, ret: 4.7, mdd: -7.1, iret: 3.0, imdd: -6.5, n: 31, win: 48, avg: 7.8 },
  { year: 2006, ret: 4.5, mdd: -11.3, iret: 13.6, imdd: -6.8, n: 27, win: 41, avg: 1.6 },
  { year: 2007, ret: 18.4, mdd: -8.0, iret: 4.2, imdd: -7.8, n: 33, win: 58, avg: 4.4 },
  { year: 2008, ret: -1.4, mdd: -10.9, iret: -41.0, imdd: -43.9, n: 34, win: 35, avg: -0.2 },
  { year: 2009, ret: -1.3, mdd: -3.8, iret: 29.1, imdd: -26.7, n: 15, win: 20, avg: -2.9 },
  { year: 2010, ret: 0.2, mdd: -8.2, iret: 11.6, imdd: -16.0, n: 25, win: 28, avg: -0.7 },
  { year: 2011, ret: -9.7, mdd: -13.9, iret: -0.0, imdd: -17.6, n: 24, win: 29, avg: -1.8 },
  { year: 2012, ret: -1.5, mdd: -4.9, iret: 11.5, imdd: -9.3, n: 13, win: 31, avg: -2.1 },
  { year: 2013, ret: -1.5, mdd: -4.7, iret: 31.3, imdd: -4.5, n: 13, win: 38, avg: -1.1 },
  { year: 2014, ret: 8.7, mdd: -7.6, iret: 13.4, imdd: -6.2, n: 17, win: 41, avg: 3.0 },
  { year: 2015, ret: 7.3, mdd: -3.5, iret: -1.3, imdd: -9.7, n: 12, win: 50, avg: 6.9 },
  { year: 2016, ret: -2.5, mdd: -2.8, iret: 8.6, imdd: -8.8, n: 5, win: 20, avg: -5.9 },
  { year: 2017, ret: 19.5, mdd: -9.0, iret: 19.4, imdd: -2.3, n: 23, win: 43, avg: 6.3 },
  { year: 2018, ret: 7.5, mdd: -7.8, iret: -7.0, imdd: -17.5, n: 26, win: 42, avg: 7.0 },
  { year: 2019, ret: 5.7, mdd: -3.0, iret: 30.3, imdd: -6.6, n: 14, win: 64, avg: 2.2 },
  { year: 2020, ret: 10.6, mdd: -6.9, iret: 14.3, imdd: -31.8, n: 33, win: 39, avg: 2.4 },
  { year: 2021, ret: -6.5, mdd: -16.6, iret: 28.7, imdd: -3.9, n: 43, win: 26, avg: 0.8 },
  { year: 2022, ret: -4.0, mdd: -8.9, iret: -19.4, imdd: -23.4, n: 32, win: 28, avg: -0.7 },
  { year: 2023, ret: 1.6, mdd: -4.2, iret: 24.2, imdd: -10.1, n: 14, win: 29, avg: -1.8 },
  { year: 2024, ret: 11.6, mdd: -9.9, iret: 25.2, imdd: -5.5, n: 33, win: 36, avg: 3.8 },
  { year: 2025, ret: 38.7, mdd: -10.0, iret: 16.1, imdd: -17.0, n: 33, win: 36, avg: 1.8 },
  { year: 2026, ret: 36.5, mdd: -9.2, iret: 6.1, imdd: -8.6, n: 31, win: 55, avg: 25.9 },
];

const MONTHLY: Record<string, Record<number, number>> = {
  "2002": { 1: -1.1, 2: -0.7, 3: -1.4, 4: 0.0, 5: 0.3, 6: -1.6, 7: -2.9, 8: -1.7, 9: 0.7, 10: -2.2, 11: 1.0, 12: -2.0 },
  "2003": { 1: -1.3, 2: 0.0, 3: -0.1, 4: -0.9, 5: 5.4, 6: -1.2, 7: 0.5, 8: 1.1, 9: 1.4, 10: 2.7, 11: 2.4, 12: -3.5 },
  "2004": { 1: -1.1, 2: -0.3, 3: -1.2, 4: -1.3, 5: 0.1, 6: -0.2, 7: -1.7, 8: 1.7, 9: 2.2, 10: 7.6, 11: 5.2, 12: 3.6 },
  "2005": { 1: -6.3, 2: 7.3, 3: 0.1, 4: -2.7, 5: -0.1, 6: 1.0, 7: 4.8, 8: -4.6, 9: 12.1, 10: -6.5, 11: 1.8, 12: -0.5 },
  "2006": { 1: 7.8, 2: 1.6, 3: 2.9, 4: 0.3, 5: -4.9, 6: -1.6, 7: -2.2, 8: 0.6, 9: -1.1, 10: 0.5, 11: 1.9, 12: -0.9 },
  "2007": { 1: 4.9, 2: 3.9, 3: -1.0, 4: 1.9, 5: 0.5, 6: 2.8, 7: 2.4, 8: -1.2, 9: 0.9, 10: 0.0, 11: -1.6, 12: 3.6 },
  "2008": { 1: -4.8, 2: 0.5, 3: 1.2, 4: 4.6, 5: 2.2, 6: 7.0, 7: -8.6, 8: 0.5, 9: -2.6, 10: 0.0, 11: 0.1, 12: -0.5 },
  "2009": { 1: -0.3, 2: -1.6, 3: 0.0, 4: -0.5, 5: 1.9, 6: 1.2, 7: -0.8, 8: 0.5, 9: -0.5, 10: -1.2, 11: -1.4, 12: 1.3 },
  "2010": { 1: -4.0, 2: 0.7, 3: 3.2, 4: 0.4, 5: -3.5, 6: -0.3, 7: -0.0, 8: -2.5, 9: 1.8, 10: -0.5, 11: 2.7, 12: 2.5 },
  "2011": { 1: -1.7, 2: -0.9, 3: 1.1, 4: 6.4, 5: -6.6, 6: -3.1, 7: -2.8, 8: -1.8, 9: 0.1, 10: 0.4, 11: -0.3, 12: -0.4 },
  "2012": { 1: 0.0, 2: 1.4, 3: 1.6, 4: -1.0, 5: -0.3, 6: -0.5, 7: -0.2, 8: -0.3, 9: -0.6, 10: -0.4, 11: -1.1, 12: 0.0 },
  "2013": { 1: 1.8, 2: -0.9, 3: 0.5, 4: -0.2, 5: -0.1, 6: 0.5, 7: 1.8, 8: -0.4, 9: 0.1, 10: -1.2, 11: -1.8, 12: -1.5 },
  "2014": { 1: -0.4, 2: 7.0, 3: -5.5, 4: -2.0, 5: 2.2, 6: 2.8, 7: 2.3, 8: 0.5, 9: 2.0, 10: -3.0, 11: 3.1, 12: 0.1 },
  "2015": { 1: 1.5, 2: 2.4, 3: 3.3, 4: 0.2, 5: 2.7, 6: -0.4, 7: -0.8, 8: -0.7, 9: -0.4, 10: 0.0, 11: -0.5, 12: 0.0 },
  "2016": { 1: 0.0, 2: 0.0, 3: 0.0, 4: 0.3, 5: -1.7, 6: -0.1, 7: 0.7, 8: -0.3, 9: -0.5, 10: -0.6, 11: -0.0, 12: -0.2 },
  "2017": { 1: 1.4, 2: -0.3, 3: 2.1, 4: 1.5, 5: 3.3, 6: -6.4, 7: 3.9, 8: 2.6, 9: 6.4, 10: 2.7, 11: 9.6, 12: -7.6 },
  "2018": { 1: 8.6, 2: -2.8, 3: -3.4, 4: -0.5, 5: 2.3, 6: 1.1, 7: -0.4, 8: 6.3, 9: 2.3, 10: -5.4, 11: 0.0, 12: 0.0 },
  "2019": { 1: 0.1, 2: 2.0, 3: 0.4, 4: -1.1, 5: -0.2, 6: 1.6, 7: 3.7, 8: -0.9, 9: -1.2, 10: 0.1, 11: -0.6, 12: 1.7 },
  "2020": { 1: 0.4, 2: -3.1, 3: -0.6, 4: 0.4, 5: 0.3, 6: 1.2, 7: 6.5, 8: 3.3, 9: -4.0, 10: 0.3, 11: 1.1, 12: 4.8 },
  "2021": { 1: 6.9, 2: -2.5, 3: -2.5, 4: -0.3, 5: -1.6, 6: -0.0, 7: -2.1, 8: 1.5, 9: -0.7, 10: 2.2, 11: -2.4, 12: -4.7 },
  "2022": { 1: -2.0, 2: 0.2, 3: 5.9, 4: -2.4, 5: 1.3, 6: -5.6, 7: 1.9, 8: 2.6, 9: -3.7, 10: 1.3, 11: -0.1, 12: -2.9 },
  "2023": { 1: 0.7, 2: -1.2, 3: 0.0, 4: 0.0, 5: -0.0, 6: 2.2, 7: 0.6, 8: -2.3, 9: -0.5, 10: -1.4, 11: 2.6, 12: 1.0 },
  "2024": { 1: -3.4, 2: 3.4, 3: 14.4, 4: -8.9, 5: 1.8, 6: -1.1, 7: 0.3, 8: 1.3, 9: -0.0, 10: 1.1, 11: 6.7, 12: -2.8 },
  "2025": { 1: -0.1, 2: -0.8, 3: -0.3, 4: -0.7, 5: -0.7, 6: 2.1, 7: 4.5, 8: 6.6, 9: 11.0, 10: 11.2, 11: -3.9, 12: 5.6 },
  "2026": { 1: 14.6, 2: 9.5, 3: -0.7, 4: 5.0, 5: 6.5, 6: -2.0 },
};

const TH = "px-2 py-1.5 text-right font-medium whitespace-nowrap";
const TD = "px-2 py-1.5 text-right whitespace-nowrap tnum";
const fmt = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
const nm = (code: string) => {
  const n = NAMES[code];
  if (!n) return code;
  const short = n.length > 10 ? n.slice(0, 10) + "…" : n;
  return `${short} (${code})`;
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

export default function UsBacktestClient() {
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
                <th className={TH}>S&P500 (%)</th>
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
