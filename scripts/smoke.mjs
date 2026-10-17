import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const chrome =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

if (!existsSync(chrome)) {
  console.error(`Chrome not found at ${chrome}. Set CHROME_PATH to run the smoke test.`);
  process.exit(1);
}

mkdirSync(resolve(root, 'artifacts'), { recursive: true });

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio'],
});

const url = `${pathToFileURL(resolve(root, 'index.html')).href}?debug`;
const errors = [];
const warnings = [];
const externalRequests = [];
const failures = [];

const check = (condition, message) => {
  if (!condition) failures.push(message);
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${message}`);
};

const attachDiagnostics = (page, label = '') => {
  page.on('pageerror', (error) => errors.push(`${label}pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${label}console: ${message.text()}`);
    if (message.type() === 'warning') warnings.push(message.text());
  });
  page.on('request', (request) => {
    const requestUrl = request.url();
    if (!requestUrl.startsWith('file:') && !requestUrl.startsWith('data:') && !requestUrl.startsWith('blob:')) {
      externalRequests.push(requestUrl);
    }
  });
};

const state = async (page) =>
  page.evaluate(() => {
    const debug = window.__LIFE_DEBUG__;
    return {
      generation: Number(document.getElementById('generation').textContent),
      population: Number(document.getElementById('population').textContent),
      status: document.getElementById('status-label').textContent,
      speed: document.getElementById('speed-output').textContent,
      wrap: debug?.sim.wrap ?? null,
      simPopulation: debug?.sim.population ?? null,
      simGeneration: debug?.sim.generation ?? null,
      activeElement: document.activeElement?.id || document.activeElement?.tagName,
    };
  });

const wait = (page, ms) => page.waitForTimeout(ms);

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  attachDiagnostics(page);

  await page.goto(url, { waitUntil: 'load' });
  await wait(page, 3600);
  await page.screenshot({ path: resolve(root, 'artifacts/desktop.png') });

  const initial = await state(page);
  console.log('Initial stats:', initial);
  check(initial.generation > 0, `simulation advanced (generation ${initial.generation})`);
  check(initial.population > 0, `population is non-zero (${initial.population})`);
  check(initial.status.toLowerCase() === 'running', 'status starts as running');
  check(initial.wrap === true, 'toroidal wrapping is on by default');

  const framing = await page.evaluate(() => {
    const box = (selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    return {
      brand: box('.brand'),
      stats: box('.stats'),
      hint: box('.hint-wrap'),
      dock: box('.dock'),
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
  check(framing.brand.right < framing.stats.left, 'brand and statistics panels do not overlap');
  check(
    framing.hint.left > framing.brand.right && framing.hint.right < framing.stats.left,
    'desktop hint sits between the top panels',
  );
  check(framing.dock.bottom <= framing.viewport.height, 'desktop control dock is inside the viewport');

  const canvas = await page.evaluate(() => {
    const context = document.getElementById('scene').getContext('webgl2');
    return {
      webgl: Boolean(context),
      width: document.getElementById('scene').width,
      height: document.getElementById('scene').height,
    };
  });
  check(canvas.webgl, 'WebGL context is live');
  check(canvas.width >= 1440 && canvas.height >= 900, 'canvas is sized to the viewport');

  await page.getByRole('button', { name: 'Pause simulation' }).click();
  check((await state(page)).status.toLowerCase() === 'paused', 'play button pauses the simulation');

  const beforeStep = (await state(page)).generation;
  await page.getByRole('button', { name: 'Advance one generation' }).click();
  check((await state(page)).generation === beforeStep + 1, 'step advances exactly one generation');

  await page.getByRole('button', { name: 'Wrap edges' }).click();
  check((await state(page)).wrap === false, 'wrap toggle disables toroidal edges');
  await page.getByRole('button', { name: 'Wrap edges' }).click();
  check((await state(page)).wrap === true, 'wrap toggle restores toroidal edges');

  await page.locator('#draw').click();
  check((await page.locator('#draw').getAttribute('aria-pressed')) === 'true', 'draw mode toggles on');
  await page.keyboard.press('Escape');
  check((await page.locator('#draw').getAttribute('aria-pressed')) === 'false', 'Escape exits draw mode');

  await page.locator('#step').focus();
  await page.keyboard.press('r');
  await wait(page, 250);
  const randomized = await state(page);
  check(randomized.population > 100, 'R randomizes the board while a button is focused');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Space');
  await wait(page, 150);
  const spacePaused = await state(page);
  check(
    spacePaused.status.toLowerCase() === 'paused' || spacePaused.status.toLowerCase() === 'extinct',
    'Space pauses the simulation',
  );

  await page.selectOption('#seed', 'gun');
  await wait(page, 150);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Space');
  await wait(page, 150);
  const gun = await state(page);
  check(
    gun.simPopulation >= 30 && gun.simPopulation <= 60,
    `Gosper glider gun seeds correctly (population ${gun.simPopulation}, generation ${gun.simGeneration})`,
  );

  // Clear, then click the centre of the viewport to create a cell.
  await page.getByRole('button', { name: 'Clear the board' }).click();
  await wait(page, 150);
  check((await state(page)).population === 0, 'clear empties the board');
  await page.mouse.click(720, 450);
  await wait(page, 250);
  check((await state(page)).population === 1, 'clicking the board toggles one cell');
  await page.screenshot({ path: resolve(root, 'artifacts/desktop-edited.png') });

  await page.getByRole('button', { name: 'Clear the board' }).click();
  await page.locator('#draw').click();
  await page.mouse.move(650, 420);
  await page.mouse.down();
  await page.mouse.move(760, 500, { steps: 8 });
  await page.mouse.up();
  await wait(page, 300);
  const stroked = await state(page);
  check(stroked.population > 1, `draw mode paints strokes (population ${stroked.population})`);
  check(stroked.status.toLowerCase() === 'paused', 'painting pauses a running simulation');

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
  );
  check(!overflow, 'desktop has no page scroll');

  await page.close();

  // Mobile portrait ---------------------------------------------------------
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  attachDiagnostics(mobile, 'mobile: ');
  await mobile.goto(url, { waitUntil: 'load' });
  await wait(mobile, 3400);
  await mobile.screenshot({ path: resolve(root, 'artifacts/mobile.png') });

  const mobileLayout = await mobile.evaluate(() => {
    const dock = document.querySelector('.dock').getBoundingClientRect();
    const touchHint = document.querySelector('.touch-hint');
    return {
      dockWidth: Math.round(dock.width),
      dockBottom: Math.round(dock.bottom),
      viewport: window.innerWidth,
      viewportHeight: window.innerHeight,
      overflowsX: document.documentElement.scrollWidth > window.innerWidth,
      touchHintVisible: getComputedStyle(touchHint).display !== 'none',
    };
  });
  console.log('Mobile layout:', mobileLayout);
  check(!mobileLayout.overflowsX, 'no horizontal page overflow on mobile');
  check(mobileLayout.dockBottom <= mobileLayout.viewportHeight, 'mobile controls stay inside the viewport');
  check(mobileLayout.touchHintVisible, 'mobile shows the touch gesture hint');

  await mobile.getByRole('button', { name: 'Pause simulation' }).click();
  await mobile.getByRole('button', { name: 'Clear the board' }).click();
  await wait(mobile, 150);
  await mobile.touchscreen.tap(195, 400);
  await wait(mobile, 300);
  const tapped = await state(mobile);
  check(tapped.population === 1, `touch tap toggles a cell on mobile (population ${tapped.population})`);
  await mobile.close();

  // Responsive layouts ------------------------------------------------------
  for (const [width, height, label] of [
    [1024, 768, 'tablet'],
    [812, 375, 'landscape'],
  ]) {
    const responsive = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
      isMobile: width < 900,
      hasTouch: width < 900,
    });
    attachDiagnostics(responsive, `${label}: `);
    await responsive.goto(url, { waitUntil: 'load' });
    await wait(responsive, 2800);
    const layout = await responsive.evaluate(() => {
      const dock = document.querySelector('.dock').getBoundingClientRect();
      return {
        overflowX: document.documentElement.scrollWidth > innerWidth,
        overflowY: document.documentElement.scrollHeight > innerHeight,
        dockLeft: dock.left,
        dockRight: dock.right,
        dockTop: dock.top,
        dockBottom: dock.bottom,
        width: innerWidth,
        height: innerHeight,
      };
    });
    check(
      !layout.overflowX && !layout.overflowY,
      `${label} (${width}x${height}) has no page scroll`,
    );
    check(
      layout.dockLeft >= 0 &&
        layout.dockRight <= layout.width &&
        layout.dockTop >= 0 &&
        layout.dockBottom <= layout.height,
      `${label} control dock fits inside the viewport`,
    );
    await responsive.screenshot({ path: resolve(root, `artifacts/${label}.png`) });
    await responsive.close();
  }
} finally {
  if (warnings.length) {
    console.log(`\n${warnings.length} console warning(s):`);
    for (const warning of warnings.slice(0, 8)) console.log(`  ${warning}`);
  }
  if (errors.length) {
    console.log(`\n${errors.length} console/page error(s):`);
    for (const error of errors) console.log(`  ${error}`);
  }
  await browser.close();
}

check(!externalRequests.length, `standalone page makes no external network requests${externalRequests.length ? `: ${externalRequests.join(', ')}` : ''}`);
if (errors.length) failures.push('browser reported console errors');
if (failures.length) {
  console.log(`\nSmoke test failed (${failures.length}):`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}

console.log('\nSmoke test passed. Screenshots in artifacts/.');
