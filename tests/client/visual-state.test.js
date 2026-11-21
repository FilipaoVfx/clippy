/**
 * Visual state reducer (public/js/visual/state.js) and quality profiles.
 * The reducer decides what the 3D scene shows, so these lock in the rules
 * from the visual spec: only confirmed facts, at most five devices, a peer
 * leaving touches only its own slot, no fake reconnection or delivery.
 */
import { describe, it, expect } from 'vitest';
import { initialState, reduce, replay, activePeers, MAX_PEERS } from '../../public/js/visual/state.js';
import { pickProfile, lowerProfile, FrameGovernor, PROFILES } from '../../public/js/visual/three/performance.js';

function run(events, state = initialState()) {
  const effects = [];
  for (const [name, payload] of events) {
    const r = reduce(state, name, payload);
    if (r) {
      state = r.state;
      effects.push(...r.effects);
    }
  }
  return { state, effects };
}

describe('visual state: sessions', () => {
  it('starts idle with no devices', () => {
    expect(initialState()).toMatchObject({ phase: 'idle', peers: [] });
  });

  it('session created -> waiting, no peers yet', () => {
    const { state, effects } = run([['session:created', { connectedDevices: 1 }]]);
    expect(state.phase).toBe('waiting');
    expect(state.peers).toEqual([]);
    expect(effects).toEqual([{ type: 'session' }]);
  });

  it('a confirmed device connection adds exactly one peer and grows its strand', () => {
    const { state, effects } = run([
      ['session:created', { connectedDevices: 1 }],
      ['device:connected', { connectedDevices: 2 }],
    ]);
    expect(state.phase).toBe('connected');
    expect(state.peers).toEqual([{ slot: 0, status: 'connected' }]);
    expect(effects.at(-1)).toEqual({ type: 'connect', slot: 0, revived: false });
  });

  it('joining builds count - 1 peers', () => {
    const { state } = run([['session:joined', { connectedDevices: 3 }]]);
    expect(activePeers(state).map((p) => p.slot)).toEqual([0, 1]);
  });

  it('ignores device events outside a session', () => {
    expect(reduce(initialState(), 'device:connected', { connectedDevices: 2 })).toBeNull();
    expect(reduce(initialState(), 'device:disconnected', { connectedDevices: 1 })).toBeNull();
  });

  it('rejects counts the protocol cannot produce', () => {
    const s = run([['session:created', {}]]).state;
    expect(reduce(s, 'device:connected', { connectedDevices: 6 })).toBeNull();
    expect(reduce(s, 'device:connected', { connectedDevices: 0 })).toBeNull();
    expect(reduce(s, 'device:connected', { connectedDevices: '2' })).not.toBeNull(); // numeric strings are fine
    expect(reduce(s, 'device:connected', { connectedDevices: 2.5 })).toBeNull();
  });

  it('caps the network at five devices (four peers)', () => {
    const { state } = run([
      ['session:created', {}],
      ...[2, 3, 4, 5].map((n) => ['device:connected', { connectedDevices: n }]),
    ]);
    expect(state.peers).toHaveLength(MAX_PEERS);
  });

  it('closing or expiring returns to idle', () => {
    for (const end of ['session:closed', 'session:expired']) {
      const { state, effects } = run([['session:joined', { connectedDevices: 2 }], [end, {}]]);
      expect(state).toEqual(initialState());
      expect(effects.at(-1)).toEqual({ type: 'reset' });
    }
  });
});

describe('visual state: disconnection and reconnection', () => {
  const three = [['session:created', {}], ['device:connected', { connectedDevices: 2 }], ['device:connected', { connectedDevices: 3 }]];

  it('one device leaving dims one slot and leaves the others alone', () => {
    const { state, effects } = run([...three, ['device:disconnected', { connectedDevices: 2 }]]);
    expect(state.peers).toEqual([{ slot: 0, status: 'connected' }, { slot: 1, status: 'disconnected' }]);
    expect(effects.at(-1)).toEqual({ type: 'disconnect', slot: 1 });
    expect(state.phase).toBe('connected');
  });

  it('a returning device revives the dimmed slot instead of adding one', () => {
    const { state, effects } = run([
      ...three,
      ['device:disconnected', { connectedDevices: 2 }],
      ['device:connected', { connectedDevices: 3 }],
    ]);
    expect(state.peers).toEqual([{ slot: 0, status: 'connected' }, { slot: 1, status: 'connected' }]);
    expect(effects.at(-1)).toEqual({ type: 'connect', slot: 1, revived: true });
  });

  it('a duplicate disconnect changes nothing', () => {
    const { state } = run([...three, ['device:disconnected', { connectedDevices: 2 }]]);
    expect(reduce(state, 'device:disconnected', { connectedDevices: 2 })).toBeNull();
  });

  it('reconnecting is shown, and only a confirmed resume restores it', () => {
    let { state } = run([...three, ['device:reconnecting', { attempt: 1 }]]);
    expect(state.self).toBe('reconnecting');
    expect(reduce(state, 'connection:online', {})).toBeNull(); // transport alone is not a resume
    const r = reduce(state, 'device:reconnected', { connectedDevices: 3 });
    expect(r.state.self).toBe('online');
    expect(r.effects[0]).toEqual({ type: 'self-online' });
    ({ state } = run([['device:reconnecting', {}], ['connection:failed', {}]], r.state));
    expect(state.self).toBe('offline');
  });
});

