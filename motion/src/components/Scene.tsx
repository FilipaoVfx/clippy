import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {Grain, Stage, StageTone} from './Stage';

/**
 * Shared scene frame: pastel stage, a slow camera push, one SVG layer for
 * strands/devices (1:1 with the composition) and an HTML layer for type.
 * Content fades out at the end so each clip loops back onto the empty stage.
 */
export const Scene: React.FC<{
  tone: StageTone;
  svg: React.ReactNode;
  html?: React.ReactNode;
  push?: number;
  fadeOut?: number;
  /** Vertical shift, used to recentre chapters rendered without captions. */
  offsetY?: number;
}> = ({tone, svg, html, push = 0.04, fadeOut = 14, offsetY = 0}) => {
  const frame = useCurrentFrame();
  const {width, height, durationInFrames} = useVideoConfig();
  const zoom = interpolate(frame, [0, durationInFrames], [1, 1 + push]);
  const opacity = interpolate(frame, [durationInFrames - fadeOut, durationInFrames - 1], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <Stage tone={tone}>
      <AbsoluteFill style={{transform: `translateY(${offsetY}px) scale(${zoom})`, opacity}}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{position: 'absolute', inset: 0, overflow: 'visible'}}>
          {svg}
        </svg>
        {html}
      </AbsoluteFill>
      <Grain />
    </Stage>
  );
};
