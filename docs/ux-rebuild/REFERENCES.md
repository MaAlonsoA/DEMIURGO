# References

Phase 0 research for the DEMIURGO frontend rebuild (2026-09-25). Three research passes fetched every
source below during this run; nothing is cited from memory. A page that failed to load was replaced
or dropped, never invented (the fetch notes are at the end). DESIGN.md cites these entries by ID.

**99 distinct sources** in 7 categories. When two passes fetched the same page, the
entries are merged under one ID.

## Index

| ID | Source | Category |
| --- | --- | --- |
| R01 | [GitHub Actions: workflow run logs and the live visualization graph](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs) | 1 · Pipeline and workflow orchestration UIs |
| R02 | [GitHub Actions: re-running workflows and jobs (attempts)](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs) | 1 · Pipeline and workflow orchestration UIs |
| R03 | [Buildkite: the new build page and the feedback round that followed](https://buildkite.com/resources/changelog/266-introducing-the-new-build-page-engineered-for-scale-and-flexibility/) | 1 · Pipeline and workflow orchestration UIs |
| R04 | [Buildkite: build annotations](https://buildkite.com/docs/agent/v3/cli-annotate) | 1 · Pipeline and workflow orchestration UIs |
| R05 | [Temporal: redesigned workflow execution UI (Compact / Timeline / Full history)](https://temporal.io/blog/the-dark-magic-of-workflow-exploration) | 1 · Pipeline and workflow orchestration UIs |
| R06 | [Temporal: Web UI docs and the live Event History feed](https://docs.temporal.io/web-ui) | 1 · Pipeline and workflow orchestration UIs |
| R07 | [Apache Airflow: Grid view and task instance details](https://airflow.apache.org/docs/apache-airflow/stable/ui.html) | 1 · Pipeline and workflow orchestration UIs |
| R08 | [Dagster: run details page](https://docs.dagster.io/guides/operate/webserver) | 1 · Pipeline and workflow orchestration UIs |
| R09 | [Prefect: states (type vs name, terminal states, messages)](https://docs.prefect.io/v3/concepts/states) | 1 · Pipeline and workflow orchestration UIs |
| R10 | [Inngest: run inspection and trace (waterfall) view](https://www.inngest.com/docs/platform/monitor/traces) | 1 · Pipeline and workflow orchestration UIs |
| R11 | [GitHub Copilot coding agent: tracking agent sessions](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/track-copilot-sessions) | 1 · Pipeline and workflow orchestration UIs |
| R12 | [Langfuse: token and cost tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking) | 1 · Pipeline and workflow orchestration UIs |
| R13 | [LangSmith annotation queues](https://docs.langchain.com/langsmith/annotation-queues) | 2 · AI agent and LLM observability |
| R14 | [Langfuse: sessions, and token and cost tracking](https://langfuse.com/docs/observability/features/sessions) | 2 · AI agent and LLM observability |
| R15 | [Braintrust: viewing logs](https://www.braintrust.dev/docs/observe/view-logs) | 2 · AI agent and LLM observability |
| R16 | [Weights & Biases Weave: trace tree](https://docs.wandb.ai/weave/guides/tracking/trace-tree) | 2 · AI agent and LLM observability |
| R17 | [Helicone sessions](https://docs.helicone.ai/features/sessions) | 2 · AI agent and LLM observability |
| R18 | [Arize Phoenix sessions](https://arize.com/docs/phoenix/tracing/llm-traces/sessions) | 2 · AI agent and LLM observability |
| R19 | [LangChain Agent Inbox](https://github.com/langchain-ai/agent-inbox) | 2 · AI agent and LLM observability |
| R20 | [Microsoft HAX: Guidelines for Human-AI Interaction](https://www.microsoft.com/en-us/haxtoolkit/library/) | 2b · Human-in-the-loop and AI UX guidance |
| R21 | [Google PAIR People + AI Guidebook: Explainability & Trust, Feedback & Control](https://pair.withgoogle.com/chapter/explainability-trust/) | 2b · Human-in-the-loop and AI UX guidance |
| R22 | [Shape of AI pattern catalog](https://www.shapeof.ai/) | 2b · Human-in-the-loop and AI UX guidance |
| R23 | [Nielsen Norman Group: explainable AI, prompt controls, designing AI agents](https://www.nngroup.com/articles/explainable-ai/) | 2b · Human-in-the-loop and AI UX guidance |
| R24 | [Microsoft Design: UX design for agents](https://microsoft.design/articles/ux-design-for-agents/) | 2b · Human-in-the-loop and AI UX guidance |
| R25 | [Smashing Magazine: Designing for agentic AI (control, consent, accountability)](https://www.smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/) | 2b · Human-in-the-loop and AI UX guidance |
| R26 | [GitLab Pajamas: AI-human interaction, and Agents and flows](https://design.gitlab.com/usability/ai-human-interaction) | 2b · Human-in-the-loop and AI UX guidance |
| R27 | [GitHub Copilot coding agent: tracking sessions and reviewing its PRs](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/track-copilot-sessions) | 2b · Human-in-the-loop and AI UX guidance |
| R28 | [Devin: session tools, Session Insights, Devin Review](https://docs.devin.ai/work-with-devin/devin-session-tools) | 2b · Human-in-the-loop and AI UX guidance |
| R29 | [Linear Agent Interaction Guidelines (AIG) and agent sessions](https://linear.app/developers/aig) | 2b · Human-in-the-loop and AI UX guidance |
| R30 | [Linear Inbox and Triage](https://linear.app/docs/inbox) | 3 · Developer-tool and issue-tracking UX |
| R31 | [Linear: How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui) | 3 · Developer-tool and issue-tracking UX |
| R32 | [Linear: command menu, shortcuts and the Linear Method](https://linear.app/docs/select-issues) | 3 · Developer-tool and issue-tracking UX |
| R33 | [GitHub notifications inbox](https://docs.github.com/en/subscriptions-and-notifications/concepts/about-notifications) | 3 · Developer-tool and issue-tracking UX |
| R34 | [Vercel dashboard redesigns (2026 navigation, and the earlier dashboard write-up)](https://vercel.com/changelog/dashboard-navigation-redesign-rollout) | 3 · Developer-tool and issue-tracking UX |
| R35 | [Primer — Color overview (token levels, functional roles, emphasis vs muted)](https://primer.style/foundations/color/overview) | 4 · Design systems for technical products |
| R36 | [Primer — StateLabel](https://primer.style/components/state-label) | 4 · Design systems for technical products |
| R37 | [Primer — Timeline](https://primer.style/components/timeline) | 4 · Design systems for technical products |
| R38 | [Primer — Blankslate](https://primer.style/components/blankslate) | 4 · Design systems for technical products |
| R39 | [Atlassian — Lozenge](https://atlassian.design/components/lozenge/usage) | 4 · Design systems for technical products |
| R40 | [Atlassian — Design tokens](https://atlassian.design/foundations/tokens/design-tokens) | 4 · Design systems for technical products |
| R41 | [IBM Carbon — Notification pattern](https://v10.carbondesignsystem.com/patterns/notification-pattern/) | 4 · Design systems for technical products |
| R42 | [IBM Carbon — Spacing scale](https://v10.carbondesignsystem.com/guidelines/spacing/overview/) | 4 · Design systems for technical products |
| R43 | [IBM Carbon — Data table row sizes](https://v10.carbondesignsystem.com/components/data-table/style/) | 4 · Design systems for technical products |
| R44 | [IBM Carbon — Empty states pattern](https://v10.carbondesignsystem.com/patterns/empty-states-pattern/) | 4 · Design systems for technical products |
| R45 | [IBM Carbon — Loading pattern](https://v10.carbondesignsystem.com/patterns/loading-pattern/) | 4 · Design systems for technical products |
| R46 | [Radix Colors — Understanding the scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale) | 4 · Design systems for technical products |
| R47 | [Radix Themes — Color](https://www.radix-ui.com/themes/docs/theme/color) | 4 · Design systems for technical products |
| R48 | [Vercel Geist — Colors](https://vercel.com/geist/colors) | 4 · Design systems for technical products |
| R49 | [AWS Cloudscape — Content density](https://cloudscape.design/foundation/visual-foundation/content-density/) | 4 · Design systems for technical products |
| R50 | [AWS Cloudscape — Loading and refreshing](https://cloudscape.design/patterns/general/loading-and-refreshing/) | 4 · Design systems for technical products |
| R51 | [NN/g — 8 Design Guidelines for Complex Applications](https://www.nngroup.com/articles/complex-application-design/) | 5 · UX research on expert and monitoring applications |
| R52 | [NN/g — Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | 5 · UX research on expert and monitoring applications |
| R53 | [NN/g — Indicators, Validations, and Notifications](https://www.nngroup.com/articles/indicators-validations-notifications/) | 5 · UX research on expert and monitoring applications |
| R54 | [NN/g — Response Times: The 3 Important Limits](https://www.nngroup.com/articles/response-times-3-important-limits/) | 5 · UX research on expert and monitoring applications |
| R55 | [NN/g — Skeleton Screens 101](https://www.nngroup.com/articles/skeleton-screens/) | 5 · UX research on expert and monitoring applications |
| R56 | [NN/g — Visibility of System Status](https://www.nngroup.com/articles/visibility-system-status/) | 5 · UX research on expert and monitoring applications |
| R57 | [NN/g — Empty State Interface Design (complex applications)](https://www.nngroup.com/articles/empty-state-interface-design/) | 5 · UX research on expert and monitoring applications |
| R58 | [NN/g — Dashboards: Making Charts and Graphs Easier to Understand](https://www.nngroup.com/articles/dashboards-preattentive/) | 5 · UX research on expert and monitoring applications |
| R59 | [NN/g — Data Tables: Four Major User Tasks](https://www.nngroup.com/articles/data-tables/) | 5 · UX research on expert and monitoring applications |
| R60 | [NN/g — Change Blindness in UX](https://www.nngroup.com/articles/change-blindness-definition/) | 5 · UX research on expert and monitoring applications |
| R61 | [NN/g — Dark Mode vs. Light Mode](https://www.nngroup.com/articles/dark-mode/) | 5 · UX research on expert and monitoring applications |
| R62 | [High-Performance HMI (ISA-101) — RealPars summary](https://www.realpars.com/blog/high-performance-hmi) | 5 · UX research on expert and monitoring applications |
| R63 | [Endsley's situation awareness model — EBSCO Research Starter](https://www.ebsco.com/research-starters/social-sciences-and-humanities/situational-awareness/) | 5 · UX research on expert and monitoring applications |
| R64 | [Structured State Reconciliation for Human-AI Task Handover (arXiv, 2026)](https://arxiv.org/abs/2608.28907) | 5 · UX research on expert and monitoring applications |
| R65 | [GitHub: reviewing proposed changes in a pull request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request) | 6 · Real-time status, log streaming and diff/review interfaces |
| R66 | [GitHub: applying suggested changes (single commit vs batch)](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/incorporating-feedback-in-your-pull-request) | 6 · Real-time status, log streaming and diff/review interfaces |
| R67 | [GitHub: rendered prose diffs](https://github.blog/2014-02-14-rendered-prose-diffs/) | 6 · Real-time status, log streaming and diff/review interfaces |
| R68 | [Gerrit: review UI (drafts, reviewed marks, patch-set comparison, shortcuts)](https://gerrit-review.googlesource.com/Documentation/user-review-ui.html) | 6 · Real-time status, log streaming and diff/review interfaces |
| R69 | [Gerrit: the attention set ("whose turn is it")](https://gerrit-review.googlesource.com/Documentation/user-attention-set.html) | 6 · Real-time status, log streaming and diff/review interfaces |
| R70 | [Reviewable: discussion dispositions and computed resolution](https://docs.reviewable.io/discussions.html) | 6 · Real-time status, log streaming and diff/review interfaces |
| R71 | [Vercel: build logs](https://vercel.com/docs/deployments/logs) | 6 · Real-time status, log streaming and diff/review interfaces |
| R72 | [Grafana Explore: live tailing logs](https://grafana.com/docs/grafana/latest/explore/logs-integration/) | 6 · Real-time status, log streaming and diff/review interfaces |
| R73 | [Carbon Design System: status indicator pattern](https://v10.carbondesignsystem.com/patterns/status-indicator-pattern/) | 6 · Real-time status, log streaming and diff/review interfaces |
| R74 | [GitLab Pajamas: Badge component](https://design.gitlab.com/components/badge/) | 6 · Real-time status, log streaming and diff/review interfaces |
| R75 | [Atlassian Statuspage: top-level status and incident impact calculation](https://support.atlassian.com/statuspage/docs/top-level-status-and-incident-impact-calculations/) | 6 · Real-time status, log streaming and diff/review interfaces |
| R76 | [Primer (GitHub): degraded experiences pattern](https://primer.style/product/ui-patterns/degraded-experiences/) | 6 · Real-time status, log streaming and diff/review interfaces |
| R77 | [web.dev: offline UX design guidelines](https://web.dev/articles/offline-ux-design-guidelines) | 6 · Real-time status, log streaming and diff/review interfaces |
| R78 | [TanStack Query: optimistic updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates) | 6 · Real-time status, log streaming and diff/review interfaces |
| R79 | [W3C WCAG 2.2: Understanding SC 2.2.2 "Pause, Stop, Hide" (auto-updating content)](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html) | 6 · Real-time status, log streaming and diff/review interfaces |
| R80 | [W3C WCAG 2.2: Understanding SC 4.1.3 "Status Messages"](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) | 6 · Real-time status, log streaming and diff/review interfaces |
| R81 | [Nielsen Norman Group: status trackers and progress updates](https://www.nngroup.com/articles/status-tracker-progress-update/) | 6 · Real-time status, log streaming and diff/review interfaces |
| R82 | [WCAG 2.2 — What's new](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/) | 7 · Accessibility (WCAG 2.2, WAI-ARIA APG) |
| R83 | [WCAG 2.2 — Understanding 2.4.11 Focus Not Obscured (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) | 7 · Accessibility (WCAG 2.2, WAI-ARIA APG) |
| R84 | [WCAG 2.2 — Understanding 2.4.13 Focus Appearance (AAA)](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html) | 7 · Accessibility (WCAG 2.2, WAI-ARIA APG) |
| R85 | [WCAG 2.2 — Understanding 2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) | 7 · Accessibility (WCAG 2.2, WAI-ARIA APG) |
| R86 | [WCAG 2.2 — Understanding 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | 7 · Accessibility (WCAG 2.2, WAI-ARIA APG) |
| R87 | [WCAG 2.2 — Understanding 3.3.7 Redundant Entry](https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html) | 7 · Accessibility (WCAG 2.2, WAI-ARIA APG) |
| R88 | [WCAG 2.2 — Understanding 3.2.6 Consistent Help](https://www.w3.org/WAI/WCAG22/Understanding/consistent-help.html) | 7 · Accessibility (WCAG 2.2, WAI-ARIA APG) |
| R89 | [WCAG 2.2 — Understanding 1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) | 7 · Accessibility (WCAG 2.2, WAI-ARIA APG) |
| R90 | [WCAG 2.2 — Understanding 1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) | 7 · Accessibility (WCAG 2.2, WAI-ARIA APG) |
| R91 | [WCAG 2.2 — Understanding 1.4.13 Content on Hover or Focus](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html) | 7 · Accessibility (WCAG 2.2, WAI-ARIA APG) |
| R92 | [WCAG Technique ARIA23 — role=log](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA23) | 7 · Accessibility (WCAG 2.2, WAI-ARIA APG) |
| R93 | [WAI-ARIA APG — Developing a Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/) | 7 · Accessibility (WCAG 2.2, WAI-ARIA APG) |
| R94 | [WAI-ARIA APG — Landmark Regions](https://www.w3.org/WAI/ARIA/apg/practices/landmark-regions/) | 7 · Accessibility (WCAG 2.2, WAI-ARIA APG) |
| R95 | [WAI-ARIA APG — Dialog (Modal) pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | 7 · Accessibility (WCAG 2.2, WAI-ARIA APG) |
| R96 | [WAI-ARIA APG — Tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) | 7 · Accessibility (WCAG 2.2, WAI-ARIA APG) |
| R97 | [WAI-ARIA APG — Tree View pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/) | 7 · Accessibility (WCAG 2.2, WAI-ARIA APG) |
| R98 | [WAI-ARIA APG — Treegrid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treegrid/) | 7 · Accessibility (WCAG 2.2, WAI-ARIA APG) |
| R99 | [WAI-ARIA APG — Feed pattern](https://www.w3.org/WAI/ARIA/apg/patterns/feed/) | 7 · Accessibility (WCAG 2.2, WAI-ARIA APG) |

## 1 · Pipeline and workflow orchestration UIs

### R01 · GitHub Actions: workflow run logs and the live visualization graph
- URL: https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs
  (companion page, also fetched:
  https://docs.github.com/en/actions/how-tos/monitor-workflows/use-the-visualization-graph)
- Category: 1
- What it is: The official docs for the run page. It has a job graph with status icons that update
  live, and per-step collapsible logs with search, line permalinks and download.
- Takeaways for DEMIURGO:
  - **Run detail:**
    - Render Prepare / Invoke / Apply as collapsible step rows, each with its duration.
    - Auto-expand only the failed step, and the running step while live.
    - Keep succeeded steps collapsed.
  - **Run detail, permalinks:** give each streamed event a permalink, for example `#e42`, by
    clicking its line number or timestamp. The person can then send or bookmark "the moment it
    failed" (see also Vercel, #13).
  - **Run detail, search:**
    - Search inside the event stream and show a match count.
    - GitHub only searches expanded steps, which is a known gotcha. DEMIURGO should search all
      phases and auto-expand the ones that match.
  - **Runs list / Needs you / graph nodes:** put a status icon to the left of the item name, with
    the same icon set on every surface, so the eye learns one vocabulary.
  - **Run graph:** only worth it when runs depend on each other, for example the
    knowledge_classifier → knowledge_reviewer cascade. Draw that chain as linked nodes. A single
    run is a linear strip, not a graph.
- Evidence:
  - "Any failed steps are automatically expanded to display the results."
  - "When you search logs, only expanded steps are included in the results."
  - "to get a link to a specific line in the logs, click on the step's line number."
  - "Every workflow run generates a real-time graph that illustrates the run progress."
  - "An icon to the left of the job name indicates the status of the job."

### R02 · GitHub Actions: re-running workflows and jobs (attempts)
- URL: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs
- Category: 1
- What it is: The docs for re-running a whole run, only its failed jobs, or a single job. Earlier
  attempts stay reachable through an attempt selector.
- Takeaways for DEMIURGO:
  - **Run detail header:**
    - A run keeps one identity across retries: "Run R-123 · Attempt 2".
    - A "Latest ▾" selector lists earlier attempts, which stay readable.
    - Never overwrite a failed attempt's events.
  - **Runs list, bulk action:** "Retry failed" re-queues only the runs that are failed or have
    invalid output. It never re-runs succeeded ones, which would spend quota for nothing.
  - **Retry menu:** offer a "Retry with full raw provider stream kept" option next to Retry,
    GitHub's "enable debug logging" equivalent. The person should not have to go through Settings
    for it.
  - **Run detail:** show the retry budget and who triggered each attempt ("Attempt 2 · automatic
    retry" or "Attempt 3 · retried by you"). This fits the rule that the server fixes the actor.
  - **Run detail:** tell the person what cannot be retried and why. GitHub has explicit limits:
    30 days and 50 attempts.
- Evidence:
  - "To the right of the run name, select the **Latest** dropdown menu and click a previous run
    attempt."
  - Options include "Re-run all jobs", "Re-run failed jobs" and the sync icon next to a single job.
  - "enable runner diagnostic logging and step debug logging for the re-run".
  - "A workflow run can be re-run a maximum of 50 times."

### R03 · Buildkite: the new build page and the feedback round that followed
- URL:
  https://buildkite.com/resources/changelog/266-introducing-the-new-build-page-engineered-for-scale-and-flexibility/
  (follow-up, also fetched:
  https://buildkite.com/resources/changelog/271-responding-to-feedback-for-the-new-build-page/)
- Category: 1
- What it is: Buildkite's 2025 redesign of its build page and the changes made after user
  feedback. It has a state-based sidebar, a table view, a movable and resizable job drawer, and
  failures first.
- Takeaways for DEMIURGO:
  - **Runs list / Needs you:**
    - Group by state and put blocked and failed items at the top, with a count per group.
    - When anything failed, hide succeeded items behind "Show N succeeded".
  - **Runs list:** give failed rows a faint red background *in addition to* icon + text. This
    helps scanning in long lists.
  - **Run detail as a drawer:**
    - Opening a run from the Runs list, Needs you or Activity opens a resizable side drawer, so
      the list stays in view.
    - The drawer has an "Open full page" permalink.
    - Remember the drawer's size and position per user.
  - **Persistence:** remember collapsed groups and the chosen view (list / table / timeline)
    across navigation. Buildkite added this after complaints about having to re-collapse the same
    sections on every page.
  - **Retries:** mark retried items in the list, with a hover card that jumps between attempts.
  - **Journal / Activity:** virtualize long lists, rendering only what is visible. Buildkite had
    to add this for large builds.
- Evidence:
  - "Immediately see blocked or failed steps at the top of your sidebar."
  - The layout puts "the highest priority items at the top".
  - "Position the step log drawer on the side, bottom or center of your screen and resize it to
    your needs."
  - "Retried steps are clearly indicated in the sidebar, with hover tooltips for quick navigation
    between attempts."
  - Feedback round: "persist collapsed states in the build page sidebar", "remember" the preferred
    view, and "initially hiding passed jobs when viewing failed steps".
  - Also from the feedback round: failed steps get "a slight red background", and Buildkite added
    "virtualisation to the canvas and table views".

### R04 · Buildkite: build annotations
- URL: https://buildkite.com/docs/agent/v3/cli-annotate
- Category: 1
- What it is: A build step can write Markdown "annotation" cards to the top of the build page. The
  cards have styles and priorities, and each context holds one card that is updated in place.
- Takeaways for DEMIURGO:
  - **Run detail:**
    - Put one human-readable summary card above the event stream.
    - While the run works, the card says "What the agent is doing".
    - When the run ends, it says what it produced, for example "3 proposals for FDR-AGE-002".
    - If the run failed, it says why.
    - The raw events come below it.
  - **Card styles:** use success / info / warning / error, mapped to design-system tokens.
    - For invalid output, list the schema violations in plain language.
    - Order cards by priority, with errors first.
  - **Idempotent cards:** one card per context (such as "validation" or "summary"), updated in
    place as the run progresses, never a pile of duplicates.
  - **Proposal batch header:** the same pattern gives the agent's rationale for the batch, shown
    before the individual proposals.
- Evidence:
  - "Build annotations allow you to customize the Buildkite build interface to show information
    that may surface from your builds."
  - Styles are `success`, `info`, `warning` and `error`.
  - "Running the annotate command with an identical context updates the existing annotation rather
    than creating a duplicate."
  - Annotations have priorities from 1 to 10 and higher ones are shown first.

### R05 · Temporal: redesigned workflow execution UI (Compact / Timeline / Full history)
- URL: https://temporal.io/blog/the-dark-magic-of-workflow-exploration
  (companion post, also fetched: https://temporal.io/blog/lets-visualize-a-workflow)
- Category: 1
- What it is: Temporal's write-up of its redesigned execution page. It offers three views of the
  same history, groups related low-level events into one row, and has a visual language for
  pending and retrying states.
- Takeaways for DEMIURGO:
  - **Run detail tabs:**
    - **Summary**, the default: what happened, in order, without clock time.
    - **Timeline:** durations.
    - **Raw events:** every SSE / stream-json event, as JSON.
    - The non-technical person lives in Summary. Developers switch tabs.
  - **Event grouping:** collapse "model call started / streaming / finished" into a single
    "Invoke model" row that spans its duration. Collapse repeated identical events into one line
    with a count, for example "Streaming output ×148".
  - **Pending language:**
    - Pending or working: dashed, animated forward line.
    - Retrying: dashed red.
    - Failed: solid red.
    - Done: solid green.

    Reuse this as design-system tokens, with a reduced-motion fallback of static dashes.
  - **Attempts:** show a retry icon with the current attempt number on the phase row
    (see #2 and #10).
  - **Child runs inline:** a cascaded run (classifier → reviewer) opens inside the parent's detail
    view, without leaving the page.
  - **Declutter:** move secondary information to tabs so the first view shows "only vital
    information".
- Evidence:
  - "Our goal was to improve the Workflow Execution UI so that you could look at any Workflow and
    understand what's happening, right now."
  - "The Compact view does not take clock time into consideration. Simply what happened, in what
    order."
  - "Red means failure, dashed red means retrying, dashed purple is pending, green means
    completion."
  - From the Timeline post: "a retry icon with the current attempt number". Also, "the three
    related Events … produce a single Activity row that spans the duration of the activity."

### R06 · Temporal: Web UI docs and the live Event History feed
- URL: https://docs.temporal.io/web-ui
  (also fetched:
  https://temporal.io/change-log/updated-event-history-timeline-view-is-now-available)
- Category: 1
- What it is: The reference for Temporal's execution list, detail page, pending-activities panel,
  task-failure flagging and controls. The changelog adds the live history feed with pause.
- Takeaways for DEMIURGO:
  - **Runs list filters:** status, agent, run type, started / ended. Offer a per-user setting to
    show times as relative, local or absolute.
  - **Automatic "failing repeatedly" flag:**
    - After N consecutive failed runs of the same agent, raise one Needs you item: "Designer has
      failed 5 times in a row: check its model assignment".
    - Clear it automatically on the next success.
  - **Run detail, "Right now" block:** show what is pending at this instant, for example "Waiting
    for model response · 42 s · attempt 2". It sits above the history.
  - **Journal:**
    - A live feed with ascending / descending order and a Pause-live button.
    - Clicking an event opens its related events together (queued → started → finished for the
      same run).
  - **Run detail controls:** Cancel and Retry live in the run header, next to the status, and are
    not buried in menus.
- Evidence:
  - Executions can be listed by "Status, Workflow ID, Workflow Type, Start time, End time".
  - Time can be shown in UTC, local or relative format.
  - "When a Workflow experiences five consecutive task failures or timeouts, it gets automatically
    flagged. The moment the Workflow recovers with a successful task, the flag clears."
  - Pending activities: "Displays a summary of recently active and/or pending Activity
    Executions."
  - From the changelog: "Monitor live updates of incoming Events in either Ascending or Descending
    order. Ability to pause live Events to stop and investigate." Also: "click the row to open and
    view all information for not only that Event, but all related Events".

### R07 · Apache Airflow: Grid view and task instance details
- URL: https://airflow.apache.org/docs/apache-airflow/stable/ui.html
- Category: 1
- What it is: Airflow's main monitoring view. A matrix with one task per row and one run per
  column, colored by state, with a details panel holding logs, details and a mini-Gantt.
- Takeaways for DEMIURGO:
  - **Runs page, "Agent health" strip:**
    - Rows are agents (explorer, designer, onboarding, knowledge_classifier, knowledge_reviewer).
    - Columns are the last N runs.
    - Each cell is colored and shaped by state, with a tooltip.
    - One look answers "which agent keeps failing?".
  - **Cell click:** open the run drawer with tabs for Events (logs), Details and Actions.
    - Details lists agent, provider, model, duration, tokens and attempt.
    - Actions offers retry and cancel.
  - **Do NOT copy "mark success / mark failed".** Airflow lets people force a state. In DEMIURGO
    that would fake an outcome, so omit it. The only human verdicts are accept and reject on
    proposals.
  - **Details tab:** add a mini duration bar compared with the agent's typical duration, so
    "slow" can be read at a glance.
- Evidence:
  - "Each row represents a task, and each column represents a Dag run."
  - "Identify failed or retried tasks by color and tooltip."
  - Clicking a cell lets you "view logs or mark instances as successful, failed, or cleared".
  - Task instances include "a mini Gantt-style timeline that visually represents the task's
    duration".

### R08 · Dagster: run details page
- URL: https://docs.dagster.io/guides/operate/webserver
- Category: 1
- What it is: Dagster's run page. It has a Gantt chart of steps at the top, a filterable
  structured event log at the bottom, a switch to raw stdout/stderr, and a Re-execute button with
  a list of related runs.
- Takeaways for DEMIURGO:
  - **Run detail layout:**
    - Top: a phase strip or timeline.
    - Bottom: the structured event list (text delta, tool call, validation, apply, error) with
      type filters and search.
    - A toggle shows the raw provider stream (stream-json / exec --json).
  - **Structured vs raw:** structured events carry metadata such as the record code touched and
    the proposal id. The raw stream is the unedited provider output for debugging.
  - **Related runs panel:** retries and re-executions of the same logical run sit together on the
    right, not scattered through the list.
  - **"Re-run with same inputs":** it lives in the run header, and the context pack used is
    visible (see #10).
- Evidence:
  - "a Gantt chart, indicating how long each asset or op took to execute".
  - "Structured logs are enriched and categorized with metadata" and "raw compute logs contain
    logs for both stdout and stderr, which you can toggle between".
  - "filterable events and logs emitted during execution".
  - "related runs (e.g., runs created by re-executing the same previous run)".

### R09 · Prefect: states (type vs name, terminal states, messages)
- URL: https://docs.prefect.io/v3/concepts/states
- Category: 1
- What it is: Prefect's state model. A state *type* drives orchestration. A state *name* is the
  label people see. Terminal states are distinct, and Failed (code) is separate from Crashed
  (infrastructure).
- Takeaways for DEMIURGO:
  - **Two layers:** a small set of types drives color, icon and sorting. Friendlier names go
    inside them:
    - Queued: Queued, Late, Waiting for retry.
    - Working: Preparing, Calling model, Applying, Retrying.
    - Succeeded.
    - Failed: Failed, Invalid output, Timed out.
    - Crashed: Provider unavailable, CLI crashed.
    - Cancelled.
  - **Failed vs Crashed tells the person what to do.**
    - Crashed means the infrastructure broke: retrying is sensible, or check the provider in
      Models & providers.
    - Failed or Invalid output means the content broke: change the input or the agent, because a
      blind retry wastes quota.
  - **Terminal vs non-terminal:** only non-terminal states show a spinner and a live elapsed
    timer. Terminal states show the final duration and a timestamp.
  - **Surface "Late":** a run queued longer than expected (for example behind the serial knowledge
    queue) becomes a visible state, and a Needs you item if it passes a threshold.
  - **State message:** always show a one-line reason under the badge, for example "Invalid output:
    design_proposal missing 'relations' (3 errors)".
- Evidence:
  - "A state's name is often, but not always, synonymous with its type."
  - Failed: "The run did not complete because of a code issue and had no remaining retry
    attempts".
  - Crashed: "The run did not complete because of an infrastructure issue".
  - The Scheduled type includes "Late, AwaitingRetry". Terminal states include "Cancelled,
    Completed, … Failed, TimedOut, and Crashed".

### R10 · Inngest: run inspection and trace (waterfall) view
- URL: https://www.inngest.com/docs/platform/monitor/traces
  (also fetched: https://www.inngest.com/docs/platform/monitor/inspecting-function-runs)
- Category: 1
- What it is: Inngest's run inspector for durable, step-based functions, including AI inference
  steps. It has compound bars for queue vs execution time, attempt badges, and a side panel with
  input/output per step.
- Takeaways for DEMIURGO:
  - **Timeline tab:**
    - Draw each phase as a compound bar: a gray segment for time waiting in the queue, then a
      status-colored segment for execution.
    - This separates "stuck in queue" from "model is slow".
  - **Attempts:**
    - Show an "Attempt 2" badge next to the phase name, colored by that attempt's outcome.
    - Each attempt is its own row, so the attempts can be compared.
  - **Phase side panel:** clicking a phase opens Input / Output tabs.
    - Prepare shows the context pack that was sent.
    - Invoke shows the model's structured output.
    - Apply shows the proposals created.

    This is essential for debugging "invalid output".
  - **Rerun from a step:** DEMIURGO keeps `step_completions`, so it can offer "Re-apply" (rerun
    Apply without calling the model again) when only Apply failed. That saves quota.
  - **Runs list filters:** status, queued at and started at, with the same terms as the state
    model.
- Evidence:
  - "its bar displays as a **compound bar**: a short gray segment (queue delay) immediately
    followed by a status-colored segment (execution time)."
  - The attempt badge: "'Attempt 2'. The badge is colored to match the step's status".
  - "Expanding a step provides the same level of details (the error message and timings) along
    with retries information."
  - "select a step in the trace to rerun from that step".

### R11 · GitHub Copilot coding agent: tracking agent sessions
- URL: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/track-copilot-sessions
  (also fetched:
  https://github.blog/changelog/2026-03-19-more-visibility-into-copilot-coding-agent-sessions/)
- Category: 1 (AI agent run supervision; also relevant to 6)
- What it is: GitHub's UI for supervising autonomous coding-agent sessions. It has an agents panel
  reachable from any page and a session log with reasoning and tool calls. It also shows token
  usage and supports mid-run steering, stopping, and links from commits back to the session.
- Takeaways for DEMIURGO:
  - **Header health / global runs popover:**
    - Reachable from every page.
    - Lists running and recent runs with a live count badge.
    - Clicking a run opens the drawer (see #3).
  - **Run detail header:** show token usage and elapsed time next to the status.
  - **Steering in threads:** a message sent while the agent works is accepted and labelled "Will
    be read after the current step", not rejected and not silently dropped.
  - **Cancel explains what is kept:** "Stop run: proposals already created stay in review; nothing
    is accepted." Copilot keeps pushed commits on Stop.
  - **Provenance:**
    - Every proposal and every accepted record version links to the run and session that
      produced it ("Proposed by designer · run R-123 · view log").
    - The Origins tree and the proposal review both carry this link.
  - **Sub-agents collapsed:** the cascaded reviewer run collapses by default with a heads-up line,
    "Reviewer checking 4 candidates…", and expands on demand.
- Evidence:
  - Users can "monitor the agent's progress, token usage, and session length."
  - "Copilot implements your input after it finishes its current tool call."
  - "click **Stop session** in the session log viewer".
  - "Each commit message includes a link to the session logs, so you can trace why a change was
    made".
  - From the changelog: "The subagent's activity is now collapsed by default, with a heads-up
    display showing what it's working on right now."

### R12 · Langfuse: token and cost tracking
- URL: https://langfuse.com/docs/observability/features/token-and-cost-tracking
- Category: 1 (LLM run observability)
- What it is: How an LLM observability tool records usage and cost for each generation and each
  trace. Usage is split into non-overlapping types (input, output, cached). Cost reported by the
  provider takes priority over cost the tool infers.
- Takeaways for DEMIURGO:
  - **Run detail usage block:** show input / output / cached tokens as buckets that don't overlap,
    so they add up to the total.
  - **Label where the numbers come from:**
    - "reported by provider" or "estimated ≈".
    - For Claude and Codex subscriptions, show tokens and "Included in subscription" rather than
      an invented dollar figure.
    - Show cost only where the provider gives it.
  - **Settings / agent consumption:**
    - Aggregate per agent and per model over time: a small sparkline per agent in Models &
      providers.
    - Totals per run and per batch of proposals.
  - **Proposal batch header:** "This batch cost 38k tokens (designer · Claude)", so the person can
    connect spending to output.
- Evidence:
  - "**Usage details**: number of units consumed per usage type" and "**Cost details**: USD cost
    per usage type".
  - "each token must be counted in exactly one key".
  - "**ingested values take priority** over inferred ones".
  - Dashboards show "cost by model, cost over time".

## 2 · AI agent and LLM observability

### R13 · LangSmith annotation queues
- URL: https://docs.langchain.com/langsmith/annotation-queues
- Category: 2
- What it is: LangSmith's human-review workflow. Runs or whole threads are pushed into a queue and
  reviewers work through them one by one against a rubric. A pairwise mode shows two outputs side
  by side.
- Takeaways for DEMIURGO:
  - **Proposal review as a queue, in three panes.** Left: the batch's proposals, each with its
    review status (pending, accepted, rejected, edited). Center: the before/after of the selected
    proposal. Right: the decision panel (Accept, Reject with reason, Edit).
  - **Pin the batch-level context in the side panel on every item**, the way LangSmith shows
    annotator instructions on each item. That context is the agent's summary of the batch, the
    thread message that caused it, and the records it touches, so the reviewer never loses it
    while stepping through items.
  - **Deciding moves to the next item.** Show "4 of 9 reviewed" in the batch header. Make
    "Accept package" state how many items are still unreviewed ("Accept all 9 (5 not opened)").
  - **Single-key decisions**, like LangSmith's pairwise hotkeys A/B/E: `A` accept, `R` reject,
    `E` edit, `J`/`K` next/previous.
  - **Reuse the pairwise mode to compare thread forks.** Show two forks side by side with
    "Keep A / Keep B / Keep both open".
  - Skip reservations and multi-reviewer thresholds. DEMIURGO has one human reviewer.
- Evidence: "Single-run annotation queues present one queue item at a time, either a run or a
  thread"; "Pairwise annotation queues (PAQs) present two runs side-by-side so reviewers can
  quickly decide which output is better". The layout is a left sidebar of items with review status,
  a center pane with the content, and a right feedback panel. Setup lets you "Draft some high-level
  Instructions for your annotators, which will be shown in the sidebar on every item". Pairwise
  reviewers choose "A is better", "B is better" or "Equal" with hotkeys A, B, E. Clicking **Done**
  completes an item.

### R14 · Langfuse: sessions, and token and cost tracking
- URL: https://langfuse.com/docs/observability/features/sessions
- URL: https://langfuse.com/docs/observability/features/token-and-cost-tracking
- Category: 2
- What it is: Open-source LLM observability. Sessions group many traces into one replayable
  interaction. Cost tracking records usage and USD per usage type, per call, and aggregates it in
  dashboards.
- Takeaways for DEMIURGO:
  - **Treat a thread as a session.** The thread page gets an "Agent activity" toggle that replays
    every run the thread triggered, inline and in order. Each run opens its run detail.
  - **Break tokens into exclusive buckets** in run detail: input, cached input, output, reasoning.
    Count each token once, so the totals add up and the reader can trust them.
  - **Consumption lives in three places:** a cost/tokens column in the runs list, the total per
    thread in the thread header, and a Consumption view in settings by agent, model and week, with
    "top threads by cost".
  - **Let the user bookmark a run or thread** ("Save for later") so they can find a bad output
    again when they want to report it or retry.
  - **Take feedback at more than one level**: on a DEMIURGO message, on a run, and on a whole
    thread.
- Evidence: "Sessions in Langfuse allow you to group traces together and see a simple session
  replay of the entire interaction". Users can "replay the entire interaction to debug or analyze
  the conversation" and bookmark sessions. Cost: "Usage details: number of units consumed per usage
  type" and "Cost details: USD cost per usage type". Usage types include input, output,
  cached_tokens and reasoning tokens, and "each token must be counted in exactly one key". There is
  a "Cost tracking dashboard … showing cost by model, cost over time, and top users and use cases
  by cost".

### R15 · Braintrust: viewing logs
- URL: https://www.braintrust.dev/docs/observe/view-logs
- Category: 2
- What it is: Braintrust's production log explorer. It is a table of traces with live tail, saved
  default views, custom columns and a trace viewer.
- Takeaways for DEMIURGO:
  - **Give the runs list ready-made views as tabs:** All · Running · Failed/Invalid · Needs review
    (produced proposals not yet decided) · Cancelled. Braintrust ships "Errors", "Unreviewed" and
    "Assigned to me" the same way.
  - **Live tail in the live journal and Activity log.** Flash new rows briefly. Pause streaming when
    the tab is hidden and show "12 new events" on return instead of scrolling the page away from
    the reader.
  - **Runs list columns:** status, agent, model/provider, trigger (thread, knowledge update,
    classifier), duration, tokens, cost, started at. Let the user hide columns. Non-technical users
    will hide tokens.
  - **Filters reach into a run's events.** Searching "rate limit" finds runs whose streamed
    events contain it, not only runs with that title.
  - **Selecting a row opens the run in a side viewer** (peek) instead of navigating away, so the
    list keeps its place.
- Evidence: logs display as "a table of traces where each row represents a complete trace with
  its root span". With Live tail on, "new rows are highlighted with a flash animation, and
  streaming pauses automatically when the browser tab is hidden". Default views include Errors,
  Unreviewed ("Hides human-reviewed items") and Assigned to me. Columns cover duration, tokens and
  cost. "filters can still match child-span fields". Selecting a trace "opens it in the trace
  viewer".

### R16 · Weights & Biases Weave: trace tree
- URL: https://docs.wandb.ai/weave/guides/tracking/trace-tree
- Category: 2
- What it is: Weave's trace view has three panels (trace list, call tree, details). The tree has
  alternative visualizations: code composition, flame graph and graph.
- Takeaways for DEMIURGO:
  - **Run detail in three panels.**
    - Left: a narrow list of sibling runs (same thread or same trigger) to jump between retries.
    - Center: the step tree prepare → invoke → apply, with streamed events nested under invoke.
    - Right: details of the selected step (input context pack, output, usage, errors).
  - **Each step node shows a status icon, its duration and its cost inline**, so the failing step
    and the slow step stand out without opening anything.
  - **Add a thin horizontal timeline above the tree**, a simplified flame bar with three segments
    (prepare / invoke / apply). It shows where the time went and where the run stopped.
  - **Keyboard traversal** of the step tree (Alt+↑/↓) and tabbed step details: Output · Context ·
    Usage · Raw.
- Evidence: "The Left panel contains a sortable, paginated list of all traces for the project",
  with tokens, cost and latency; "the Right panel shows details for a selected op". The tree
  displays "stack hierarchy, cost per op (if available), execution time, and status indicators".
  The flame graph gives "a timeline-based visualization of execution depth and duration".
  Navigation: "Use Cmd (macOS) or Alt (Windows/Linux) + Up Arrow (↑) or Down Arrow (↓)". Op
  details are tabbed: Call, Code, Feedback, Scores, Summary, Usage.

### R17 · Helicone sessions
- URL: https://docs.helicone.ai/features/sessions
- Category: 2
- What it is: Helicone groups related LLM calls into sessions. A path hierarchy (`/a/b/c`) describes
  conceptual structure, and a human-readable session name groups similar workflows.
- Takeaways for DEMIURGO:
  - **Group runs by purpose, not only by time.** Offer a "Group by" on the runs list:
    project → thread / knowledge update / classifier → batch. A user asking "what has the Designer
    done on Checkout?" gets a tree, not a flat log.
  - **Name every run in human terms.** Use "Reply in thread 'Checkout flow'" or "Update knowledge
    after ADR-004 v2", never only `designer#run-8f3a`. The agent id becomes secondary metadata.
  - **Roll up cost and duration to the parent group** (thread, batch), so the user sees what a
    whole piece of work cost.
- Evidence: "Sessions group these related requests together, letting you trace the entire agent
  flow from initial user input to final response in one unified view". "Paths create the hierarchy
  within your session, showing how requests relate to each other". "Think of session paths as
  conceptual groupings rather than chronological order". Session Name: "Human-readable name for the
  session type. Groups similar workflows together".

### R18 · Arize Phoenix sessions
- URL: https://arize.com/docs/phoenix/tracing/llm-traces/sessions
- Category: 2
- What it is: Phoenix renders a multi-turn session as a chatbot-like transcript. Each turn is backed
  by a trace, with token usage and latency per conversation.
- Takeaways for DEMIURGO:
  - **Put a quiet footer on every DEMIURGO message in a thread** with a link to the run that
    produced it: "Explorer · run 8f3a · 4.2k tokens · 12 s". The transcript stays the primary
    view, and the trace is one click away.
  - **Show thread-level totals** (turns, tokens, time) in the thread's info popover, not in the
    main column.
  - **Thread search** should match message text and run metadata (agent, failure reason).
- Evidence: Sessions let you "Track the entire history of a conversation in a single thread", with
  "a chatbot-like UI showing inputs and outputs of each turn". You can "Search through sessions to
  find specific interactions" and "Track token usage and latency per conversation", which gives "a
  connected view that reveals how your application performs across an entire user journey".

### R19 · LangChain Agent Inbox
- URL: https://github.com/langchain-ai/agent-inbox
- Category: 2 (HITL tooling for LangGraph)
- What it is: An open-source inbox UI for agent interrupts. Each interrupt has a title, a markdown
  description and arguments. It offers a configured subset of four responses: accept, edit,
  respond, ignore.
- Takeaways for DEMIURGO:
  - **Type every Needs-you item by the responses it allows**, and show only those:

    | Item | Responses |
    | --- | --- |
    | Proposal | Accept · Edit & accept · Reject |
    | Guided question | Answer (option buttons + free text) · Skip |
    | Failed or invalid run | Retry · Change model · Dismiss |
    | Assumption to confirm | Confirm · Replace |

  - **The server declares the allowed actions per item**, like `allow_accept` / `allow_edit`.
    The UI renders what the server permits and does not decide it in the client. This matches
    DEMIURGO's server-fixed actor and capability matrix.
  - **Card anatomy:** the header is the action ("Accept change to FDR-012"), the body is the
    agent's markdown rationale, and the arguments (the diff) are editable in place when edit is
    allowed.
  - **Every inbox item deep-links to its origin** (the thread, the run, the batch) so the user can
    take the decision in full context.
- Evidence: the title is "rendered in the Agent Inbox as the main header for the interrupt
  event"; the description "may be markdown. This will be rendered in the Agent Inbox as the
  description". The responses are Accept ("Accept the interrupt's arguments, or action"), Edit,
  Respond ("Send a response to the interrupt") and Ignore. Which ones appear is controlled by
  `allow_accept`, `allow_edit`, `allow_respond` and `allow_ignore`.

## 2b · Human-in-the-loop and AI UX guidance

### R20 · Microsoft HAX: Guidelines for Human-AI Interaction
- URL: https://www.microsoft.com/en-us/haxtoolkit/library/
- URL: https://www.microsoft.com/en-us/haxtoolkit/guideline/make-clear-why-the-system-did-what-it-did/
- URL: https://www.microsoft.com/en-us/haxtoolkit/guideline/make-clear-how-well-the-system-can-do-what-it-can-do/
- Category: 2b
- What it is: Microsoft Research's 18 guidelines (CHI 2019) grouped by phase (initially, during
  interaction, when wrong, over time), with design patterns per guideline.
- Takeaways for DEMIURGO:
  - **G1/G2: an agent card** in settings and in the run detail header. It says what the agent does
    ("Designer drafts FDR changes as proposals; it cannot accept") and how reliable it has been
    ("7 of 10 recent batches accepted without edits"). This is G2's "report system performance
    information".
  - **G16, convey consequences, before accepting.** The Accept button opens a compact preview:
    "Accepting will create FDR-012 v3, add 2 relations, move 1 check to confirmed, and start a
    knowledge update." Package accept shows the aggregate.
  - **G11, local explanations.** Each proposal has a "Why this change" block linking to the
    thread message, record or source that caused it.
  - **G8/G9/G15, efficient dismissal and granular feedback.** Reject takes one click or key, with
    optional reason chips: wrong fact · out of scope · duplicate · too vague. The reasons feed the
    agent stats.
  - **G17 and G18.** A global "Pause all agents" control, and a Catch up entry "Designer agent
    changed (new skill version)" when an agent's content hash changes.
- Evidence: the library lists G1 "Make clear what the system can do", G2 "Make clear how well the
  system can do what it can do", G8 "Support efficient dismissal", G9 "Support efficient
  correction", G11 "Make clear why the system did what it did", G15 "Encourage granular feedback",
  G16 "Convey the consequences of user actions", G17 "Provide global controls" and G18 "Notify
  users about changes". G2 patterns include "Report system performance information" and "Provide
  low performance alerts". G11 includes "Local Explanations".

### R21 · Google PAIR People + AI Guidebook: Explainability & Trust, Feedback & Control
- URL: https://pair.withgoogle.com/chapter/explainability-trust/
- URL: https://pair.withgoogle.com/chapter/feedback-controls/
- Category: 2b
- What it is: Google's guidebook chapters on showing model confidence and explaining output, and
  on collecting feedback while balancing automation against user control.
- Takeaways for DEMIURGO:
  - **Keep certainty categorical.** DEMIURGO's confirmed / assumed / proposed / open / unknown are
    the buckets PAIR recommends. Give each one an explicit next action in the record UI:
    - assumed: "Confirm or replace";
    - open: "Answer";
    - unknown: "Ask an agent".
  - **Never show numeric model confidence** (percentages) on records or proposals.
  - **Offer alternatives when the system is unsure.** Guided questions with predefined options, and
    forks, are the "N-best alternatives" pattern. When an agent is unsure, it should present 2–4
    options, not one confident answer.
  - **Say what the feedback changed.** After accept or reject, a toast names the effect: "Accepted.
    Checkout is now 'Ready to build' (2 checks confirmed)". Avoid a generic "Thanks".
  - **Keep a manual path for high-stakes work.** Users want control where they feel responsible,
    so every surface where an agent writes also lets the human write or edit by hand. Agents can be
    turned off per project.
- Evidence: categorical displays "categorize confidence values into buckets, such as High / Medium
  / Low", and teams should "clearly indicate what action a user should take under each category".
  "Numeric confidence indicators are risky because they presume your users have a good baseline
  understanding of probability". N-best is "especially useful in low-confidence situations" and
  "prompts the user to rely on their own judgement". Feedback should move from "Thanks for your
  feedback" to "Thanks. We've updated your recommendations. Take a look". "Allow users to test it
  out or turn it off".

### R22 · Shape of AI pattern catalog
- URL: https://www.shapeof.ai/
- URL: https://www.shapeof.ai/patterns/footprints
- URL: https://www.shapeof.ai/patterns/verification
- Category: 2b
- What it is: Emily Campbell's catalog of AI UX patterns, grouped as Wayfinders, Inputs, Tuners,
  Governors, Trust builders and Identifiers. It covers Footprints, Verification, Action plan,
  Controls, Stream of thought, Citations, Caveat and Disclosure.
- Takeaways for DEMIURGO:
  - **Footprints everywhere, with one visual mark.** Every record version, relation and check
    carries a small provenance line: "Proposed by Designer (run 8f3a) · accepted by Marcos · 25
    Sep". Origins is the full tree of those footprints. Use a single "agent-made" icon across the
    app.
  - **Match friction to risk in verification.**
    - Answering a guided question or accepting one small edit needs no extra confirm.
    - Accepting a package, or a proposal that changes a *confirmed* record or supersedes an ADR,
      gets an explicit confirmation step listing what changes.
  - **Action plan before long runs.** When an agent emits a plan, show it as a checklist in the
    run detail and in the thread's run chip, so the user can stop the run early if the plan is
    wrong.
  - **Controls: Stop is always visible** on a running run (runs list row, run detail, thread chip).
  - **Disclosure.** AI-authored text (drafts, summaries) is visibly styled differently from
    accepted authority.
- Evidence: Footprints "Let users trace the AI's steps from prompt to result". "Without these,
  users cannot judge reliability, repeat a result, or hold the system accountable", and the page
  advises: "Make footprints discoverable and consistent". Verification: "Allow users to confirm AI
  decisions and actions before proceeding". "Match friction to risk", including "Loss of work from
  overwritten records". Action plan: "Have the AI show the steps it will take before executing
  response". Controls: "pause mid-stream to adjust".

### R23 · Nielsen Norman Group: explainable AI, prompt controls, designing AI agents
- URL: https://www.nngroup.com/articles/explainable-ai/
- URL: https://www.nngroup.com/articles/prompt-controls-genai/
- URL: https://www.nngroup.com/articles/designing-ai-agents/
- Category: 2b
- What it is: NN/g research articles on how explanations and citations in AI chat mislead or help
  users, on hybrid "prompt controls" around chat inputs, and on a usability study of an agent
  (Qwen).
- Takeaways for DEMIURGO:
  - **In proposal review, lead with evidence, not reasoning.** Put the cited records and sources
    next to the claim they support, labeled meaningfully ("FDR-004 · Payment retries", not "[1]"),
    and styled differently from the proposal text. Put the agent's streamed reasoning behind a
    "Show agent narration" disclosure.
  - **Guided-question options are prompt controls.** Render them as labeled buttons grouped by
    function, with standard icons plus text, and always keep a free-text escape.
  - **Two ways in to each task.** The thread composer and explicit buttons ("Ask Explorer to
    challenge this", "Draft FDR from this thread") reach the same action.
  - **Clarify instead of assuming.** When a request is broad, the agent asks a clarifying
    question with options rather than guessing. This is what DEMIURGO's guided questions already do.
  - **No surprises in decision-critical information.** Before starting an expensive run (big
    context pack, Claude/Codex quota), show the model and an estimate or at least "uses your
    Claude subscription". An unexplained cost jump was the moment users abandoned the agent in the
    study.
- Evidence: "explanations currently offered by large language models (LLMs) are often inaccurate,
  hidden, or confusing". Step-by-step reasoning is often "rationalizations generated after the fact,
  rather than faithful representations". Designers should "Style citations differently from the
  main output response" and place sources next to claims. Prompt controls: "Pairing icons with
  descriptive labels is even more important". From the Qwen study: offer redundant entry points, and
  "clarifying questions with options work better than assuming specific items". Users abandoned the
  agent when a price jumped without explanation.

### R24 · Microsoft Design: UX design for agents
- URL: https://microsoft.design/articles/ux-design-for-agents/
- Category: 2b
- What it is: Microsoft Design's principles for agent UX, organized as Space, Time and Core.
- Takeaways for DEMIURGO:
  - **Persistent agent status in the top bar,** visible from every page: "2 running · 1 needs
    you · 1 failed". It opens a runs drawer. This is the answer to "what is running / stuck /
    needs me at a glance".
  - **Background processes need a place to be seen and controlled.** Knowledge updates and
    classifier runs appear in the same runs list, with Stop/Retry, not only user-triggered runs.
  - **Nudge more than notify.** Catch up summarizes ("While you were away: 3 batches ready, 1 run
    failed twice, Checkout reached Ready"), each line linking to a filtered view, rather than
    replaying every event.
  - **Make agents inspectable.** The agent page lists its skills, the version (content hash), the
    assigned model and its recent runs.
- Evidence: "Agent status, or what the agent is doing, is clearly visible at all times". "Agents
  that operate as background processes have a user-facing mechanism to view and control actions and
  automations". "Agents' associated knowledge, tools/skills, and connections with people and other
  agents are transparent and customizable". "Nudging more than notifying". "A certain level of Agent
  uncertainty is expected. Uncertainty is a key element of agent design."

### R25 · Smashing Magazine: Designing for agentic AI (control, consent, accountability)
- URL: https://www.smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/
- Category: 2b
- What it is: Victor Yocco (Feb 2026) describes six patterns across the agent lifecycle, each with
  metrics: Intent Preview, Autonomy Dial, Explainable Rationale, Confidence Signal, Action Audit &
  Undo, Escalation Pathway.
- Takeaways for DEMIURGO:
  - **Intent preview → batch header.** Offer three explicit choices: "Accept package" · "Review one
    by one" · "I'll write it myself". The last one closes the batch and opens the record editor.
  - **Autonomy dial, fixed and stated.** DEMIURGO sits permanently at "Plan & Propose". Say so in
    the settings agent card ("Agents propose; only you accept"). Do not offer higher levels; that
    would break the core rule.
  - **Explainable rationale in the "Because you said X, I did Y" form.** Each proposal quotes or
    links the triggering thread message or decision.
  - **Action audit.** The Activity log is a chronological timeline with clear statuses (running,
    done, reverted). Because the diary is append-only, "undo" becomes "Revert", which creates a new
    superseding version, and the log says so.
  - **Metrics for agent quality.** Show per agent: acceptance-without-edit ratio, reject ratio,
    retry rate. Show them in settings, not in the review flow.
- Evidence: patterns run "Pre-Action … In-Action … Post-Action". Intent preview decision points are
  "Proceed, Edit Plan, Handle it Myself". The Autonomy Dial levels include "Plan & Propose – Agent
  creates plans requiring review". Rationale follows "Because you said X, I did Y". Action Audit
  calls for a "chronological timeline view of all agent-initiated actions" with statuses.
  "Surfacing uncertainty helps prevent automation bias". "The long-term success of an agentic system
  depends less on its ability to be perfect and more on its ability to recover gracefully when it
  fails."

### R26 · GitLab Pajamas: AI-human interaction, and Agents and flows
- URL: https://design.gitlab.com/usability/ai-human-interaction
- URL: https://design.gitlab.com/patterns/duo-agents-and-flows/
- Category: 2b
- What it is: GitLab's design-system guidance for Duo. It defines AI modes (Focused, Supportive,
  Integrated), proactive and reactive interactivity, labeling of AI content, and where
  non-conversational "flows" show their state.
- Takeaways for DEMIURGO:
  - **Pick a mode per surface on purpose.**
    - Thread: *Focused* (AI is the main context).
    - Go deeper panel: *Supportive* (it complements the thread).
    - "Ask about this record" on a record: *Integrated*.
  - **Label AI content as "<Verb> by <agent>"**: "Proposed by Designer", "Summarized by Explorer".
    Accepted authority shows "Accepted by <human>", never an agent.
  - **Show a run's state in four coordinated places**, following GitLab's flows:
    1. a status chip on the object it works on (thread, record);
    2. a real-time session log (run detail);
    3. an entry in the Activity timeline;
    4. a notification or Needs-you item when input is needed, with the action button inline.
  - **When an agent fails or cannot answer,** explain why and give a path forward that does not
    need AI ("Edit the record by hand", "Retry with another model").
  - **One consistent identity per agent** (name, avatar, handle), distinct from human avatars.
- Evidence: "Focused: AI is the main context, with dedicated interface (for example, chat)",
  "Supportive: AI complements the main context within existing workflows", "Integrated: AI is
  blended into specific workflow moments". "Flag AI-generated content with the disclaimer `<Verb> by
  AI`". Flows show status in the comments/activity timeline, a "Session Panel" ("Real-time activity
  log with timestamps, step-by-step progress, and tool invocations"), a "Sessions Indicator" and
  notifications. When input is needed, "update status indicator to show input needed state with
  action button". Failures: "Explain why the system was not able to provide a recommendation" and
  ensure "a path forward that does not rely on AI".

### R27 · GitHub Copilot coding agent: tracking sessions and reviewing its PRs
- URL: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/track-copilot-sessions
- URL: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/review-copilot-prs
- Category: 2b (a production agent review UI)
- What it is: GitHub's docs for its asynchronous coding agent: an agents panel available from any
  page, session logs, steering, stopping, and the human review gate on its pull requests.
- Takeaways for DEMIURGO:
  - **The runs drawer opens from any page** (top-bar indicator plus a shortcut), so the list of
    sessions is never more than one click away.
  - **Every AI output links to its session log.** Each proposal, batch and thread message carries
    a link to the run that produced it, as each Copilot commit links to its log.
  - **Steering while a run works.** If the user writes in a thread during a run, show the message
    as "queued, the agent will read it after its current step". Don't block the composer.
  - **Say what Stop keeps.** The Stop confirmation states what survives: "Proposals already
    emitted stay in the batch; nothing is applied."
  - **Thumbs up/down with an optional reason** on the run output. This is lightweight feedback,
    separate from accept/reject.
- Evidence: "Use the agents panel on GitHub to monitor and manage agent sessions across your
  repositories". Users can "monitor the agent's progress, token usage, and session length". "Each
  commit message includes a link to the session logs". "Copilot implements your input after it
  finishes its current tool call". "Stopping a session ends the GitHub Actions run and preserves any
  commits already pushed". Review: "your approval of a Copilot pull request won't count"; workflows
  wait for "Approve and run workflows".

### R28 · Devin: session tools, Session Insights, Devin Review
- URL: https://docs.devin.ai/work-with-devin/devin-session-tools
- URL: https://docs.devin.ai/product-guides/session-insights
- URL: https://docs.devin.ai/work-with-devin/devin-review
- Category: 2b (a production agent review UI)
- What it is: Cognition's docs for Devin's session UI (progress tab, read-only side chats, taking
  over), a post-hoc analysis of sessions (issue timeline, improved prompt), and an AI-assisted diff
  review.
- Takeaways for DEMIURGO:
  - **Run detail opens on a summary, with the full log below.** The summary has four key points:
    Task (what was asked), Plan, Output (the batch or message it produced), Outcome (succeeded,
    failed: why). Devin's redesign highlights "Task, Plan, PR, Summary".
  - **Post-mortem for failed or invalid runs.** Show an issue list with a category label ("Invalid
    output: missing field `certainty`"), an impact (high/medium/low) and the suggested next step
    (Retry · Retry with another model · Edit the prompt context). Mark the failure point on the
    timeline in red.
  - **Go deeper as a read-only side chat.** State plainly in the panel that it answers questions
    and cannot change the thread or records until the user brings an answer back. That is the
    same contract as Devin's side chats.
  - **Diffs in proposal review:** an overview first, then related changes grouped with their
    explanation next to each group. Severity tiers apply to reviewer warnings (for example, "This
    contradicts ADR-002": high).
  - **Composer conventions:** Cmd/Ctrl+Enter submits and Esc dismisses, in reply and review
    comment boxes.
- Evidence: the session UI highlights "the Task, the Plan, the PR, and the Summary". Session
  Insights lists issues where "Each issue includes: a label describing the issue category, an impact
  rating (high, medium, or low), a description explaining what went wrong". Its timeline shows
  "where Devin made progress, where it hit obstacles, and how it recovered". "Side chats are
  read-only: Devin can search and read the codebase to answer your questions, but it cannot edit
  files, run commands, or change the session's work". Review "Groups changes logically", with
  sections "with explanations alongside their diffs". The composer uses "Cmd+Enter to submit and
  Escape to dismiss".

### R29 · Linear Agent Interaction Guidelines (AIG) and agent sessions
- URL: https://linear.app/developers/aig
- URL: https://linear.app/developers/agent-interaction
- Category: 2b (also 3: an issue tracker's own agent model)
- What it is: Linear's principles for agents that work inside a human workflow tool, plus the
  platform model: six session states, five activity types, and a session plan checklist.
- Takeaways for DEMIURGO:
  - **Collapse the run states into a small, user-facing set** that Linear's six mirror closely:

    | Label | DEMIURGO states |
    | --- | --- |
    | Queued | queued |
    | Working | working |
    | Needs you | awaiting input |
    | Failed | failed, invalid output |
    | Done | succeeded |
    | Stalled | no event for N minutes; Linear's "stale" |

    Cancelled is a filter, not a headline state. Stalled is how "stuck" becomes visible.
  - **Style streamed events by type** in run detail:
    - thought: muted and collapsible (ephemeral);
    - action: tool-like row;
    - elicitation: highlighted, and it also creates a Needs-you item;
    - response: final output;
    - error: red, with a link.
  - **The agent plan as a live checklist** (pending / in progress / done / cancelled) at the top
    of run detail and in the thread's run chip.
  - **Agents are never mistaken for people.** Use a distinct avatar shape and an "Agent" tag.
    Acknowledge any invocation within a moment (a "Queued" chip right after send).
  - **Stop means stop.** After a stop, the agent does nothing until explicitly re-engaged.
    Accountability stays human: accepted items show the human who accepted.
- Evidence: "An agent should always disclose that it's an agent"; "An agent should provide instant
  feedback"; "An agent should be clear and transparent about its internal state"; "An agent should
  respect requests to disengage"; "An agent cannot be held accountable". The states are "pending,
  active, error, awaitingInput, complete, stale. These will be visible to users". Activity types are
  thought, elicitation, action, response and error, and "Only thought or action type activities can
  be marked ephemeral". A plan is "a session-level checklist of tasks it's working on, designed to
  evolve during execution".

## 3 · Developer-tool and issue-tracking UX

### R30 · Linear Inbox and Triage
- URL: https://linear.app/docs/inbox
- URL: https://linear.app/docs/triage
- Category: 3
- What it is: Linear's personal notification inbox (priority tab, snooze, keyboard triage) and the
  team Triage queue, where incoming issues are accepted, declined, merged as duplicates or snoozed.
  AI suggestions are shown inline.
- Takeaways for DEMIURGO:
  - **Needs you as a keyboard-first list plus detail split:**
    - `J`/`K` to move;
    - `Enter` to open;
    - `H` to snooze, with natural-language time and "until something changes";
    - `Backspace` to mark done;
    - `U` to mark read/unread.
  - **Proposal decisions on number keys,** like Triage: `1` Accept, `2` Mark as duplicate of an
    existing record, `3` Reject. Put the key hints on the buttons themselves.
  - **A Priority tab in Needs you** for items that block progress: a failed run blocking a
    readiness stage, or a question an agent is waiting on. Everything else sits under "All".
  - **Show AI suggestions as suggestions.** When the classifier or reviewer agent suggests a
    relation, a duplicate or a certainty, show it as a dimmed chip in the item that the human
    applies with one click, as Triage Intelligence does.
  - **"Snooze until new activity"** also suits proposal batches that wait on a running knowledge
    update.
- Evidence: shortcuts "`J`/`K` or arrow keys", "`U` to mark items as read/unread", "`H` for
  snooze", "`Backspace` to delete". "Snoozing hides a notification from your Inbox until the selected
  time". Triage: "Accept (shortcut: 1)", "Mark as Duplicate (shortcuts: 2 or MM)", "Decline
  (shortcut: 3)", and Snooze until "chosen time or new activity occurs". Triage Intelligence
  analyzes new issues "to suggest properties like assignee and label" and to find duplicates.

### R31 · Linear: How we redesigned the Linear UI
- URL: https://linear.app/now/how-we-redesigned-the-linear-ui
- Category: 3
- What it is: Linear's write-up of its UI redesign: the inverted-L chrome, denser and quieter
  navigation, a color system generated in LCH from three variables, and an inbox centered on
  notification type and people.
- Takeaways for DEMIURGO:
  - **Use an inverted-L shell:** a sidebar (projects, Needs you, Runs, Records, Threads, Map,
    Graph) and one header row that controls the main view. Every page uses the same header levels,
    so the user always knows the page's scope.
  - **Quiet chrome, loud state.** Keep the accent color out of navigation chrome. Save saturated
    color for status (failed, needs you, running) and certainty, so state is what draws the eye.
  - **One set of view types for every collection** (records, runs, proposals): list, split
    (list + detail) and full page. Moving between them keeps the selection.
  - **Needs-you rows lead with the item type icon and the agent's face.** Proposal, question and
    failed run must be distinguishable by icon before reading.
  - **If status tokens are added to `@demiurgo/design-system`,** check that they have equal
    perceived lightness (LCH/OKLCH) in light and dark themes, so no status looks more urgent by
    accident.
- Evidence: the redesign centers on the "inverted L-shape" chrome. The team "adjusted the sidebar,
  tabs, headers, and panels to reduce visual noise, maintain visual alignment, and increase the
  hierarchy and density of navigation elements". "LCH has the benefit that it's perpetually uniform",
  and the system went from 98 variables to three. It limited "how much chrome (blue in our case) was
  used". Inbox notifications were "redesigned to be more centered around the notification type and
  emphasized the faces of your teammates".

### R32 · Linear: command menu, shortcuts and the Linear Method
- URL: https://linear.app/docs/select-issues
- URL: https://linear.app/changelog/2021-03-25-keyboard-shortcuts-help
- URL: https://linear.app/method/introduction
- Category: 3
- What it is: Linear's docs on the contextual Cmd/Ctrl+K menu, context menus, bulk actions and the
  searchable shortcut help, plus the Method's principles for opinionated, simple tools.
- Takeaways for DEMIURGO:
  - **Cmd/Ctrl+K is contextual.** With a proposal, record or run selected, the menu first lists the
    actions for that object (Accept, Reject, Retry run, Open origin), then navigation ("Go to
    Needs you").
  - **The same actions appear three ways:** a visible button, a right-click context menu and the
    command menu. Keyboard is an accelerator, never the only path.
  - **Bulk bar.** With several proposals selected (`X`, Shift+click), a bar at the bottom offers
    "Accept 4 · Reject 4".
  - **`?` opens a searchable shortcut sheet.** Add `G` then a letter for navigation (`G N` Needs
    you, `G R` runs, `G D` records).
  - **Method: don't invent terms, and start simple.** DEMIURGO's own vocabulary (FDR, ADR,
    readiness stage, certainty) needs plain-language labels and tooltips for a non-technical owner,
    with codes as secondary. Advanced panels (tokens, raw events) stay collapsed until asked for.
- Evidence: "Once an issue or set of issues are selected, use Cmd/Ctrl K to open the command bar
  and select the preferred action", "or right-click anywhere on the selected issue(s) to open the
  contextual menu". "Common bulk actions will show up at the bottom". The team "redesigned our
  keyboard shortcuts help screen and made it searchable". Method: "Don't invent terms if possible";
  "A tool should be simple to get started with and grow more powerful as you scale"; "Remove or
  automate 'work around work'".

### R33 · GitHub notifications inbox
- URL: https://docs.github.com/en/subscriptions-and-notifications/concepts/about-notifications
- Category: 3
- What it is: GitHub's notification model: reason labels, Done / Save / Unsubscribe, read state,
  custom filters by reason and repository, and retention rules.
- Takeaways for DEMIURGO:
  - **Each Needs-you item states why it is there,** as a reason label: "Waiting for your
    acceptance", "Question from Explorer", "Run failed twice", "Assumption to confirm", "Conflict
    with ADR-002". Reasons are filterable (`reason:question`).
  - **Separate Done, Saved and Mute.**
    - Done removes the item from the inbox but keeps it findable in Activity.
    - Saved keeps it indefinitely.
    - Mute stops items from one thread or agent.
  - **Custom filters per project and per reason,** saved in the sidebar under Needs you.
  - **Keep the inbox strict.** Actionable items only. Informational events (run succeeded,
    knowledge updated) go to Activity. GitHub's pile of expiring notifications shows what happens
    otherwise.
- Evidence: "Your inbox shows the `reason` you're receiving a notification as a label, such as,
  `mention`, `subscribed`, or `review requested`". "Remove a notification from the inbox with Done".
  "Notifications marked as `Saved` are kept indefinitely". "You can create a custom filter", for
  example `reason:review-requested`.

### R34 · Vercel dashboard redesigns (2026 navigation, and the earlier dashboard write-up)
- URL: https://vercel.com/changelog/dashboard-navigation-redesign-rollout
- URL: https://vercel.com/blog/dashboard-redesign
- Category: 3
- What it is: Vercel's 2026 navigation change (resizable sidebar, consistent tabs, projects as
  filters) and an earlier redesign post about deployment status, logs and perceived performance.
- Takeaways for DEMIURGO:
  - **Global and project scope on the same page.** Runs, Needs you and Activity exist once, with a
    project filter. Switching between "all projects" and one project is one click, not a separate
    page tree.
  - **Status in the browser tab.** The favicon and title reflect state, for example "(2) DEMIURGO"
    when something needs you and a spinner favicon while a run in the current project works. The
    user can leave the tab in the background.
  - **Order the navigation by frequency**: Needs you, Threads, Records, Runs; then Map, Graph,
    Origins, Sources. Make the sidebar resizable and collapsible.
  - **Batch updates for live data.** Coalesce SSE-driven query invalidations (TanStack Query) so
    a burst of journal events does not re-render every list. Vercel reports cutting re-renders this
    way.
  - **Separate "what is live" from "what is proposed",** as Vercel separates production from
    preview deployments. Accepted authority and pending proposals never share one undifferentiated
    list.
- Evidence (2026 changelog): "horizontal tabs moved to a resizable sidebar that can be hidden when
  not needed"; "navigation items prioritized the most common developer workflows"; projects act as
  filters to switch between team and project versions of the same page. Earlier post: "the status
  of your deployment is now reflected in the tab icon as queued, building, error, or ready";
  separate views for production and preview deployments; batch updates reduced re-renders by 20%.

## 4 · Design systems for technical products

### R35 · Primer — Color overview (token levels, functional roles, emphasis vs muted)
- URL: https://primer.style/foundations/color/overview
- Category: 4
- What it is: GitHub's color foundation: three token levels (base, functional, component/pattern),
  semantic roles and light/dark themes.
- Takeaways for DEMIURGO:
  - Three token layers: primitives (raw scale values, never used in components) → semantic/functional
    tokens (`fg`, `bg`, `border` × role) → rare component tokens. Components consume only semantic tokens.
  - Define roles by meaning, not hue: `accent` (links, selection, focus, neutral info), `success`,
    `attention` (warnings **and active processes such as "queued"**), `danger`, `done`, plus
    DEMIURGO-specific roles for certainty (`confirmed`, `assumed`, `proposed`, `open`, `unknown`).
  - Two intensities per role: `muted` (subtle bg for badges/rows) and `emphasis` (solid bg), and
    emphasis backgrounds always pair with a dedicated `fg-onEmphasis` token.
  - Light and dark share the same functional token names; the neutral scale is inverted per theme.
  - If a high-contrast theme is ever added, target 7:1 for text and interactive elements.
- Evidence: "Base color tokens are the lowest level tokens and map directly to a raw value" and
  should not be used directly; "Functional color tokens represent global UI patterns such as text,
  borders, shadows, and backgrounds." `attention`: "Warning states, active processes such as queued
  PRs". "Emphasis background colors … are always combined with `fgColor-onEmphasis` tokens".

### R36 · Primer — StateLabel
- URL: https://primer.style/components/state-label
- Category: 4
- What it is: The pill that shows the lifecycle state of an issue or pull request (Draft, Open,
  Merged, Closed, Closed as not planned, Unavailable, Queued…).
- Takeaways for DEMIURGO:
  - Build one `StateLabel`-like component for lifecycle states: run status (queued, working,
    succeeded, failed, cancelled, invalid output), proposal status (pending, accepted, rejected,
    edited) and batch status. Each state maps to exactly one icon + one role color + one text label.
  - Keep a separate, visually quieter `Label`/tag for classification metadata (area, agent, kind).
  - Two sizes: default for headers/detail views, small for table rows and list items.
  - The icon differs per state *and* per object type (like Primer's issue vs PR icons): a failed run
    and a rejected proposal must not look identical.
- Evidence: "StateLabel is used for rendering the status of an issue or pull request." "Each status
  variant has an associated icon, selected based on the status type and whether it applies to an
  issue or pull request." Two sizes, default and small.

### R37 · Primer — Timeline
- URL: https://primer.style/components/timeline
- Category: 4
- What it is: Vertical list of events joined by a connector line, with badges, body, actions and
  breaks; basis of GitHub's issue/PR activity.
- Takeaways for DEMIURGO:
  - Use a timeline for the activity log, record version history and "Catch up": badge icon per event
    kind, body with actor ("DEMIURGO proposed", "You accepted"), relative time with absolute time on hover.
  - `condensed` items for low-value events (e.g. run retried, knowledge refreshed) so that authority
    events (accept/reject) stand out.
  - A `Break` separator for "since you were away" in Catch up.
  - The connector line and badge color are decorative: the event text itself must state the status
    ("Run failed: invalid output"), because the line is hidden from assistive technology.
- Evidence: "The Timeline component is used to display items on a vertical Timeline". `condensed`
  "reduces vertical padding and removes background from an item's badge". "Since this component is
  decorative, it is not conveyed to assistive technologies like screen readers."

### R38 · Primer — Blankslate
- URL: https://primer.style/components/blankslate
- Category: 4
- What it is: Primer's empty-state component: visual, heading, description, primary action,
  secondary action; narrow and spacious variants.
- Takeaways for DEMIURGO:
  - One `EmptyState` component with fixed anatomy: optional icon → heading (states the situation) →
    one sentence explaining *why* it is empty → one primary action → optional secondary link.
  - Narrow variant inside panels (Go deeper, side panels, table bodies); spacious variant for whole
    screens (first project, empty Needs you).
  - Heading level must be settable (`as`) so the empty state fits the page outline.
  - Action labels are task verbs: "Start a thread", "Choose a model", not "Get started".
- Evidence: "Blankslate is used as placeholder to tell users why content is missing." Anatomy
  Visual / Heading / Description / PrimaryAction / SecondaryAction; `narrow`, `spacious`, `border`.

### R39 · Atlassian — Lozenge
- URL: https://atlassian.design/components/lozenge/usage
- Category: 4
- What it is: Atlassian's status pill (default, inprogress, moved, new, removed, success), subtle or bold.
- Takeaways for DEMIURGO:
  - Lozenges (status pills) are for states that must be noticed: run status, certainty,
    "Needs you". Tags are for categorization. Never mix the two looks.
  - Subtle by default; bold only for the one state per view that demands action (e.g. `failed`,
    `invalid output`, "Needs your decision").
  - Pills are not focusable, so their text must never truncate: keep labels to one or two words
    ("Assumed", "Invalid output") and cap width; put detail in an adjacent tooltip trigger or the row.
  - Sentence case ("In progress"), never ALL CAPS.
  - Always text label + (optional) icon; never color alone.
- Evidence: "Use lozenges for important labels that need to be easily noticed — like workflow status
  … system state … priority". "Don't use lozenges for descriptive metadata that only classifies or
  categorizes — use a tag instead." "Lozenges can't be focused, so truncated text will not be
  visible" (default max width 200px). "Don't use color alone to signify an important attribute.
  Instead, use clear labels and, if relevant, a supporting icon."

### R40 · Atlassian — Design tokens
- URL: https://atlassian.design/foundations/tokens/design-tokens
- Category: 4
- What it is: Atlassian's token naming and theming model.
- Takeaways for DEMIURGO:
  - Name semantic tokens `foundation.property.modifier`: e.g. `color.bg.certainty.assumed.subtle`,
    `color.icon.run.failed`, `color.border.focus`, `space.200`.
  - Pick a token by meaning, not by the value it happens to have in light mode; a look-alike token
    will break in dark mode.
  - A theme = a full set of values for the same token names (light, dark, later high-contrast);
    the existing `dm-*` tokens in `@demiurgo/design-system` should be audited against this rule.
- Evidence: "A design token's name describes how it should be used, and each part communicates one
  piece of its usage" (foundation, property, modifier). "Choose tokens based on meaning where
  applicable, not specific values"; matching by visual similarity "can break the experience in other
  themes". "A theme is a collection of token values designed to achieve a certain look or style."

### R41 · IBM Carbon — Notification pattern
- URL: https://v10.carbondesignsystem.com/patterns/notification-pattern/
- Category: 4
- What it is: Carbon's five notification types (inline, toast, banner, notification panel, modal)
  and four statuses (info, success, warning, error).
- Takeaways for DEMIURGO:
  - Inline notification (persists until resolved): run failed inside a thread, invalid output on a
    proposal batch.
  - Toast (≤ 3 lines, may auto-dismiss): only for confirmations of the user's own action
    ("Batch accepted").
  - Banner (persists until dismissed): system-level, e.g. "No model assigned for this project" or
    "Live updates disconnected — reconnecting".
  - Notification panel = the "Needs you" inbox: the one place that collects everything that needs a
    human decision.
  - Modal only for critical blocking information. **Never** a timed auto-dismiss for anything the
    human must act on.
- Evidence: Inline notifications "Persist until the message is resolved or dismissed by user";
  toasts are "Short, time-based messages that slide in and out of a page", max three lines; the panel
  gives access to multiple notifications "without cluttering the screen"; "Don't use notifications
  that dismiss on a timer for critical or emergency messages"; "Only send notifications where necessary".

### R42 · IBM Carbon — Spacing scale
- URL: https://v10.carbondesignsystem.com/guidelines/spacing/overview/
- Category: 4
- What it is: Carbon's 13-step spacing scale on a 2x grid with an 8px mini unit.
- Takeaways for DEMIURGO:
  - Adopt a non-linear scale of the same shape: 2, 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96, 160 px.
  - Steps up to 16px for inside components (pill padding 2/4 px, row padding 8/12 px, card padding 16 px);
    24 px and above for separating page regions.
  - Use spacing as hierarchy: the more space around a group, the more important it reads, so give
    "Needs you" items more space than activity-log lines.
- Evidence: `$spacing-01`…`$spacing-13` = 2, 4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96, 160 px;
  "2x grid system with 8px as the mini unit"; small increments are for "detail-level designs";
  "Elements that have more spacing around them tend to be perceived as higher in importance".

### R43 · IBM Carbon — Data table row sizes
- URL: https://v10.carbondesignsystem.com/components/data-table/style/ and
  https://raw.githubusercontent.com/carbon-design-system/carbon-website/main/src/pages/components/data-table/style.mdx
- Category: 4
- What it is: Carbon's table density options.
- Takeaways for DEMIURGO:
  - Offer row heights from a fixed set: 24 (xs), 32 (sm), 40 (md), 48 (lg), 64 (xl) px.
  - Runs list, proposals list, records table: 40 px default, 32 px in compact mode; 24 px only for
    log-like views (activity log, token usage), never for rows with interactive controls
    (see WCAG 2.5.8).
  - 64 px only for rows that really hold two lines (record title + summary).
  - The header row matches the body density.
- Evidence: v11 source lists xs 24 / sm 32 / md 40 / lg 48 / xl 64; "Extra large row heights are only
  recommended if your data is expected to have two lines of content in a single row." v10: compact
  24, short 32, default 48, tall 64; "The column header row should consistently match the table's
  selected row size."

### R44 · IBM Carbon — Empty states pattern
- URL: https://v10.carbondesignsystem.com/patterns/empty-states-pattern/
- Category: 4
- What it is: Types and anatomy of empty states.
- Takeaways for DEMIURGO:
  - Three kinds, each with its own copy: **no data yet** (first project, no records: say what will
    appear here), **user-action result** (filter/search with no results; clear filters), **error**
    (cannot load, missing permission, no model assigned: plain language, what happened, how to fix).
  - Error empty states never show raw codes (show "No model is assigned to Explorer" + "Choose a
    model", not "409").
  - Design the empty version of every panel, table, tile and side panel before the full one.
- Evidence: empty states are "moments in an app where there is no data to display"; be "specific
  about what will be available in the space when data is there"; error states use "plain language
  (no codes), precisely indicate the problem, and constructively suggest a solution"; "What will the
  pages, tiles, data tables, and side panels look like without content?"

### R45 · IBM Carbon — Loading pattern
- URL: https://v10.carbondesignsystem.com/patterns/loading-pattern/
- Category: 4
- What it is: When to use skeleton states, full-page loading, inline loading and progress bars.
- Takeaways for DEMIURGO:
  - Skeletons only on the **initial load** of containers and data components (record view, lists,
    tables, cards). Never skeletons for menus, toasts, dialogs, dropdown items or buttons.
  - Inline loading for a single component doing work ("Accepting…", "Sending…").
  - Progress indicator when a process takes more than a moment or two.
  - Avoid a full-screen blocking loader: agent work runs in the background and the app stays usable.
- Evidence: "Skeleton states are simplified versions of components used on an initial page load";
  "Never represent toast notifications, overflow menus, dropdown items, modals, and loaders with
  skeleton states"; "Use the inline loading component when a single component is processing"; "If a
  process will take more than a moment or two to complete, use a progress indicator instead."

### R46 · Radix Colors — Understanding the scale
- URL: https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale
- Category: 4
- What it is: The 12-step scale behind Radix Colors, where each step has a UI job.
- Takeaways for DEMIURGO:
  - Build every hue as a 12-step scale with fixed jobs: 1–2 app/subtle backgrounds, 3/4/5
    component bg normal/hover/pressed-selected, 6/7/8 borders (8 = strong border **and focus ring**),
    9/10 solid fill and its hover, 11/12 low- and high-contrast text.
  - Because each step has a job, semantic tokens map mechanically (`certainty.assumed.bg` = amber 3,
    `.border` = amber 7, `.fg` = amber 11), for light and dark alike.
  - Text steps 11/12 on step 2 are guaranteed APCA Lc 60 / Lc 90; still verify WCAG 2 ratios
    (4.5:1 text, 3:1 non-text) because WCAG 2.2 is the legal bar.
  - Dark mode = a second 12-step set with the same step semantics, plus a mutable app-background alias.
- Evidence: "Steps 1 and 2 are designed for app backgrounds and subtle component backgrounds"; "Step 5
  is for pressed or selected states"; "Step 8 is designed for stronger borders on interactive
  components and focus rings"; "Step 9 has the highest chroma of all steps"; "Steps 11 and 12 … are
  guaranteed to Lc 60 and Lc 90 APCA contrast ratio on top of a step 2 background from the same scale."

### R47 · Radix Themes — Color
- URL: https://www.radix-ui.com/themes/docs/theme/color
- Category: 4
- What it is: How Radix Themes turns the scales into theme tokens (accent, gray, alpha, panel,
  overlay, focus).
- Takeaways for DEMIURGO:
  - One accent scale + one (slightly tinted) gray scale carry most of the UI; status hues are used
    only for status (fits the "color = meaning" rule of high-performance HMI below).
  - Use alpha variants (`--x-a1..a12`) for anything layered over varying surfaces (hover rows in the
    Go deeper panel, selection over the map canvas) so it looks the same on any background.
  - Separate surface tokens: page background, solid panel, translucent panel, overlay (dialog scrim).
  - Focus ring from a single focus scale step (Radix uses `--focus-8`) so it is consistent everywhere.
- Evidence: "Every color has an alpha variant which is designed to appear visually the same when
  placed over the page background"; tokens `--color-background`, `--color-panel-solid`,
  `--color-panel-translucent`, `--color-overlay`; most components use `--focus-8`.

### R48 · Vercel Geist — Colors
- URL: https://vercel.com/geist/colors
- Category: 4
- What it is: Vercel's developer-tool color system: 10 scales × 10 steps (100–1000) plus two backgrounds.
- Takeaways for DEMIURGO:
  - A 10-step variant of the same idea: 100–300 component bg (default/hover/active), 400–600 borders
    (default/hover/active), 700–800 high-contrast bg, 900–1000 text/icons. Either 10 or 12 steps work;
    what matters is that each step has a job.
  - Only two page backgrounds (Background 1 default, Background 2 for subtle differentiation):
    resist adding more surface levels.
  - Status palette limited to a handful of hues (blue, red, amber, green, teal, purple, pink).
  - Use P3 colors progressively where supported, with sRGB fallbacks.
- Evidence: "Each non-background scale has 10 steps, from 100 through 1000"; step ranges as above;
  "P3 colors are used on supported browsers and displays."

### R49 · AWS Cloudscape — Content density
- URL: https://cloudscape.design/foundation/visual-foundation/content-density/
- Category: 4
- What it is: The AWS console design system's comfortable/compact density modes.
- Takeaways for DEMIURGO:
  - Comfortable is the default; compact is a user preference (in the person menu), not a per-screen
    designer decision.
  - Compact reduces spacing only (paddings and margins by one 4px step), not font sizes.
  - Do not compact help text, alerts, the thread composer or dropdown option lists.
  - Compact benefits data-heavy views: runs list, proposals table, records table, activity log.
- Evidence: "Comfortable is the standard density level of the system, active by default"; "Compact
  is an additional density level for data intensive views"; "In compact mode, the spacing scale is
  reduced in increments of 4"; "Users are in control of choosing their preferred level of density";
  "Always set comfortable mode as default"; "Ensure users can always switch between comfortable and
  compact mode."

### R50 · AWS Cloudscape — Loading and refreshing
- URL: https://cloudscape.design/patterns/general/loading-and-refreshing/
- Category: 4 (monitoring-oriented pattern)
- What it is: How the AWS console handles initial loads, manual/automatic refresh and staleness.
- Takeaways for DEMIURGO:
  - Skeleton rows for initial table loads so the column layout is stable.
  - Show "Last updated <absolute time>" wherever data is live or refreshed, and a live/stale indicator
    for the SSE stream (e.g. "Live" vs "Reconnecting…, last event 14:29").
  - If a refresh/reconnect is not done within about 1–10 s, show a status indicator next to the
    refresh control instead of silently waiting.
  - Refresh/reconnect buttons need an accessible label; loading states need text for screen readers.
  - Spinners only for expandable rows and progressive loading.
- Evidence: "Skeleton rows preserve the table's column layout … reducing perceived loading time";
  automatic refresh at "predefined intervals, for example 10 seconds"; "display a timestamp to provide
  users with information on the outcome of the operation"; "When refreshing can't be completed within
  1-10 seconds, communicate that the process is taking longer by using a status indicator next to the
  refresh button."

## 5 · UX research on expert and monitoring applications

### R51 · NN/g — 8 Design Guidelines for Complex Applications
- URL: https://www.nngroup.com/articles/complex-application-design/
- Category: 5
- What it is: Nielsen Norman Group's guidelines for domain-expert, workflow-heavy applications.
- Takeaways for DEMIURGO:
  - No rigid linear flows: the guided thread suggests the next question but the person can jump to
    any record, fork, or proposal at any time.
  - Help users resume after interruptions: persistent "where you left off" per project, drafts that
    survive navigation, and Catch up.
  - Show supplementary info without leaving the primary screen: Go deeper side panel, record peek on
    hover/focus, provenance in a side panel, not a new page.
  - Staged disclosure: advanced controls (retries, token details, raw agent output) only when
    relevant (e.g. on a failed run).
  - Salience by subtraction: remove chrome before adding emphasis.
  - Teach faster methods in place (e.g. show the keyboard shortcut next to "Accept").
- Evidence: "Allow users flexibility in their task sequence by avoiding rigid, linear workflows";
  "Offload working-memory burden and help users resume tasks after interruptions or breaks in
  workflow"; "Allow users to access and view supplemental information without leaving the primary
  screen"; "Staged disclosure, where options are shown only when they are relevant"; "removing
  nonessential elements can be equally effective".

### R52 · NN/g — Progressive Disclosure
- URL: https://www.nngroup.com/articles/progressive-disclosure/
- Category: 5
- What it is: The canonical definition, benefits and rules of progressive disclosure.
- Takeaways for DEMIURGO:
  - Primary level of every screen = what is needed often (record content + certainty, proposal diff +
    Accept/Reject/Edit, run status). Secondary = versions, relations, checks detail, raw output, tokens.
  - Maximum two disclosure levels inside a screen; deeper detail goes to a separate view.
  - The way to the second level must be obvious and labeled with what it reveals ("Show 3 checks",
    "Token usage", "Raw output") — no bare "More".
- Evidence: "Progressive disclosure defers advanced or rarely used features to a secondary screen";
  "You have to disclose everything that users frequently need up front"; "It must be obvious how
  users progress from the primary to the secondary disclosure levels"; "Designs that go beyond 2
  disclosure levels typically have low usability".

### R53 · NN/g — Indicators, Validations, and Notifications
- URL: https://www.nngroup.com/articles/indicators-validations-notifications/
- Category: 5
- What it is: A taxonomy of three communication mechanisms and when each one fits.
- Takeaways for DEMIURGO:
  - **Indicators** (contextual, passive, conditional): certainty pills, "new version" dot, run status in
    a row, "edited by you" markers.
  - **Validations** (contextual, need correction): errors when editing a proposal or answering a
    guided question; they say how to fix.
  - **Notifications** (system events not triggered by the user's current action): a run finished, a
    new proposal batch arrived. Split them into *action required* → Needs you, and *passive* →
    activity log / Catch up, never interrupting.
  - Do not use a notification for something that is really an indicator (e.g. toasting every SSE event).
- Evidence: Indicators are "conditional—they are not always present, but appear or change depending
  on certain conditions"; a validation is "contextual and applies to a specific user input that has a
  problem"; notifications "are not triggered by users' immediate actions" and are either
  action-required or passive.

### R54 · NN/g — Response Times: The 3 Important Limits
- URL: https://www.nngroup.com/articles/response-times-3-important-limits/
- Category: 5
- What it is: Nielsen's 0.1 s / 1 s / 10 s perception limits and matching feedback.
- Takeaways for DEMIURGO:
  - ≤ 0.1 s: button presses, tab switches, selection must feel instant (optimistic UI for
    accept/reject drafts, rolled back on 409).
  - ≤ 1 s: no indicator needed; navigations should stay under this with TanStack Query caching.
  - 2–10 s: busy indicator, no percentage.
  - > 10 s (typical agent runs): the user will switch tasks, so show elapsed time and evidence of
    progress ("Reading 4 records…", tokens streamed, step n), and let them leave; completion arrives in
    Needs you.
  - Unknown duration: show "processed items" instead of a fake progress bar.
- Evidence: 0.1 s: "no special feedback is necessary except to display the result"; 1 s: "the user's
  flow of thought to stay uninterrupted"; 10 s: "keeping the user's attention focused on the dialogue";
  progress indicators "reassure the user that the system has not crashed"; for unknown durations,
  display processed items or a basic busy indicator.

### R55 · NN/g — Skeleton Screens 101
- URL: https://www.nngroup.com/articles/skeleton-screens/
- Category: 5
- What it is: When skeletons, spinners and progress bars are appropriate.
- Takeaways for DEMIURGO:
  - < 1 s: nothing. Full-page/view loads under 10 s with known layout: skeleton. Single module
    2–10 s: spinner. > 10 s: progress bar or determinate status.
  - Skeletons must mimic the real layout (record header, list rows); never frame-only skeletons.
  - Animated shimmer is optional and must respect `prefers-reduced-motion`.
  - Agent runs are not "loading": they are long processes with their own status UI, never a skeleton.
- Evidence: "If a page takes less than 1 second to load, skeleton screens or spinners aren't
  necessary"; "skeleton screens should be used with a wait time that's under 10 seconds"; "progress
  bars are strongly recommended for any page that takes longer that 10 seconds"; frame-display
  skeletons "do not give users any sense that the page is gradually transitioning"; animated
  skeletons can create accessibility issues.

### R56 · NN/g — Visibility of System Status
- URL: https://www.nngroup.com/articles/visibility-system-status/
- Category: 5
- What it is: Nielsen's first usability heuristic, explained with examples.
- Takeaways for DEMIURGO:
  - Always visible in the shell: live-connection state, number of running agents, number of items in
    Needs you.
  - Every human action gets immediate visible feedback (pill changes to "Accepted", draft counter).
  - Being honest about state builds trust in an AI-proposes/human-accepts tool: never show
    "Succeeded" for an invalid output, never hide a retry.
- Evidence: "systems should always keep users informed about what is going on, through appropriate
  feedback within reasonable time"; "A lack of information often equates to a lack of control";
  "When we understand the system's state, we feel in control."

### R57 · NN/g — Empty State Interface Design (complex applications)
- URL: https://www.nngroup.com/articles/empty-state-interface-design/
- Category: 5
- What it is: Three roles of empty states in complex apps.
- Takeaways for DEMIURGO:
  - Distinguish loading vs empty vs error explicitly; never leave a panel blank while SSE or a query is
    pending.
  - Use empty states to teach in place ("Accepted proposals become records. Nothing accepted yet.").
  - Always offer a direct pathway ("Start the first thread", "Open Needs you").
  - Never show "Loading…" and then an empty panel with no explanation.
- Evidence: "totally empty states cause confusion about how and whether the system is working";
  "in-context help can often be applied right away and is thus more memorable"; "Provide direct
  pathways (i.e., links) to getting started with key tasks related to populating the empty state."

### R58 · NN/g — Dashboards: Making Charts and Graphs Easier to Understand
- URL: https://www.nngroup.com/articles/dashboards-preattentive/
- Category: 5
- What it is: Dashboard definition (operational vs analytical) and preattentive attributes.
- Takeaways for DEMIURGO:
  - The project overview is an **operational** dashboard: one screen, at a glance, act quickly
    (readiness toward "Ready to build", runs in flight, decisions waiting).
  - Use length and 2D position (bars, simple lines) for quantities such as token consumption or
    readiness; no pie charts, gauges or 3D.
  - Color is for categories (status, certainty), never for magnitude.
- Evidence: "Dashboards are collections of data visualizations, presented in a single-page view that
  imparts at-a-glance information on which users can act quickly"; "color should not be used to
  communicate information about quantitative values or magnitude"; pie charts are "notoriously poor
  at most information-communication tasks".

### R59 · NN/g — Data Tables: Four Major User Tasks
- URL: https://www.nngroup.com/articles/data-tables/
- Category: 5
- What it is: Guidance for tables built around find, compare, view/edit one record, act on records.
- Takeaways for DEMIURGO:
  - First column = human-readable identifier (record title, proposal summary), not an ID.
  - Sticky header (and first column if horizontal scroll).
  - Open a row in a non-modal side panel so the list stays visible (proposal review, record peek, run
    detail) instead of a modal.
  - Checkbox selection + select-all for batch operations; batch actions above the table.
  - Filters must be discoverable and clearly marked when active ("Showing: Needs you · 3 filters · Clear").
- Evidence: "The (default) first column should be a human-readable record identifier"; for editing,
  avoid modals and use a "nonmodal panel or separate window"; make filters "discoverable, quick, and
  powerful"; clearly signal active filters.

### R60 · NN/g — Change Blindness in UX
- URL: https://www.nngroup.com/articles/change-blindness-definition/
- Category: 5
- What it is: Why users miss UI changes far from their focus, and how to prevent it.
- Takeaways for DEMIURGO:
  - SSE updates that land far from focus will be missed: surface them near focus ("3 new updates"
    pill at the top of the list) instead of silently reflowing content.
  - Group simultaneous changes in one region; one change at a time.
  - Brief, subtle highlight (≈1–2 s fade, disabled under reduced motion) on rows that changed state.
  - Never move the item the user is reading or about to click (no reordering under the cursor).
- Evidence: "Change blindness refers to people's tendency to ignore changes in a scene when they
  occur in a region that is far away from their focus of attention"; it "occurs when movement as a cue
  for change is weak or completely absent"; recommendations: one change at a time, group changes, use
  animation strategically, dim unchanged areas.

### R61 · NN/g — Dark Mode vs. Light Mode
- URL: https://www.nngroup.com/articles/dark-mode/
- Category: 5
- What it is: Review of research on positive vs negative contrast polarity.
- Takeaways for DEMIURGO:
  - Design light first: DEMIURGO is reading-heavy (records, threads, proposals) and light polarity
    performs better for people with normal vision, especially with small text.
  - Offer dark mode as an equal-quality theme (preference, some visual impairments).
  - Do not rely on what users *say* they read better; perception did not match performance.
- Evidence: "light mode leads to better performance most of the time"; "positive contrast polarity
  was better for both visual-acuity tasks and for proofreading tasks"; "participants in the study did
  not report any difference in their perception of text readability"; "participants with cloudy
  ocular media had better reading rates with dark modes"; "allow users to switch to dark mode".

### R62 · High-Performance HMI (ISA-101) — RealPars summary
- URL: https://www.realpars.com/blog/high-performance-hmi (principles confirmed by search:
  ISA-101 / ASM Consortium, gray base, color reserved for abnormal conditions)
- Category: 5
- What it is: Industrial control-room display practice designed for situation awareness of
  operators supervising automated processes.
- Takeaways for DEMIURGO:
  - Supervising many agents is a control-room task: quiet neutral base, saturated color **only** for
    abnormal or attention states (failed, invalid output, needs decision). Normal running work stays
    gray/neutral.
  - Four-level hierarchy maps well: L1 project overview (all agents, readiness, Needs you) → L2 area
    (thread/journey/batch) → L3 item (record, proposal, run) → L4 diagnostics (raw output, provenance,
    token log, retries).
  - Show values against their normal range (token consumption vs typical/budget; run duration vs
    usual) rather than bare numbers.
  - Keep small trends visible (e.g. sparkline of runs per hour, failures) to see drift early.
  - No decorative animation, 3D or ornamental iconography.
- Evidence: color is "intended to be the attention-getter"; "a 48% improvement in detecting abnormal
  situations before alarms occur"; levels 1–4 from overall awareness to diagnostics; showing a reading
  with its normal operating range lets operators "make a quick decision to take action". Search:
  "reserves saturated color for abnormal conditions and safety-relevant states".

### R63 · Endsley's situation awareness model — EBSCO Research Starter
- URL: https://www.ebsco.com/research-starters/social-sciences-and-humanities/situational-awareness/
- Category: 5
- What it is: Encyclopedic summary of Mica Endsley's three-level SA model (1988) and its design implications.
- Takeaways for DEMIURGO:
  - Structure "Catch up" in three levels: **Perception** (what happened: runs finished/failed, batches
    arrived, records changed), **Comprehension** (what it means: which records became open/assumed,
    which decisions are blocked), **Projection** (what happens next: what is waiting on you, what
    agents will do after you decide).
  - Data is not awareness: summarize and prioritize instead of dumping the event stream.
  - Explainability: every proposal and derived item links to why/where it came from (provenance).
- Evidence: SA has "three levels: perception, comprehension, and prediction"; "too much data can
  distract people and cause them to miss important ideas"; "Just having data, however, does not equal
  having SA"; human-autonomy teams need "explainability and transparency in artificial intelligence".

### R64 · Structured State Reconciliation for Human-AI Task Handover (arXiv, 2026)
- URL: https://arxiv.org/abs/2608.28907
- Category: 5
- What it is: Bishop, Stull, Crockett, Hayes (submitted 28 Aug 2026): a pipeline that merges system
  telemetry and human reports into a structured task-state handover, compared with end-to-end AI summaries.
- Takeaways for DEMIURGO:
  - Build Catch up from **structured events** (the append-only `events` journal) first, and add an AI
    narrative second, clearly marked as a summary.
  - Show conflicts between sources explicitly (e.g. the person's note says X, the latest accepted
    record says Y).
  - Keep the person's own notes/answers visible in the handover: they carry strategic intent that
    state metrics miss.
- Evidence: combining both sources "preserved greater estimated task-state utility than either the
  user report or telemetry alone"; structured reconciliation matched an end-to-end AI system while
  producing "substantially less misinformation"; human reports contain "substantial strategic
  knowledge that lies outside state-focused metrics".

## 6 · Real-time status, log streaming and diff/review interfaces

### R65 · GitHub: reviewing proposed changes in a pull request
- URL: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request
- Category: 6
- What it is: The review flow on GitHub's Files changed tab.
  - Comments stay pending until you submit.
  - A "Viewed" checkbox collapses a file and a progress bar counts them.
  - Files can be filtered and reached from a file tree.
  - The review is submitted as Comment, Approve or Request changes.
- Takeaways for DEMIURGO:
  - **Proposal review:**
    - Each proposal has a "Reviewed" checkbox that collapses it.
    - A progress bar reads "4 of 9 reviewed".
    - A left tree groups proposals by record code (FDR-…, ADR-…) and type (new / change / relation
      / retire), and clicking an entry jumps to it.
  - **Invalidate stale review:** if an agent revises a proposal after the person marked it
    reviewed, it drops back to unreviewed with a "Changed since you reviewed" tag.
  - **Drafts until submit:** accept / reject / edit choices are drafts, visible only to the
    person, until one final "Submit decisions", which shows a summary. "Discard all drafts" is
    available. This matches the existing "drafts confirmed together" behaviour in V2.1.
  - **Submit dialog:** offer explicit outcomes, "Accept selected (N)", "Accept package", and
    "Reply to agent / request changes", each with a one-line consequence.
- Evidence:
  - Files can be marked viewed, and "If the file changes after you view the file, it will be
    unmarked as viewed."
  - Pending comments are drafts visible only to the reviewer and can be discarded together.
  - "Select Comment to leave general feedback without explicitly approving the changes or
    requesting additional changes."

### R66 · GitHub: applying suggested changes (single commit vs batch)
- URL: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/incorporating-feedback-in-your-pull-request
- Category: 6
- What it is: How a proposed edit ("suggestion") is applied. It can be committed on its own or
  added to a batch and committed together, and the suggester is credited as co-author.
- Takeaways for DEMIURGO:
  - **Proposal review, two paths:**
    - "Accept" applies one proposal now.
    - "Add to selection" collects several, then "Accept N selected" performs a single human act.
    - Keep both. Single accept suits one-off fixes and the batch suits a coherent package.
  - **Attribution on the resulting record version:**
    - "Proposed by designer (agent) · Accepted by Marcos".
    - When several proposals are accepted together, list all proposers.
  - **Gating shown up front:** when a proposal cannot be accepted (for example it conflicts with a
    newer version), say so on the proposal before the click, not after it.
- Evidence:
  - "click **Add suggestion to batch** … When you've finished adding suggested changes, click
    **Commit suggestions**."
  - "Each person who suggested a change included in the commit will be a co-author of the commit."
  - Suggestions need write access.

### R67 · GitHub: rendered prose diffs
- URL: https://github.blog/2014-02-14-rendered-prose-diffs/
- Category: 6
- What it is: GitHub's rendered diff for prose documents. Changes are shown inside the rendered
  document, and it switches back to source.
  - Deletions are struck through in red and additions are in green.
  - Link and attribute changes get a dotted underline with a tooltip.
  - Tables and lists are diffed structurally.
- Takeaways for DEMIURGO:
  - **Proposal before/after for records:**
    - Records are prose, so the default is the *rendered* record with word-level inline marks:
      struck-through red for removed, green for added.
    - A "Source" toggle shows the Markdown.
  - **Non-text changes:** changes to certainty state, links and typed relations get a quiet dotted
    underline. Hovering shows "assumed → confirmed". They don't need a separate panel.
  - **Checks / acceptance criteria:** diff them as structured rows (added check, removed check,
    edited check), not as reflowed text.
  - **Records history:** use the same rendered diff for "compare v3 with v5" on a record's
    history page (see #16).
- Evidence:
  - "Click the 'rendered' button to see the changes as they'll appear in the rendered document."
  - For non-text changes, GitHub uses "a low-key dotted underline" with a hover tooltip.
  - The rendered diffs work with tables and lists.

### R68 · Gerrit: review UI (drafts, reviewed marks, patch-set comparison, shortcuts)
- URL: https://gerrit-review.googlesource.com/Documentation/user-review-ui.html
- Category: 6
- What it is: Gerrit's change screen.
  - A file list with a "reviewed" checkbox.
  - Side-by-side diffs with context and whitespace preferences.
  - Comparison of any two patch sets.
  - Drafts published with a single Reply.
  - A "?" overlay of keyboard shortcuts.
- Takeaways for DEMIURGO:
  - **Proposal review, "Compare against":** a selector compares the proposal against the current
    accepted version (the default), an older version, or an earlier revision of the same proposal.
  - **Keyboard review:**
    - j / k move to the next or previous proposal.
    - `a` accepts (as a draft), `r` rejects (as a draft) and `e` edits.
    - `?` shows the shortcut overlay.

    For a person with 20 proposals this matters more than any visual polish.
  - **Diff preferences persist:** context size (whole record vs changed section only) and whether
    formatting-only changes count. Remember them per user.
  - **Drafts auto-save:** draft decisions and notes survive reloads and navigation until submitted.
- Evidence:
  - "The checkbox in front of the file name allows the patch to be marked as reviewed."
  - "Clicking on a patch set changes the selection for the patch set comparison".
  - "Comments are first saved as drafts … Finally, they will be published by clicking the
    'Reply'."
  - "Typing `?` opens a popup that shows a list of available keyboard shortcuts".

### R69 · Gerrit: the attention set ("whose turn is it")
- URL: https://gerrit-review.googlesource.com/Documentation/user-attention-set.html
- Category: 6
- What it is: A computed set of the users expected to act on a change. Explicit rules add and
  remove users. The dashboard has a "Your turn" section showing how long each item has waited,
  and a hovercard explains why and when you were added.
- Takeaways for DEMIURGO:
  - **Needs you = an attention set with written rules.**
    - An item enters when:
      - a batch of proposals is ready;
      - an agent asks a guided question;
      - a run fails or produces invalid output;
      - an agent has been failing repeatedly (#6).
    - It leaves automatically when the person answers or decides. There is no manual "mark done".
  - **Every row explains itself:** "Why: designer proposed 4 changes to FDR-AGE-002 · waiting for
    you 2 h". The reason shows on hover or in a secondary line.
  - **Home / Catch up:** a "Your turn" section at the top. Items that have waited longest are
    highlighted.
  - **Work in progress doesn't ping:** a run that is still working never enters Needs you. Only
    its outcome does, which keeps the inbox free of noise.
- Evidence:
  - The attention set lists users "that are currently expected to act on the change".
  - "Replying (commenting, voting or just writing a change message) removes the replying user from
    the attention set."
  - "Users are not added by automatic rules when the change is work in progress."
  - "The 'Waiting' column indicates how long the owner has already been waiting for you to act."
  - The hovercard "contains information about whether, why and when a user was added".

### R70 · Reviewable: discussion dispositions and computed resolution
- URL: https://docs.reviewable.io/discussions.html
- Category: 6
- What it is: A code-review tool where every participant sets a stance on each discussion
  (Discussing, Satisfied, Blocking, Working, Informing, Pondering). Resolution is *computed* from
  these stances, a red counter tracks unreplied items, and drafts publish together.
- Takeaways for DEMIURGO:
  - **Thread / guided questions:** give each open question an explicit stance.
    - "Open" and "Blocking readiness" come from the agent.
    - "Answered (draft)" and "Confirmed" come from the person.
    - "Parked" corresponds to Pondering.
    - Readiness is computed from these: a stage can't be "Ready to build" while any question is
      Blocking.
  - **Counter semantics:**
    - The red count on the Thread tab and in Needs you counts *unanswered* questions.
    - A drafted answer already counts as answered, so the counter doesn't nag while the person is
      mid-way.
  - **One publish:** confirming a set of answers publishes the drafts, the stance changes and the
    fork choices together. This is the V2.1 behaviour, now with a named model behind it.
  - **Show the rule:** a hover on "Not ready" explains "2 questions are blocking: Q-014,
    Q-019".
- Evidence:
  - Blocking means "Opposed to resolution while waiting on another contributor".
  - A discussion resolves when "at least one participant is Satisfied or Informing, and no
    participants are Blocking or Working."
  - "If you have a draft reply to a discussion, the discussion is considered replied to."
  - On publishing, "any draft comments in discussions — along with disposition changes or pending
    acknowledgements — are published too."

### R71 · Vercel: build logs
- URL: https://vercel.com/docs/deployments/logs
- Category: 6
- What it is: Vercel's deployment log viewer.
  - Clicking a line's timestamp gives a permalink, and shift-click selects a range (`#L6-L9`).
  - Warnings are yellow and errors red.
  - Sensitive values are redacted automatically.
  - Logs over 4 MB are truncated.
- Takeaways for DEMIURGO:
  - **Run detail event permalinks:** the timestamp column is the link. Shift-click selects a range
    and updates the URL (`/runs/R-123#e40-e52`), and the selection is highlighted on load.
  - **Line severity color:** warning and error events get a tinted row plus an icon, not only
    colored text.
  - **Automatic redaction:** mask agent API keys (`dmg_agent_…`) and provider secrets in the raw
    stream before rendering. Record that a redaction happened, and show "[redacted]" inline. This
    supports the "never repeat secrets" rule.
  - **Size cap with notice:** "Showing the last 2,000 events · Download full log". Never fail
    silently on a huge run.
- Evidence:
  - "If you click on the timestamp to the left of the log entry, you get a link to that log entry.
    This will highlight the selected log and append the line number to the URL as an anchor."
  - "You can select multiple lines by holding the `Shift` key".
  - Errors and warnings are "highlighted with different colors, such as yellow for warnings and
    red for errors".
  - "Vercel replaces the value with `[REDACTED]`".

### R72 · Grafana Explore: live tailing logs
- URL: https://grafana.com/docs/grafana/latest/explore/logs-integration/
- Category: 6
- What it is: Grafana's log explorer. Its Live mode has Pause, Resume, Stop and Clear, and new
  lines get a contrasting background. It also offers level colors, deduplication, line wrap,
  JSON prettify, and newest-first or oldest-first order.
- Takeaways for DEMIURGO:
  - **Journal and run detail (live):**
    - A newly arrived event gets a brief contrasting background that fades after about 2 s, so the
      eye finds what just changed.
    - Honour reduced-motion settings.
  - **Controls on the Journal:** Pause / Resume, and "Clear view" (clears the screen only, never
    the data).
  - **Deduplicate noisy streams:** collapse repeated consecutive events with a count ("Streaming
    output ×148"). This is the same idea as Temporal's grouping (#5).
  - **Order toggle:** the Journal defaults to newest first. Run detail defaults to oldest first,
    because a run reads as a story (see Disagreements).
  - **Raw events:** "Wrap lines" and "Prettify JSON" toggles.
- Evidence:
  - "new logs appear at the bottom of the screen, and have a contrasting background".
  - The controls are Pause, Resume, Stop and Clear logs.
  - Deduplication modes include "Exact, Numbers, or Signature".
  - Order is "Oldest Logs First" or "Newest logs first".
  - "Enable line wrapping and prettify JSON".
  - While scrolling in live tail the stream keeps updating, and you must pause to explore.

### R73 · Carbon Design System: status indicator pattern
- URL: https://v10.carbondesignsystem.com/patterns/status-indicator-pattern/
- Category: 6
- What it is: IBM Carbon's rules for status indicators. It covers redundancy between color,
  shape, symbol and text, and four indicator types (icon, badge, shape, differential). It also
  gives a limit per view, consolidated statuses and label casing.
- Takeaways for DEMIURGO:
  - **All status badges (runs, proposals, records' certainty, readiness):** use at least 3 of 4
    cues (color, shape, symbol, text). The text label is always present in lists and headers.
  - **Consistent shape semantics:**
    - A shape that signals "action needed" for failed runs and items in Needs you.
    - A different shape for "might need action": retrying, late, stale.
    - A neutral shape for "no action needed": succeeded, confirmed.
    - A distinct shape for **unknown** certainty.

    Never reuse a shape with a different meaning.
  - **Consolidated status (a batch, project health):** take the color of the highest-attention
    member, so a failure is never hidden by successes. The wording can still be nuanced (#23).
  - **Limit:** at most 5–6 distinct indicators in one view. Record lists shouldn't show certainty,
    readiness, version, run state and proposal state all at once. Pick the one or two that
    matter per surface.
  - **Labels:** sentence case ("Invalid output", "Needs you"). Don't mix outlined and filled
    icons on one page.
- Evidence:
  - Status indicators must incorporate "at least three of these four components: symbols, shapes,
    colors, and type".
  - "Avoid exceeding 5-6 indicators per view."
  - "When grouping multiple states, use the highest-attention color."
  - Text labels are the "most important element".
  - "Don't mix outlined and filled icons on the same page."

*Also fetched by a second pass (IBM Carbon — Status indicator pattern):*
https://carbondesignsystem.com/patterns/status-indicator-pattern/, confirmed via search)
  severity/attention levels.
- Takeaways for DEMIURGO:
  - Encode each status with **symbol + shape + color + text**, at least three of them. Carbon's shape
    grammar fits DEMIURGO well: circle = action needed (failed, invalid output), triangle = action
    might be needed (assumed, stale), square = no action needed (succeeded, confirmed, cancelled),
    diamond = unknown (the `unknown` certainty state).
  - Three attention tiers: high (red/orange: failed, invalid output, blocked), medium
    (green/blue/purple: succeeded, working, proposed), low (gray: queued, not started).
  - A group or parent shows the **highest-attention** status of its children (project card, batch
    summary, thread header).
  - Keep the vocabulary small: no more than 5–6 distinct indicators in a view.
  - Filled icons for high-attention states, outlined for low-attention.
- Evidence: "For WCAG compliance, at least three of these elements must be present" (symbol, shape,
  color, type). "More than 5 or 6 indicators begins to tax a user and makes it difficult to focus."
  Consolidated statuses: "Use the highest-attention color to represent the group." Search result:
  "Circle = Action needs to be taken, Triangle = Action might need to be taken, Square = No action
  needed, Diamond = Unknown."

### R74 · GitLab Pajamas: Badge component
- URL: https://design.gitlab.com/components/badge/
- Category: 6
- What it is: GitLab's badge guidelines. There are six semantic variants. A badge can hold an
  icon, text or both. Icon-only badges need a tooltip and an `aria-label`, long text is truncated
  with a tooltip, and the guidelines say when not to use a badge.
- Takeaways for DEMIURGO:
  - **Variant follows meaning, not urgency:**
    - "Proposed" and "Assumed" are neutral or info, not warning.
    - "Failed" is danger.
    - "Retrying" is warning.
    - "Succeeded" is success.

    Don't paint things orange to get attention.
  - **Icon-only badges** appear only in dense grids (the agent-health strip #7, graph nodes, map
    canvas). Each has a tooltip plus an `aria-label` such as "Run failed". When icon and text
    appear together, the icon is `aria-hidden`.
  - **Truncate long badge text with a tooltip:** agent names and model ids stay in one line.
  - **Don't use badges for user-defined tags** on records. Use plain labels, so status badges keep
    their meaning.
- Evidence:
  - "Match the variant to the meaning of the metadata, not to how much attention you want to
    attract."
  - "Information can be represented by an icon, text, or both together."
  - Icon-only badges need an `aria-label`. With icon and text together, the icon is
    `aria-hidden="true"`.
  - Long text "is truncated and aided by a tooltip."

### R75 · Atlassian Statuspage: top-level status and incident impact calculation
- URL: https://support.atlassian.com/statuspage/docs/top-level-status-and-incident-impact-calculations/
- Category: 6
- What it is: How Statuspage rolls component statuses (Operational, Degraded performance, Partial
  outage, Major outage, Maintenance) up into one headline. It uses a decision tree with graded
  wording, not simply "worst wins".
- Takeaways for DEMIURGO:
  - **Header health headline:** roll agents and runs up into graded plain language:
    - "All quiet";
    - "2 agents working";
    - "1 run needs you";
    - "Claude provider unavailable: 3 runs waiting".
    - Never a bare red dot.
  - **Degraded vs outage:**
    - Degraded is slow or retrying: the provider responds but with retries.
    - Outage is unavailable: the provider or CLI can't be reached.

    They get different wording and actions.
  - **Scope in the wording:** "Partial" means some agents or providers and "Major" means all of
    them. Give the count of affected items rather than an alarmist global message.
  - **Maintenance state:** a planned state such as "Restarting server", shown when the API
    restarts under `node --watch`. It is visually distinct from failure.
- Evidence:
  - "If _all_ components have a status of 'Operational', top-level status will read 'All Systems
    Operational'."
  - "If _any_ components have a status of 'Major Outage', top-level status will read 'Partial
    System Outage'." A single major outage is not escalated to a system-wide outage.
  - Top-level statuses range from "All Systems Operational" to "Major System Outage".

### R76 · Primer (GitHub): degraded experiences pattern
- URL: https://primer.style/product/ui-patterns/degraded-experiences/
- Category: 6
- What it is: GitHub's guidance for pages where some data or services are unavailable.
  - Split primary experiences from secondary ones.
  - Use a global warning banner and inline messages, at most 5 per page.
  - Remove non-critical controls and never disable controls because something is unavailable.
- Takeaways for DEMIURGO:
  - **SSE disconnect / API restart:**
    - A global warning banner above the navigation: "Live updates paused. Reconnecting… Some
      information may be out of date." Include a Retry.
    - Never show a blocking modal, and never show an error page for a secondary failure.
  - **Primary vs secondary per page:**
    - On proposal review, the proposal content is primary. Its failure gets an error page with
      Retry.
    - Live counts, the graph and token totals are secondary. They degrade inline with a short
      message and icon.
  - **Don't disable Accept because of connectivity.** Keep it enabled. On click, re-validate
    against the server and explain clearly on failure ("Couldn't reach the server, your decision
    is still a draft").
  - **Hide non-critical controls:** when data is unavailable, hide live badges and "show more"
    links silently.
  - **Cap:** no more than 5 outage messages on one page. Collapse the rest into the banner.
- Evidence:
  - "Don't try to conceal or downplay that something is wrong. Communicate that there is a problem
    and guide users around that problem as much as possible."
  - The banner goes "at the top of the page above the global navigation", with "Some content and
    actions may be unavailable. Try refreshing."
  - "Never disable an interactive control that is non-functional due to availability issues."
  - "we suggest limiting pages to 5 or less outage messages."

### R77 · web.dev: offline UX design guidelines
- URL: https://web.dev/articles/offline-ux-design-guidelines
- Category: 6
- What it is: Google's guidance on communicating connectivity and staleness.
  - Tell users the app state and the actions still possible.
  - Show when data was last updated.
  - Queue actions and don't block content with modals.
  - Combine language, color and visuals.
- Takeaways for DEMIURGO:
  - **Freshness stamps:**
    - Needs you, the runs list and project health show "Updated 12 s ago" while live.
    - The stamp switches to a warning ("Last updated 4 min ago · reconnecting") when SSE drops.
  - **Say what still works:** "You can keep reading and drafting answers; accepting will be
    available when reconnected."
  - **Queue drafts, not authority:** draft answers and draft decisions can be written offline
    (they are local drafts). Final acceptance waits for the server.
  - **Don't block content:** use skeletons and stale data with a stamp, never a full-screen
    loading overlay.
- Evidence:
  - "Tell the user both the application's state and the actions they can still take when they
    have a network failure."
  - "Some apps can always show the last time they were updated."
  - Avoid "an intrusive loading modal dialog that covers the entire screen".
  - "Use language, color, and visual components to show a status or change of state".

### R78 · TanStack Query: optimistic updates
- URL: https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates
- Category: 6
- What it is: The official guide for the library DEMIURGO already uses. It describes two optimistic
  patterns:
  - render the pending mutation's `variables` in the UI;
  - write to the cache with `onMutate` and roll back on error.

  It also explains `useMutationState` for showing pending mutations elsewhere.
- Takeaways for DEMIURGO:
  - **Low-stakes, reversible actions** are optimistic through `variables`:
    - marking an inbox item seen;
    - collapsing a proposal;
    - posting a thread message.

    The pending item is rendered at reduced opacity, and a failed item stays in place with
    "Retry".
  - **Authority actions (accept / reject / accept package) are *not* optimistic in outcome.**
    - Show an "Accepting…" pending state on the proposal.
    - Flip to Accepted only when the server confirms, through the response or the SSE event.
    - A 409 must never look like a success that later vanishes.
  - **Cross-surface pending:** use `useMutationState` with a mutation key so the Needs you count
    and header health reflect in-flight decisions ("2 decisions sending…").
  - **Failed mutation memory:** keep the variables on error. A draft answer that failed to send is
    never lost.
- Evidence:
  - "We're rendering a temporary item with a different `opacity` as long as the mutation is
    pending."
  - "variables are _not_ cleared when the mutation errors, so we can still access them, maybe even
    show a retry button."
  - "If you only have one place where the optimistic result should be shown, using `variables` …
    requires less code."

### R79 · W3C WCAG 2.2: Understanding SC 2.2.2 "Pause, Stop, Hide" (auto-updating content)
- URL: https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html
- Category: 6
- What it is: The accessibility requirement that auto-updating content shown alongside other
  content can be paused, stopped, hidden or slowed. Unlike moving content, it has no 5-second
  exemption.
- Takeaways for DEMIURGO:
  - **Journal, Activity and the live runs list:** a visible "Pause live updates" control is a
    requirement here, not a nice-to-have.
  - **On resume:** show "12 new events" and let the person jump to them. The stock-ticker example
    in the spec shows a notice when data was delayed.
  - **Run detail while reading:**
    - If the person has scrolled away from the tail, stop moving the content.
    - Buffer new events behind a "Jump to latest · N new" pill.
    - Update status badges in place without reordering rows under the cursor.
  - **Background surfaces:** the Needs you list must not reorder while the person hovers or
    focuses it. Apply the reordering on the next idle moment or on explicit refresh.
- Evidence:
  - For auto-updating content there must be "a mechanism for the user to pause, stop, or hide it or
    to control the frequency of the update unless the auto-updating is part of an activity where
    it is essential."
  - "there is no five second exception for auto-updating".
  - "Content that moves or auto-updates can be a barrier to anyone who has trouble reading
    stationary text quickly".

### R80 · W3C WCAG 2.2: Understanding SC 4.1.3 "Status Messages"
- URL: https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
- Category: 6
- What it is: How to announce status changes to assistive technology without moving focus. It
  covers `role=status` for results and state, `role=alert` for errors, and `role=log` for
  sequential updates such as chat and logs.
- Takeaways for DEMIURGO:
  - **Run detail event stream and the Thread's streaming reply:** use `role="log"`, which is a
    polite, sequential region. Don't make each token an alert.
  - **Run finished:** announce "Run succeeded: 3 proposals ready" through `role="status"`. "Run
    failed" and "Invalid output" use `role="alert"`, once each, not per event.
  - **Throttle:** one announcement per state change, never per streamed token. This mirrors
    Primer's "single loading announcement for a collection" (see
    https://primer.style/product/ui-patterns/loading/, also fetched).
  - **Never steal focus** on SSE updates. Focus moves only when the person acts.
- Evidence:
  - A status message provides information "on the success or results of an action, on the waiting
    state of an application, on the progress of a process, or on the existence of errors."
  - Status messages must be presentable "without receiving focus".
  - `role=log` is "for sequential information updates".

*Also fetched by a second pass (WCAG 2.2 — Understanding 4.1.3 Status Messages):*
- Takeaways for DEMIURGO:
  - `role="status"` (polite) for results of actions ("Batch accepted", "3 new proposals",
    "Run succeeded"); `role="alert"` only for errors needing attention ("Run failed");
    `role="log"` for sequential streams; `progressbar` for determinate progress.
  - One shell-level polite live region fed by a throttled announcer; never announce every SSE event
    or streamed token.
  - Search/filter results announce their count ("12 records").
- Evidence: a status message "provides information to the user on the success or results of an
  action, on the waiting state of an application, on the progress of a process, or on the existence
  of errors"; must be "programmatically determined through role or properties such that they can be
  presented … without receiving focus"; techniques ARIA22 (status), ARIA19 (alert), ARIA23 (log).

### R81 · Nielsen Norman Group: status trackers and progress updates
- URL: https://www.nngroup.com/articles/status-tracker-progress-update/
- Category: 6
- What it is: 16 research-based guidelines for "pull" status trackers and "push" progress updates.
  Among them: latest update first, plain language, scannability, history with dates, regular
  updates during long processes, and specific errors.
- Takeaways for DEMIURGO:
  - **Catch up:**
    - Lead with the most recent and most important change.
    - Write in plain language ("The designer proposed 4 changes to *Agent providers*") rather
      than event names (`batch.created`).
    - Include a dated history below.
  - **Long runs:** emit a low-granularity progress line at least every few seconds or on each
    phase change ("Still waiting for Claude · 1 min 20 s"), so a working run never looks frozen.
  - **Error copy:** every failed or invalid-output state says the probable cause and the next step
    ("The model's answer was missing required fields. Retry, or switch the designer to another
    model in Models & providers").
  - **Activity:** keep previous updates visible next to the current one. The history is part of
    the status, and an event stays in the history after it is superseded.
- Evidence:
  - "Present the latest update prominently, so users can find it first."
  - "Each update should be written in plain language and should be free from jargon."
  - "Provide regular updates, even if they are of low granularity."
  - "Show previous updates, as well as the current update."
  - "Effective error messages give users helpful information about possible reasons why they've
    encountered an error."

## 7 · Accessibility (WCAG 2.2, WAI-ARIA APG)

### R82 · WCAG 2.2 — What's new
- URL: https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
- Category: 7
- What it is: W3C's list of the nine criteria added in WCAG 2.2 and the removal of 4.1.1.
- Takeaways for DEMIURGO:
  - Target WCAG 2.2 AA. New criteria that apply: 2.4.11 (AA), 2.5.7 (AA), 2.5.8 (AA), 3.3.8 (AA),
    3.2.6 (A), 3.3.7 (A).
  - Aim for 2.4.13 Focus Appearance (AAA) anyway: 2px focus outline, 3:1 change of contrast.
  - Login: no cognitive-function test (no puzzles, allow paste and password managers) — 3.3.8.
- Evidence: 2.4.11: focused component "is not entirely hidden due to author-created content"; 2.5.7:
  dragging functionality "can be achieved by a single pointer without dragging"; 2.5.8: "at least 24
  by 24 CSS pixels"; 3.2.6 (A): help in "the same relative order"; 3.3.7 (A): previous input
  "auto-populated, or available for the user to select"; 3.3.8: "A cognitive function test is not
  required for any step in an authentication process"; 4.1.1 Parsing removed.

### R83 · WCAG 2.2 — Understanding 2.4.11 Focus Not Obscured (Minimum)
- URL: https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
- Category: 7
- What it is: Intent and techniques for keeping the focused element at least partly visible.
- Takeaways for DEMIURGO:
  - Sticky elements (top bar, thread composer at the bottom, sticky proposal action bar, SSE banners,
    toasts) must not cover the focused element: set `scroll-padding-top/bottom` equal to the sticky
    heights on scroll containers.
  - Non-modal overlays (Go deeper panel, toasts) must not sit on top of the focus path; place them
    beside content, not over it.
  - Modal dialogs pass by design (focus moves inside).
- Evidence: "the item receiving keyboard focus is always partially visible in the user's viewport";
  "Typical types of content that can overlap focused items are sticky footers, sticky headers, and
  non-modal dialogs"; technique "C43: Using CSS scroll-padding to un-obscure content".

### R84 · WCAG 2.2 — Understanding 2.4.13 Focus Appearance (AAA)
- URL: https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html
- Category: 7
- What it is: The measurable focus-indicator criterion (AAA) and its relation to 1.4.11 and 2.4.7.
- Takeaways for DEMIURGO:
  - One global focus style: solid 2px outline, 2px offset, color from the focus token; it must reach
    3:1 against the unfocused state *and* 3:1 against adjacent colors (1.4.11).
  - Inside composite widgets (tree, grid, listbox) the focused row needs a visible 2px indicator
    distinct from "selected".
  - Never `outline: none` without a replacement.
- Evidence: indicator "is at least as large as the area of a 2 CSS pixel thick perimeter of the
  unfocused component"; "has a contrast ratio of at least 3:1 between the same pixels in the focused
  and unfocused states"; simplest approach "a solid outline around the component"; offset recommended.

### R85 · WCAG 2.2 — Understanding 2.5.7 Dragging Movements
- URL: https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html
- Category: 7
- What it is: Requirement that drag operations have a single-pointer, non-drag alternative.
- Takeaways for DEMIURGO:
  - Map canvas / knowledge graph: pan and zoom buttons (and keyboard), "move to…" menu for nodes.
  - Resizable Go deeper panel: the splitter must also work without dragging (keyboard arrows on a
    focusable separator, or preset width buttons / double-click to reset).
  - Any reorder (journeys, steps) offers "Move up/Move down" or a menu.
- Evidence: "All functionality that uses a dragging movement for operation can be achieved by a single
  pointer without dragging, unless dragging is essential"; examples: sortable lists with up/down
  controls, kanban with select-then-move, map panning buttons, slider track click.

### R86 · WCAG 2.2 — Understanding 2.5.8 Target Size (Minimum)
- URL: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- Category: 7
- What it is: The 24×24 CSS px minimum with its spacing, inline, equivalent, user-agent and
  essential exceptions.
- Takeaways for DEMIURGO:
  - Minimum 24×24 px hit area for every icon button (row actions, copy key, close panel, expand
    tree node); 32 px preferred in comfortable density; 44 px for the main decision buttons
    (Accept/Reject) per 2.5.5 advice.
  - If a visual icon is 16 px, pad the hit area to 24 px or keep 24 px spacing circles clear of other
    targets.
  - Compact density must not shrink hit areas below 24 px (drives row-height choice: no 24 px rows
    with two icon buttons side by side unless spaced).
  - Map pins/graph nodes can use the "essential" exception but still provide a list alternative.
- Evidence: "The size of the target for pointer inputs is at least 24 by 24 CSS pixels"; spacing
  exception with "a 24 CSS pixel diameter circle"; "For important links/controls, consider aiming for
  the stricter 2.5.5 Target Size (Enhanced)" (44×44).

### R87 · WCAG 2.2 — Understanding 3.3.7 Redundant Entry
- URL: https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html
- Category: 7
- What it is: Level A criterion against asking for the same information twice in one process.
- Takeaways for DEMIURGO:
  - Guided questions: answers already given in the thread (or in a sibling fork) are preselected or
    offered, never re-asked as blank.
  - "Edit" on a proposal pre-fills the proposed content.
  - After a failed submit (409/422), keep the user's text in the composer.
- Evidence: previous information "is either: auto-populated, or available for the user to select";
  examples include search pages keeping the term and error pages preserving submitted data; "Users
  with learning, and cognitive disabilities are highly susceptible to mental fatigue".

### R88 · WCAG 2.2 — Understanding 3.2.6 Consistent Help
- URL: https://www.w3.org/WAI/WCAG22/Understanding/consistent-help.html
- Category: 7
- What it is: Level A criterion: help mechanisms stay in the same relative order across pages.
- Takeaways for DEMIURGO:
  - If there is a help entry point (docs link, "Ask DEMIURGO", companion chat), put it in the same
    place in the shell on every screen.
  - A chatbot counts as a help mechanism; the agent chat entry point must be consistently located.
- Evidence: covers "fully automated contact systems like chatbots"; mechanisms must "occur in the
  same order relative to other page content, unless a change is initiated by the user"; it does not
  require providing help.

### R89 · WCAG 2.2 — Understanding 1.4.3 Contrast (Minimum)
- URL: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- Category: 7
- What it is: Text contrast requirement.
- Takeaways for DEMIURGO:
  - 4.5:1 for all body and UI text, including muted/secondary text, timestamps and placeholder-like
    hints; 3:1 only for text ≥ 24 px, or ≥ 18.66 px bold.
  - Text inside status pills is text: pill fg on pill bg must reach 4.5:1 in both themes.
  - Automate the check in the design-system tests; no rounding (4.49 fails).
- Evidence: 4.5:1 normal, 3:1 large; "14pt and 18pt are equivalent to approximately 18.5px and 24px";
  "4.499:1 would not meet the 4.5:1 threshold"; inactive components are exempt.

### R90 · WCAG 2.2 — Understanding 1.4.11 Non-text Contrast
- URL: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
- Category: 7
- What it is: 3:1 contrast for UI component boundaries/states and meaningful graphics.
- Takeaways for DEMIURGO:
  - Status icons, certainty shapes, checkbox/toggle states, input borders (when they are the only
    affordance), focus rings and selected-row indicators: 3:1 against adjacent colors.
  - Graph edges and node shapes that carry meaning on the map/knowledge graph: 3:1, or a text
    alternative.
  - Disabled controls are exempt, but prefer explaining why something is disabled.
- Evidence: "any visual information provided that is necessary for a user to identify that a control
  is present and how to operate it must have a minimum 3:1 contrast ratio"; state information
  "must also ensure that the information used to identify the control in that state has a minimum
  3:1 contrast ratio"; inactive components excluded.

### R91 · WCAG 2.2 — Understanding 1.4.13 Content on Hover or Focus
- URL: https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html
- Category: 7
- What it is: Rules for tooltips, popovers and hover cards: dismissible, hoverable, persistent.
- Takeaways for DEMIURGO:
  - Record peek cards, provenance hovers and status tooltips: Esc dismisses without moving focus; the
    pointer can move into the card; no timeout.
  - Anything that appears on hover must also appear on keyboard focus.
  - Essential information (why a run failed) must not live only in a tooltip.
- Evidence: "A mechanism is available to dismiss the additional content without moving pointer hover
  or keyboard focus"; "the pointer can be moved over the additional content without the additional
  content disappearing"; "remains visible until the hover or focus trigger is removed, the user
  dismisses it, or its information is no longer valid".

### R92 · WCAG Technique ARIA23 — role=log
- URL: https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA23
- Category: 7
- What it is: Technique for sequentially updating content (chat, server logs).
- Takeaways for DEMIURGO:
  - Thread message list = `role="log"`: new agent messages are announced politely, only the new
    message is read (aria-atomic false).
  - Activity log in live mode = `role="log"` as well, but throttle/batch to avoid chatter.
  - Test with NVDA + Firefox/Chrome and VoiceOver; support varies.
- Evidence: "The ARIA live region role of log has an implicit aria-live value of polite and
  aria-atomic value of false"; examples are a chat conversation and a server log; announcement depends
  on "AT/browser compatibility".

### R93 · WAI-ARIA APG — Developing a Keyboard Interface
- URL: https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/
- Category: 7
- What it is: APG's general keyboard guidance (focus visibility, tab sequence, roving tabindex vs
  aria-activedescendant, disabled items, shortcuts).
- Takeaways for DEMIURGO:
  - Tab moves between components; arrow keys move inside composites (lists, trees, tables, toolbars).
    One tab stop per composite (roving tabindex).
  - Use roving tabindex for lists of proposals/runs (browser scrolls focused item into view);
    `aria-activedescendant` for comboboxes where focus stays in the input.
  - Keep disabled items focusable inside composites so screen-reader users discover them.
  - Keyboard shortcuts (e.g. `a` accept, `r` reject, `j/k` next/prev) are accelerators, never the
    only path; avoid browser/AT conflicts; expose with `aria-keyshortcuts` and a visible hint.
- Evidence: "The visual focus indicator must always be visible"; "the tab and shift + tab keys move
  focus from one UI component to another while other keys, primarily the arrow keys, move focus inside
  of components"; with roving tabindex "the user agent will scroll the newly focused element into
  view"; disabled items: screen reader users "are far less likely to discover disabled elements that
  are not focusable".

### R94 · WAI-ARIA APG — Landmark Regions
- URL: https://www.w3.org/WAI/ARIA/apg/practices/landmark-regions/
- Category: 7
- What it is: How to structure a page with landmarks.
- Takeaways for DEMIURGO:
  - Shell: `banner` (top bar), `navigation` (project nav, labeled), one `main`, `complementary`
    for Go deeper / detail side panels (each labeled: "Go deeper", "Proposal detail").
  - Label every repeated landmark uniquely; all content inside some landmark.
  - Dialog content needs no landmark wrapper.
- Evidence: "Including all perceivable content on a page in one of its landmark regions"; "If a
  specific landmark role is used more than once on a page, provide each instance of that landmark with
  a unique label"; "Each page should have one main landmark"; wrapping modal dialog content in a
  landmark "is unnecessary".

### R95 · WAI-ARIA APG — Dialog (Modal) pattern
- URL: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- Category: 7
- What it is: Focus management and semantics for modal dialogs.
- Takeaways for DEMIURGO:
  - Focus moves into the dialog on open, Tab cycles inside, Esc closes, focus returns to the trigger
    (Radix Dialog does this; keep it).
  - For irreversible or authority-changing confirmations (reject a whole batch, revoke an agent key),
    focus the least destructive option (Cancel) first.
  - For long content (full proposal diff in a dialog), focus the title/static start with
    `tabindex="-1"` so nothing scrolls away.
  - Every dialog has a visible title referenced by `aria-labelledby`.
- Evidence: "When a dialog opens, focus moves to an element inside the dialog"; "Escape: Closes the
  dialog"; "When a dialog closes, focus returns to the element that invoked the dialog"; for
  destructive actions focus the least destructive option; for complex content "add tabindex="-1" to a
  static element at the start of the content and initially focus that element".

### R96 · WAI-ARIA APG — Tabs pattern
- URL: https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
- Category: 7
- What it is: Tablist/tab/tabpanel semantics and activation models.
- Takeaways for DEMIURGO:
  - Record view tabs (Content, Versions, Relations, Checks, Provenance): automatic activation on
    arrow focus if panels render without noticeable latency (prefetch with TanStack Query);
    otherwise manual activation (Enter/Space).
  - Arrow keys + Home/End inside the tablist; a panel without focusable content gets `tabindex="0"`.
- Evidence: "It is recommended that tabs activate automatically when they receive focus as long as
  their associated tab panels are displayed without noticeable latency"; "the tabpanel should set
  tabindex="0"" when it has no focusable content.

### R97 · WAI-ARIA APG — Tree View pattern
- URL: https://www.w3.org/WAI/ARIA/apg/patterns/treeview/
- Category: 7
- What it is: Roles, states and keyboard model for hierarchical trees.
- Takeaways for DEMIURGO:
  - Provenance tree and design-record hierarchy: `tree`/`treeitem`/`group`, `aria-expanded` on parents,
    Right/Left to expand/collapse, Home/End, type-ahead (required feel with > 7 root nodes),
    `*` to expand siblings.
  - When children load lazily from the API, set `aria-level`, `aria-setsize`, `aria-posinset`.
  - Use `aria-selected` (single-select navigation) and do not mix with `aria-checked`.
- Evidence: "All tree nodes are contained in or owned by an element with role tree"; "Type-ahead is
  recommended for all trees, especially for trees with more than 7 root nodes"; level/setsize/posinset
  required when "the complete set of available nodes is not present in the DOM due to dynamic loading".

### R98 · WAI-ARIA APG — Treegrid pattern
- URL: https://www.w3.org/WAI/ARIA/apg/patterns/treegrid/
- Category: 7
- What it is: Hierarchical, interactive tabular data with expandable rows.
- Takeaways for DEMIURGO:
  - Use a treegrid only where hierarchy *and* columns both matter (batch → proposals with status,
    agent, certainty columns; run → retries with duration/tokens). Otherwise prefer a plain list or tree.
  - Row focus and cell focus both possible; focus ≠ selection, so style them differently.
  - Avoid editable inputs inside cells (arrow keys are captured by grid navigation); edit in the side panel.
- Evidence: "in a treegrid both rows and cells are focusable"; "the selected state is independent of
  the focus"; Right Arrow on a collapsed row "expands the row"; navigation keys "are not available to
  do something like operate a combobox or move an editing caret inside of a cell".

### R99 · WAI-ARIA APG — Feed pattern
- URL: https://www.w3.org/WAI/ARIA/apg/patterns/feed/
- Category: 7
- What it is: Structure for lists of articles that load more as the user scrolls.
- Takeaways for DEMIURGO:
  - Long activity log / Catch up history with infinite scroll: `role="feed"` containing `article`s
    with `aria-posinset`/`aria-setsize`, `aria-busy="true"` while loading more.
  - Page Down/Up between articles; Ctrl+End/Home to leave the feed.
  - Feed is for reading history; `role="log"` is for announcing new live entries. Do not combine both
    on the same container.
- Evidence: "A feed is a section of a page that automatically loads new sections of content as the
  user scrolls"; "a feed is a structure, not a widget"; aria-busy during updates is "extremely
  important"; Page Down/Up and Control + End/Home.

## Where sources disagree, and the position DEMIURGO takes

Each pass listed the conflicts it found. Positions are restated in DESIGN.md where they apply.

### Orchestration, status, logs and review

1. **Auto-scroll logs vs user-controlled scroll.**
   - Grafana keeps streaming while you scroll and requires an explicit Pause to read history.
   - Temporal adds a "pause live" button.
   - WCAG 2.2.2 requires a pause mechanism for auto-updating content.
   - Common live-log practice follows the tail only while the view is at the bottom. GitHub
     Actions live logs work this way, but the GitHub docs fetched here do not describe it.

   **DEMIURGO:** use a scroll-aware follow.
   - Follow while the reader is at the bottom.
   - Stop following as soon as they scroll up, and show a "Jump to latest · N new" pill.
   - The Journal and Activity also get an explicit Pause / Resume.

   *Why:* the primary user reads agent output carefully and may not be technical. Yanking the text
   away is hostile, and a pause control is an accessibility requirement anyway.

2. **Failure-first reordering vs natural order.**
   - Buildkite moves blocked and failed steps to the top and initially hides passed jobs.
   - GitHub Actions, Airflow and Dagster keep structural or chronological order and only
     highlight or auto-expand the failures.

   **DEMIURGO:** use both, by scope.
   - *Across* items (Runs list, Needs you, batch lists): order by what needs action and collapse
     succeeded items with a count.
   - *Within* one run (Prepare → Invoke → Apply) or one thread: keep causal order and auto-expand
     the failure.

   *Why:* order inside a run carries meaning, because Apply failing only makes sense after Invoke.
   Order across runs doesn't.

3. **Inline vs side-by-side diff, and source vs rendered.**
   - Gerrit centres on side-by-side.
   - GitHub offers unified and split, plus a *rendered* prose diff for documents.

   **DEMIURGO:**
   - The default for records is a rendered, inline, word-level diff.
   - Structured fields (certainty, relations, checks) get a field-level before → after table.
   - Side-by-side and Source are toggles, and the choice is remembered per user.

   *Why:* DEMIURGO's records are prose read by a possibly non-technical person. Line-based code
   diffs of Markdown are noise, and inline rendered diffs keep the reading flow.

4. **Status as text badges vs icon-only.**
   - Pajamas allows icon-only badges with a tooltip and `aria-label`.
   - Carbon requires at least 3 of 4 cues and calls the text label the "most important element".
   - GitHub Actions puts only an icon beside the job name.

   **DEMIURGO:**
   - Icon + text everywhere by default: lists, headers, the drawer, Needs you.
   - Icon-only only in dense grids (agent-health strip, graph nodes, map canvas), with a tooltip
     and `aria-label`.

   *Why:* a non-technical supervisor must not learn an icon language, and the text also lets a
   state carry its reason ("Invalid output").

5. **How to roll many statuses into one.**
   - Carbon says to use the highest-attention color.
   - Statuspage deliberately avoids escalating: one component in major outage reads as a "Partial
     System Outage".

   **DEMIURGO:**
   - The *color / shape* comes from the highest-attention member, so a failure is never hidden.
   - The *wording* is graded and counted ("1 run failed · 2 working").

   *Why:* both goals hold. The failure must be noticed, and panic must not be induced when one run
   out of twenty failed.

6. **Where run detail opens: drawer vs page.**
   - Buildkite uses a resizable drawer that can dock to the side, bottom or center and keeps the
     list context.
   - GitHub Actions, Dagster and Inngest use full pages or panels that replace the list.

   **DEMIURGO:**
   - From lists (Runs, Needs you, Activity), open a side drawer, with an "Open full page" link.
   - The full page is the permalink target.

   *Why:* supervising several agents is triage. The person moves item to item, and losing the list
   costs orientation.

7. **Clock-time timeline vs ordered compact view as the default.**
   - Dagster (Gantt) and Inngest (waterfall) lead with time-proportional bars.
   - Temporal made a Compact view that "does not take clock time into consideration" the easier
     entry point.

   **DEMIURGO:**
   - Compact is the default: three phases with durations as text.
   - A Timeline tab covers timing questions, useful for cascades and queue delays (#10).

   *Why:* a DEMIURGO run has few phases. The question is "what happened / what is it doing", not
   "where did the milliseconds go".

8. **Commit one change at a time vs publish everything at once.**
   - GitHub supports both a single "Commit suggestion" and a batch.
   - Gerrit and Reviewable publish all drafts in one Reply or publish.

   **DEMIURGO:**
   - Decisions are drafts by default and are confirmed together (matching the V2.1 patch
     2cd79c9).
   - A single proposal can still be accepted immediately when it is alone or when the person
     explicitly chooses "Accept now".

   *Why:* coherent packages should become authority in one human act, and a lone fix shouldn't
   need ceremony. Both paths create authority only through the human.

9. **Optimistic updates vs waiting for server truth.**
   - TanStack Query encourages optimistic UI.
   - Primer and web.dev stress telling the truth about state and staleness.

   **DEMIURGO:**
   - Optimistic for reversible UI state (seen, collapsed, draft message).
   - Pessimistic, with an explicit "Accepting…" state, for authority-creating actions.

   *Why:* the rule is that only the human creates authority. The UI must never show a record as
   accepted before the server has recorded it, because a 409 rollback would undermine trust in the
   whole flow.

10. **Disable controls vs keep them enabled.**
    - Primer says "Never disable an interactive control that is non-functional due to availability
      issues".
    - Many review tools disable the approve or merge button when checks fail, as a
      rule-based block.

    **DEMIURGO:**
    - For *availability* (SSE lost, server restarting), keep Accept enabled and explain on click.
    - For *rule-based* blocks (conflict with a newer version, a blocking question), use an
      inactive-but-focusable button with the reason printed next to it.

    *Why:* the reason must always be visible or reachable. A silently disabled button teaches
    nothing.

11. **Newest-first vs oldest-first.**
    - Grafana and Temporal let the user toggle.
    - Build logs (GitHub, Vercel) are oldest-first.
    - Status trackers (NN/g) put the latest update first.

    **DEMIURGO:**
    - Run detail and threads are oldest-first, because they read as stories.
    - Journal, Activity and Catch up are newest-first, because they answer "what changed".
    - The Journal gets a toggle.

    *Why:* the reading task differs by surface.

12. **Hide succeeded items vs show everything.**
    - Buildkite initially hides passed jobs.
    - Airflow's grid shows every cell.

    **DEMIURGO:**
    - In lists, collapse succeeded items behind a count when anything needs attention.
    - In the agent-health grid, show everything, because the pattern of green is the information
      there.

### Agent observability, AI UX and dev tools

1. **Numeric confidence vs categorical certainty.**
   - The views:
     - Smashing lists a numeric display ("Confidence: 95%") as a valid Confidence Signal.
     - PAIR warns that "numeric confidence indicators are risky".
     - HAX G2 says to match the precision of the UI to real system performance.
   - **DEMIURGO position: categorical only.** Certainty (confirmed / assumed / proposed / open /
     unknown) describes the epistemic status of a record, set through human acceptance, not a
     model's self-reported probability. LLM self-confidence is poorly calibrated, and a percentage
     would invite automation bias. Where an agent is unsure, show alternatives (guided options,
     forks), which is PAIR's N-best.

2. **Showing the agent's reasoning vs distrusting it.**
   - The views:
     - Linear AIG (internal state and reasoning should be inspectable), Copilot session logs, shapeof.ai "Stream
       of Thought" and Devin's progress view put reasoning in front.
     - NN/g says step-by-step explanations are often after-the-fact rationalizations and to lead
       with sources.
   - **DEMIURGO position: both, placed differently.**
     - Run detail streams all events, with thoughts muted and collapsible, labeled as the agent's
       narration.
     - Proposal review leads with evidence: the diff, the cited records, sources and thread
       messages. Narration sits behind a disclosure.
     - Acceptance rests on evidence, not on how persuasive the reasoning sounds.

3. **Chat-centric vs object-centric agent UI.**
   - The views:
     - GitLab's "Focused" mode and Devin make chat the main surface.
     - Linear AIG ("inhabit the platform natively"), GitLab's non-conversational flows, Agent Inbox
       and NN/g's hybrid prompt controls push work into objects and structured controls.
   - **DEMIURGO position: object-centric, with chat as one surface.**
     - The home is Needs you plus records and readiness, not a chat.
     - Proposals, questions and runs are first-class objects with their own lists, states and
       actions.
     - Threads stay the place to explore, but their outputs (guided questions, batches) are
       objects that also appear in Needs you. The authority model (AI proposes, human accepts)
       needs objects to act on, not messages.

4. **Keyboard-first vs visible controls for novices.**
   - The views:
     - Linear is keyboard-first (number keys, `J`/`K`, Cmd+K).
     - NN/g stresses labeled icons, conventional patterns and redundant entry points.
     - Linear's own Method says a tool should be "simple to get started with".
   - **DEMIURGO position: visible labeled buttons always; shortcuts are accelerators.** Hints show
     on the buttons and in tooltips, and Cmd+K and `?` are available. The primary user may be
     non-technical, so no action is keyboard-only.

5. **First-person agent voice vs neutral language.**
   - The views:
     - GitLab lets agents speak in first person inside chat.
     - NN/g advises "factual, neutral language" and warns against anthropomorphizing.
     - Linear AIG insists an agent is always disclosed as an agent.
   - **DEMIURGO position: first person only inside thread messages,** with a distinct agent avatar
     and tag. All system UI (statuses, Needs-you reasons, toasts, Catch up) is third-person and
     neutral ("Designer proposed…", "Run failed: invalid output").

6. **Adjustable autonomy vs a fixed human gate.**
   - The views:
     - Smashing's Autonomy Dial goes up to "Act Autonomously".
     - shapeof.ai allows opting out of verification after the first time.
     - GitHub keeps a hard human gate: the self-approval doesn't count, and workflows need "Approve
       and run".
   - **DEMIURGO position: fixed at "Plan & Propose"; acceptance is always human.** Friction is
     reduced another way: package accept, bulk accept, keyboard decisions. The level of
     confirmation scales with risk (shapeof.ai "match friction to risk"), but the gate itself is
     never removed. The agent card states the rule.

7. **Undo vs an append-only history.**
   - The views: Smashing's Action Audit & Undo (time-limited undo) and PAIR's "erase or update
     previous selections" assume reversal.
   - **DEMIURGO position: no hidden undo.** The diary is append-only and nothing is deleted.
     "Revert" creates a new superseding version or a revert proposal. It appears in Activity and
     Origins, so reverting is itself traceable.

8. **Notify everything vs nudge.**
   - The views:
     - GitHub's inbox collects everything subscribed, with reasons.
     - Microsoft ("nudging more than notifying") and Linear's Priority tab filter hard.
   - **DEMIURGO position: Needs you holds actionable items only,** each with a reason label.
     Everything else goes to Activity. Catch up is a summary with links, not a replay. One person
     supervising several agents would drown in a GitHub-style firehose.

9. **Cost as a first-class column vs cost kept out of sight.**
   - The views:
     - Observability tools (Langfuse, Braintrust, Weave) put tokens and cost in every row.
     - Product agents (Copilot) keep usage inside the session.
     - NN/g's Qwen study shows that an unexplained cost jump breaks trust.
   - **DEMIURGO position: cost stays visible but secondary.**
     - Runs list: a hideable column.
     - Run detail: a usage tab with exclusive buckets.
     - Settings: consumption per agent and model.
     - Before a user starts a Claude/Codex run: an explicit "uses your subscription" note, so
       quota is never spent by surprise.

10. **Multi-reviewer workflows vs a single owner.**
    - The views: LangSmith (reservations, reviewer thresholds), Braintrust (assignments, "Assigned
      to me") and Copilot ("your approval won't count") assume teams.
    - **DEMIURGO position: no assignment or reservation UI.** There is one human. Keep attribution
      ("Accepted by Marcos") because the data model needs a human actor, but do not build
      team-review chrome.

11. **Live auto-scroll vs a stable reading position.**
    - The views: live tails and session logs stream continuously (Braintrust, GitLab session panel).
      Braintrust also pauses when the tab is hidden.
    - **DEMIURGO position:** auto-scroll the live journal and run detail only while the user is at
      the bottom. Otherwise show a "N new events" pill. Pause SSE rendering while the tab is hidden
      and catch up on return.

### Design systems, expert UX and accessibility

1. **Default density: comfortable vs compact.**
   Cloudscape: comfortable by default, compact as a user-controlled option for data-heavy views,
   never for help/alerts/dropdowns. Carbon v10 table default is 48 px, the v11 set adds 40 px, and
   compact goes down to 24 px. Control-room practice (HMI) favors information-dense overviews.
   **DEMIURGO position:** comfortable by default (the primary user may be non-technical and most
   surfaces are reading surfaces: threads, records, proposals, Catch up), with a global
   "Compact" preference that only affects tables and lists (runs, proposals, records, activity log):
   row 40 → 32 px, one 4 px spacing step less, fonts unchanged, hit areas never below 24 px (2.5.8).

2. **Skeletons vs spinners.**
   NN/g: nothing below 1 s, skeleton for full views under 10 s, spinner for a single module 2–10 s,
   progress bar above 10 s. Carbon: skeletons only on initial load of containers/data components.
   Cloudscape: prefers skeletons in general and keeps spinners for expandable rows and progressive
   loading. NN/g also flags animated skeletons as an accessibility risk.
   **DEMIURGO position:** (a) no indicator for < 1 s (render the skeleton only after a short delay to
   avoid flashes); (b) layout-shaped skeletons for initial loads of views and tables; (c) inline
   spinner + verb ("Accepting…") for the user's own actions; (d) agent runs are never "loading":
   they use the run status indicator with elapsed time and streamed evidence of progress, and the
   person can leave. Shimmer off under `prefers-reduced-motion`.

3. **Icon-only status in dense tables.**
   Carbon allows compact *shape indicators* (shape + color) in tight spaces but still asks for at least
   three of symbol/shape/color/text and admits shape-only is weak for screen readers and low color
   vision. Atlassian and Primer require a text label on status pills. Primer's Timeline uses icon-only
   badges but declares them decorative and puts the status in the text.
   **DEMIURGO position:** icon + text by default everywhere. Icon-only (distinct shape + symbol +
   color) is allowed only in a column whose header names the dimension (e.g. "Certainty"), with an
   accessible name on the icon and a 1.4.13-compliant tooltip, and never for high-attention states
   (failed, invalid output, needs decision), which always show text.

4. **Dark vs light default for a monitoring tool.**
   High-performance HMI recommends a light-gray, low-glare base with color reserved for abnormal
   states; NN/g finds light polarity performs better for normal vision and recommends offering dark as
   an option; developer tools (Geist, Radix) ship light and dark as equals.
   **DEMIURGO position:** design and QA light first (reading-heavy product, evidence on polarity),
   follow the OS `prefers-color-scheme` on first visit with an explicit override in the person menu,
   and produce both themes from the same semantic tokens. In both themes, keep the neutral base quiet
   and reserve saturated color for attention states.

5. **4 px vs 8 px base grid.**
   Cloudscape uses a 4 px base (compact removes 4 px steps). Carbon describes an 8 px mini unit but its
   scale starts at 2 and 4 px and includes 12 px.
   **DEMIURGO position:** 4 px base unit for tokens (2, 4, 8, 12, 16, 24, 32, 40, 48, 64…), with page
   layout rhythm in multiples of 8. This keeps compact mode (−4 px) expressible and matches Carbon's
   actual values.

6. **Contrast metric: WCAG 2 ratios vs APCA.**
   Radix guarantees APCA Lc 60/90 for its text steps; WCAG 2.2 (the conformance target) uses ratios
   4.5:1 / 3:1; Primer's high-contrast theme targets 7:1.
   **DEMIURGO position:** WCAG 2.2 ratios are the gate (automated test on every semantic fg/bg pair,
   including status pills in both themes); APCA is advisory for fine-tuning muted text.

7. **Scale length: 12 steps (Radix) vs 10 steps (Geist) vs emphasis/muted pairs (Primer).**
   All agree that each step has a fixed job. **DEMIURGO position:** keep whatever length the existing
   `@demiurgo/design-system` uses, but document the job of each step and expose only semantic tokens
   (`muted`/`emphasis` per role) to components.

8. **Modal vs side panel for detail and editing.**
   APG gives a full modal-dialog pattern; NN/g's table research says editing a row in a modal hides the
   data the user needs and recommends a non-modal panel; complex-app guidance says to show
   supplementary info without leaving the primary screen.
   **DEMIURGO position:** side panels (labeled `complementary`) for reviewing/editing proposals, record
   peeks, run details and Go deeper; modals only for short confirmations of authority-changing or
   destructive actions, with focus on the least destructive option.

9. **Auto-dismissing toasts.**
   Carbon allows time-based toasts; Carbon itself and WCAG-oriented guidance forbid timed dismissal for
   critical messages. **DEMIURGO position:** toasts only confirm the person's own action; anything an
   agent produced that needs a human goes to Needs you and stays until handled.

10. **Depth of disclosure: 2 levels (NN/g) vs 4-level display hierarchy (HMI).**
    Not a real conflict: NN/g limits disclosure levels *within* a view; HMI describes navigation levels
    *across* views. **DEMIURGO position:** four navigational levels (overview → area → item →
    diagnostics), at most two disclosure levels within any one screen.

11. **Catch up: AI narrative vs structured reconciliation.**
    A generated summary is quick to build; the 2026 handover study found structured reconciliation of
    telemetry + human notes matched end-to-end AI utility with substantially less misinformation.
    **DEMIURGO position:** Catch up is built from the event journal (perception → comprehension →
    projection, per Endsley); an optional AI narrative sits on top, labeled as a summary and linked to
    the events it cites.

12. **Tab activation: automatic vs manual.**
    APG prefers automatic activation only when panels appear without noticeable latency.
    **DEMIURGO position:** automatic for record tabs whose data is prefetched; manual (Enter/Space) for
    tabs that trigger a slow query or an agent call.

## Fetch notes

- The current carbondesignsystem.com pages are rendered on the client and came back empty. Carbon
  guidance is taken from the server-rendered v10 pages and, for table sizes, from the
  `carbon-website` repository. Token names differ in v11; the spacing values are the same.
- These sources were dropped or replaced because they did not load or no longer hold the content:
  - Cloudscape "Status indicator": only its one-line description loaded.
  - Polaris "Voice and tone": it now redirects to a page without that guidance.
  - The Statuspage "component statuses" page: it returns 404; the "top-level status" page is used
    instead (R75).
  - The Argo Workflows docs: they have no UI content.
- Quotes come from the fetch tool's extraction. Where the tool condensed a page, treat the quote as
  a close paraphrase.
- The date of the older Vercel dashboard post (R34) could not be confirmed. The Phoenix entry (R18)
  and the Vercel entry lean on vendor summary pages rather than deep documentation.
- Correction to the brief: in WCAG 2.2, 3.2.6 Consistent Help and 3.3.7 Redundant Entry are Level A,
  not AA (R82). An AA target includes every Level A criterion, so both still apply.
