import { Section } from "@/components/ui";
import { densityGrids, LOG_BINS, DEFN } from "@/lib/s2Density";
import { yearPerf } from "@/lib/s2YearPerf";
import { entryReturns } from "@/lib/s2EntryReturn";
import { DensityGrid } from "@/components/DensityGrid";

export const metadata = {
  title: "과밀田 — S2 급락 후보 잔디밭",
  description:
    "하루에 S2 진입 후보가 몇 건 떴는지를 달력 격자에 그린다. 과밀일은 진입 문턱이 완화되는 날이다.",
};

export const dynamic = "force-dynamic";   // ★nav_daily 를 매번 읽는다(EOD 마다 갱신된다)

export default async function CrowdedPage() {
  const dens = await densityGrids();
  const { grids, meta: m } = dens;
  const zeroPct = m.days ? (100 * m.zeroDays) / m.days : 0;
  const [perf, ret] = await Promise.all([yearPerf(m.firstYear || 2015), entryReturns()]);

  return (
    <>
      <div className="mb-3">
        <h1 className="text-lg font-bold">과밀田</h1>
        <p className="mt-1 max-w-[68ch] text-sm text-muted">
          하루에 <b className="text-textc">진입 후보</b>가 몇 건 떴는지를 달력에 그렸다. 후보 1건 ={" "}
          그날 <code className="rounded bg-surface px-1">MA20</code>이 있고, 최근 {DEFN.ma}일 최대
          거래대금이 <code className="rounded bg-surface px-1">{DEFN.tvMinEok.toLocaleString()}억</code> 이상이며,
          종가가 <code className="rounded bg-surface px-1">MA20 × {(1 - DEFN.baseEp).toFixed(2)}</code>{" "}
          아래인 <b className="text-textc">종목-일</b>. 색이 진할수록 그날 후보가 많다.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {[
          [m.days.toLocaleString(), "거래일"],
          [m.totalN.toLocaleString(), "총 후보"],
          [`${zeroPct.toFixed(1)}%`, "0건인 날"],
          [String(m.maxN), "하루 최대"],
          [m.crowdedDays.toLocaleString(), "과밀일"],
        ].map(([v, k]) => (
          <div
            key={k}
            className="min-w-[92px] rounded-lg border border-[var(--color-borderc)] bg-surface px-3 py-2"
          >
            <div className="tnum text-lg font-semibold">{v}</div>
            <div className="text-[11px] uppercase tracking-wider text-muted">{k}</div>
          </div>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>적음</span>
        {[0, 1, 2, 3, 4, 5].map((lv) => (
          <span key={lv} className="flex items-center gap-1">
            <i
              className="inline-block h-3 w-3 rounded-[3px]"
              style={{
                background: `var(--dens-${lv})`,
                outline: "1px solid var(--dens-line)",
                outlineOffset: "-1px",
              }}
            />
            <span className="tnum text-[11px]">{lv === 0 ? "0" : LOG_BINS[lv - 1][2]}</span>
          </span>
        ))}
        <span>많음</span>
        <span className="ml-2 flex items-center gap-1">
          <i
            className="inline-block h-3 w-3 rounded-[3px]"
            style={{ boxShadow: "inset 0 0 0 1.5px var(--color-up)" }}
          />
          <span>과밀일</span>
        </span>
      </div>

      <DensityGrid grids={grids} perf={perf.years} ret={ret} />

      <Section title="이 그림을 읽는 법">
        <div className="space-y-3 text-sm text-muted">
          <p>
            한 칸이 하루다. 세로 5칸이 <b className="text-textc">월–금</b>, 가로 한 칸이 한 주.
            연도는 <b className="text-textc">최근이 위</b>, 한 해 안에서는{" "}
            <b className="text-textc">왼쪽이 1월</b>이다. 점선 칸은 아직 오지 않은 날, 옅은 칸은
            휴장일이다.
          </p>
          <p>
            {m.firstYear}년부터 그렸다 —{" "}
            <b className="text-textc">그 이전에는 후보가 한 건도 없다</b>. 색은{" "}
            <b className="text-textc">로그 구간</b>이다(<code>1 / 2 / 3–4 / 5–8 / 9+</code>). 0건인
            날이 <b className="text-textc">{zeroPct.toFixed(1)}%</b>라 선형으로 칠하면 거의 다 같은
            색으로 보인다.
          </p>
          <p>
            <b className="text-up">빨간 테두리와 아래 띠가 과밀일</b>이다. 15거래일 누적 후보 수가
            상위 <b className="text-textc">{(DEFN.topq * 100).toFixed(2)}%</b>를 넘은 날로, 그날은
            진입 문턱이 <code>{DEFN.baseEp} → {DEFN.relax}</code>로 완화된다. 전체{" "}
            <b className="text-textc">{m.crowdedDays}일</b>. 띠가 짙을수록 그 주에 과밀일이 많다.
          </p>
        </div>
      </Section>

      <Section title="연도 옆 성과 두 줄">
        <div className="space-y-3 text-sm text-muted">
          <p>
            <b className="text-textc">운영 NAV 곡선</b>에서 계산한다 — 대시보드·성과 페이지와{" "}
            <b className="text-textc">같은 세계</b>다. EOD 마다 갱신되므로 여기도 매일 따라온다.
            {perf.rows > 0 && (
              <>
                {" "}
                기준 <code>{perf.first}</code> – <code>{perf.last}</code> ·{" "}
                <code className="tnum">{perf.rows.toLocaleString()}</code>일.
              </>
            )}
          </p>
          <p>
            <b className="text-textc">연 수익률</b>은 그 해 마지막 NAV ÷ 직전 해 마지막 NAV − 1이다.
            한 해짜리라 CAGR과 같은 값이다.{" "}
            <b className="text-up">연내 MDD는 그 해 안에서만 고점을 잡아 잰 낙폭</b>이라 전 구간
            MDD와 다르다 — 해를 넘는 낙폭은 안 잡힌다.
          </p>
          <p>
            색은 한국식이다: <span className="text-up">빨강 = 상승</span>,{" "}
            <span className="text-down">파랑 = 하락</span>. 격자의 빨간 테두리는 상승이 아니라{" "}
            <b className="text-textc">과밀일 표시</b>다.
          </p>
        </div>
      </Section>

      <Section title="수치의 세계">
        <div className="space-y-3 text-sm text-muted">
          <p>
            <b className="text-textc">매일 갱신된다</b> — 장 마감 후 EOD가{" "}
            <code>export_density.py</code>로 다시 세어 올린다. 지금 데이터는{" "}
            <code>{m.first}</code> – <code>{m.last}</code> ·{" "}
            <code className="tnum">{m.days.toLocaleString()}</code>일이다.
          </p>
          <p>
            정의는 <code>update_env_density.py</code>에서 <b className="text-textc">상수째</b>{" "}
            가져온다(<code>MA={DEFN.ma} · WIN={DEFN.win} · TOPQ={DEFN.topq}</code>). 그래서 이 화면과{" "}
            <b className="text-textc">실제 진입 문턱 완화가 쓰는 과밀일 목록이 어긋날 수 없다</b>.
          </p>
          <p>
            ⚠️ 이것은 <b className="text-textc">후보</b>이지 <b className="text-textc">체결</b>이
            아니다. 실제 진입은 자본·보유 한도·중복 배제를 통과한 뒤에 난다. 후보 총{" "}
            <b className="text-textc">{m.totalN.toLocaleString()}건</b>과 실제 거래 수를 같은 것으로
            읽지 말 것 — 툴팁의 「진입 / 완결」이 실제 거래 수다.
          </p>
        </div>
      </Section>
    </>
  );
}
