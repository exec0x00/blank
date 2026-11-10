import { staticFile } from "remotion";

export type PhotoId =
  | "baby"
  | "tricycle"
  | "hats"
  | "hat-closeup"
  | "nativity"
  | "balloon"
  | "smile"
  | "net"
  | "sunglasses"
  | "trophy"
  | "forest"
  | "portrait";

/** Where the face sits in each photo (percent), so crops and zooms keep it in view. */
export const focus: Record<PhotoId, [number, number]> = {
  baby: [70, 30],
  tricycle: [42, 22],
  hats: [62, 45],
  "hat-closeup": [50, 62],
  nativity: [34, 26],
  balloon: [45, 34],
  smile: [52, 45],
  net: [60, 30],
  sunglasses: [50, 28],
  trophy: [45, 38],
  forest: [52, 36],
  portrait: [50, 34],
};

export const photo = (id: PhotoId) => staticFile(`photos/${id}.jpg`);
