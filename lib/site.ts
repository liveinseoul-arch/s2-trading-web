// 사이트 정체성 분기 — 하나의 코드베이스, 두 개의 Vercel 프로젝트로 배포
// NEXT_PUBLIC_SITE=marginki (기본) → 마감지기 (S2 매매 시스템 따라하기)
// NEXT_PUBLIC_SITE=rs96 → 선두지기(96+) (RS96+ 한미일 모멘텀 스크리너)

export type SiteId = "marginki" | "rs96";

export const SITE: SiteId =
  (process.env.NEXT_PUBLIC_SITE as SiteId) === "rs96" ? "rs96" : "marginki";

export const IS_RS96 = SITE === "rs96";
export const IS_MARGINKI = SITE === "marginki";

export const SITE_CONFIG = {
  marginki: {
    brandPrefix: "마감",
    brandSuffix: "지기",
    title: "마감지기",
    description:
      "검증된 매매 룰은 갖춘 직장인 투자자를 위해 — 장중 시세 감시는 시스템이 대신합니다. 15:10 동시호가 직전엔 오늘 살 종목과 지지선 지정가를, 15:45 마감 직후엔 체결 결과와 내일 세팅할 감시주문을 정확히 전달합니다.",
    homePath: "/",
    landingPath: "/landing",
  },
  rs96: {
    brandPrefix: "선두",
    brandSuffix: "지기(96+)",
    title: "선두지기(96+)",
    description:
      "한국·미국·일본 3개 시장의 RS96+ 모멘텀 종목을 한 화면에. O'Neil CANSLIM·Minervini SEPA 변형 룰의 기본 후보군을 주별로 정리하고, 한미일 통합 테마로 어떤 트렌드가 동시 가동되는지 보여줍니다.",
    homePath: "/rs96",
    landingPath: "/landing/rs96",
  },
} as const;

export const CONFIG = SITE_CONFIG[SITE];
