import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Balloons } from "../components/Balloons";
import { ConfettiBurst, ConfettiRain } from "../components/Confetti";
import { KenBurns } from "../components/PhotoCard";
import { Scene } from "../components/Scene";
import { Heart, Sparkle } from "../components/Sparkle";
import { GoldScript, Kicker, PopLetters, WordReveal } from "../components/Text";
import { NAME, T, clamp, color, font, goldGradient } from "../theme";

/** Closing card. The last chord of the song lands on the sparkle burst. */
export const Finale: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - 4, fps, config: { damping: 12 } });
  const chord = 34 * 50 - T.finale; // local frame of the final chord
  const ring = spring({ frame: frame - chord, fps, config: { damping: 20, mass: 1.4 } });
  return (
    <Scene duration={duration} fadeOut={0}>
      <AbsoluteFill style={{ background: "rgba(27,7,22,0.4)" }} />
      <ConfettiRain at={0} count={60} seed="finale-rain" fadeIn={1} />
      <Balloons at={0} count={14} seed="finale" />

      <ConfettiBurst at={chord} count={130} seed="finale-burst" />

      {/* medallion */}
      <div
        style={{
          position: "absolute",
          left: 540 - 230,
          top: 250,
          width: 460,
          height: 460,
          borderRadius: "50%",
          padding: 10,
          boxSizing: "border-box",
          backgroundImage: goldGradient,
          boxShadow: "0 40px 80px rgba(10,0,8,0.6), 0 0 70px rgba(246,198,103,0.4)",
          transform: `scale(${pop}) rotate(${(1 - pop) * -20}deg)`,
        }}
      >
        <div style={{ width: "100%", height: "100%", borderRadius: "50%", overflow: "hidden" }}>
          <KenBurns id="portrait" duration={duration} from={1.5} to={1.62} />
        </div>
      </div>
      {/* ring that blooms on the last chord */}
      <div
        style={{
          position: "absolute",
          left: 540 - 250,
          top: 230,
          width: 500,
          height: 500,
          borderRadius: "50%",
          border: `4px solid ${color.goldPale}`,
          opacity: (1 - ring) * 0.9,
          transform: `scale(${1 + ring * 1.6})`,
        }}
      />

      <PopLetters
        text="Happy Birthday"
        at={14}
        stagger={2}
        style={{
          position: "absolute",
          top: 790,
          left: 0,
          right: 0,
          fontFamily: font.serif,
          fontWeight: 700,
          fontSize: 118,
          color: color.cream,
          textShadow: "0 8px 0 rgba(109,22,64,0.9), 0 14px 30px rgba(10,0,8,0.6)",
        }}
      />
      <AbsoluteFill style={{ top: 900, height: 440, alignItems: "center" }}>
        <GoldScript text={NAME} size={330} at={34} duration={30} />
      </AbsoluteFill>

      <AbsoluteFill style={{ top: 1330, height: 200, alignItems: "center" }}>
        <WordReveal
          text="Keep smiling. Keep singing. Keep shining."
          at={66}
          stagger={5}
          style={{
            fontFamily: font.serif,
            fontStyle: "italic",
            fontSize: 54,
            lineHeight: 1.3,
            color: color.cream,
            width: 720,
            textShadow: "0 4px 18px rgba(10,0,8,0.8)",
          }}
        />
      </AbsoluteFill>

      <div
        style={{
          position: "absolute",
          top: 1535,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 26,
          opacity: interpolate(frame, [104, 124], [0, 1], clamp),
          transform: `translateY(${interpolate(frame, [104, 128], [30, 0], clamp)}px)`,
        }}
      >
        <Kicker text="With lots of love" at={104} />
        <Heart
          size={70 * (1 + 0.1 * Math.max(0, Math.sin((frame - 110) / 5)))}
          fill={color.rose}
          style={{ filter: "drop-shadow(0 0 18px rgba(255,122,107,0.8))" }}
        />
      </div>

      {[
        [150, 330, 70],
        [930, 300, 56],
        [110, 1020, 50],
        [975, 1080, 72],
        [200, 1420, 40],
        [880, 1440, 46],
      ].map(([x, y, s], i) => (
        <Sparkle
          key={i}
          x={x}
          y={y}
          size={s * spring({ frame: frame - chord - i * 3, fps, config: { damping: 7 } }) * (1 + 0.22 * Math.sin(frame / 4 + i * 2))}
          rotate={frame * 2 + i * 31}
        />
      ))}
      {/* fade to black */}
      <AbsoluteFill
        style={{ background: "#0c020a", opacity: interpolate(frame, [duration - 42, duration - 4], [0, 1], clamp) }}
      />
    </Scene>
  );
};
