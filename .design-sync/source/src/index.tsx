// DEMIURGO design system: the visual language agreed in the canvas «DEMIURGO · UX», as React components.
// Every component renders the `dm-*` classes of demiurgo.css; load that stylesheet (styles.css) once.
import * as React from 'react';

type Children = { children?: React.ReactNode };
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------------------------------------------------------------- icons

const PATHS = {
  feature: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 9h18"></path><path d="M9 9v11"></path>',
  decision: '<path d="M12 3l9 9-9 9-9-9z"></path>',
  'tech-decision': '<rect x="6" y="6" width="12" height="12" rx="2"></rect><path d="M10 10h4v4h-4z"></path><path d="M10 2v4M14 2v4M10 18v4M14 18v4M2 10h4M2 14h4M18 10h4M18 14h4"></path>',
  question: '<path d="M4 5h16v11H10l-4 4v-4H4z"></path>',
  check: '<circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="3.5"></circle>',
  idea: '<path d="M9 18h6"></path><path d="M10 21h4"></path><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2h5c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"></path>',
  thread: '<circle cx="6" cy="5" r="2"></circle><circle cx="6" cy="19" r="2"></circle><circle cx="18" cy="7" r="2"></circle><path d="M6 7v10"></path><path d="M18 9c0 5-12 3-12 8"></path>',
  journey: '<circle cx="6" cy="19" r="2"></circle><circle cx="18" cy="5" r="2"></circle><path d="M8 19h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16"></path>',
  'depends-on': '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"></path><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"></path>',
  conflict: '<path d="M12 3l9.5 17h-19z"></path><path d="M12 10v4"></path><path d="M12 17.5v.01"></path>',
  'needs-review': '<path d="M20 11a8 8 0 1 0-2.3 5.7"></path><path d="M20 4v7h-7"></path>',
  blocked: '<rect x="3" y="8" width="18" height="8" rx="1"></rect><path d="M8 8l-3 8M13 8l-3 8M18 8l-3 8"></path>',
  clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
  plug: '<path d="M9 3v5M15 3v5"></path><path d="M6 8h12v3a6 6 0 0 1-12 0z"></path><path d="M12 17v4"></path>',
  automatic: '<circle cx="12" cy="12" r="3"></circle><path d="M12 3v3M12 18v3M3 12h3M18 12h3"></path>',
  info: '<path d="M12 11v7"></path><circle cx="12" cy="6.5" r="1.4" fill="currentColor" stroke="none"></circle>',
  close: '<path d="M6 6l12 12M18 6L6 18"></path>'
} as const;
type IconName = keyof typeof PATHS;

function Svg({ name, size = 16, stroke = 1.8 }: { name: IconName; size?: number; stroke?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}

export type ItemType = 'feature' | 'decision' | 'tech-decision' | 'question' | 'check' | 'idea' | 'thread' | 'journey';
const TYPE_WORD: Record<ItemType, string> = {
  feature: 'Feature',
  decision: 'Decision',
  'tech-decision': 'Tech decision',
  question: 'Question',
  check: 'Check',
  idea: 'Idea',
  thread: 'Thread',
  journey: 'Journey'
};

export interface TypeIconProps {
  /** What the thing is. */
  type: ItemType;
  /** Pixel size; 14 on cards, 20 in references. */
  size?: number;
  /** Show the type word next to the icon, in the uppercase label style. */
  label?: boolean;
}
/** What something is: one stroke icon per type, always first on a card. */
export function TypeIcon({ type, size = 14, label = false }: TypeIconProps) {
  if (!label) return <Svg name={type} size={size} />;
  return (
    <span className="dm-card-type">
      <Svg name={type} size={size} />
      {TYPE_WORD[type].toUpperCase()}
    </span>
  );
}

// ---------------------------------------------------------------- marks

export type Certainty = 'confirmed' | 'assumed' | 'proposed' | 'open' | 'unknown';
const CERTAINTY_WORD: Record<Certainty, string> = {
  confirmed: 'Confirmed',
  assumed: 'Assumed',
  proposed: 'Proposed',
  open: 'Open',
  unknown: 'Unknown'
};

export interface CertaintyDotProps {
  /** How sure: confirmed (a person said yes), assumed (DEMIURGO concluded it), proposed (waiting for you), open (asked, not answered), unknown (not asked yet). */
  state: Certainty;
  /** 'sm' is the 10px dot used inside cards. */
  size?: 'md' | 'sm';
  /** Show the word next to the dot. Proposed reads in blue. */
  label?: boolean;
}
/** How sure DEMIURGO is about something: one dot and one word, on every element. */
export function CertaintyDot({ state, size = 'md', label = false }: CertaintyDotProps) {
  const mark =
    state === 'unknown' ? (
      <span className="dm-unknown" title="Unknown">?</span>
    ) : (
      <span className={cx('dm-dot', `dm-dot--${state}`, size === 'sm' && 'dm-dot--sm')} title={CERTAINTY_WORD[state]} />
    );
  if (!label) return mark;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
      {mark}
      <span className={state === 'proposed' ? 'dm-word-proposed' : undefined}>{CERTAINTY_WORD[state]}</span>
    </span>
  );
}

