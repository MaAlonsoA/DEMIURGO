// What this tab started (DESIGN.md §3.9): the Day 1 threads whose first reading shows live even
// when DEMIURGO is quicker than the page. Where an answer stands comes from the message itself.
// Memory of the tab only: after a reload, the screens follow what the API says.

const liveThreads = new Set<string>();

export const live = {
  start(explorationId: string): void {
    liveThreads.add(explorationId);
  },
  isLive(explorationId: string): boolean {
    return liveThreads.has(explorationId);
  },
  end(explorationId: string): void {
    liveThreads.delete(explorationId);
  },
};
