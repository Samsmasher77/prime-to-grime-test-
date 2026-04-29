import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotsDir = path.join(__dirname, 'temporary screenshots');
let nextNum = fs.readdirSync(screenshotsDir)
  .filter(f => f.match(/^screenshot-(\d+)/))
  .map(f => parseInt(f.match(/^screenshot-(\d+)/)[1]))
  .sort((a,b)=>b-a)[0] || 0;

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox','--disable-setuid-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });

await page.evaluate(() => document.getElementById('bbq-canvas').scrollIntoView({ block: 'center' }));
await new Promise(r => setTimeout(r, 8000));  // wait for GLB load

async function shot(label) {
  nextNum++;
  const out = path.join(screenshotsDir, `screenshot-${nextNum}-${label}.png`);
  const el = await page.$('.explodex-canvas-wrap');
  await el.screenshot({ path: out });
  console.log('Saved:', out);
}

async function dragCanvas(dx, dy) {
  const box = await page.$eval('#bbq-canvas', c => { const r = c.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + dx, box.y + dy, { steps: 20 });
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 2000));  // let camera lerp settle
}

// Front view
await shot('front');

// Rotate ~180° to see back (drag hugely horizontally)
await dragCanvas(1200, 0);
await shot('back');

// Rotate to side
await dragCanvas(-600, 0);
await shot('side');

// Explode and shot from an angled view
await page.click('#bbq-explode-btn');
await new Promise(r => setTimeout(r, 3000));
await shot('explode-side');

await dragCanvas(-600, 0);
await shot('explode-front');

await browser.close();