export type Status = 'parked' | 'dropped' | 'replaced' | 'out-of-date' | 'conflict';
const STATUS_WORD: Record<Status, string> = {
  parked: 'Parked',
  dropped: 'Dropped',
  replaced: 'Replaced',
  'out-of-date': 'Out of date',
  conflict: 'Conflict'
};

export interface StatusMarkProps {
  /** parked (kept for later), dropped (discarded), replaced (a newer version), out-of-date (its basis changed), conflict (two confirmed things clash). */
  status: Status;
  /** Conflict count. */
  count?: number;
  /** Show the word next to the mark. */
  label?: boolean;
}
/** Grey marks for things that are no longer active, and the rust Conflict mark. */
export function StatusMark({ status, count, label = false }: StatusMarkProps) {
  let mark: React.ReactNode;
  if (status === 'parked') {
    mark = (
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <rect x="2" y="1.5" width="3" height="9" rx="1" fill="var(--inactive)" />
        <rect x="7" y="1.5" width="3" height="9" rx="1" fill="var(--inactive)" />
      </svg>
    );
  } else if (status === 'dropped') {
    mark = (
      <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="6" cy="6" r="5" fill="none" stroke="var(--inactive)" strokeWidth="1.5" />
        <path d="M2.6 9.4l6.8-6.8" stroke="var(--inactive)" strokeWidth="1.5" />
      </svg>
    );
  } else if (status === 'replaced') {
    mark = (
      <svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="4.4" cy="7.2" r="3.4" fill="var(--inactive-soft)" />
        <circle cx="7.6" cy="4.8" r="3.4" fill="var(--surface)" stroke="var(--inactive)" strokeWidth="1.2" />
      </svg>
    );
  } else if (status === 'out-of-date') {
    mark = (
      <span style={{ display: 'inline-flex', color: 'var(--inactive)' }}>
        <Svg name="clock" size={14} stroke={2} />
      </span>
    );
  } else {
    mark = (
      <span className="dm-signal dm-signal--problem">
        <Svg name="conflict" size={14} stroke={2} />
        {count ?? ''}
      </span>
    );
  }
  return (
    <span title={STATUS_WORD[status]} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
      {mark}
      {label ? <span style={{ color: status === 'conflict' ? 'var(--problem)' : 'var(--muted)' }}>{STATUS_WORD[status]}</span> : null}
    </span>
  );
}

export type Stage = 'not-ready' | 'ready' | 'building' | 'verified' | 'in-doubt' | 'first-only';
const STAGE_WORD: Record<Stage, string> = {
  'not-ready': 'Not ready',
  ready: 'Ready to build',
  building: 'Building',
  verified: 'Verified',
  'in-doubt': 'In doubt',
  'first-only': 'Ready to build (built and verified come later)'
};
const STAGE_BARS: Record<Stage, [string, string, string]> = {
  'not-ready': ['', '', ''],
  ready: ['ink', '', ''],
  building: ['ink', 'build', ''],
  verified: ['ink', 'ink', 'ink'],
  'in-doubt': ['doubt', '', ''],
  'first-only': ['ink', 'later', 'later']
};

export interface StageBarsProps {
  /** How far a feature is: ready · built · verified. 'in-doubt' = it was ready and something holds it back; 'first-only' = only the first bar is active yet. */
  stage: Stage;
  /** Show the word next to the track. On cards, leave it off: the word shows on hover. */
  label?: boolean;
}
/** How far a feature is: a three-bar track with no text on the card. Features only. */
export function StageBars({ stage, label = false }: StageBarsProps) {
  const track = (
    <span className="dm-bars" title={STAGE_WORD[stage]} role="img" aria-label={STAGE_WORD[stage]}>
      {STAGE_BARS[stage].map((b, i) => (
        <span key={i} className={cx('dm-bar', b && `dm-bar--${b}`)} />
      ))}
    </span>
  );
  if (!label) return track;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
      {track}
      {STAGE_WORD[stage]}
    </span>
  );
}

