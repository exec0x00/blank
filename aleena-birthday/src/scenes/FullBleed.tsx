import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { KenBurns } from "../components/PhotoCard";
import { Scene } from "../components/Scene";
import { Kicker, WordReveal } from "../components/Text";
import { PhotoId } from "../photos";
import { clamp, color, font } from "../theme";

/** The photo fills the whole frame, with the words set over a soft shade at the foot. */
export const FullBleed: React.FC<{ id: PhotoId; kicker: string; caption: string; duration: number }> = ({
  id,
  kicker,
  caption,
  duration,
}) => {
  const frame = useCurrentFrame();
  return (
    <Scene duration={duration}>
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <KenBurns id={id} duration={duration} from={1.02} to={1.14} />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(27,7,22,0.55) 0%, rgba(27,7,22,0) 22%, rgba(27,7,22,0) 52%, rgba(27,7,22,0.9) 86%, rgba(27,7,22,0.96) 100%)",
        }}
      />
      {/* thin gold frame */}
      <div
        style={{
          position: "absolute",
          inset: 36,
          border: `3px solid ${color.gold}`,
          borderRadius: 26,
          opacity: interpolate(frame, [6, 26], [0, 0.85], clamp),
          boxShadow: "0 0 30px rgba(246,198,103,0.25)",
        }}
      />
      <Kicker text={kicker} at={8} style={{ position: "absolute", top: 1420, left: 0, right: 0 }} />
      <AbsoluteFill style={{ top: 1480, height: 320, alignItems: "center" }}>
        <WordReveal
          text={caption}
          at={16}
          stagger={4}
          style={{
            fontFamily: font.script,
            fontSize: 112,
            lineHeight: 1.1,
            color: color.cream,
            width: 940,
            textShadow: "0 6px 24px rgba(10,0,8,0.8)",
          }}
        />
      </AbsoluteFill>
    </Scene>
  );
};
