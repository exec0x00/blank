import React from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Scene } from "../components/Scene";
import { GoldScript, Kicker } from "../components/Text";
import { PhotoId, focus, photo } from "../photos";
import { BAR, clamp, color, font } from "../theme";

const SHOTS: Array<{ id: PhotoId; label: string; x: number; y: number; tilt: number }> = [
  { id: "nativity", label: "the little poser", x: 44, y: 430, tilt: -5 },
  { id: "balloon", label: "the giggler", x: 556, y: 500, tilt: 4 },
  { id: "smile", label: "the charmer", x: 70, y: 1090, tilt: 3.5 },
  { id: "net", label: "the goofball", x: 548, y: 1150, tilt: -4 },
];

const W = 480;
const H = 600;

/** Four instant prints slap down onto the table, one per bar of music. */
export const Montage: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <Scene duration={duration}>
      <AbsoluteFill style={{ background: "rgba(27,7,22,0.35)" }} />
      <Kicker text="So many moods" at={4} style={{ position: "absolute", top: 180, left: 0, right: 0 }} />
      <AbsoluteFill style={{ top: 225, height: 200, alignItems: "center" }}>
        <GoldScript text="one little girl" size={120} at={10} duration={24} />
      </AbsoluteFill>
      {SHOTS.map((s, i) => {
        const at = 6 + i * (BAR - 6);
        const drop = spring({ frame: frame - at, fps, config: { damping: 13, mass: 0.8, stiffness: 130 } });
        if (frame < at) return null;
        const [fx, fy] = focus[s.id];
        const settle = Math.sin((frame - at) / 26 + i) * 0.6;
        return (
          <div
            key={s.id}
            style={{
              position: "absolute",
              left: s.x,
              top: s.y,
              width: W,
              height: H,
              padding: "20px 20px 0",
              boxSizing: "border-box",
              background: "linear-gradient(165deg, #ffffff, #fbf3e4)",
              borderRadius: 6,
              boxShadow: `0 ${20 + (1 - drop) * 80}px ${40 + (1 - drop) * 90}px rgba(10,0,8,${0.55 - (1 - drop) * 0.25})`,
              opacity: interpolate(frame - at, [0, 5], [0, 1], clamp),
              transform: `rotate(${s.tilt + (1 - drop) * (i % 2 ? 22 : -22) + settle}deg) scale(${1 + (1 - drop) * 0.9})`,
            }}
          >
            <div style={{ width: "100%", height: 470, overflow: "hidden", borderRadius: 3 }}>
              <Img
                src={photo(s.id)}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: `${fx}% ${fy}%`,
                  transformOrigin: `${fx}% ${fy}%`,
                  transform: `scale(${1.08 + (frame - at) * 0.0007})`,
                }}
              />
            </div>
            <div
              style={{
                height: 108,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: font.script,
                fontSize: 62,
                color: color.wine,
              }}
            >
              {s.label}
            </div>
          </div>
        );
      })}
    </Scene>
  );
};
