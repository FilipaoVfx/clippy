/**
 * VisualStateAdapter: listens to PasttyBus, folds events through the pure
 * reducer and hands the result to the engine. The engine may load after the
 * session already started, so it first replays the bus history (state only,
 * no animations), then follows live events.
 */
import { EVENTS, reduce, replay } from './state.js';

export function createAdapter(bus, engine) {
  let state = replay(bus.history());
  engine.sync(state);

  const offs = EVENTS.map((name) => bus.on(name, (payload) => {
    const result = reduce(state, name, payload);
    if (!result) return; // duplicate, out of order or irrelevant
    state = result.state;
    engine.sync(state);
    for (const effect of result.effects) engine.play(effect);
  }));

  return {
    get state() { return state; },
    destroy() {
      offs.forEach((off) => off());
      offs.length = 0;
    },
  };
}
