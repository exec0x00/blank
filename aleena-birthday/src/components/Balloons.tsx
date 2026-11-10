import React from "react";
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from "remotion";
import { HEIGHT, WIDTH, color } from "../theme";

const TINTS = [color.rose, color.gold, color.coral, color.blush, color.teal, "#b46cf0"];

const Balloon: React.FC<{ tint: string; size: number; sway: number; id: string }> = ({
  tint,
  size,
  sway,
  id,
}) => (
  <svg
    viewBox="0 0 100 260"
    width={size}
    height={size * 2.6}
    style={{ overflow: "visible", transform: `rotate(${sway}deg)`, transformOrigin: "50% 20%" }}
  >
    <defs>
      <radialGradient id={id} cx="35%" cy="28%" r="75%">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
        <stop offset="18%" stopColor={tint} stopOpacity="0.95" />
        <stop offset="100%" stopColor={tint} />
      </radialGradient>
    </defs>
    <path
      d={`M50 122 C${46 - sway} 160 ${58 + sway} 200 ${50 - sway * 0.6} 258`}
      stroke="rgba(255,240,220,0.7)"
      strokeWidth="1.6"
      fill="none"
    />
    <ellipse cx="50" cy="58" rx="46" ry="57" fill={`url(#${id})`} />
    <path d="M44 114 L56 114 L53 124 L47 124 Z" fill={tint} />
    <ellipse cx="33" cy="36" rx="9" ry="15" fill="rgba(255,255,255,0.45)" transform="rotate(-24 33 36)" />
  </svg>
);

/** Balloons drift up the sides of the frame, leaving the middle clear. */
export const Balloons: React.FC<{ at?: number; count?: number; seed?: string; sides?: boolean }> = ({
  at = 0,
  count = 10,
  seed = "balloons",
  sides = true,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = (frame - at) / fps;
  if (t < 0) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {Array.from({ length: count }, (_, i) => {
        const r = (k: string) => random(`${seed}-${k}-${i}`);
        const size = 115 + r("s") * 70;
        const left = i % 2 === 0;
        const x = sides
          ? left
            ? -70 + r("x") * 130
            : WIDTH - size + 70 - r("x") * 130
          : r("x") * (WIDTH - size);
        const speed = 190 + r("v") * 150;
        const delay = r("d") * 3.2;
        const y = HEIGHT + 40 - (t - delay) * speed;
        if (t < delay || y < -size * 2.8) return null;
        const sway = Math.sin(t * 1.3 + r("p") * 6) * 5;
        return (
          <div
            key={i}
            style={{ position: "absolute", left: x + Math.sin(t * 0.9 + i) * 22, top: y, opacity: 0.96 }}
          >
            <Balloon tint={TINTS[i % TINTS.length]} size={size} sway={sway} id={`${seed}-g-${i}`} />
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
