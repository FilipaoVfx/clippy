/**
 * PasttyBus: a tiny app-level event bus.
 *
 * app.js stays the source of truth. It announces confirmed session and
 * transfer facts here as normalized events; the visual layer (js/visual/)
 * listens. Nothing secret goes through it: no codes, tokens, ids from the
 * server or user content (docs/visual-engine.md lists the contract).
 *
 * The visual engine loads late (after the page is usable), so the bus keeps a
 * short history it can replay to catch up. That is the only state it holds.
 */
(() => {
  const HISTORY_LIMIT = 64;
  const listeners = new Map();
  const history = [];

  function on(name, fn) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
    return () => listeners.get(name)?.delete(fn);
  }

  function emit(name, payload = {}) {
    const event = Object.freeze({ ...payload });
    history.push([name, event]);
    if (history.length > HISTORY_LIMIT) history.shift();
    listeners.get(name)?.forEach((fn) => {
      // A broken listener must never break the app that emitted the event.
      try { fn(event); } catch (err) { console.error('[PasttyBus]', name, err); }
    });
  }

  function listenerCount() {
    let total = 0;
    listeners.forEach((set) => { total += set.size; });
    return total;
  }

  window.PasttyBus = Object.freeze({
    on,
    emit,
    history: () => history.slice(),
    listenerCount,
  });
})();
