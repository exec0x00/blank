// usage: node katex_render.js in.json out.json   (in: [[tex, display], ...])
const katex = require(process.env.KATEX_PATH || "katex");
const fs = require("fs");
const [inp, out] = process.argv.slice(2);
const items = JSON.parse(fs.readFileSync(inp, "utf8"));
fs.writeFileSync(out, JSON.stringify(items.map(([t, d]) =>
  katex.renderToString(t, { displayMode: d, throwOnError: true, strict: false, output: "html" }))));
