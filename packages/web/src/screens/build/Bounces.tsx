// «Why pull requests bounce» (Delivery): Jev's category of each reviewer comment of the last 30 days, with
// how many an instruction to the builder would have avoided and the latest example of each.
import type { BuildQueue } from "../../api/types.ts";
import type { BUILD } from "./words.i18n.ts";

const label = (t: typeof BUILD.en, category: string): string => {
  const v = (t as Record<string, unknown>)[`bounce_${category}`];
  return typeof v === "string" ? v : category;
};

export function Bounces({ bounces, t }: { bounces: BuildQueue["bounces"]; t: typeof BUILD.en }) {
  if (!bounces || bounces.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 text-sm text-fg-2" data-delivery-bounces>
      <span className="text-xs font-medium text-fg-3">{t.bouncesTitle}</span>
      <p className="text-xs text-fg-3 max-w-prose">{t.bouncesHint}</p>
      {bounces.map((b) => (
        <div key={b.category} className="flex flex-col gap-0.5" data-bounce-category={b.category}>
          <span className="text-fg tabular-nums">
            {label(t, b.category)}: {t.bounceLine(b.count, b.avoidable)}
          </span>
          <span className="text-xs text-fg-3 max-w-prose">
            {t.bounceExample}: {b.example.path ? `${b.example.path}: ` : ""}
            {b.example.body.length > 220 ? `${b.example.body.slice(0, 220)}…` : b.example.body}
          </span>
        </div>
      ))}
    </div>
  );
}
