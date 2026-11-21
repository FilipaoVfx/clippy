import {Easing, interpolate, spring} from 'remotion';
import {clamp} from './geometry';

export const ease = Easing.bezier(0.16, 1, 0.3, 1);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);

/** 0→1 over [start, start+dur] with the brand easing. */
export const tween = (frame: number, start: number, dur: number, easing = ease) =>
  interpolate(frame, [start, start + dur], [0, 1], {
    easing,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

/** Bouncy arrival used for objects that "drop" into the scene. */
export const drop = (frame: number, fps: number, start: number, damping = 10) =>
  spring({frame: frame - start, fps, config: {damping, stiffness: 140, mass: 0.9}});

export const pop = (frame: number, fps: number, start: number) =>
  spring({frame: frame - start, fps, config: {damping: 11, stiffness: 220, mass: 0.6}});

/** Squash & stretch from a spring's overshoot: returns [scaleX, scaleY]. */
export const squash = (s: number): [number, number] => {
  const over = clamp(s - 1, -0.12, 0.12);
  return [1 + over * 1.5, 1 - over * 1.5];
};

/** Fade-in/out window. */
export const windowed = (frame: number, a: number, b: number, c: number, d: number) =>
  interpolate(frame, [a, b, c, d], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
