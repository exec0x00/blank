import { loadFont } from "@remotion/fonts";
import { continueRender, delayRender, staticFile } from "remotion";

const faces: Array<[string, string, string, "normal" | "italic"]> = [
  ["Great Vibes", "great-vibes-latin-400-normal", "400", "normal"],
  ["Playfair Display", "playfair-display-latin-400-italic", "400", "italic"],
  ["Playfair Display", "playfair-display-latin-600-italic", "600", "italic"],
  ["Playfair Display", "playfair-display-latin-700-normal", "700", "normal"],
  ["Poppins", "poppins-latin-400-normal", "400", "normal"],
  ["Poppins", "poppins-latin-500-normal", "500", "normal"],
  ["Poppins", "poppins-latin-600-normal", "600", "normal"],
];

const handle = delayRender("Loading fonts");
Promise.all(
  faces.map(([family, file, weight, style]) =>
    loadFont({
      family,
      url: staticFile(`fonts/${file}.woff2`),
      weight,
      style,
    }),
  ),
)
  .then(() => continueRender(handle))
  .catch((err) => {
    console.error("Font loading failed", err);
    continueRender(handle);
  });
