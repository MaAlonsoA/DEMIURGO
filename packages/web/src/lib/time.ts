// Dates in few words: "2 min ago", "Thu 18:52", "24 Sep".

const DAY = 86_400_000;

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return shortDate(iso);
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function dayTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (now - d.getTime() < 6 * DAY) return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${time}`;
  return `${shortDate(iso)} ${time}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Duration as m:ss (or h:mm:ss). */
export function duration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function between(start: string | null | undefined, end: string | null | undefined, now = Date.now()): string {
  if (!start) return '';
  const a = new Date(start).getTime();
  const b = end ? new Date(end).getTime() : now;
  return duration(b - a);
}
