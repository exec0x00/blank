import React from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ConfettiRain } from "../components/Confetti";
import { Scene } from "../components/Scene";
import { Heart } from "../components/Sparkle";
import { WordReveal } from "../components/Text";
import { PhotoId, focus, photo } from "../photos";
import { clamp, color, font, goldGradient } from "../theme";

const ROWS: PhotoId[][] = [
  ["baby", "tricycle", "hat-closeup"],
  ["hats", "nativity", "balloon"],
  ["smile", "net", "sunglasses"],
  ["trophy", "forest", "portrait"],
];
const TILE_W = 322;
const TILE_H = 352;
const GAP = 22;
const ROW_Y = [56, 56 + TILE_H + GAP, 1138, 1138 + TILE_H + GAP];

/** Every photo at once, with the wish in the middle. */
export const Wall: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <Scene duration={duration}>
      <AbsoluteFill style={{ background: "rgba(27,7,22,0.45)" }} />
      <ConfettiRain at={0} count={36} seed="wall-rain" fadeIn={1} />
      {ROWS.map((row, r) =>
        row.map((id, c) => {
          const n = r * 3 + c;
          const s = spring({ frame: frame - 4 - n * 3, fps, config: { damping: 12, mass: 0.7 } });
          const [fx, fy] = focus[id];
          const drift = (r % 2 ? 1 : -1) * interpolate(frame, [0, duration], [-14, 14]);
          const tilt = ((n * 37) % 7) - 3;
          return (
            <div
              key={id}
              style={{
                position: "absolute",
                left: 35 + c * (TILE_W + GAP) + drift,
                top: ROW_Y[r],
                width: TILE_W,
                height: TILE_H,
                padding: 10,
                boxSizing: "border-box",
                background: color.cream,
                borderRadius: 14,
                boxShadow: "0 18px 36px rgba(10,0,8,0.5)",
                opacity: Math.min(1, s * 1.5),
                transform: `scale(${0.3 + 0.7 * s}) rotate(${tilt * 0.8 + (1 - s) * (n % 2 ? 30 : -30)}deg)`,
              }}
            >
              <div style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: 8 }}>
                <Img
                  src={photo(id)}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    objectPosition: `${fx}% ${fy}%`,
                    transformOrigin: `${fx}% ${fy}%`,
                    transform: `scale(${1.05 + frame * 0.0006})`,
                  }}
                />
              </div>
            </div>
          );
        }),
      )}

      <AbsoluteFill style={{ top: 808, height: 312, alignItems: "center", justifyContent: "center" }}>
        <WordReveal
          text="May your year be filled with"
          at={26}
          stagger={3}
          style={{
            fontFamily: font.serif,
            fontStyle: "italic",
            fontSize: 58,
            color: color.cream,
            textShadow: "0 4px 18px rgba(10,0,8,0.8)",
          }}
        />
        <div
          style={{
            marginTop: 6,
            fontFamily: font.script,
            fontSize: 118,
            lineHeight: 1.25,
            padding: "0 40px",
            backgroundImage: goldGradient,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            filter: "drop-shadow(0 6px 14px rgba(20,2,14,0.6))",
            opacity: interpolate(frame, [48, 66], [0, 1], clamp),
            transform: `scale(${interpolate(frame, [48, 70], [0.86, 1], { ...clamp, easing: (t) => 1 - (1 - t) ** 3 })})`,
            whiteSpace: "nowrap",
          }}
        >
          music, laughter &amp; love
        </div>
        <Heart
          size={44 * spring({ frame: frame - 74, fps, config: { damping: 6 } })}
          fill={color.rose}
          style={{ marginTop: 2, filter: "drop-shadow(0 0 14px rgba(255,122,107,0.7))" }}
        />
      </AbsoluteFill>
    </Scene>
  );
};
