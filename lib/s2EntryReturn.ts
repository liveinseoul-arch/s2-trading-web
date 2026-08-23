// 진입일별 수익률 — ★그날 진입한 거래들이 결국 얼마를 벌었나.
//
// [해달별님 요구 2026-08-23]
//   「발생 건수 하단에 ★최종매도 수익금액의 ★1차매수 금액 대비 비율인 수익률을」
//
// [구현 정의 — ★분자와 분모를 못박는다]
//   · 분자 = 그날 진입한 ★완결 거래들의 ★실현손익 합 (trades.pnl · status='closed')
//   · 분모 = 그 거래들의 ★1차매수 금액 합 (trade_legs.leg_type='buy_new' 의 amount)
//   ★★추가매수(buy_add)는 ★분모에 안 넣는다 — 해달별님이 「1차매수 금액 대비」라고 했다.
//     ⚠️그래서 이 값은 ★투하자본 수익률이 아니다. 추가매수가 많이 붙은 거래일수록
//     ★분모가 작아 ★비율이 커 보인다. 그 성격을 화면에 적는다.
//   · 미완결(status='open') 거래는 ★분자·분모 ★둘 다에서 뺀다(아직 답이 없다).
//
// ⚠️★「발생 건수」와 ★「거래 수」는 다르다 — 발생은 ★후보이고, 그중 자본·보유 한도·
//   중복 배제를 통과한 것만 진입한다. 그래서 후보가 있어도 거래가 0인 날이 많다.
//
// 세계 — 운영 Supabase(trades · trade_legs). 웹앱의 다른 페이지와 같다.
import { createClient } from "@supabase/supabase-js";

export interface EntryReturn {
  /** 그날 진입한 거래 수(미완결 포함) */
  n: number;
  /** 그중 완결된 거래 수 */
  closed: number;
  /** 완결분 실현손익 합(원) */
  pnl: number;
  /** 완결분 1차매수 금액 합(원) */
  firstBuy: number;
  /** pnl / firstBuy x 100. 완결이 없으면 null */
  retPct: number | null;
}

/** 진입일(YYYY-MM-DD) → 그날 진입분의 수익률. */
export async function entryReturns(): Promise<Record<string, EntryReturn>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "";
  if (!url || !key) return {};
  const sb = createClient(url, key, { auth: { persistSession: false } });

  type Tr = { id: number; entry_date: string; pnl: number | null; status: string };
  type Lg = { trade_id: number; amount: number };

  // ★PostgREST 는 1,000행씩 준다 — 다 받을 때까지 돈다.
  const trades: Tr[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb
      .from("trades")
      .select("id,entry_date,pnl,status")
      .range(off, off + 999);
    if (error || !data?.length) break;
    trades.push(...(data as unknown as Tr[]));
    if (data.length < 1000) break;
  }
  if (!trades.length) return {};

  const legs: Lg[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb
      .from("trade_legs")
      .select("trade_id,amount")
      .eq("leg_type", "buy_new")     // ★1차매수만 — 추가매수는 분모에 안 넣는다
      .range(off, off + 999);
    if (error || !data?.length) break;
    legs.push(...(data as unknown as Lg[]));
    if (data.length < 1000) break;
  }

  const first = new Map<number, number>();
  for (const l of legs) first.set(l.trade_id, l.amount);

  const out: Record<string, EntryReturn> = {};
  for (const t of trades) {
    const e = (out[t.entry_date] ??= { n: 0, closed: 0, pnl: 0, firstBuy: 0, retPct: null });
    e.n += 1;
    if (t.status !== "closed") continue; // ★미완결은 분자·분모 둘 다에서 뺀다
    e.closed += 1;
    e.pnl += t.pnl ?? 0;
    e.firstBuy += first.get(t.id) ?? 0;
  }
  for (const e of Object.values(out)) {
    e.retPct = e.firstBuy > 0 ? (e.pnl / e.firstBuy) * 100 : null;
  }
  return out;
}
