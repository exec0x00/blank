import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Scene } from "../components/Scene";
import { Sparkle } from "../components/Sparkle";
import { GoldScript, Kicker, WordReveal } from "../components/Text";
import { NAME, clamp, color, font } from "../theme";

export const Intro: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // part one: "once upon a time"; part two: the title card
  const one = interpolate(frame, [0, 14, 88, 102], [0, 1, 1, 0], clamp);
  const two = interpolate(frame, [98, 112], [0, 1], clamp);
  const ring = spring({ frame: frame - 100, fps, config: { damping: 14 } });
  return (
    <Scene duration={duration} fadeIn={0}>
      <AbsoluteFill style={{ background: `rgba(12,2,10,${interpolate(frame, [0, 30], [1, 0], clamp)})` }} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: one }}>
        <Kicker text="Once upon a time" at={8} />
        <WordReveal
          text="a little star was born…"
          at={30}
          stagger={5}
          style={{
            marginTop: 46,
            fontFamily: font.serif,
            fontStyle: "italic",
            fontSize: 82,
            color: color.cream,
            width: 900,
            lineHeight: 1.25,
            textShadow: "0 6px 26px rgba(0,0,0,0.5)",
          }}
        />
        <Sparkle
          x={540}
          y={730}
          size={interpolate(frame, [20, 60], [0, 90], clamp) * (1 + 0.12 * Math.sin(frame / 5))}
          rotate={frame * 1.5}
        />
      </AbsoluteFill>

      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: two }}>
        {/* slowly turning halo behind the title */}
        <div
          style={{
            position: "absolute",
            width: 1500,
            height: 1500,
            borderRadius: "50%",
            background:
              "repeating-conic-gradient(from 0deg, rgba(246,198,103,0.13) 0deg 5deg, transparent 5deg 15deg)",
            WebkitMaskImage: "radial-gradient(circle, black 12%, transparent 62%)",
            maskImage: "radial-gradient(circle, black 12%, transparent 62%)",
            transform: `rotate(${frame * 0.25}deg) scale(${0.7 + 0.3 * ring})`,
          }}
        />
        <div
          style={{
            fontFamily: font.serif,
            fontStyle: "italic",
            fontSize: 70,
            color: color.cream,
            opacity: interpolate(frame, [104, 122], [0, 1], clamp),
            transform: `translateY(${interpolate(frame, [104, 126], [30, 0], clamp)}px)`,
            textShadow: "0 6px 26px rgba(0,0,0,0.5)",
          }}
        >
          this is the story of
        </div>
        <GoldScript text={NAME} size={330} at={122} duration={34} style={{ marginTop: -30 }} />
        <div
          style={{
            width: interpolate(frame, [150, 176], [0, 520], { ...clamp, easing: (t) => 1 - (1 - t) ** 3 }),
            height: 3,
            marginTop: -10,
            background: `linear-gradient(90deg, transparent, ${color.gold}, transparent)`,
          }}
        />
        {[
          [250, 700, 46, 150],
          [840, 760, 34, 158],
          [770, 1180, 52, 164],
          [300, 1150, 30, 170],
        ].map(([x, y, s, at], i) => (
          <Sparkle
            key={i}
            x={x}
            y={y}
            size={s * spring({ frame: frame - at, fps, config: { damping: 8 } }) * (1 + 0.15 * Math.sin(frame / 4 + i))}
            rotate={frame * 2 + i * 30}
          />
        ))}
      </AbsoluteFill>
    </Scene>
  );
};