export type Who = 'you' | 'demiurgo' | 'agent' | 'automatic';
const WHO_WORD: Record<Who, string> = { you: 'You', demiurgo: 'DEMIURGO', agent: 'Agent', automatic: 'Automatic' };

export interface WhoMarkProps {
  /** you (the only one who confirms), demiurgo (drafts, asks, proposes), agent (from outside, only proposes), automatic (a rule, the import, a test). */
  who: Who;
  /** Pixel size; 18 in story lines and card footers, 22 in references. */
  size?: number;
  /** An agent's name, or the model that did a DEMIURGO run; shown on hover. */
  name?: string;
  /** Show the word (or the name) next to the mark. */
  label?: boolean;
}
/** Who did something: You, DEMIURGO, an Agent or Automatic. */
export function WhoMark({ who, size = 18, name, label = false }: WhoMarkProps) {
  const cls = { you: 'dm-who--you', demiurgo: 'dm-who--d', agent: 'dm-who--agent', automatic: 'dm-who--auto' }[who];
  const inner =
    who === 'you' ? (
      <svg width={size - 8} height={size - 8} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="12" cy="8" r="4.5" />
        <path d="M3 22a9 9 0 0 1 18 0z" />
      </svg>
    ) : who === 'demiurgo' ? (
      'D'
    ) : who === 'agent' ? (
      <Svg name="plug" size={Math.round(size * 0.56)} stroke={2.5} />
    ) : (
      <Svg name="automatic" size={size - 8} stroke={2.5} />
    );
  const mark = (
    <span className={cx('dm-who', cls)} style={{ width: size, height: size }} title={name ? `${WHO_WORD[who]}: ${name}` : WHO_WORD[who]}>
      {inner}
    </span>
  );
  if (!label) return mark;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}>
      {mark}
      {name ?? WHO_WORD[who]}
    </span>
  );
}

// ---------------------------------------------------------------- signals

export interface NeedsYouProps {
  /** How many things wait for the person. Render nothing when it is zero. */
  count: number;
  /** Show the words "Needs you" before the counter, as in the header. */
  label?: boolean;
}
/** The one way DEMIURGO asks for attention: a blue counter, with the words Needs you in the header. */
export function NeedsYou({ count, label = false }: NeedsYouProps) {
  if (count <= 0) return null;
  const bubble = <span className="dm-needs">{count}</span>;
  if (!label) return bubble;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
      Needs you{bubble}
    </span>
  );
}

export interface WorkingProps extends Children {
  /** What is happening and for how long, e.g. "Drafting… · 0:42". */
  children?: React.ReactNode;
}
/** Someone is working on it right now: an amber dot with a halo and what is happening. */
export function Working({ children }: WorkingProps) {
  return (
    <span className="dm-working">
      <span className="dm-working-dot" />
      {children}
    </span>
  );
}

export type SignalKind = 'checks' | 'depends-on' | 'assumptions' | 'conflict' | 'needs-review' | 'blocked' | 'changed';
export interface SignalProps {
  /** checks (n/m passed), depends-on (n), assumptions (rests on n assumed answers), conflict (n), needs-review, blocked, changed (vN). */
  kind: SignalKind;
  /** The number or short text shown next to the icon, e.g. "2/3", 2, "v2". */
  value?: React.ReactNode;
}
/** A card signal: a small icon and a number. Show only what is not zero, at most four per card. */
export function Signal({ kind, value }: SignalProps) {
  const problem = kind === 'conflict' || kind === 'needs-review' || kind === 'blocked';
  const icon =
    kind === 'checks' ? (
      <Svg name="check" size={14} stroke={2} />
    ) : kind === 'depends-on' ? (
      <Svg name="depends-on" size={14} stroke={2} />
    ) : kind === 'assumptions' ? (
      <span className="dm-dot dm-dot--assumed dm-dot--sm" />
    ) : kind === 'changed' ? (
      <StatusMark status="replaced" />
    ) : (
      <Svg name={kind} size={14} stroke={2} />
    );
  const fallback = kind === 'needs-review' ? 'Needs review' : kind === 'blocked' ? 'Blocked' : '';
  return (
    <span className={cx('dm-signal', problem && 'dm-signal--problem')}>
      {icon}
      {value ?? fallback}
    </span>
  );
}

