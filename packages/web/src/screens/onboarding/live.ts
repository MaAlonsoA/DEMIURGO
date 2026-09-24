// What this tab started: the Day 1 threads whose first reading shows live (canvas S4B) even when
// DEMIURGO is quicker than the page, and the messages it sent that DEMIURGO is expected to answer.
// Memory of the tab only: after a reload, the screens follow what the API says.

const liveThreads = new Set<string>();
const sentMessages = new Set<string>();

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
  sent(messageId: string): void {
    sentMessages.add(messageId);
  },
  expects(messageId: string | undefined): boolean {
    return !!messageId && sentMessages.has(messageId);
  },
};
