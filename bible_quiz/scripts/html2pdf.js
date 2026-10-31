// Convert a paginated quiz HTML file into PDF with headless Chromium.
// Usage: node html2pdf.js input.html output.pdf
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const [inp, out] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const warnings = [];
  page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text()); });
  await page.goto('file://' + path.resolve(inp), { waitUntil: 'load' });
  await page.waitForFunction('window.__paginated === true', null, { timeout: 180000 });
  const info = await page.evaluate(() => {
    const pages = [...document.querySelectorAll('.page')];
    const over = pages.filter(p => p.scrollHeight > p.clientHeight + 1).length;
    const fontsOk = document.fonts.check("11pt 'Noto Serif Kannada'") && document.fonts.check("9pt 'Noto Sans Kannada'");
    return { pages: pages.length, overflowing: over, fontsOk };
  });
  await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true });
  await browser.close();
  console.log(JSON.stringify({ out, ...info, warnings }));
  if (info.overflowing || !info.fontsOk || warnings.length) process.exit(2);
})();
