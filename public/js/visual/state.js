/**
 * Visual state reducer. Pure: no DOM, no Three.js, so it is unit-tested in
 * tests/client/visual-state.test.js and can replay the bus history.
 *
 * The protocol reports how many devices are connected, not which ones, so the
 * scene is reconciled to that count: one node for this device plus
 * `count - 1` peer slots. A peer that leaves keeps its slot, dimmed, until the
 * count grows again or the session ends; the rest of the network is untouched.
 */

export const MAX_DEVICES = 5;
export const MAX_PEERS = MAX_DEVICES - 1;

export const EVENTS = Object.freeze([
  'session:created',
  'session:joined',
  'session:closed',
  'session:expired',
  'device:connected',
  'device:disconnected',
  'device:reconnecting',
  'device:reconnected',
  'connection:online',
  'connection:offline',
  'connection:failed',
  'transfer:started',
  'transfer:received',
  'transfer:completed',
  'transfer:aborted',
]);

const CONTENT_TYPES = new Set(['text', 'image', 'video']);

export function initialState() {
  return {
    phase: 'idle', // idle | waiting | connected
    self: 'online', // online | reconnecting | offline
    peers: [], // [{ slot, status: 'connected' | 'disconnected' }]
    transfers: [], // ids of transfers in flight (bounded)
  };
}

function count(payload) {
  const n = Number(payload?.connectedDevices);
  if (!Number.isInteger(n) || n < 1 || n > MAX_DEVICES) return null;
  return n;
}

function contentType(payload) {
  return CONTENT_TYPES.has(payload?.contentType) ? payload.contentType : 'text';
}

function transferId(payload) {
  const id = payload?.transferId;
  return typeof id === 'string' && id.length > 0 && id.length <= 64 ? id : null;
}

export function activePeers(state) {
  return state.peers.filter((p) => p.status === 'connected');
}

/** Bring the peer slots in line with a confirmed device count. */
function reconcile(state, devices, effects) {
  const wanted = Math.min(devices - 1, MAX_PEERS);
  const peers = state.peers.map((p) => ({ ...p }));
  let active = peers.filter((p) => p.status === 'connected').length;

  // Grow: revive a dimmed slot first, so a returning device reuses its strand.
  while (active < wanted) {
    const dim = peers.find((p) => p.status === 'disconnected');
    if (dim) {
      dim.status = 'connected';
      effects.push({ type: 'connect', slot: dim.slot, revived: true });
    } else {
      const used = new Set(peers.map((p) => p.slot));
      let slot = 0;
      while (used.has(slot)) slot += 1;
      peers.push({ slot, status: 'connected' });
      effects.push({ type: 'connect', slot, revived: false });
    }
    active += 1;
  }

  // Shrink: dim the most recent connected peers; their slots stay put.
  for (let i = peers.length - 1; i >= 0 && active > wanted; i -= 1) {
    if (peers[i].status !== 'connected') continue;
    peers[i].status = 'disconnected';
    effects.push({ type: 'disconnect', slot: peers[i].slot });
    active -= 1;
  }

  peers.sort((a, b) => a.slot - b.slot);
  return { ...state, peers };
}

/**
 * @returns {{ state, effects } | null} null when the event changes nothing
 */
export function reduce(state, name, payload = {}) {
  const effects = [];

  switch (name) {
    case 'session:created': {
      const next = { ...initialState(), phase: 'waiting' };
      effects.push({ type: 'session' });
      return { state: next, effects };
    }

    case 'session:joined': {
      const n = count(payload) ?? 2;
      const base = { ...initialState(), phase: 'connected' };
      effects.push({ type: 'session' });
      return { state: reconcile(base, n, effects), effects };
    }

    case 'device:connected':
    case 'device:reconnected': {
      if (state.phase === 'idle' && name === 'device:connected') return null;
      const n = count(payload);
      if (n === null) return null;
      let next = { ...state, phase: 'connected', self: 'online' };
      if (name === 'device:reconnected' && state.self !== 'online') {
        effects.push({ type: 'self-online' });
      }
      next = reconcile(next, n, effects);
      return { state: next, effects };
    }

    case 'device:disconnected': {
      if (state.phase === 'idle') return null;
      const n = count(payload);
      if (n === null) return null;
      const next = reconcile(state, n, effects);
      return effects.length ? { state: next, effects } : null;
    }

    case 'device:reconnecting': {
      if (state.phase === 'idle' || state.self === 'reconnecting') return null;
      effects.push({ type: 'self-reconnecting' });
      return { state: { ...state, self: 'reconnecting', transfers: [] }, effects };
    }

    case 'connection:failed': {
      if (state.phase === 'idle' || state.self === 'offline') return null;
      effects.push({ type: 'self-offline' });
      return { state: { ...state, self: 'offline', transfers: [] }, effects };
    }

    case 'connection:online':
    case 'connection:offline':
      // Transport-level only; the session state changes on the events above.
      return null;

    case 'transfer:started':
    case 'transfer:received': {
      if (state.phase !== 'connected' || state.self !== 'online') return null;
      if (activePeers(state).length === 0) return null;
      const id = transferId(payload);
      if (id && state.transfers.includes(id)) return null; // duplicate event
      const direction = name === 'transfer:received' || payload.direction === 'in' ? 'in' : 'out';
      effects.push({ type: 'transfer', direction, contentType: contentType(payload) });
      const transfers = id ? [...state.transfers, id].slice(-16) : state.transfers;
      return { state: { ...state, transfers }, effects };
    }

    case 'transfer:completed': {
      if (state.phase !== 'connected') return null;
      const id = transferId(payload);
      const confirmation = payload.confirmation === 'complete' ? 'complete' : 'relayed';
      effects.push({
        type: 'complete',
        direction: payload.direction === 'in' ? 'in' : 'out',
        contentType: contentType(payload),
        confirmation,
      });
      const transfers = id ? state.transfers.filter((t) => t !== id) : state.transfers;
      return { state: { ...state, transfers }, effects };
    }

    case 'transfer:aborted': {
      const id = transferId(payload);
      if (id && !state.transfers.includes(id)) return null;
      effects.push({ type: 'abort' });
      const transfers = id ? state.transfers.filter((t) => t !== id) : [];
      return { state: { ...state, transfers }, effects };
    }

    case 'session:closed':
    case 'session:expired': {
      if (state.phase === 'idle') return null;
      effects.push({ type: 'reset' });
      return { state: initialState(), effects };
    }

    default:
      return null;
  }
}

/** Fold a bus history into a state, discarding effects (no replayed animations). */
export function replay(history) {
  let state = initialState();
  for (const [name, payload] of history) {
    const result = reduce(state, name, payload);
    if (result) state = result.state;
  }
  return state;
}
