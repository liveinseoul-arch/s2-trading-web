// 종가의 일봉 EMA21/EMA50 이탈 표시 — 테마(/global) · 국가별(/rs96) 화면 공용.
// 21EMA 하향 = 연한 빨강 "-", 50EMA 하향 = 진한 빨강 "-", 둘 다면 나란히.

// 고정폭 슬롯 — 채워진 슬롯과 빈 슬롯의 크기가 같아 세로 정렬이 유지된다.
export const EMA_BADGE =
  "inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold leading-none text-white";

/**
 * ★반전 배지 — 「21EMA 를 하회했지만 ★팔지 않는다」를 뜻한다.
 *
 * RS 매도 규칙은 peak gain +50% 에서 50EMA 트레일이 21EMA 를 ★대체하므로,
 * 승격한 종목의 21EMA 이탈은 ★매도 신호가 아니다(SPEC_RS_CURRENT §6).
 * 채운 배지(매도 대상)와 ★한눈에 갈리도록 배경을 비우고 테두리·글자만 남긴다.
 * 슬롯 크기는 EMA_BADGE 와 같아 세로 정렬이 유지된다(테두리는 안쪽으로 그린다).
 */
export const EMA_BADGE_INV =
  "inline-flex h-4 w-4 items-center justify-center rounded border border-red-400 bg-transparent text-[10px] font-bold leading-none text-red-400";

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

/**
 * 이탈 배지 — 21(왼)·50(오른) 고정 2슬롯. 이탈 없음/데이터없음 → 공백.
 *
 * `promoted` 는 ★peak gain +50% 승격 여부다(lib/promotion50).
 * ★true 면 21EMA 이탈이 ★매도 신호가 아니므로 왼쪽 슬롯을 ★반전 표시한다.
 * 값을 안 넘기면(undefined·null) 승격을 ★모르는 것이라 종전대로 채워 그린다.
 */
export function EmaBreakBadge({
  bits,
  promoted,
}: {
  bits?: number | null;
  promoted?: boolean | null;
}) {
  if (bits == null || bits === 0) return null;
  const below21 = (bits & 1) !== 0; // 왼쪽 슬롯: 연한 빨강
  const below50 = (bits & 2) !== 0; // 오른쪽 슬롯: 진한 빨강
  // ★50EMA 가 기준을 넘겨받은 상태 — 21EMA 이탈로는 팔지 않는다.
  const keep21 = below21 && promoted === true;
  return (
    <span className="inline-flex gap-0.5">
      <span
        className={
          keep21 ? EMA_BADGE_INV : below21 ? `${EMA_BADGE} bg-red-400` : EMA_BADGE
        }
        title={
          keep21
            ? "종가가 21EMA 아래 — 다만 +50% 승격 종목이라 매도 대상이 아니다(50EMA 가 기준)"
            : below21
              ? "종가가 21EMA 아래 — 매도 대상"
              : undefined
        }
      >
        {below21 ? "-" : ""}
      </span>
      <span
        className={below50 ? `${EMA_BADGE} bg-red-700` : EMA_BADGE}
        title={below50 ? "종가가 50EMA 아래" : undefined}
      >
        {below50 ? "-" : ""}
      </span>
    </span>
  );
}
