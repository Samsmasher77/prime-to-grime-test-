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
  args: ['--no-sandbox','--disable-setuid-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']
});

const page = await browser.newPage();
page.on('console', m => console.log('[page]', m.type(), m.text()));
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });

await page.waitForFunction(
  () => window.__bbq3d && window.__bbq3d.partNames && window.__bbq3d.partNames().length > 0,
  { timeout: 30000 }
);
await new Promise(r => setTimeout(r, 800));

await page.evaluate(() => {
  document.querySelector('#explodex').scrollIntoView({ block: 'start' });
  // Dismiss floating newsletter so it doesn't overlay the sidebar
  const nlClose = document.getElementById('nl-close');
  if (nlClose) nlClose.click();
  const nl = document.getElementById('nl-float');
  if (nl) nl.style.display = 'none';
});
await new Promise(r => setTimeout(r, 600));

const section = await page.$('#explodex .explodex-layout');

// 1) idle state — list visible, no selection
const out1 = path.join(screenshotsDir, `screenshot-${nextNum()}-list-idle.png`);
await section.screenshot({ path: out1 });
console.log('Saved:', out1);

// 2) select Burners via list click (via JS for reliability)
await page.evaluate(() => {
  const btns = document.querySelectorAll('.explodex-part-btn');
  for (const b of btns) {
    if (b.getAttribute('data-part-name') === 'Burners') { b.click(); break; }
  }
});
await new Promise(r => setTimeout(r, 2500));
const out2 = path.join(screenshotsDir, `screenshot-${nextNum()}-list-burners.png`);
await section.screenshot({ path: out2 });
console.log('Saved:', out2);

// 3) select Grill Lid
await page.evaluate(() => {
  const btns = document.querySelectorAll('.explodex-part-btn');
  for (const b of btns) {
    if (b.getAttribute('data-part-name') === 'Grill Lid') { b.click(); break; }
  }
});
await new Promise(r => setTimeout(r, 2500));
const out3 = path.join(screenshotsDir, `screenshot-${nextNum()}-list-lid.png`);
await section.screenshot({ path: out3 });
console.log('Saved:', out3);

await browser.close();
