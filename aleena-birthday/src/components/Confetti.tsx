import React from "react";
import { AbsoluteFill, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";
import { HEIGHT, WIDTH, clamp, color } from "../theme";

const COLORS = [color.gold, color.goldPale, color.blush, color.rose, color.coral, color.teal, "#ffffff"];

type Piece = {
  side: number;
  angle: number;
  speed: number;
  w: number;
  h: number;
  tint: string;
  spin: number;
  flutter: number;
  phase: number;
  round: boolean;
  delay: number;
};

const make = (seed: string, count: number): Piece[] =>
  Array.from({ length: count }, (_, i) => {
    const r = (k: string) => random(`${seed}-${k}-${i}`);
    return {
      side: i % 2,
      angle: (50 + r("a") * 36) * (Math.PI / 180),
      speed: 1500 + r("v") * 2100,
      w: 14 + r("w") * 16,
      h: 20 + r("h") * 22,
      tint: COLORS[Math.floor(r("c") * COLORS.length)],
      spin: (r("s") - 0.5) * 14,
      flutter: 5 + r("f") * 9,
      phase: r("p") * Math.PI * 2,
      round: r("o") > 0.78,
      delay: r("d") * 0.25,
    };
  });

/** Two cannons in the lower corners fire up and inwards, then everything flutters down. */
export const ConfettiBurst: React.FC<{ at?: number; count?: number; seed?: string }> = ({
  at = 0,
  count = 150,
  seed = "burst",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pieces = React.useMemo(() => make(seed, count), [seed, count]);
  const drag = 1.7;
  const terminal = 330;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {pieces.map((p, i) => {
        const t = (frame - at) / fps - p.delay;
        if (t < 0) return null;
        const k = (1 - Math.exp(-drag * t)) / drag;
        const dir = p.side === 0 ? 1 : -1;
        const x =
          (p.side === 0 ? -30 : WIDTH + 30) +
          dir * Math.cos(p.angle) * p.speed * k +
          Math.sin(t * 2.4 + p.phase) * 40 * Math.min(1, t);
        const y = HEIGHT * 0.86 - Math.sin(p.angle) * p.speed * k + terminal * (t - k);
        if (y > HEIGHT + 60) return null;
        const flip = Math.cos(t * p.flutter + p.phase);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: p.w,
              height: p.round ? p.w : p.h,
              borderRadius: p.round ? "50%" : 3,
              background: p.tint,
              opacity: interpolate(t, [0, 0.08], [0, 1], clamp),
              transform: `rotate(${t * p.spin * 40 + p.phase * 57}deg) scaleY(${flip})`,
              filter: `brightness(${0.8 + 0.35 * Math.abs(flip)})`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/** A steady, gentle fall from above. */
export const ConfettiRain: React.FC<{ at?: number; count?: number; seed?: string; fadeIn?: number }> = ({
  at = 0,
  count = 70,
  seed = "rain",
  fadeIn = 30,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pieces = React.useMemo(() => make(seed, count), [seed, count]);
  const t = (frame - at) / fps;
  if (t < 0) return null;
  const span = HEIGHT + 300;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: interpolate(frame - at, [0, fadeIn], [0, 1], clamp) }}>
      {pieces.map((p, i) => {
        const fall = 170 + (p.speed - 1500) / 9;
        const y0 = random(`${seed}-y-${i}`) * span;
        const y = ((y0 + fall * t) % span) - 150;
        const x = random(`${seed}-x-${i}`) * WIDTH + Math.sin(t * 1.6 + p.phase) * 50;
        const flip = Math.cos(t * p.flutter * 0.7 + p.phase);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: p.w * 0.9,
              height: p.round ? p.w * 0.9 : p.h * 0.9,
              borderRadius: p.round ? "50%" : 3,
              background: p.tint,
              transform: `rotate(${t * p.spin * 25 + p.phase * 57}deg) scaleY(${flip})`,
              filter: `brightness(${0.8 + 0.35 * Math.abs(flip)})`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
