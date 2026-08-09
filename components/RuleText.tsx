// `**강조**` 만 지원하는 초경량 렌더러. 외부 의존성 없음(배포 리스크 0).
// lib/s2rules.ts 의 규칙 본문을 **순수 텍스트로** 유지하기 위한 것 —
// 규칙을 고칠 때 JSX 를 건드리지 않아도 되게 한다.
export default function RuleText({ children }: { children: string }) {
  const parts = children.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") && p.length > 4 ? (
          <b key={i}>{p.slice(2, -2)}</b>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
