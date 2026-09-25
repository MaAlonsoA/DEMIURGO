// The browser tab says where the person is and how much waits for them (DESIGN.md §2.3, R34):
// "(3) Needs you · DEVMIURGO · DEMIURGO". Pages set their part with usePageTitle (components/Page);
// the project shell sets the count.

let count = 0;

function render(): void {
  if (typeof document === 'undefined') return;
  const page = document.documentElement.dataset.pageTitle ?? '';
  const base = page ? `${page} · DEMIURGO` : 'DEMIURGO';
  document.title = count > 0 ? `(${count}) ${base}` : base;
}

if (typeof window !== 'undefined') window.addEventListener('dm:title', render);

export function setTitleCount(n: number): void {
  if (n === count) return;
  count = n;
  render();
}
