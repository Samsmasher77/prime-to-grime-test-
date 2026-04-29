import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotsDir = path.join(__dirname, 'temporary screenshots');
const existing = fs.readdirSync(screenshotsDir)
  .filter(f => f.match(/^screenshot-(\d+)/))
  .map(f => parseInt(f.match(/^screenshot-(\d+)/)[1]))
  .sort((a,b)=>b-a);
const nextNum = (existing[0]||0)+1;
const label = process.argv[2] || 'bbq';
const explode = process.argv[3] === 'explode';
const out = path.join(screenshotsDir, `screenshot-${nextNum}-${label}.png`);

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--no-sandbox', '--disable-setuid-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--enable-accelerated-2d-canvas'
  ],
});
const page = await browser.newPage();
page.on('console', m => {
  const t = m.text();
  if (/error|Error|WebGL/i.test(t)) console.log('[console]', m.type(), t.slice(0, 200));
});
page.on('pageerror', e => console.log('[pageerror]', e.message));

await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });

await page.evaluate(() => {
  const c = document.getElementById('bbq-canvas');
  if (c) c.scrollIntoView({ block: 'center' });
});

// Wait for the LOADING MODEL overlay to hide
try {
  await page.waitForFunction(() => {
    const loader = document.querySelector('.explodex-loader, #explodex-loader, [class*="loader"]');
    // Fallback: look for element containing "LOADING MODEL"
    const nodes = Array.from(document.querySelectorAll('*')).filter(n => n.children.length === 0 && (n.textContent || '').trim().toUpperCase() === 'LOADING MODEL');
    return nodes.length === 0 || nodes.every(n => {
      let cur = n;
      while (cur && cur !== document.body) {
        if (getComputedStyle(cur).display === 'none') return true;
        cur = cur.parentElement;
      }
      return false;
    });
  }, { timeout: 20000 });
  console.log('model loaded');
} catch (e) {
  console.log('loader wait timed out');
}

await new Promise(r => setTimeout(r, 1500));

if (explode) {
  await page.click('#bbq-explode-btn');
  await new Promise(r => setTimeout(r, 2500));
}

const el = await page.$('.explodex-canvas-wrap');
if (!el) { console.log('no canvas wrap'); process.exit(1); }
await el.screenshot({ path: out });
await browser.close();
console.log('Saved:', out);
