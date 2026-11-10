import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Balloons } from "../components/Balloons";
import { Bunting } from "../components/Bunting";
import { ConfettiBurst, ConfettiRain } from "../components/Confetti";
import { KenBurns } from "../components/PhotoCard";
import { Backdrop, Scene } from "../components/Scene";
import { Sparkle } from "../components/Sparkle";
import { GoldScript, PopLetters } from "../components/Text";
import { BAR, NAME, clamp, color, font, goldGradient } from "../theme";

const ARCH_W = 740;
const ARCH_H = 900;

/**
 * The big moment. The song's last verse starts here, and her name writes
 * itself on exactly where the song sings it (bar 6 of the verse).
 */
export const Reveal: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - 2, fps, config: { damping: 11, mass: 0.9 } });
  const nameAt = 5 * BAR - 4;
  const namePulse = spring({ frame: frame - nameAt - 26, fps, config: { damping: 6, mass: 0.6 } });
  return (
    <Scene duration={duration} fadeIn={0}>
      <Backdrop id="portrait" strength={0.6} />
      {/* rays fanning out behind the portrait */}
      <div
        style={{
          position: "absolute",
          left: 540 - 1100,
          top: 900 - 1100,
          width: 2200,
          height: 2200,
          borderRadius: "50%",
          background: "repeating-conic-gradient(from 0deg, rgba(246,198,103,0.16) 0deg 4deg, transparent 4deg 12deg)",
          WebkitMaskImage: "radial-gradient(circle, black 15%, transparent 60%)",
          maskImage: "radial-gradient(circle, black 15%, transparent 60%)",
          transform: `rotate(${frame * 0.3}deg) scale(${0.6 + 0.4 * pop})`,
        }}
      />
      <ConfettiRain at={50} count={60} seed="reveal-rain" fadeIn={40} />
      <Balloons at={10} count={12} seed="reveal" />
      <Bunting at={6} y={26} sag={62} />

      {/* bursts sit behind the portrait and lettering so her face stays clear */}
      <ConfettiBurst at={0} count={170} seed="reveal-burst" />
      <ConfettiBurst at={nameAt + 8} count={110} seed="name-burst" />

      <PopLetters
        text="Happy Birthday"
        at={10}
        stagger={2}
        style={{
          position: "absolute",
          top: 232,
          left: 0,
          right: 0,
          fontFamily: font.serif,
          fontWeight: 700,
          fontSize: 124,
          color: color.cream,
          letterSpacing: 1,
          textShadow: "0 8px 0 rgba(109,22,64,0.9), 0 14px 30px rgba(10,0,8,0.6)",
        }}
      />

      {/* portrait in a gilded arch */}
      <div
        style={{
          position: "absolute",
          left: (1080 - ARCH_W) / 2,
          top: 430,
          width: ARCH_W,
          height: ARCH_H,
          transform: `translateY(${(1 - pop) * 300}px) scale(${0.7 + 0.3 * pop})`,
          opacity: Math.min(1, pop * 1.6),
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: -22,
            borderRadius: `${ARCH_W / 2 + 22}px ${ARCH_W / 2 + 22}px 50px 50px`,
            border: `3px solid ${color.gold}`,
            opacity: 0.75,
          }}
        />
        <div
          style={{
            width: "100%",
            height: "100%",
            padding: 10,
            boxSizing: "border-box",
            borderRadius: `${ARCH_W / 2}px ${ARCH_W / 2}px 34px 34px`,
            backgroundImage: goldGradient,
            boxShadow: "0 50px 100px rgba(10,0,8,0.6), 0 0 80px rgba(246,198,103,0.35)",
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              overflow: "hidden",
              borderRadius: `${ARCH_W / 2 - 10}px ${ARCH_W / 2 - 10}px 26px 26px`,
            }}
          >
            <KenBurns id="portrait" duration={duration} from={1.3} to={1.42} />
          </div>
        </div>
      </div>

      {/* "dear" lands on the song's "dear", her name right after */}
      <div
        style={{
          position: "absolute",
          top: 1362,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: font.serif,
          fontStyle: "italic",
          fontSize: 62,
          color: color.cream,
          opacity: interpolate(frame, [4 * BAR + 8, 4 * BAR + 24], [0, 1], clamp),
          transform: `translateY(${interpolate(frame, [4 * BAR + 8, 4 * BAR + 26], [24, 0], clamp)}px)`,
          textShadow: "0 4px 18px rgba(10,0,8,0.8)",
        }}
      >
        to our dearest
      </div>
      <AbsoluteFill style={{ top: 1385, height: 420, alignItems: "center" }}>
        <GoldScript
          text={NAME}
          size={300}
          at={nameAt}
          duration={30}
          style={{ transform: `scale(${1 + namePulse * 0.04 - (frame > nameAt + 26 ? 0.04 : 0)})` }}
        />
      </AbsoluteFill>
      {[
        [170, 1500, 64],
        [915, 1470, 80],
        [240, 1740, 46],
        [850, 1760, 56],
        [540, 1395, 40],
      ].map(([x, y, s], i) => (
        <Sparkle
          key={i}
          x={x}
          y={y}
          size={s * spring({ frame: frame - nameAt - 18 - i * 4, fps, config: { damping: 7 } }) * (1 + 0.2 * Math.sin(frame / 4 + i * 2))}
          rotate={frame * 2 + i * 33}
        />
      ))}

    </Scene>
  );
};
