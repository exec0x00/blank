import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { PhotoCard } from "../components/PhotoCard";
import { Backdrop, Scene } from "../components/Scene";
import { Sparkle } from "../components/Sparkle";
import { Kicker, WordReveal } from "../components/Text";
import { PhotoId } from "../photos";
import { clamp, color, font } from "../theme";

export type MemoryProps = {
  id: PhotoId;
  kicker: string;
  caption: string;
  duration: number;
  /** Card size in px. */
  width?: number;
  height?: number;
  tilt?: number;
  /** Side the card flies in from: -1 left, 1 right. */
  from?: -1 | 1;
  sparkles?: boolean;
};

/** One memory: a taped-in print, a label above it and a handwritten line below. */
export const Memory: React.FC<MemoryProps> = ({
  id,
  kicker,
  caption,
  duration,
  width = 860,
  height = 1110,
  tilt = -2.5,
  from = -1,
  sparkles = false,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - 2, fps, config: { damping: 15, mass: 0.9 } });
  const leave = interpolate(frame, [duration - 14, duration], [0, 1], clamp);
  const bob = Math.sin(frame / 22) * 6;
  const cardCentre = 900;
  return (
    <Scene duration={duration}>
      <Backdrop id={id} />
      <Kicker text={kicker} at={6} style={{ position: "absolute", top: 205, left: 0, right: 0 }} />
      <div
        style={{
          position: "absolute",
          left: (1080 - width) / 2,
          top: cardCentre - height / 2,
          transform: `translate(${(1 - enter) * from * 900}px, ${(1 - enter) * 120 + bob - leave * 90}px) rotate(${
            tilt + (1 - enter) * from * 16 + Math.sin(frame / 30) * 0.5
          }deg) scale(${0.86 + 0.14 * enter + frame * 0.00025})`,
        }}
      >
        <PhotoCard id={id} width={width} height={height} duration={duration} />
      </div>
      {sparkles
        ? [
            [150, 420, 70, 14],
            [940, 520, 54, 20],
            [120, 1300, 48, 26],
            [960, 1380, 76, 32],
            [540, 310, 40, 38],
          ].map(([x, y, s, at], i) => (
            <Sparkle
              key={i}
              x={x}
              y={y + Math.sin(frame / 12 + i) * 10}
              size={s * spring({ frame: frame - at, fps, config: { damping: 7 } }) * (1 + 0.2 * Math.sin(frame / 4 + i * 2))}
              rotate={frame * 2.2 + i * 40}
            />
          ))
        : null}
      <AbsoluteFill style={{ top: cardCentre + height / 2 + 34, height: 300, alignItems: "center", justifyContent: "flex-start" }}>
        <WordReveal
          text={caption}
          at={16}
          stagger={4}
          style={{
            fontFamily: font.script,
            fontSize: 104,
            lineHeight: 1.12,
            color: color.cream,
            width: 980,
            textShadow: "0 6px 24px rgba(10,0,8,0.7), 0 0 30px rgba(246,198,103,0.25)",
          }}
        />
      </AbsoluteFill>
    </Scene>
  );
};
