import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, color, font, goldGradient } from "../theme";

/** Gold-foil script lettering that writes itself on from the left. */
export const GoldScript: React.FC<{
  text: string;
  size: number;
  /** Frame (local) the write-on starts. */
  at?: number;
  duration?: number;
  style?: React.CSSProperties;
}> = ({ text, size, at = 0, duration = 28, style }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [at, at + duration], [0, 1], {
    ...clamp,
    easing: (t) => 1 - Math.pow(1 - t, 2.2),
  });
  return (
    <div
      style={{
        fontFamily: font.script,
        fontSize: size,
        lineHeight: 1.15,
        // generous padding: the swashes reach outside the text box
        padding: `${size * 0.18}px ${size * 0.4}px ${size * 0.22}px`,
        backgroundImage: goldGradient,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        whiteSpace: "nowrap",
        filter: "drop-shadow(0 6px 14px rgba(20,2,14,0.55)) drop-shadow(0 0 26px rgba(246,198,103,0.35))",
        clipPath: `inset(-20% ${(1 - p) * 104 - 2}% -20% -2%)`,
        ...style,
      }}
    >
      {text}
    </div>
  );
};

/** Words rise into place one after another. */
export const WordReveal: React.FC<{
  text: string;
  at?: number;
  stagger?: number;
  style?: React.CSSProperties;
}> = ({ text, at = 0, stagger = 4, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", ...style }}>
      {text.split(" ").map((word, i) => {
        const s = spring({ frame: frame - at - i * stagger, fps, config: { damping: 16, mass: 0.7 } });
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              marginRight: "0.26em",
              opacity: interpolate(s, [0, 0.6], [0, 1], clamp),
              transform: `translateY(${(1 - s) * 36}px)`,
              filter: `blur(${(1 - Math.min(1, s)) * 6}px)`,
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};

/** Small letter-spaced label with a rule on either side. */
export const Kicker: React.FC<{ text: string; at?: number; style?: React.CSSProperties }> = ({
  text,
  at = 0,
  style,
}) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [at, at + 18], [0, 1], { ...clamp, easing: (t) => 1 - (1 - t) ** 3 });
  const rule: React.CSSProperties = {
    height: 2,
    width: 70 * p,
    background: `linear-gradient(90deg, transparent, ${color.gold})`,
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 22,
        opacity: p,
        ...style,
      }}
    >
      <div style={rule} />
      <div
        style={{
          fontFamily: font.sans,
          fontWeight: 600,
          fontSize: 34,
          letterSpacing: 10 - (1 - p) * 4,
          color: color.gold,
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          textShadow: "0 2px 12px rgba(0,0,0,0.5)",
        }}
      >
        {text}
      </div>
      <div style={{ ...rule, transform: "scaleX(-1)" }} />
    </div>
  );
};

/** Letters pop in one at a time. */
export const PopLetters: React.FC<{
  text: string;
  at?: number;
  stagger?: number;
  style?: React.CSSProperties;
}> = ({ text, at = 0, stagger = 2, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ display: "flex", justifyContent: "center", whiteSpace: "pre", ...style }}>
      {text.split("").map((ch, i) => {
        const s = spring({ frame: frame - at - i * stagger, fps, config: { damping: 9, mass: 0.6 } });
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              opacity: Math.min(1, s * 2),
              transform: `translateY(${(1 - s) * 60}px) scale(${0.4 + 0.6 * s}) rotate(${(1 - s) * (i % 2 ? 14 : -14)}deg)`,
            }}
          >
            {ch}
          </span>
        );
      })}
    </div>
  );
};
