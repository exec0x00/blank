// Render preview stills: node scripts/stills.mjs <outDir> <frame> [frame...]
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import path from "node:path";

const [outDir, ...frames] = process.argv.slice(2);
const browserExecutable = process.env.REMOTION_BROWSER || undefined;
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const composition = await selectComposition({ serveUrl, id: "AleenaBirthday", browserExecutable });
for (const f of frames) {
  await renderStill({
    composition,
    serveUrl,
    frame: Number(f),
    output: path.join(outDir, `f${String(f).padStart(4, "0")}.jpg`),
    imageFormat: "jpeg",
    jpegQuality: 85,
    scale: Number(process.env.SCALE || 0.5),
    browserExecutable,
  });
}
console.log("rendered", frames.length, "stills");
