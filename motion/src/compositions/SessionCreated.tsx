import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {Device, devicePort, screenOf} from '../components/Device';
import {Scene} from '../components/Scene';
import {ScreenStatus} from '../components/Screens';
import {Strand} from '../components/Strand';
import {drop, easeInOut, pop, tween} from '../lib/anim';
import {measure, strandPath} from '../lib/geometry';
import {C, FONT_BODY, LINE, PASTELS} from '../theme';

export const CREATED = {width: 1080, height: 1080, fps: 30, durationInFrames: 66};

/**
 * SessionCreated: this device lands, a strand reaches out of it, and turns
 * into the pairing card. The card shows empty slots, never a code: a real
 * code only ever exists in the live app.
 */
export const SessionCreated: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const pos = {x: 330, y: 640};
  const a = devicePort('laptop', pos, 0.62, 'right');
  const card = {x: 640, y: 250, w: 360, h: 190};
  const b = {x: card.x + 40, y: card.y + card.h + 10};
  const m = measure(strandPath(a, b, frame, {sag: 60, wiggle: 10, curlAt: 0.45, curlRadius: 42, seed: 5}));
  const grow = tween(frame, 10, 22, easeInOut);
  const cardIn = pop(frame, fps, 28);
  const s = screenOf('laptop');

  return (
    <Scene
      tone="pasta"
      fadeOut={10}
      svg={
        <>
          <Strand id="created" m={m} to={grow} width={24} lit={tween(frame, 32, 10)} />
          <Device id="self" type="laptop" x={pos.x} y={pos.y} scale={0.62} enter={drop(frame, fps, 0)} rotate={-3} pastel={PASTELS.apricot} state="idle" bob={frame}>
            <ScreenStatus w={s.w} h={s.h} label="New room" tone="wait" />
          </Device>
        </>
      }
      html={
        <div
          style={{
            position: 'absolute',
            left: card.x,
            top: card.y,
            width: card.w,
            height: card.h,
            transform: `scale(${cardIn})`,
            transformOrigin: '10% 100%',
            background: C.white,
            border: `${LINE}px solid ${C.ink}`,
            borderRadius: 28,
            boxShadow: `10px 10px 0 ${C.ink}`,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 18,
          }}
        >
          <span style={{fontFamily: FONT_BODY, fontWeight: 800, fontSize: 24, letterSpacing: 3, color: C.muted}}>YOUR CODE</span>
          <div style={{display: 'flex', gap: 10, alignItems: 'center'}}>
            {[0, 1, 2, -1, 3, 4, 5].map((i, k) =>
              i < 0 ? (
                <span key={k} style={{width: 18, height: 6, background: C.ink, borderRadius: 3}} />
              ) : (
                <span
                  key={k}
                  style={{
                    width: 34,
                    height: 46,
                    borderRadius: 9,
                    border: `3px solid ${C.ink}`,
                    background: tween(frame, 36 + i * 3, 6) > 0.5 ? C.yellow : C.paper,
                  }}
                />
              ),
            )}
          </div>
        </div>
      }
    />
  );
};