describe('visual state: transfers', () => {
  const connected = run([['session:joined', { connectedDevices: 2 }]]).state;

  it('outgoing and incoming transfers carry direction and kind', () => {
    const out = reduce(connected, 'transfer:started', { transferId: 't1', direction: 'out', contentType: 'image' });
    expect(out.effects).toEqual([{ type: 'transfer', direction: 'out', contentType: 'image' }]);
    const inn = reduce(connected, 'transfer:received', { transferId: 't2', contentType: 'text' });
    expect(inn.effects).toEqual([{ type: 'transfer', direction: 'in', contentType: 'text' }]);
  });

  it('the same transfer id never animates twice', () => {
    const first = reduce(connected, 'transfer:started', { transferId: 'dup', contentType: 'video' });
    expect(reduce(first.state, 'transfer:started', { transferId: 'dup', contentType: 'video' })).toBeNull();
  });

  it('no particles without a live peer or while reconnecting', () => {
    const waiting = run([['session:created', {}]]).state;
    expect(reduce(waiting, 'transfer:started', { contentType: 'text' })).toBeNull();
    const dropped = reduce(connected, 'device:reconnecting', {}).state;
    expect(reduce(dropped, 'transfer:started', { contentType: 'text' })).toBeNull();
  });

  it('a relayed send is not reported as a full delivery', () => {
    const r = reduce(connected, 'transfer:completed', { direction: 'out', contentType: 'text', confirmation: 'relayed' });
    expect(r.effects[0].confirmation).toBe('relayed');
    const v = reduce(connected, 'transfer:completed', { direction: 'out', contentType: 'video', confirmation: 'complete' });
    expect(v.effects[0].confirmation).toBe('complete');
  });

  it('unknown content types fall back to text, never to user data', () => {
    const r = reduce(connected, 'transfer:started', { contentType: '<script>' });
    expect(r.effects[0].contentType).toBe('text');
  });

  it('aborting an unknown transfer is ignored', () => {
    expect(reduce(connected, 'transfer:aborted', { transferId: 'nope' })).toBeNull();
  });
});

describe('visual state: replay', () => {
  it('rebuilds the same state from bus history, with no animations', () => {
    const history = [
      ['session:created', { connectedDevices: 1 }],
      ['device:connected', { connectedDevices: 2 }],
      ['device:connected', { connectedDevices: 3 }],
      ['device:disconnected', { connectedDevices: 2 }],
    ];
    expect(replay(history)).toEqual(run(history).state);
  });

  it('ignores events it does not know', () => {
    expect(reduce(initialState(), 'session:hijacked', {})).toBeNull();
  });
});

describe('quality profiles', () => {
  it('picks high on a big desktop, low on a small phone or Save-Data', () => {
    expect(pickProfile({ width: 1920, dpr: 2, cores: 8, memory: 8, coarse: false }).name).toBe('high');
    expect(pickProfile({ width: 390, dpr: 3, cores: 4, memory: 4, coarse: true }).name).toBe('low');
    expect(pickProfile({ width: 1920, cores: 16, memory: 16, saveData: true }).name).toBe('low');
  });

  it('steps down one level at a time and stops at low', () => {
    expect(lowerProfile(PROFILES.high)).toBe(PROFILES.medium);
    expect(lowerProfile(PROFILES.medium)).toBe(PROFILES.low);
    expect(lowerProfile(PROFILES.low)).toBeNull();
  });

  it('every profile keeps particles bounded', () => {
    for (const p of Object.values(PROFILES)) {
      expect(p.particles).toBeLessThanOrEqual(96);
      expect(p.media).toBeLessThanOrEqual(40);
    }
  });

  it('the governor asks for a downgrade only after sustained slow frames', () => {
    const g = new FrameGovernor({ window: 10, slowMs: 25, coolDownMs: 1000 });
    let now = 0;
    for (let i = 0; i < 10; i += 1) expect(g.sample(16, (now += 16))).toBe(false);
    let asked = false;
    for (let i = 0; i < 10; i += 1) asked = g.sample(40, (now += 40)) || asked;
    expect(asked).toBe(true);
    // Cool-down: immediately slow again does not ask twice.
    let again = false;
    for (let i = 0; i < 10; i += 1) again = g.sample(40, (now += 40)) || again;
    expect(again).toBe(false);
  });

  it('long gaps (tab switches) are not counted as slow frames', () => {
    const g = new FrameGovernor({ window: 5, slowMs: 25, coolDownMs: 0 });
    let asked = false;
    for (let i = 0; i < 20; i += 1) asked = g.sample(1000, i * 1000) || asked;
    expect(asked).toBe(false);
  });
});