// ---------------------------------------------------------------- controls

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary: the one action that resolves what needs you (blue); secondary: the other choices; quiet: a light blue action inside a panel; text: the way out. */
  variant?: 'primary' | 'secondary' | 'quiet' | 'text';
}
/** Buttons say what happens. Blue is for the action that answers what needs you, one per view. */
export function Button({ variant = 'secondary', className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={cx('dm-btn', `dm-btn--${variant}`, className)} {...rest} />;
}

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Whether the chip is chosen. A pressed chip is ink. */
  pressed?: boolean;
}
/** A short choice, such as the reason for rejecting a proposal. */
export function Chip({ pressed = false, className, type = 'button', ...rest }: ChipProps) {
  return <button type={type} aria-pressed={pressed} className={cx('dm-chip', className)} {...rest} />;
}

export interface ChoiceOption {
  /** The answer, in a few words. */
  label: string;
  /** What choosing it changes, in one line. */
  effect: string;
  /** DEMIURGO's recommendation. Only one option carries it. */
  recommended?: boolean;
  /** Why it is recommended, one sentence. */
  why?: string;
}
export interface ChoiceProps {
  /** The options, two or three. */
  options: ChoiceOption[];
  /** The chosen option's label. */
  value?: string;
  /** Called with the chosen label. */
  onChange?: (label: string) => void;
}
/** Answering a question: each option says what it changes; DEMIURGO recommends one, the person picks. */
export function Choice({ options, value, onChange }: ChoiceProps) {
  return (
    <div role="radiogroup" aria-label="Your answer" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {options.map((o) => {
        const on = o.label === value;
        return (
          <div
            key={o.label}
            role="radio"
            aria-checked={on}
            tabIndex={0}
            onClick={() => onChange?.(o.label)}
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
              background: 'var(--surface)',
              border: on ? '2px solid var(--needs)' : '1px solid var(--line-strong)',
              borderRadius: 'var(--radius-card-md)',
              padding: on ? '11px 13px' : '12px 14px',
              cursor: 'pointer'
            }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                flexShrink: 0,
                marginTop: 2,
                boxSizing: 'border-box',
                borderRadius: '50%',
                border: on ? '5px solid var(--needs)' : '1.5px solid var(--line-strong)'
              }}
            />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                {o.label}
                {o.recommended ? <span className="dm-rec">Recommended</span> : null}
              </span>
              <span className="dm-text-small" style={{ color: 'var(--ink-3)' }}>
                {o.effect}
              </span>
              {o.recommended && o.why ? (
                <span className="dm-text-caption" style={{ color: 'var(--needs-strong)' }}>
                  {o.why}
                </span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export interface HeaderProps {
  /** The project name. */
  project: string;
  /** The section tabs, in order. */
  tabs: string[];
  /** The current tab. */
  current: string;
  /** How many things need the person. */
  needs?: number;
}
/** The app header: the product name, the project, the sections and Needs you on the right. */
export function Header({ project, tabs, current, needs = 0 }: HeaderProps) {
  return (
    <header
      style={{
        height: 56,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 24,
        padding: '0 24px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--line)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
        <span className="dm-text-wordmark">DEMIURGO</span>
        <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{project}</span>
        <nav aria-label="Sections" style={{ display: 'flex', gap: 4 }}>
          {tabs.map((t) => (
            <a
              key={t}
              href="#"
              aria-current={t === current ? 'page' : undefined}
              style={{
                fontWeight: t === current ? 600 : 500,
                color: t === current ? 'var(--ink)' : 'var(--ink-3)',
                background: t === current ? 'var(--line-soft)' : 'transparent',
                borderRadius: 'var(--radius-tab)',
                padding: '6px 12px',
                textDecoration: 'none',
                whiteSpace: 'nowrap'
              }}
            >
              {t}
            </a>
          ))}
        </nav>
      </div>
      <NeedsYou count={needs} label />
    </header>
  );
}

// ---------------------------------------------------------------- cards

export interface FeatureCardProps {
  /** How sure. */
  state: Certainty;
  /** How far. */
  stage: Stage;
  /** Plain words; no codes on a card. */
  title: string;
  /** One line that says what it does. */
  line: string;
  /** Who touched it last. */
  who: Who;
  /** When, e.g. "Thursday" or "18:52". */
  when: string;
  /** How many things about it need the person. */
  needs?: number;
  /** At most four Signal elements, only the ones that are not zero. */
  signals?: React.ReactNode;
  /** Selected: 2px blue border with a ring. */
  selected?: boolean;
  /** Card width in px. */
  width?: number;
}
/** A feature on the map or the overview: the six-zone card template (what, how sure and how far, Needs you, title and line, who and when, signals). */
export function FeatureCard({ state, stage, title, line, who, when, needs = 0, signals, selected = false, width = 300 }: FeatureCardProps) {
  return (
    <div className={cx('dm-card', selected && 'dm-selected', state === 'open' && 'dm-dashed')} style={{ width, height: 146 }}>
      {needs > 0 ? (
        <span className="dm-card-needs">
          <NeedsYou count={needs} />
        </span>
      ) : null}
      <span className="dm-card-type">
        <Svg name="feature" size={14} />
        FEATURE<span className="dm-sep">·</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, letterSpacing: 0, color: state === 'proposed' ? 'var(--needs-strong)' : 'var(--ink)' }}>
          <CertaintyDot state={state} size="sm" />
          {CERTAINTY_WORD[state]}
        </span>
        <StageBars stage={stage} />
      </span>
      <strong className="dm-card-title">{title}</strong>
      <span className="dm-card-line">{line}</span>
      <span className="dm-card-foot">
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <WhoMark who={who} size={18} />
          {WHO_WORD[who]} · {when}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{signals}</span>
      </span>
    </div>
  );
}

export interface NodeProps {
  /** What it is. */
  type: ItemType;
  /** How sure; 'parked' shows the Parked mark instead of a dot. */
  state: Certainty | 'parked';
  /** Plain words. */
  title: string;
  /** Something at the end of the row: StageBars for a feature, NeedsYou, a Signal. */
  trailing?: React.ReactNode;
  /** Selected: 2px blue border with a ring. */
  selected?: boolean;
}
/** The small size of the card template: one 44px row for trees, lists and the small things on the map. */
export function Node({ type, state, title, trailing, selected = false }: NodeProps) {
  const faded = state === 'parked';
  return (
    <div className={cx('dm-node', selected && 'dm-selected', state === 'open' && 'dm-dashed', faded && 'dm-faded')}>
      <Svg name={type} size={14} />
      {faded ? <StatusMark status="parked" /> : <CertaintyDot state={state} size="sm" />}
      <span style={{ fontSize: 14, fontWeight: state === 'proposed' || state === 'confirmed' ? 600 : 400, flexGrow: 1 }}>{title}</span>
      {trailing}
    </div>
  );
}

export interface PanelProps extends Children {
  /** Floating: the peek that appears beside a pointed card, with a float shadow. */
  floating?: boolean;
  /** Width in px. */
  width?: number;
}
/** The detail size of the card template: a panel for the selected thing, or a floating peek. */
export function Panel({ children, floating = false, width = 330 }: PanelProps) {
  return (
    <div className={cx('dm-panel', floating && 'dm-float')} style={{ width }}>
      {children}
    </div>
  );
}

export interface TooltipProps extends Children {}
/** The dark tooltip shown when pointing at a single mark. */
export function Tooltip({ children }: TooltipProps) {
  return (
    <span role="tooltip" style={{ display: 'inline-block', background: 'var(--ink)', color: 'var(--surface)', fontSize: 12, borderRadius: 'var(--radius-tab)', padding: '5px 9px' }}>
      {children}
    </span>
  );
}

export interface LegendEntry {
  /** The mark, e.g. <CertaintyDot state="proposed" size="sm" />. */
  mark: React.ReactNode;
  /** Its word. */
  word: string;
  /** One line that explains it; shown for new marks. */
  desc?: string;
}
export interface LegendProps {
  /** Open shows the panel; closed shows only the ⓘ button. */
  open?: boolean;
  /** Marks that are new on this screen, explained. */
  newMarks?: LegendEntry[];
  /** Marks the person already knows, compact. */
  known?: LegendEntry[];
}
const legendSlot = (m: React.ReactNode) => (
  <span style={{ width: 34, height: 20, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{m}</span>
);

/** A legend of the marks on the current screen, bottom-left, that folds into an ⓘ and announces new marks. */
export function Legend({ open = true, newMarks = [], known = [] }: LegendProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
      {open ? (
        <section
          aria-label="What the marks mean"
          style={{
            width: 312,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            background: 'var(--surface)',
            border: '1px solid var(--line-strong)',
            borderRadius: 'var(--radius-card)',
            padding: '14px 16px',
            boxShadow: 'var(--shadow-float)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <strong style={{ fontSize: 13 }}>What the marks mean</strong>
            <span className="dm-text-caption" style={{ color: 'var(--muted)' }}>
              Got it
            </span>
          </div>
          {newMarks.length ? <span className="dm-label">New on this screen</span> : null}
          {newMarks.map((e) => (
            <div key={e.word} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: 6 }}>
              {legendSlot(e.mark)}
              <span>
                <strong style={{ display: 'block', fontSize: 13 }}>{e.word}</strong>
                <span className="dm-text-caption" style={{ color: 'var(--ink-3)' }}>
                  {e.desc}
                </span>
              </span>
            </div>
          ))}
          {known.length ? (
            <span className="dm-label" style={{ paddingTop: 6 }}>
              You know these
            </span>
          ) : null}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px', fontSize: 13 }}>
            {known.map((e) => (
              <span key={e.word} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 4px' }}>
                {legendSlot(e.mark)}
                {e.word}
              </span>
            ))}
          </div>
        </section>
      ) : null}
      <button
        type="button"
        aria-label="What the marks mean"
        style={{
          font: 'inherit',
          height: 34,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'var(--surface)',
          border: '1px solid var(--line-strong)',
          borderRadius: 'var(--radius-pill)',
          padding: newMarks.length && !open ? '0 12px 0 9px' : '0 9px',
          boxShadow: 'var(--shadow-raised)',
          color: 'var(--ink)'
        }}
      >
        <Svg name="info" size={16} stroke={2.4} />
        {newMarks.length && !open ? <span className="dm-text-caption" style={{ fontWeight: 600 }}>{newMarks.length} new marks</span> : null}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- patterns

export interface ReadinessItem {
  /** The reason, exactly as the back end gives it. */
  text: string;
  /** reason (blocks), warning (never blocks), assumed (an assumed answer waiting to be confirmed). */
  kind?: 'reason' | 'warning' | 'assumed';
  /** The certainty of the thing the reason is about; defaults to open. */
  state?: Certainty;
}
export interface ReadinessProps {
  /** What still stops it. Empty means ready. */
  items?: ReadinessItem[];
  /** What to do next once it is ready. */
  next?: string;
}
/** Before it can be built: what still stops a feature, in product words, until it reads Ready to build. */
export function Readiness({ items = [], next }: ReadinessProps) {
  return (
    <div className="dm-panel" style={{ width: 330 }}>
      <span className="dm-label">Before it can be built</span>
      {items.length === 0 ? (
        <>
          <StageBars stage="ready" label />
          {next ? (
            <span className="dm-text-small" style={{ color: 'var(--ink-3)' }}>
              {next}
            </span>
          ) : null}
        </>
      ) : (
        items.map((it) => (
          <span
            key={it.text}
            className="dm-text-small"
            style={{ display: 'flex', gap: 8, alignItems: 'baseline', color: it.kind === 'warning' ? 'var(--problem)' : it.kind === 'assumed' ? 'var(--ink-3)' : 'var(--ink)' }}
          >
            {it.kind === 'warning' ? <Svg name="conflict" size={14} stroke={2} /> : <CertaintyDot state={it.kind === 'assumed' ? 'assumed' : (it.state ?? 'open')} size="sm" />}
            <span>{it.text}</span>
          </span>
        ))
      )}
    </div>
  );
}

export interface ProposalProps {
  /** Who proposes. */
  author: 'demiurgo' | 'agent';
  /** The agent's name, e.g. "Claude Code". */
  authorName?: string;
  /** Where it sits in its batch, e.g. "2 of 4". */
  position?: string;
  /** What it is. */
  type: ItemType;
  /** What kind of change, e.g. "New check". */
  kindLabel: string;
  /** What it proposes, in plain words. */
  title: string;
  /** Why, in the author's own words. */
  why: string;
  /** A source it used; always shown as unverified. */
  source?: string;
  /** A note from DEMIURGO, e.g. when the proposal grows the feature beyond the idea. */
  note?: string;
  /** Out of date: what it relied on changed. It offers no Accept. */
  outOfDate?: string;
}
/** One proposal at a time, from DEMIURGO or an agent: what it changes, why in its own words, and Accept, Change or Reject. */
export function Proposal({ author, authorName, position, type, kindLabel, title, why, source, note, outOfDate }: ProposalProps) {
  if (outOfDate) {
    return (
      <div className="dm-panel" style={{ width: 360, background: 'var(--surface-soft)' }}>
        <StatusMark status="out-of-date" label />
        <strong style={{ fontSize: 15, color: 'var(--ink-3)' }}>{title}</strong>
        <span className="dm-text-small" style={{ color: 'var(--ink-3)' }}>
          {outOfDate}
        </span>
      </div>
    );
  }
  return (
    <div className="dm-panel" style={{ width: 520 }}>
      <span className="dm-text-caption" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)' }}>
        <WhoMark who={author} size={20} name={authorName} />
        <strong style={{ color: 'var(--ink)' }}>{authorName ?? WHO_WORD[author]}</strong> proposes{position ? ` · ${position}` : ''}
      </span>
      <span className="dm-card-type">
        <Svg name={type} size={14} />
        {kindLabel.toUpperCase()}
        <span className="dm-sep">·</span>
        <CertaintyDot state="proposed" size="sm" label />
      </span>
      <strong style={{ fontSize: 17, fontWeight: 600 }}>{title}</strong>
      <span style={{ fontSize: 14, color: 'var(--ink-2)' }}>
        “{why}”{source ? <span style={{ color: 'var(--muted)' }}> · {source}, unverified</span> : null}
      </span>
      {note ? (
        <span className="dm-text-small" style={{ background: 'var(--surface-soft)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', display: 'flex', gap: 8 }}>
          <WhoMark who="demiurgo" size={18} />
          {note}
        </span>
      ) : null}
      <div style={{ display: 'flex', gap: 10 }}>
        <Button variant="primary">Accept</Button>
        <Button>Change</Button>
        <Button>Reject</Button>
      </div>
    </div>
  );
}

export interface WhileAwayItem {
  /** When, e.g. "Thu 18:52". */
  time: string;
  /** Who did it; 'waited' draws the grey clock. */
  who: Who | 'waited';
  /** One line per thing. */
  text: React.ReactNode;
}
export interface WhileAwayProps {
  /** What happened since the last visit, one line per thing. */
  items: WhileAwayItem[];
}
/** What happened since your last visit, one line per thing, with who did it. */
export function WhileAway({ items }: WhileAwayProps) {
  return (
    <div className="dm-panel" style={{ width: 620 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 15 }}>While you were away</strong>
        <span className="dm-text-caption" style={{ fontWeight: 600, color: 'var(--needs-strong)' }}>
          Show everything
        </span>
      </div>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '70px 18px minmax(0, 1fr)', alignItems: 'center', gap: 10, fontSize: 13.5 }}>
          <span className="dm-text-caption" style={{ color: 'var(--inactive)' }}>
            {it.time}
          </span>
          {it.who === 'waited' ? <StatusMark status="out-of-date" /> : <WhoMark who={it.who} size={18} />}
          <span>{it.text}</span>
        </div>
      ))}
    </div>
  );
}

export interface CheckRowProps {
  /** What must be true, as a title. */
  title: string;
  /** The statement: when … then …. */
  statement: string;
  /** Who verifies it: automatic (a test) or you (by hand, once built). */
  verifiedBy: 'automatic' | 'you';
  /** The code, shown small, e.g. AC-INS-001-01. */
  code?: string;
  /** A verifiability warning; replaces the statement line in rust. */
  warning?: string;
}
/** A check (acceptance criterion): what must be true, how it is verified and by whom. */
export function CheckRow({ title, statement, verifiedBy, code, warning }: CheckRowProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '20px minmax(0, 1fr) auto', gap: 10, alignItems: 'start' }}>
      <span style={{ marginTop: 2 }}>
        <Svg name="check" size={16} />
      </span>
      <span>
        <strong style={{ fontSize: 14 }}>{title}</strong>
        <span className="dm-text-small" style={{ display: 'block', color: warning ? 'var(--problem)' : 'var(--ink-3)' }}>
          {warning ?? statement}
        </span>
        {code ? <span className="dm-code">{code}</span> : null}
      </span>
      <WhoMark who={verifiedBy === 'automatic' ? 'automatic' : 'you'} size={18} label />
    </div>
  );
}
