import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--use-gl=swiftshader'] });
const page = await browser.newPage();
page.on('console', m => console.log('[console]', m.type(), m.text()));
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('requestfailed', r => console.log('[reqfail]', r.url(), r.failure()?.errorText));

await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise(r => setTimeout(r, 6000));

const state = await page.evaluate(() => ({
  loaderVisible: (() => { const e = document.querySelector('#explodex .model-loader, #explodex [class*="loading"]'); return e ? getComputedStyle(e).display : 'n/a'; })(),
  canvasChildCount: (window.scene && window.scene.children && window.scene.children.length) || 'no-scene',
  gltfLoader: !!(window.THREE && window.THREE.GLTFLoader),
  threeVer: window.THREE && window.THREE.REVISION
}));
console.log('STATE:', JSON.stringify(state, null, 2));

await browser.close();
