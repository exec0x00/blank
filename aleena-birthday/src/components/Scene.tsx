import React from "react";
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from "remotion";
import { OVERLAP, clamp } from "../theme";
import { PhotoId, photo } from "../photos";

/** Fades a scene in over its first frames and out over its last. */
export const Scene: React.FC<{
  duration: number;
  fadeIn?: number;
  fadeOut?: number;
  children: React.ReactNode;
}> = ({ duration, fadeIn = OVERLAP, fadeOut = OVERLAP, children }) => {
  const frame = useCurrentFrame();
  const opacity =
    (fadeIn > 0 ? interpolate(frame, [0, fadeIn], [0, 1], clamp) : 1) *
    (fadeOut > 0 ? interpolate(frame, [duration - fadeOut, duration], [1, 0], clamp) : 1);
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

/** The scene's own photo, blurred and dimmed, as a wash of colour behind it. */
export const Backdrop: React.FC<{ id: PhotoId; strength?: number }> = ({ id, strength = 0.75 }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ opacity: strength, overflow: "hidden" }}>
      <Img
        src={photo(id)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: "blur(46px) brightness(0.66) saturate(1.45)",
          transform: `scale(${1.25 + frame * 0.0006})`,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(27,7,22,0.66) 0%, rgba(58,12,44,0.1) 30%, rgba(58,12,44,0.12) 62%, rgba(27,7,22,0.8) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
