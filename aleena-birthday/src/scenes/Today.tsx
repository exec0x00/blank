import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Cake } from "../components/Cake";
import { Scene } from "../components/Scene";
import { GoldScript, WordReveal } from "../components/Text";
import { clamp, color, font } from "../theme";

/** The pause before the big moment: candles being lit. */
export const Today: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = spring({ frame: frame - 4, fps, config: { damping: 13 } });
  return (
    <Scene duration={duration} fadeOut={8}>
      <AbsoluteFill style={{ background: "rgba(20,4,16,0.5)" }} />
      <AbsoluteFill style={{ top: 300, height: 300, alignItems: "center" }}>
        <GoldScript text="And today…" size={190} at={4} duration={26} />
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 220,
          top: 640,
          transform: `translateY(${(1 - rise) * 260}px) scale(${0.8 + 0.2 * rise})`,
          opacity: Math.min(1, rise * 1.5),
          filter: "drop-shadow(0 40px 60px rgba(0,0,0,0.45))",
        }}
      >
        <Cake size={640} lightAt={14} />
      </div>
      <AbsoluteFill style={{ top: 1440, height: 300, alignItems: "center" }}>
        <WordReveal
          text="it's her special day!"
          at={30}
          stagger={4}
          style={{
            fontFamily: font.serif,
            fontStyle: "italic",
            fontWeight: 600,
            fontSize: 84,
            color: color.cream,
            textShadow: "0 6px 24px rgba(10,0,8,0.7)",
          }}
        />
      </AbsoluteFill>
      {/* the screen warms up as the candles catch */}
      <AbsoluteFill
        style={{
          background: "radial-gradient(circle at 50% 42%, rgba(255,214,120,0.5), transparent 60%)",
          opacity: interpolate(frame, [22, 70], [0, 1], clamp) * (0.85 + 0.15 * Math.sin(frame * 0.7)),
          mixBlendMode: "screen",
        }}
      />
    </Scene>
  );
};
