// Screenshot the quote-bot widget in closed + open states.
// Usage: node ss-widget.mjs
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] || 'http://localhost:3000';

const screenshotsDir = path.join(__dirname, 'temporary screenshots');
if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

const existing = fs.readdirSync(screenshotsDir)
  .filter(f => f.match(/^screenshot-(\d+)/))
  .map(f => parseInt(f.match(/^screenshot-(\d+)/)[1]))
  .sort((a, b) => b - a);
let n = (existing[0] || 0) + 1;

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
});

async function cap(page, label, clipBottomRight = true) {
  const filename = `screenshot-${n++}-${label}.png`;
  const out = path.join(screenshotsDir, filename);
  if (clipBottomRight) {
    // Crop to bottom-right area where the widget lives (1440x900 viewport)
    await page.screenshot({
      path: out,
      clip: { x: 900, y: 250, width: 540, height: 650 }
    });
  } else {
    await page.screenshot({ path: out, fullPage: false });
  }
  console.log(`Saved: ${out}`);
}

// Desktop — closed bubble
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3500)); // let nudge appear
  await cap(page, 'widget-closed');

  // Click bubble to open
  await page.click('#gb-bubble');
  await new Promise(r => setTimeout(r, 1200)); // bot greeting returns
  await cap(page, 'widget-open');

  // Send a user message to see the user bubble rendered
  await page.type('#gb-input', 'Gas grill, 4 burner');
  await new Promise(r => setTimeout(r, 200));
  await page.click('#gb-send');
  await new Promise(r => setTimeout(r, 1200));
  await cap(page, 'widget-user-msg');

  await page.close();
}

// Mobile — open panel full-screen
{
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));
  await page.click('#gb-bubble');
  await new Promise(r => setTimeout(r, 1200));
  const filename = `screenshot-${n++}-widget-mobile.png`;
  await page.screenshot({ path: path.join(screenshotsDir, filename), fullPage: false });
  console.log(`Saved: ${path.join(screenshotsDir, filename)}`);
  await page.close();
}

await browser.close();
