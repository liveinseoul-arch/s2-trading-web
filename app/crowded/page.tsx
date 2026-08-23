import { Section } from "@/components/ui";
import { density, yearGrids, LOG_BINS } from "@/lib/s2Density";
import { DensityGrid } from "@/components/DensityGrid";

export const metadata = {
  title: "과밀일 — S2 급락 후보 잔디밭",
  description:
    "하루에 S2 진입 후보가 몇 건 떴는지를 달력 격자에 그린다. 과밀일은 진입 문턱이 완화되는 날이다.",
};

const eok = (n: number) => `${Math.round(n / 1e8).toLocaleString()}억`;

export default function CrowdedPage() {
  const grids = yearGrids();
  const m = density.meta;
  const pm = density.perfMeta;
  const zeroPct = (100 * m.zeroDays) / m.days;

  return (
    <>
      <div className="mb-3">
        <h1 className="text-lg font-bold">과밀일</h1>
        <p className="mt-1 max-w-[68ch] text-sm text-muted">
          하루에 <b className="text-textc">진입 후보</b>가 몇 건 떴는지를 달력에 그렸다. 후보 1건 ={" "}
          그날 <code className="rounded bg-surface px-1">MA20</code>이 있고, 최근 {m.defn.ma}일 최대
          거래대금이 <code className="rounded bg-surface px-1">{eok(m.defn.tv_min)}</code> 이상이며,
          종가가 <code className="rounded bg-surface px-1">MA20 × {(1 - m.defn.base_ep).toFixed(2)}</code>{" "}
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
              className="inline-block h-3 w-3 rounded-[3px] border border-[var(--color-hairc,#eef2f6)]"
              style={{ background: `var(--dens-${lv})` }}
            />
            <span className="tnum text-[11px]">{lv === 0 ? "0" : LOG_BINS[lv - 1][2]}</span>
          </span>
        ))}
        <span>많음</span>
        <span className="ml-2 flex items-center gap-1">
          <i
            className="inline-block h-3 w-3 rounded-[3px]"
            style={{ boxShadow: "inset 0 0 0 2.5px var(--color-up)" }}
          />
          <span>과밀일</span>
        </span>
      </div>

      <DensityGrid grids={grids} perf={density.perf} />

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
            상위 <b className="text-textc">{(m.defn.topq * 100).toFixed(2)}%</b>를 넘은 날로, 그날은
            진입 문턱이 <code>{m.defn.base_ep} → {m.defn.relax}</code>로 완화된다. 전체{" "}
            <b className="text-textc">{m.crowdedDays}일</b>. 띠가 짙을수록 그 주에 과밀일이 많다.
          </p>
        </div>
      </Section>

      <Section title="연도 옆 성과 두 줄">
        <div className="space-y-3 text-sm text-muted">
          <p>
            <b className="text-textc">연 수익률</b>은 그 해 마지막 NAV ÷ 직전 해 마지막 NAV − 1이다.
            한 해짜리라 CAGR과 같은 값이다.{" "}
            <b className="text-up">연내 MDD는 그 해 안에서만 고점을 잡아 잰 낙폭</b>이라 전 구간
            MDD(<code className="tnum">{pm.total.mdd.toFixed(2)}%</code>)와 다르다 — 해를 넘는 낙폭은
            안 잡힌다.
          </p>
          <p>
            세계 — 지금 굴리는 구성 그대로다. 래칫 트리거 ×0.75 · 사이징{" "}
            <code>{pm.world.size.join("/")}</code> · 기간손절{" "}
            <code>{String(pm.world.time_stop)}</code>일 · 진입 문턱{" "}
            <code>{String(pm.world.envelope_pct)}</code> · 무차입 ·{" "}
            <code>S2_CA_ADJUST=1</code>. 전 구간 CAGR{" "}
            <code className="tnum">{pm.total.cagr.toFixed(2)}%</code> · Calmar{" "}
            <code className="tnum">{pm.total.calmar.toFixed(3)}</code> · 거래{" "}
            <code className="tnum">{pm.total.trades}</code> ·{" "}
            <code>{pm.total.period_start}</code> – <code>{pm.total.period_end}</code>.
          </p>
          <p>
            ⚠️ <b className="text-textc">과밀일 맵은 껐다</b> — 그래서 위 성과에는{" "}
            <b className="text-textc">과밀일 완화가 안 들어 있다</b>. 그리고{" "}
            <b className="text-textc">{m.firstYear} – 2017은 사실상 무거래</b>라 그 해 수익률은
            성과가 아니라 <b className="text-textc">현금이었다</b>는 뜻이다.
          </p>
        </div>
      </Section>

      <Section title="수치의 세계">
        <div className="space-y-3 text-sm text-muted">
          <p>
            DB <code>{m.db}</code> · <code>{m.first}</code> – <code>{m.last}</code> · 정의는{" "}
            <code>update_env_density.py</code>에서 상수째 가져왔다(
            <code>
              MA={m.defn.ma} · WIN={m.defn.win} · WARM={m.defn.warm} · TOPQ={m.defn.topq}
            </code>
            ). ⚠️ canonical 스냅샷이라 <b className="text-textc">{m.last} 이후는 없다</b>.
          </p>
          <p>
            ⚠️ 이것은 <b className="text-textc">후보</b>이지 <b className="text-textc">체결</b>이
            아니다. 실제 진입은 자본·보유 한도·중복 배제를 통과한 뒤에 난다. 후보 총{" "}
            <b className="text-textc">{m.totalN.toLocaleString()}건</b>과 실제 거래 수를 같은 것으로
            읽지 말 것.
          </p>
          <p className="text-xs">
            스냅샷 생성 <code>{m.generated}</code> · 성과 <code>{pm.generated}</code>
          </p>
        </div>
      </Section>
    </>
  );
}
