// The top of the Build page: «Lanes» (what the queue did over the last hours) and, under the chosen bar, the
// «Path» of that attempt (the stages, what entered the builder, what came out). Hidden when the server sends no
// timeline (an older server) or no build ran in the window. It refreshes with the page's own polling.

import { useState } from "react";
import type { BuildTimeline } from "../../api/types.ts";
import { Section } from "../../components/Page.tsx";
import { Lanes } from "./Lanes.tsx";
import { TaskPath } from "./TaskPath.tsx";
import { type Selection, resolveSelection } from "./timelineLogic.ts";
import type { BUILD } from "./words.i18n.ts";

export function BuildTimelineView({
  projectId,
  timeline,
  needsYou,
  t,
}: {
  projectId: string;
  timeline: BuildTimeline | undefined;
  needsYou: string | null;
  t: typeof BUILD.en;
}) {
  const [chosen, setChosen] = useState<Selection | null>(null);
  if (!timeline || timeline.requests.length === 0) return null;
  const shown = resolveSelection(timeline, chosen);
  const hours = Math.max(1, Math.round((Date.parse(timeline.now) - Date.parse(timeline.since)) / 3_600_000));
  return (
    <>
      <Section id="build-lanes" title={t.tlTitle}>
        <Lanes
          timeline={timeline}
          selection={shown ? { request: shown.request.id, attempt: shown.attempt.n } : null}
          needsYou={needsYou}
          onSelect={setChosen}
          hours={hours}
          t={t}
        />
      </Section>
      {shown ? (
        <Section id="build-path" title={t.tpTitle}>
          <TaskPath projectId={projectId} request={shown.request} attempt={shown.attempt} onSelect={setChosen} t={t} />
        </Section>
      ) : null}
    </>
  );
}
