import React from "react";
import { color } from "../theme";

const PATH =
  "M0,-1 C0.08,-0.28 0.28,-0.08 1,0 C0.28,0.08 0.08,0.28 0,1 C-0.08,0.28 -0.28,0.08 -1,0 C-0.28,-0.08 -0.08,-0.28 0,-1Z";

/** A four-point twinkle, centred on (x, y). */
export const Sparkle: React.FC<{
  x: number;
  y: number;
  size: number;
  opacity?: number;
  rotate?: number;
  fill?: string;
}> = ({ x, y, size, opacity = 1, rotate = 0, fill = color.goldPale }) => (
  <svg
    viewBox="-1 -1 2 2"
    width={size}
    height={size}
    style={{
      position: "absolute",
      left: x - size / 2,
      top: y - size / 2,
      opacity,
      transform: `rotate(${rotate}deg)`,
      filter: `drop-shadow(0 0 ${size / 5}px ${color.gold})`,
      overflow: "visible",
    }}
  >
    <path d={PATH} fill={fill} />
  </svg>
);

export const Heart: React.FC<{ size: number; fill?: string; style?: React.CSSProperties }> = ({
  size,
  fill = color.rose,
  style,
}) => (
  <svg viewBox="0 0 32 30" width={size} height={(size * 30) / 32} style={style}>
    <path
      d="M16 29 C4 20 0 14 0 8.5 C0 3.5 3.8 0 8.3 0 C11.4 0 14.3 1.7 16 4.6 C17.7 1.7 20.6 0 23.7 0 C28.2 0 32 3.5 32 8.5 C32 14 28 20 16 29Z"
      fill={fill}
    />
  </svg>
);
