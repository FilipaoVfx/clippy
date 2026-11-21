/**
 * Pastty motion palette (docs/visual-engine.md): charcoal ink and pasta yellow
 * on warm ivory. Each device carries its own warm pastel so five devices stay
 * distinguishable without labels.
 */
export const C = {
  ink: '#191919',
  inkSoft: '#3a3533',
  paper: '#f7f2ea', // ivory
  white: '#fff8ed', // cream

  yellow: '#ffb52e', // golden
  yellowDeep: '#d98c00',
  yellowLight: '#ffc857', // pasta
  yellowHi: '#fff4cf',
  glow: '#ffe27a',
  orange: '#ff963d',

  // Device pastels: all from the warm brand range, still distinct side by side.
  apricot: '#fde0c8',
  apricotDeep: '#f4b384',
  pasta: '#ffeab0',
  pastaDeep: '#f7c75a',
  peach: '#f9d3bb',
  peachDeep: '#ee9f75',
  sand: '#f1e6d6',
  sandDeep: '#d6bf9f',
  butter: '#fff3d1',
  butterDeep: '#f3d27a',
  blush: '#fbd9cc',
  blushDeep: '#f0a58b',

  success: '#239a5f',
  warn: '#e9952b',
  muted: '#7a706a',
  offline: '#b9b0a9',
} as const;

export const FONT_DISPLAY = "'Russo One', 'Arial Black', sans-serif";
export const FONT_BODY = "Manrope, Arial, sans-serif";
export const FONT_MONO = "ui-monospace, 'DejaVu Sans Mono', monospace";

/** Brutalist line weight used for every outline in the system. */
export const LINE = 5;
/** Hard offset shadow (no blur): the brutalist "block" depth cue. */
export const OFFSET = 12;

export type Pastel = {face: string; deep: string};
export const PASTELS = {
  peach: {face: C.peach, deep: C.peachDeep},
  apricot: {face: C.apricot, deep: C.apricotDeep},
  pasta: {face: C.pasta, deep: C.pastaDeep},
  sand: {face: C.sand, deep: C.sandDeep},
  blush: {face: C.blush, deep: C.blushDeep},
  butter: {face: C.butter, deep: C.butterDeep},
} satisfies Record<string, Pastel>;
