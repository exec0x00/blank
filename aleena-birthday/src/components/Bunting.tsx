import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { WIDTH, color } from "../theme";

const FLAGS = [color.gold, color.rose, color.cream, color.coral, color.teal, color.blush];

/** A string of flags that drops in from the top and keeps swaying. */
export const Bunting: React.FC<{ at?: number; y?: number; sag?: number; count?: number }> = ({
  at = 0,
  y = 30,
  sag = 110,
  count = 9,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drop = spring({ frame: frame - at, fps, config: { damping: 11, mass: 0.9 } });
  const curve = (u: number) => y + sag * 4 * u * (1 - u);
  return (
    <svg
      width={WIDTH}
      height={y + sag + 150}
      style={{ position: "absolute", top: 0, left: 0, transform: `translateY(${(1 - drop) * -320}px)`, overflow: "visible" }}
    >
      <path
        d={`M-20 ${y} Q ${WIDTH / 2} ${y + sag * 2} ${WIDTH + 20} ${y}`}
        stroke="rgba(255,240,210,0.85)"
        strokeWidth="4"
        fill="none"
      />
      {Array.from({ length: count }, (_, i) => {
        const u = (i + 0.5) / count;
        const x = u * WIDTH;
        const swing = Math.sin(frame / 14 + i * 0.9) * 5 + (1 - drop) * 20;
        return (
          <g key={i} transform={`translate(${x} ${curve(u)}) rotate(${swing + (0.5 - u) * -18})`}>
            <path d="M-46 0 L46 0 L0 104 Z" fill={FLAGS[i % FLAGS.length]} />
            <path d="M0 0 L46 0 L0 104 Z" fill="rgba(60,0,40,0.12)" />
            <circle cx="0" cy="34" r="9" fill="rgba(255,255,255,0.55)" />
          </g>
        );
      })}
    </svg>
  );
};
