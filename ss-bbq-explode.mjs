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

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });

await page.evaluate(() => {
  const c = document.getElementById('bbq-canvas');
  if (c) c.scrollIntoView({ block: 'center' });
});

// Wait for GLB to fully load (canvas has actual 3D content, not just loading text)
await new Promise(r => setTimeout(r, 10000));

if (explode) {
  await page.click('#bbq-explode-btn');
  await new Promise(r => setTimeout(r, 2500));
}

const el = await page.$('.explodex-canvas-wrap');
if (!el) { console.log('no canvas wrap'); process.exit(1); }
await el.screenshot({ path: out });
await browser.close();
console.log('Saved:', out);
