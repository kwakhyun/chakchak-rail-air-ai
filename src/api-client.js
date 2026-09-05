// @ts-check
/** Only the latest request may update a view, including its error/loading state. */
export function createLatestRequest() {
  let sequence = 0;
  /** @type {AbortController | undefined} */
  let controller;
  return {
    start() {
      controller?.abort();
      controller = new AbortController();
      const id = ++sequence;
      return { signal: controller.signal, isCurrent: () => id === sequence };
    },
    cancel() { sequence++; controller?.abort(); }
  };
}
