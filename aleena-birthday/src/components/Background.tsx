import React from "react";
import { AbsoluteFill, interpolate, random, useCurrentFrame } from "remotion";
import { HEIGHT, WIDTH, color } from "../theme";
import { Sparkle } from "./Sparkle";

const BOKEH = Array.from({ length: 22 }, (_, i) => ({
  x: random(`bx${i}`) * WIDTH,
  y: random(`by${i}`) * HEIGHT,
  size: 120 + random(`bs${i}`) * 300,
  speed: 0.25 + random(`bv${i}`) * 0.55,
  phase: random(`bp${i}`) * Math.PI * 2,
  tint: [color.gold, color.rose, color.blush, color.coral][i % 4],
  alpha: 0.1 + random(`ba${i}`) * 0.16,
}));

const STARS = Array.from({ length: 34 }, (_, i) => ({
  x: random(`sx${i}`) * WIDTH,
  y: random(`sy${i}`) * HEIGHT,
  size: 10 + random(`ss${i}`) * 22,
  phase: random(`sp${i}`) * Math.PI * 2,
  rate: 0.05 + random(`sr${i}`) * 0.08,
}));

/** The stage every scene plays on: deep plum, drifting lights, twinkling stars. */
export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, 1860], [0, 40]);
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(120% 80% at ${50 + Math.sin(frame / 160) * 12}% ${
          34 + drift * 0.3
        }%, ${color.wine} 0%, ${color.plum} 45%, ${color.night} 100%)`,
      }}
    >
      {BOKEH.map((b, i) => {
        const y = ((b.y - frame * b.speed) % (HEIGHT + 400) + HEIGHT + 400) % (HEIGHT + 400) - 200;
        const x = b.x + Math.sin(frame / 70 + b.phase) * 40;
        const pulse = 0.75 + 0.25 * Math.sin(frame / 40 + b.phase);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x - b.size / 2,
              top: y - b.size / 2,
              width: b.size,
              height: b.size,
              borderRadius: "50%",
              opacity: b.alpha * pulse,
              background: `radial-gradient(circle, ${b.tint} 0%, ${b.tint}88 35%, transparent 70%)`,
            }}
          />
        );
      })}
      {STARS.map((s, i) => {
        const tw = Math.max(0, Math.sin(frame * s.rate + s.phase));
        return (
          <Sparkle
            key={i}
            x={s.x}
            y={s.y}
            size={s.size * (0.6 + 0.4 * tw)}
            opacity={0.15 + 0.6 * tw * tw}
            rotate={frame * 0.4 + i * 20}
          />
        );
      })}
    </AbsoluteFill>
  );
};

export const Vignette: React.FC = () => (
  <AbsoluteFill
    style={{
      pointerEvents: "none",
      background:
        "radial-gradient(90% 75% at 50% 48%, transparent 55%, rgba(12,2,10,0.55) 100%)",
    }}
  />
);
