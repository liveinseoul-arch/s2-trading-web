// 종가의 일봉 EMA21/EMA50 이탈 표시 — 테마(/global) · 국가별(/rs96) 화면 공용.
// 21EMA 하향 = 연한 빨강 "-", 50EMA 하향 = 진한 빨강 "-", 둘 다면 나란히.

// 고정폭 슬롯 — 채워진 슬롯과 빈 슬롯의 크기가 같아 세로 정렬이 유지된다.
export const EMA_BADGE =
  "inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold leading-none text-white";

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

/**
 * EMA 이탈 종목의 종목명을 흐리게 하는 클래스.
 *
 * 21/50EMA 하향은 매도 대상이거나 이미 매도했을 종목이라 매수 관점에서
 * 주목을 끌지 않게 한다. 둘 다 이탈이면 한 단계 더 흐리게.
 * 읽을 수는 있되 정상 종목보다는 확실히 뒤로 물러나는 농도.
 * (RS·모멘텀 같은 수치는 판단 재료라 흐리지 않는다.)
 *
 * /global 과 /rs96 이 같은 농도를 쓰도록 여기 한 곳에 둔다.
 */
export function emaDimClass(bits?: number | null): string {
  if (bits == null || bits === 0) return "";
  const below21 = (bits & 1) !== 0;
  const below50 = (bits & 2) !== 0;
  if (below21 && below50) return "opacity-[0.58]";
  return below21 || below50 ? "opacity-[0.76]" : "";
}

/** 흐리게 표시하는 이유 — title 툴팁용. */
export function emaDimTitle(bits?: number | null): string | undefined {
  if (bits == null || bits === 0) return undefined;
  const below21 = (bits & 1) !== 0;
  const below50 = (bits & 2) !== 0;
  if (below21 && below50) return "21EMA·50EMA 모두 하향 — 추세 약화";
  if (below21) return "21EMA 하향 — 추세 약화";
  if (below50) return "50EMA 하향 — 추세 약화";
  return undefined;
}

/** 이탈 배지 — 21(왼)·50(오른) 고정 2슬롯. 이탈 없음/데이터없음 → 공백. */
export function EmaBreakBadge({ bits }: { bits?: number | null }) {
  if (bits == null || bits === 0) return null;
  const below21 = (bits & 1) !== 0; // 왼쪽 슬롯: 연한 빨강
  const below50 = (bits & 2) !== 0; // 오른쪽 슬롯: 진한 빨강
  return (
    <span className="inline-flex gap-0.5">
      <span className={below21 ? `${EMA_BADGE} bg-red-400` : EMA_BADGE} title={below21 ? "종가가 21EMA 아래" : undefined}>
        {below21 ? "-" : ""}
      </span>
      <span className={below50 ? `${EMA_BADGE} bg-red-700` : EMA_BADGE} title={below50 ? "종가가 50EMA 아래" : undefined}>
        {below50 ? "-" : ""}
      </span>
    </span>
  );
}
