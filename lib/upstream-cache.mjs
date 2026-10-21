// Cache upstream resources, not individual traveller queries. The optional
// Cache API store also survives Worker isolate replacement within an edge region.
const statesByFetch = new WeakMap();
const MAX_ENTRIES = 32;

export async function resourceKey(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function cachedUpstream({ key, fetchImpl = fetch, storage, origin, ttlMs, failureTtlMs = 60_000, load, now = Date.now }) {
  let states = statesByFetch.get(fetchImpl);
  if (!states) { states = new Map(); statesByFetch.set(fetchImpl, states); }
  const scope = `${origin || "local"}:${key}`;
  let state = states.get(scope);
  if (!state) {
    for (const [id, old] of states) {
      if (states.size < MAX_ENTRIES) break;
      if (!old.pending) states.delete(id);
    }
    state = {};
    // Do not evict in-flight requests and accidentally start duplicate calls.
    if (states.size >= MAX_ENTRIES) throw new Error("UPSTREAM_BUSY");
    states.set(scope, state);
  }
  const result = (entry, hit) => {
    if (entry.error) throw Object.assign(new Error(entry.error.message), entry.error, { retryAt: new Date(entry.until).toISOString(), cacheHit: hit });
    return { value: entry.value, checkedAt: entry.checkedAt, cacheHit: hit, expiresAt: new Date(entry.until).toISOString() };
  };
  if (state.entry?.until > now()) return result(state.entry, true);
  if (state.pending) return result(await state.pending, true);
  const request = storage && origin ? new Request(new URL(`/__upstream-cache/v1/${key}`, origin)) : null;
  let fromStorage = false;
  state.pending = (async () => {
    if (request) {
      try {
        const stored = await storage.match(request);
        const entry = stored && await stored.json();
        if (entry?.until > now()) { state.entry = entry; fromStorage = true; return entry; }
      } catch { /* Cache outages must not prevent a bounded upstream request. */ }
    }
    let entry;
    try {
      const loaded = await load(state.entry?.value);
      entry = { value: loaded.value, checkedAt: new Date(now()).toISOString(), until: now() + Math.max(ttlMs, loaded.maxAgeMs || 0) };
    } catch (error) {
      const delay = Math.max(failureTtlMs, Number(error.retryAfterMs) || 0);
      entry = {
        until: now() + delay,
        error: { name: error.name, message: String(error.message || "UPSTREAM_ERROR").slice(0, 60), upstreamIssue: error.upstreamIssue || null }
      };
    }
    state.entry = entry;
    if (request) {
      try {
        await storage.put(request, new Response(JSON.stringify(entry), {
          headers: { "content-type": "application/json", "cache-control": `public, max-age=${Math.max(1, Math.ceil((entry.until - now()) / 1000))}` }
        }));
      } catch { /* Memory cache and single-flight protection remain available. */ }
    }
    return entry;
  })();
  try { return result(await state.pending, fromStorage); }
  finally { state.pending = null; }
}
