// usage: node build/katex_render.mjs < in.json > out.json
// in:  [{"tex": "...", "display": true|false}, ...]   out: ["<span class=katex>…", ...]
import katex from "katex";
import { readFileSync } from "node:fs";

const items = JSON.parse(readFileSync(0, "utf8"));
const out = items.map(({ tex, display }) =>
  katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: "ignore", output: "html" })
);
process.stdout.write(JSON.stringify(out));
