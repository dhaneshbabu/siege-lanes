// Renders the TV banner and launcher icons into the Android project. Needs the dev server running
// (node dev/server.mjs dist) and Playwright.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

await esbuild.build({ entryPoints: ['tools/banner.js'], bundle: true, format: 'iife', outfile: 'dist/banner.js', logLevel: 'warning' });
fs.writeFileSync('dist/banner.html', '<!doctype html><link rel="stylesheet" href="fonts.css"><body style="margin:0;background:#151a22"><canvas id="b" width="640" height="360"></canvas><script src="banner.js"></script>');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto('http://localhost:8080/banner.html');
await page.waitForFunction(() => document.title === 'done');
const res = 'android/app/src/main/res';
fs.mkdirSync(`${res}/drawable-xhdpi`, { recursive: true });
const big = await page.locator('#b').screenshot();
fs.writeFileSync('dist/banner-640.png', big);
await browser.close();
fs.rmSync('dist/banner.html');
fs.rmSync('dist/banner.js');
console.log('banner drawn');
