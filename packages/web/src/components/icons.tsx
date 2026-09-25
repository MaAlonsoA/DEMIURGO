// The icon set of the web (DESIGN.md §6.6): one 24-unit grid, 1.75 stroke, round caps and joins,
// drawn with currentColor so an icon takes the tone of its text. Icons are decorative by default
// (aria-hidden): the text next to them carries the meaning. Pass `label` only when an icon stands
// alone, and then prefer an IconButton, which names the control instead.

import type { ReactNode, SVGProps } from 'react';

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  /** Size in CSS pixels (width and height). */
  size?: number;
  /** Accessible name, only for an icon that carries meaning on its own. */
  label?: string;
};

function make(name: string, body: ReactNode, filled = false) {
  function Icon({ size = 16, label, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={filled ? 'currentColor' : 'none'}
        stroke={filled ? 'none' : 'currentColor'}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
        {...rest}
      >
        {body}
      </svg>
    );
  }
  Icon.displayName = `Icon${name}`;
  return Icon;
}

// Navigation.
export const InboxIcon = make(
  'Inbox',
  <>
    <path d="M3 13h5l1.5 2.5h5L16 13h5" />
    <path d="M5.5 5h13L21 13v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z" />
  </>,
);
export const ThreadsIcon = make(
  'Threads',
  <>
    <path d="M4 4.5h11a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z" />
    <path d="M19 9h1a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-1V21l-4-3.5h-4" />
  </>,
);
export const ProductIcon = make(
  'Product',
  <>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </>,
);
export const ActivityIcon = make('Activity', <path d="M3 12h4l3-8 4 16 3-8h4" />);
export const KnowledgeIcon = make(
  'Knowledge',
  <>
    <circle cx="12" cy="5" r="2.5" />
    <circle cx="5" cy="18" r="2.5" />
    <circle cx="19" cy="18" r="2.5" />
    <path d="M10.8 7.2 6.2 15.8M13.2 7.2l4.6 8.6M7.5 18h9" />
  </>,
);
export const SourcesIcon = make(
  'Sources',
  <>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h6" />
  </>,
);
export const SettingsIcon = make(
  'Settings',
  <>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </>,
);
export const KeyIcon = make(
  'Key',
  <>
    <circle cx="8" cy="15.5" r="4.5" />
    <path d="M11.2 12.3 20 3.5M16.5 7l2.5 2.5M14.2 9.3l2 2" />
  </>,
);
export const CpuIcon = make(
  'Cpu',
  <>
    <rect x="6" y="6" width="12" height="12" rx="2" />
    <rect x="9.5" y="9.5" width="5" height="5" rx="0.5" />
    <path d="M9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3" />
  </>,
);
export const FolderIcon = make(
  'Folder',
  <path d="M3 6.5a1.5 1.5 0 0 1 1.5-1.5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />,
);
export const MenuIcon = make('Menu', <path d="M4 7h16M4 12h16M4 17h16" />);
export const PanelRightIcon = make(
  'PanelRight',
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M15 4v16" />
  </>,
);
export const PanelLeftIcon = make(
  'PanelLeft',
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </>,
);
export const LogOutIcon = make('LogOut', <path d="M9 20H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4M16 16l4-4-4-4M20 12H9.5" />);
export const DatabaseIcon = make(
  'Database',
  <>
    <ellipse cx="12" cy="6" rx="8" ry="3" />
    <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
  </>,
);

