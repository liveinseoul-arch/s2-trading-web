// 종가의 일봉 EMA21/EMA50 이탈 표시 — 테마(/global) · 국가별(/rs96) 화면 공용.
// 21EMA 하향 = 연한 빨강 "-", 50EMA 하향 = 진한 빨강 "-", 둘 다면 나란히.

export const EMA_BADGE =
  "inline-flex items-center justify-center rounded px-1 py-0.5 text-[10px] font-bold leading-none tracking-tight text-white";

/** 종가의 EMA 이탈 비트마스크: bit0(=1)=EMA21 하향, bit1(=2)=EMA50 하향. 0~3, 값없으면 null. */
export function emaBreakBits(
  close: number | null | undefined,
  e21: number | null | undefined,
  e50: number | null | undefined,
): 0 | 1 | 2 | 3 | null {
  if (close == null || e21 == null || e50 == null) return null;
  let b = 0;
  if (close < e21) b |= 1;
  if (close < e50) b |= 2;
  return b as 0 | 1 | 2 | 3;
}

/** 이탈 배지. bits 0/데이터없음 → 표시 안 함. */
export function EmaBreakBadge({ bits }: { bits?: number | null }) {
  if (bits == null || bits === 0) return null;
  const below21 = (bits & 1) !== 0; // 연한 빨강
  const below50 = (bits & 2) !== 0; // 진한 빨강
  return (
    <span className="inline-flex gap-0.5">
      {below21 && (
        <span className={`${EMA_BADGE} bg-red-400`} title="종가가 21EMA 아래">
          -
        </span>
      )}
      {below50 && (
        <span className={`${EMA_BADGE} bg-red-700`} title="종가가 50EMA 아래">
          -
        </span>
      )}
    </span>
  );
}
