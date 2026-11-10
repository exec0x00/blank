import React from "react";
import { Img, interpolate, useCurrentFrame } from "remotion";
import { clamp, color } from "../theme";
import { PhotoId, focus, photo } from "../photos";

/** A photo that slowly pushes in towards the face. */
export const KenBurns: React.FC<{
  id: PhotoId;
  duration: number;
  from?: number;
  to?: number;
  style?: React.CSSProperties;
}> = ({ id, duration, from = 1.04, to = 1.16, style }) => {
  const frame = useCurrentFrame();
  const [fx, fy] = focus[id];
  const scale = interpolate(frame, [0, duration], [from, to], clamp);
  return (
    <Img
      src={photo(id)}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        objectPosition: `${fx}% ${fy}%`,
        transformOrigin: `${fx}% ${fy}%`,
        transform: `scale(${scale})`,
        ...style,
      }}
    />
  );
};

/** Cream-bordered print with a strip of tape, like a photo stuck in an album. */
export const PhotoCard: React.FC<{
  id: PhotoId;
  width: number;
  height: number;
  duration: number;
  border?: number;
  tape?: boolean;
  children?: React.ReactNode;
}> = ({ id, width, height, duration, border = 24, tape = true, children }) => (
  <div
    style={{
      width,
      height,
      padding: border,
      boxSizing: "border-box",
      background: `linear-gradient(160deg, #ffffff, ${color.cream})`,
      borderRadius: 10,
      boxShadow:
        "0 50px 90px rgba(10,0,8,0.55), 0 12px 24px rgba(10,0,8,0.35), 0 0 0 1px rgba(255,255,255,0.4)",
      position: "relative",
    }}
  >
    <div style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: 4, position: "relative" }}>
      <KenBurns id={id} duration={duration} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          boxShadow: "inset 0 0 60px rgba(40,5,25,0.28)",
        }}
      />
    </div>
    {tape ? (
      <div
        style={{
          position: "absolute",
          top: -26,
          left: "50%",
          width: 210,
          height: 54,
          marginLeft: -105,
          transform: "rotate(-3deg)",
          background:
            "repeating-linear-gradient(115deg, rgba(246,198,103,0.92) 0 14px, rgba(255,232,170,0.92) 14px 28px)",
          boxShadow: "0 4px 10px rgba(0,0,0,0.25)",
          opacity: 0.95,
        }}
      />
    ) : null}
    {children}
  </div>
);
