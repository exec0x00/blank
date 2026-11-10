import React from "react";
import { Composition } from "remotion";
import "./fonts";
import { FPS, HEIGHT, TOTAL_FRAMES, WIDTH } from "./theme";
import { BirthdayVideo } from "./Video";

export const Root: React.FC = () => (
  <Composition
    id="AleenaBirthday"
    component={BirthdayVideo}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
  />
);
