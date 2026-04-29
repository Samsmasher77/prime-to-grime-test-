import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotsDir = path.join(__dirname, 'temporary screenshots');

function nextNum() {
  const existing = fs.readdirSync(screenshotsDir)
    .filter(f => f.match(/^screenshot-(\d+)/))
    .map(f => parseInt(f.match(/^screenshot-(\d+)/)[1]))
    .sort((a, b) => b - a);
  return (existing[0] || 0) + 1;
}

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--enable-webgl',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist'
  ]
});

const page = await browser.newPage();
page.on('console', m => console.log('[page]', m.type(), m.text()));
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });

await page.evaluate(() => {
  const c = document.getElementById('bbq-canvas');
  if (c) c.scrollIntoView({ block: 'center' });
});

// Poll for GLB load / __bbq3d hook availability
await page.waitForFunction(
  () => window.__bbq3d && window.__bbq3d.partNames && window.__bbq3d.partNames().length > 0,
  { timeout: 30000 }
);
await new Promise(r => setTimeout(r, 800));

const partNames = await page.evaluate(() => window.__bbq3d.partNames());
console.log('Loaded parts:', partNames);

// Explode
await page.evaluate(() => window.__bbq3d.explode());
await new Promise(r => setTimeout(r, 2500));

const canvasWrap = await page.$('.explodex-canvas-wrap');

async function shootPart(name, label) {
  await page.evaluate((n) => window.__bbq3d.selectByName(n), name);
  // Wait for camera lerp to settle
  await new Promise(r => setTimeout(r, 2500));
  const out = path.join(screenshotsDir, `screenshot-${nextNum()}-${label}.png`);
  await canvasWrap.screenshot({ path: out });
  console.log('Saved:', out);
}

await shootPart('Grill Lid', 'select-lid');
await shootPart('Drip Tray', 'select-driptray');

await browser.close();