// Actions.
export const SearchIcon = make(
  'Search',
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </>,
);
export const PlusIcon = make('Plus', <path d="M12 5v14M5 12h14" />);
export const CloseIcon = make('Close', <path d="M6 6l12 12M18 6 6 18" />);
export const CheckIcon = make('Check', <path d="m5 12.5 4.5 4.5L19 7.5" />);
export const ChevronDownIcon = make('ChevronDown', <path d="m6 9 6 6 6-6" />);
export const ChevronUpIcon = make('ChevronUp', <path d="m6 15 6-6 6 6" />);
export const ChevronLeftIcon = make('ChevronLeft', <path d="m15 6-6 6 6 6" />);
export const ChevronRightIcon = make('ChevronRight', <path d="m9 6 6 6-6 6" />);
export const ChevronsUpDownIcon = make('ChevronsUpDown', <path d="m8 9 4-4 4 4M8 15l4 4 4-4" />);
export const ArrowRightIcon = make('ArrowRight', <path d="M5 12h14M13 6l6 6-6 6" />);
export const ArrowLeftIcon = make('ArrowLeft', <path d="M19 12H5M11 6l-6 6 6 6" />);
export const ArrowUpRightIcon = make('ArrowUpRight', <path d="M7 17 17 7M8 7h9v9" />);
export const ExternalIcon = make(
  'External',
  <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
);
export const CopyIcon = make(
  'Copy',
  <>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </>,
);
export const PencilIcon = make('Pencil', <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />);
export const TrashIcon = make('Trash', <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />);
export const ArchiveIcon = make(
  'Archive',
  <>
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" />
  </>,
);
export const FlagIcon = make('Flag', <path d="M5 21V4M5 4h12l-2.5 4L17 12H5" />);
export const FilterIcon = make('Filter', <path d="M4 5h16l-6 7.5V19l-4 2v-8.5z" />);
export const MoreIcon = make(
  'More',
  <>
    <circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </>,
);
export const PlayIcon = make('Play', <path d="M8 5.5v13l10.5-6.5z" />);
export const StopIcon = make('Stop', <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />);
export const RetryIcon = make('Retry', <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5M3.5 3.5v5h5" />);
export const RefreshIcon = make(
  'Refresh',
  <path d="M20 11a8 8 0 0 0-14.5-4.5L3.5 8.5M3.5 3.5v5h5M4 13a8 8 0 0 0 14.5 4.5l2-2M20.5 20.5v-5h-5" />,
);
export const SendIcon = make('Send', <path d="M4 12 20 4l-5 16-3.5-6.5zM11.5 13.5 20 4" />);
export const EnterIcon = make('Enter', <path d="M20 5v7a3 3 0 0 1-3 3H5M9 11l-4 4 4 4" />);
export const WandIcon = make('Wand', <path d="M4 20 15 9M13 7l4 4M17 3v2M21 7h-2M19.5 4.5l-1 1" />);
export const DeeperIcon = make('Deeper', <path d="M4 4v7a3 3 0 0 0 3 3h13M16 10l4 4-4 4" />);
export const ForkIcon = make(
  'Fork',
  <>
    <circle cx="6" cy="5" r="2" />
    <circle cx="18" cy="5" r="2" />
    <circle cx="12" cy="19" r="2" />
    <path d="M6 7v1.5a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7M12 11.5V17" />
  </>,
);
export const LinkIcon = make(
  'Link',
  <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
);
export const EyeIcon = make(
  'Eye',
  <>
    <path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
export const ExpandIcon = make('Expand', <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />);
export const GripIcon = make(
  'Grip',
  <>
    {[7, 12, 17].map((y) => (
      <g key={y}>
        <circle cx="9" cy={y} r="1.2" fill="currentColor" stroke="none" />
        <circle cx="15" cy={y} r="1.2" fill="currentColor" stroke="none" />
      </g>
    ))}
  </>,
);

// Status and certainty (DESIGN.md §5): the shape carries the meaning, the tone only reinforces it.
export const CheckCircleIcon = make(
  'CheckCircle',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12.5 2.5 2.5 4.5-5" />
  </>,
);
export const XCircleIcon = make(
  'XCircle',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m9.5 9.5 5 5M14.5 9.5l-5 5" />
  </>,
);
export const AlertTriangleIcon = make('AlertTriangle', <path d="M12 4 21.5 20h-19zM12 10v4.5M12 17.3v.2" />);
export const AlertCircleIcon = make(
  'AlertCircle',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V13M12 16.3v.2" />
  </>,
);
export const InfoIcon = make(
  'Info',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.8v.2" />
  </>,
);
export const HelpIcon = make(
  'Help',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.3M12 17v.2" />
  </>,
);
export const CircleIcon = make('Circle', <circle cx="12" cy="12" r="8" />);
export const CircleDashedIcon = make('CircleDashed', <circle cx="12" cy="12" r="8" strokeDasharray="3.2 3.2" />);
export const CircleDotIcon = make(
  'CircleDot',
  <>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
  </>,
);
export const CircleHalfIcon = make(
  'CircleHalf',
  <>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />
  </>,
);
export const SparklesIcon = make(
  'Sparkles',
  <>
    <path d="m11 3 1.8 4.9L18 9.7l-5.2 1.8L11 16.5l-1.8-5L4 9.7l5.2-1.8z" />
    <path d="m18.5 14.5.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
  </>,
);
export const ClockIcon = make(
  'Clock',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>,
);
export const HourglassIcon = make('Hourglass', <path d="M6 3h12M6 21h12M7 3c0 4 5 5 5 9s-5 5-5 9M17 3c0 4-5 5-5 9s5 5 5 9" />);
export const ReplacedIcon = make(
  'Replaced',
  <>
    <rect x="3.5" y="7.5" width="10" height="13" rx="1.5" strokeDasharray="2.6 2.6" />
    <rect x="10.5" y="3.5" width="10" height="13" rx="1.5" />
  </>,
);
export const MinusCircleIcon = make(
  'MinusCircle',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12h8" />
  </>,
);
export const PauseCircleIcon = make(
  'PauseCircle',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M10 9v6M14 9v6" />
  </>,
);
export const OfflineIcon = make(
  'Offline',
  <path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 6 -.8M5 12.5a10 10 0 0 1 3.4-2.2M19 12.5a10 10 0 0 0-4.6-2.6M2 8.8A15 15 0 0 1 6 6.3M22 8.8a15 15 0 0 0-9.5-3.8M12 20h.01" />,
);
export const LiveIcon = make(
  'Live',
  <>
    <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4" />
  </>,
);

// People and producers (who did something, DESIGN.md §5.4).
export const PersonIcon = make(
  'Person',
  <>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </>,
);
export const AgentIcon = make(
  'Agent',
  <>
    <rect x="4" y="8" width="16" height="11" rx="3" />
    <path d="M12 4.5V8M9 13v1.5M15 13v1.5" />
    <circle cx="12" cy="3.5" r="1" fill="currentColor" stroke="none" />
  </>,
);
export const AutomaticIcon = make('Automatic', <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />);

// Things of the product (record types, graph nodes, views).
export const FeatureIcon = make('Feature', <path d="M5 8.5h3.2a2.3 2.3 0 1 1 4.6 0H16v3.2a2.3 2.3 0 1 1 0 4.6V20H5z" />);
export const DecisionIcon = make('Decision', <path d="M12 21V3M6 5h10l2.5 2.5L16 10H6zM18 13H8l-2.5 2.5L8 18h10z" />);
export const BugIcon = make(
  'Bug',
  <path d="M8.5 9a3.5 3.5 0 0 1 7 0v5a3.5 3.5 0 0 1-7 0zM12 10v8M4 13h4.5M15.5 13H20M5 8l3.5 2M19 8l-3.5 2M5 19l3.5-2M19 19l-3.5-2M9.5 5.5 8 4M14.5 5.5 16 4" />,
);
export const RequirementIcon = make(
  'Requirement',
  <>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4V3h6v1M9 13l2 2 4-4" />
  </>,
);
export const GaugeIcon = make(
  'Gauge',
  <>
    <path d="M4 17a8 8 0 1 1 16 0" />
    <path d="m12 17 3.5-5" />
  </>,
);
export const ShieldIcon = make('Shield', <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />);
export const RocketIcon = make(
  'Rocket',
  <path d="M12 15 9 12M9 12c1.5-5 5-8 11-9-1 6-4 9.5-9 11zM9 12H5l2-3h4M12 15v4l3-2v-4" />,
);
export const IdeaIcon = make(
  'Idea',
  <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" />,
);
export const ChecksIcon = make(
  'Checks',
  <path d="m4 6 1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17M11 6.5h9M11 12.5h9M11 18.5h9" />,
);
export const VersionsIcon = make('Versions', <path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5" />);
export const HistoryIcon = make('History', <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5M3.5 3.5v5h5M12 8v4l3 2" />);
export const FilePlusIcon = make(
  'FilePlus',
  <>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M12 11v6M9 14h6" />
  </>,
);
export const PackageIcon = make('Package', <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5zM3.5 7.5 12 12l8.5-4.5M12 12v9" />);
export const DiffIcon = make(
  'Diff',
  <>
    <circle cx="6" cy="6" r="2" />
    <circle cx="18" cy="18" r="2" />
    <path d="M6 8v8a2 2 0 0 0 2 2h5M11 16l2 2-2 2M18 16V8a2 2 0 0 0-2-2h-5M13 8l-2-2 2-2" />
  </>,
);
export const TagIcon = make(
  'Tag',
  <>
    <path d="M3 12V4h8l10 10-8 8z" />
    <circle cx="7.5" cy="7.5" r="1.5" />
  </>,
);
export const MapIcon = make('Map', <path d="M9 4 3 6.5V20l6-2.5 6 2.5 6-2.5V4l-6 2.5zM9 4v13.5M15 6.5V20" />);
export const JourneyIcon = make(
  'Journey',
  <>
    <circle cx="6" cy="19" r="2" />
    <circle cx="18" cy="5" r="2" />
    <path d="M8 19h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16" />
  </>,
);
export const OriginsIcon = make(
  'Origins',
  <>
    <path d="M4 5h7M7.5 5v13h6M7.5 11.5h6" />
    <circle cx="16" cy="11.5" r="2" />
    <circle cx="16" cy="18" r="2" />
  </>,
);
export const OverviewIcon = make(
  'Overview',
  <>
    <rect x="3.5" y="4" width="17" height="16" rx="2" />
    <path d="M3.5 9h17M9 9v11" />
  </>,
);
export const TargetIcon = make(
  'Target',
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
  </>,
);
export const StagesIcon = make(
  'Stages',
  <>
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
    <path d="M7 12h3M14 12h3" />
  </>,
);
export const BookIcon = make(
  'Book',
  <path d="M3 5h6a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H3zM21 5h-6a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h7z" />,
);
export const HashIcon = make('Hash', <path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16" />);
export const QuoteIcon = make('Quote', <path d="M7 7h4v4c0 3-1.5 5-4 6M15 7h4v4c0 3-1.5 5-4 6M7 7v4h4M15 7v4h4" />);
