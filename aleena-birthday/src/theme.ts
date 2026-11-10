export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
/** One 3/4 bar of the soundtrack. Every cut sits on a bar line. */
export const BAR = 50;
/** Frames two neighbouring scenes overlap while they cross-fade. */
export const OVERLAP = 12;
export const TOTAL_FRAMES = 1860;

export const NAME = "Aleena";

export const color = {
  night: "#1b0716",
  plum: "#3a0c2c",
  wine: "#6d1640",
  rose: "#c2386b",
  blush: "#ffd3dc",
  cream: "#fff7ea",
  gold: "#f6c667",
  goldDeep: "#d99a2b",
  goldPale: "#fff0c2",
  coral: "#ff7a6b",
  teal: "#5fd3c4",
};

export const font = {
  script: "Great Vibes",
  serif: "Playfair Display",
  sans: "Poppins",
};

export const goldGradient =
  "linear-gradient(175deg, #fff6d2 5%, #f9dc85 32%, #e0a23a 58%, #fbe6a0 78%, #c98a22 100%)";

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

/** Scene start frames. */
export const T = {
  intro: 0,
  baby: 4 * BAR,
  tricycle: 6 * BAR,
  hats: 8 * BAR,
  hatCloseup: 10 * BAR,
  montage: 12 * BAR,
  sunglasses: 16 * BAR,
  trophy: 18 * BAR,
  forest: 20 * BAR,
  today: 22 * BAR,
  reveal: 24 * BAR,
  wall: 30 * BAR,
  finale: 33 * BAR + 10,
  end: TOTAL_FRAMES,
};
