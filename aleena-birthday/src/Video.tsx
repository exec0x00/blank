import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Background, Vignette } from "./components/Background";
import { Finale } from "./scenes/Finale";
import { FullBleed } from "./scenes/FullBleed";
import { Intro } from "./scenes/Intro";
import { Memory, MemoryProps } from "./scenes/Memory";
import { Montage } from "./scenes/Montage";
import { Reveal } from "./scenes/Reveal";
import { Today } from "./scenes/Today";
import { Wall } from "./scenes/Wall";
import { OVERLAP, T, clamp } from "./theme";

type Cut = { from: number; to: number; overlap?: number; render: (duration: number) => React.ReactNode };

const memory = (props: Omit<MemoryProps, "duration">) => (duration: number) => (
  <Memory {...props} duration={duration} />
);

const CUTS: Cut[] = [
  { from: T.intro, to: T.baby, render: (d) => <Intro duration={d} /> },
  {
    from: T.baby,
    to: T.tricycle,
    render: memory({ id: "baby", kicker: "Where it all began", caption: "Our tiny bundle of joy", tilt: -2.5, from: -1 }),
  },
  {
    from: T.tricycle,
    to: T.hats,
    render: memory({ id: "tricycle", kicker: "First adventures", caption: "Little wheels, big dreams", tilt: 2.5, from: 1 }),
  },
  {
    from: T.hats,
    to: T.hatCloseup,
    render: memory({
      id: "hats",
      kicker: "Partners in crime",
      caption: "Tiny hats & the sweetest smiles",
      width: 980,
      height: 770,
      tilt: -2,
      from: -1,
    }),
  },
  {
    from: T.hatCloseup,
    to: T.montage,
    render: memory({
      id: "hat-closeup",
      kicker: "Those eyes",
      caption: "Too cute to handle",
      width: 900,
      height: 930,
      tilt: 2,
      from: 1,
    }),
  },
  { from: T.montage, to: T.sunglasses, render: (d) => <Montage duration={d} /> },
  {
    from: T.sunglasses,
    to: T.trophy,
    render: memory({ id: "sunglasses", kicker: "Swag since day one", caption: "Born a little rockstar", tilt: -2.5, from: -1 }),
  },
  {
    from: T.trophy,
    to: T.forest,
    render: memory({
      id: "trophy",
      kicker: "Carol singing champion",
      caption: "A voice that wins hearts & trophies",
      tilt: 2,
      from: 1,
      sparkles: true,
    }),
  },
  {
    from: T.forest,
    to: T.today,
    render: (d) => <FullBleed id="forest" kicker="All grown up" caption="Graceful, kind & wonderful" duration={d} />,
  },
  { from: T.today, to: T.reveal, overlap: 0, render: (d) => <Today duration={d} /> },
  { from: T.reveal, to: T.wall, render: (d) => <Reveal duration={d} /> },
  { from: T.wall, to: T.finale, render: (d) => <Wall duration={d} /> },
  { from: T.finale, to: T.end, overlap: 0, render: (d) => <Finale duration={d} /> },
];

/** A burst of warm light that carries the cut into the reveal. */
const Flash: React.FC = () => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [T.reveal - 10, T.reveal, T.reveal + 26], [0, 1, 0], clamp);
  if (o === 0) return null;
  return (
    <AbsoluteFill
      style={{ background: "radial-gradient(circle at 50% 45%, #ffffff 0%, #fff0c2 45%, #f6c667 100%)", opacity: o }}
    />
  );
};

export const BirthdayVideo: React.FC = () => (
  <AbsoluteFill style={{ background: "#0c020a" }}>
    <Background />
    {CUTS.map((cut, i) => {
      const duration = cut.to - cut.from + (cut.overlap ?? OVERLAP);
      return (
        <Sequence key={i} from={cut.from} durationInFrames={duration}>
          {cut.render(duration)}
        </Sequence>
      );
    })}
    <Vignette />
    <Flash />
    <Audio src={staticFile("audio/music.mp3")} />
  </AbsoluteFill>
);
