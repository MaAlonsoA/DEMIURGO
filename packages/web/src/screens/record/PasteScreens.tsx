// The design handoff: the person designed the screens in Claude Design and pastes them back here, as the
// first version of the feature's screen design (SCR) or as a new one. No agent: the person's own act.
// It reaches authority through the commands a person already has (record.create or record_version.create,
// then record_version.approve); the server runs the same checks as for a proposal (steps served, no
// scripts or external URLs, and the components the approved design system lacks are a 409).

import { Link, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import type { ScreenDesignSpec } from '@demiurgo/domain/screen-design';
import { useCommand } from '../../api/commands.ts';
import { announce } from '../../components/announce.tsx';
import { Button } from '../../components/Button.tsx';
import { Checkbox, Field, Select, TextArea, TextInput } from '../../components/Field.tsx';
import { ErrorNotice, Notice } from '../../components/Notice.tsx';
import { SandboxedPreview } from '../../components/SandboxedPreview.tsx';
import { useMessages } from '../../i18n/define.ts';
import { stepsOf } from '../../components/BehaviorSteps.tsx';
import { type Draft, type DraftScreen, checkSpec, draftOf, emptyScreen, kebab, sectionsOf, specOf } from './paste.ts';
import { PASTE } from './paste.i18n.ts';

const STATE_KEYS = ['empty', 'loading', 'error', 'data'] as const;

export type PasteTarget = {
  projectId: string;
  /** The feature version the screens rest on (its current one). */
  feature: { code: string; version: number; domain: string; title: string; behavior: string };
  /** Names of the components of the approved design system. */
  components: string[];
  /** A new version of this screen design; absent for the first one. */
  existing?: { recordId: string; title: string; spec: ScreenDesignSpec | null };
};

export function PasteScreens({ target, onClose }: { target: PasteTarget; onClose: () => void }) {
  const t = useMessages(PASTE);
  const { projectId, feature, components, existing } = target;
  const command = useCommand<{ code?: string; versionId?: string }>(projectId);
  const navigate = useNavigate();
  const steps = useMemo(() => stepsOf(feature.behavior), [feature.behavior]);
  const [draft, setDraft] = useState<Draft>(() => draftOf(existing?.spec ?? null));
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [counter, setCounter] = useState(2);

  const spec = useMemo(() => specOf(draft, { code: feature.code, version: feature.version }), [draft, feature.code, feature.version]);
  const local: string[] = [];
  if (draft.noUi) {
    if (draft.reason.trim() === '') local.push(t.needReason);
  } else {
    draft.screens.forEach((s, i) => {
      if (s.name.trim() === '') local.push(t.needName(i + 1));
      if (s.purpose.trim() === '') local.push(t.needPurpose(i + 1));
    });
    if (draft.flow.some((f) => !f.from || !f.to || f.trigger.trim() === '')) local.push(t.needTrigger);
  }
  const checked = useMemo(() => checkSpec(spec, steps.length, components), [spec, steps.length, components]);
  const problems = local.length > 0 ? local : checked.problems;
  const ready = problems.length === 0 && checked.missing.length === 0;

  const patch = (key: string, p: Partial<DraftScreen>) =>
    setDraft((d) => ({ ...d, screens: d.screens.map((s) => (s.key === key ? { ...s, ...p } : s)) }));
  const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const sections = sectionsOf(spec);
      const links = [{ type: 'based_on', target: { code: feature.code, version: feature.version } }];
      const made = existing
        ? await command.mutateAsync({
            command: 'record_version.create',
            data: { record_id: existing.recordId, title: existing.title, sections, spec, links, change_note: note.trim() || 'Screens pasted from Claude Design.' },
          })
        : await command.mutateAsync({
            command: 'record.create',
            data: { type: 'screen_design', domain: feature.domain, title: `Screens of ${feature.title}`, sections, spec, links },
          });
      const r = made.result as { code?: string; versionId?: string };
      // The person's explicit click is the approval; the server checks it again.
      await command.mutateAsync({ command: 'record_version.approve', entityId: r.versionId ?? '', data: {} });
      announce(t.saved);
      void navigate({ to: '/p/$projectId/records/$code', params: { projectId, code: r.code ?? '' } });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const stateLabel = { empty: t.stateEmpty, loading: t.stateLoading, error: t.stateError, data: t.stateData };
  const screenOptions = draft.screens.map((s, i) => ({ key: s.key, label: s.name.trim() || t.screenN(i + 1) }));

  return (
    <div data-paste-screens className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-fg">{t.title}</h3>
        <p className="max-w-prose text-sm text-fg-2">{t.intro}</p>
      </div>
      <Checkbox checked={draft.noUi} onChange={(v) => setDraft((d) => ({ ...d, noUi: v }))} label={t.noUi} />
      {draft.noUi ? (
        <Field label={t.noUiReason}>
          {(p) => <TextArea {...p} rows={3} value={draft.reason} onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))} />}
        </Field>
      ) : (
        <>
          <section className="flex flex-col gap-8">
            <h4 className="text-sm font-semibold text-fg">{t.screensHeading}</h4>
            {draft.screens.map((s, i) => (
              <div key={s.key} data-paste-screen={i + 1} className="flex flex-col gap-4 border-t border-edge-subtle pt-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-fg-2">
                    {t.screenN(i + 1)}
                    {s.name.trim() ? <span className="ml-2 font-mono text-xs text-fg-3">{kebab(s.name)}</span> : null}
                  </span>
                  {draft.screens.length > 1 ? (
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          screens: d.screens.filter((x) => x.key !== s.key),
                          flow: d.flow.filter((f) => f.from !== s.key && f.to !== s.key),
                        }))
                      }
                    >
                      {t.removeScreen}
                    </Button>
                  ) : null}
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field label={t.name}>{(p) => <TextInput {...p} value={s.name} onChange={(e) => patch(s.key, { name: e.target.value })} />}</Field>
                  <Field label={t.purpose}>{(p) => <TextInput {...p} value={s.purpose} onChange={(e) => patch(s.key, { purpose: e.target.value })} />}</Field>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <fieldset className="flex flex-col gap-1.5">
                    <legend className="mb-1 text-sm font-medium text-fg">{t.steps}</legend>
                    {steps.length === 0 ? <p className="text-sm text-fg-3">{t.stepsNone}</p> : null}
                    {steps.map((st) => (
                      <Checkbox
                        key={st.n}
                        checked={s.steps.includes(st.n)}
                        onChange={(on) => patch(s.key, { steps: toggle(s.steps, st.n, on) })}
                        label={
                          <span className="text-sm">
                            {st.n}. {st.title}
                          </span>
                        }
                      />
                    ))}
                  </fieldset>
                  <fieldset className="flex flex-col gap-1.5">
                    <legend className="mb-1 text-sm font-medium text-fg">{t.components}</legend>
                    {components.length === 0 ? <p className="text-sm text-fg-3">{t.componentsNone}</p> : null}
                    {components.map((c) => (
                      <Checkbox
                        key={c}
                        checked={s.components.includes(c)}
                        onChange={(on) => patch(s.key, { components: toggle(s.components, c, on) })}
                        label={<span className="text-sm">{c}</span>}
                      />
                    ))}
                  </fieldset>
                </div>
                <div className="grid grid-cols-1 gap-x-4 gap-y-6 lg:grid-cols-2">
                  {STATE_KEYS.map((k) => (
                    <div key={k} className="flex flex-col gap-2">
                      <Field label={stateLabel[k]}>
                        {(p) => (
                          <TextArea
                            {...p}
                            rows={5}
                            className="font-mono text-sm"
                            spellCheck={false}
                            value={s.states[k]}
                            onChange={(e) => patch(s.key, { states: { ...s.states, [k]: e.target.value } })}
                          />
                        )}
                      </Field>
                      {s.states[k].trim() !== '' ? (
                        <SandboxedPreview html={s.states[k]} title={t.previewOf(s.name.trim() || t.screenN(i + 1), stateLabel[k])} height={200} />
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div>
              <Button
                size="sm"
                onClick={() => {
                  setDraft((d) => ({ ...d, screens: [...d.screens, emptyScreen(`n${counter}`)] }));
                  setCounter((n) => n + 1);
                }}
              >
                {t.addScreen}
              </Button>
            </div>
          </section>
          <section className="flex flex-col gap-3">
            <h4 className="text-sm font-semibold text-fg">{t.flowHeading}</h4>
            <p className="text-sm text-fg-2">{t.flowHint}</p>
            {draft.flow.map((f, i) => (
              <div key={i} data-paste-transition={i + 1} className="grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_1fr_2fr_8rem_auto]">
                <Field label={t.from}>
                  {(p) => (
                    <Select {...p} value={f.from} onChange={(e) => setDraft((d) => ({ ...d, flow: d.flow.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)) }))}>
                      <option value="">{t.pick}</option>
                      {screenOptions.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={t.to}>
                  {(p) => (
                    <Select {...p} value={f.to} onChange={(e) => setDraft((d) => ({ ...d, flow: d.flow.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)) }))}>
                      <option value="">{t.pick}</option>
                      {screenOptions.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={t.trigger}>
                  {(p) => <TextInput {...p} value={f.trigger} onChange={(e) => setDraft((d) => ({ ...d, flow: d.flow.map((x, j) => (j === i ? { ...x, trigger: e.target.value } : x)) }))} />}
                </Field>
                <Field label={t.stepOptional}>
                  {(p) => (
                    <Select {...p} value={f.step} onChange={(e) => setDraft((d) => ({ ...d, flow: d.flow.map((x, j) => (j === i ? { ...x, step: e.target.value } : x)) }))}>
                      <option value="">{t.noStep}</option>
                      {steps.map((st) => (
                        <option key={st.n} value={st.n}>
                          {st.n}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Button size="sm" variant="quiet" onClick={() => setDraft((d) => ({ ...d, flow: d.flow.filter((_, j) => j !== i) }))}>
                  {t.removeTransition}
                </Button>
              </div>
            ))}
            <div>
              <Button size="sm" onClick={() => setDraft((d) => ({ ...d, flow: [...d.flow, { from: '', to: '', trigger: '', step: '' }] }))}>
                {t.addTransition}
              </Button>
            </div>
          </section>
        </>
      )}
      {existing ? (
        <Field label={t.changeNote} optional>
          {(p) => <TextInput {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      ) : null}
      {checked.missing.length > 0 ? (
        <Notice
          tone="danger"
          role="status"
          title={t.missingTitle(checked.missing.join(', '))}
          action={
            <Link to="/p/$projectId/design-system" params={{ projectId }} className="font-medium text-accent-text hover:underline">
              {t.proposeAdding}
            </Link>
          }
        />
      ) : null}
      {problems.length > 0 ? (
        <div data-paste-problems role="status" className="flex flex-col gap-1 text-sm">
          <p className="font-medium text-fg">{t.problemsTitle}</p>
          <ul className="flex list-disc flex-col gap-0.5 pl-5 text-fg-2">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? <ErrorNotice error={error} /> : null}
      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={!ready} pending={busy} pendingLabel={t.saving} onClick={() => void save()} data-save-screens>
          {t.save}
        </Button>
        <Button variant="quiet" onClick={onClose} disabled={busy}>
          {t.cancel}
        </Button>
      </div>
    </div>
  );
}
