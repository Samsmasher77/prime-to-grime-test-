import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const url = process.argv[2] || 'http://localhost:3000';
const label = process.argv[3] || '';

// Find next available screenshot number
const screenshotsDir = path.join(__dirname, 'temporary screenshots');
if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

const existing = fs.readdirSync(screenshotsDir)
  .filter(f => f.match(/^screenshot-(\d+)/))
  .map(f => parseInt(f.match(/^screenshot-(\d+)/)[1]))
  .sort((a, b) => b - a);

const nextNum = (existing[0] || 0) + 1;
const filename = label
  ? `screenshot-${nextNum}-${label}.png`
  : `screenshot-${nextNum}.png`;
const outputPath = path.join(screenshotsDir, filename);

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

// Wait a bit for animations/fonts
await new Promise(r => setTimeout(r, 1500));

await page.screenshot({ path: outputPath, fullPage: true });
await browser.close();

console.log(`Screenshot saved: ${outputPath}`);
