import { Life } from './life.js';
import { LifeScene } from './scene.js';
import { PATTERNS, SEED_ORDER } from './patterns.js';

/* --------------------------------------------------------------------------
   Population sparkline
   -------------------------------------------------------------------------- */

class PopulationChart {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.values = [];
    this.dirty = true;
    this.maxPoints = 150;
    this.resizeObserver = new ResizeObserver(() => {
      this.dirty = true;
    });
    this.resizeObserver.observe(canvas);
  }

  reset(population = 0) {
    this.values = [population];
    this.dirty = true;
  }

  push(population) {
    this.values.push(population);
    if (this.values.length > this.maxPoints) this.values.shift();
    this.dirty = true;
  }

  render() {
    if (!this.dirty) return;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width < 2 || height < 2) {
    // The chart is hidden by the responsive layout. ResizeObserver will mark
    // it dirty again when it becomes visible.
    this.dirty = false;
    return;
  }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }

    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    this.dirty = false;

    const top = 5;
    const bottom = height - 2;
    const values = this.values;
    const maximum = Math.max(100, ...values);
    const step = width / Math.max(1, values.length - 1);
    const startX = width - Math.max(0, values.length - 1) * step;
    const pointAt = (index) => {
      const x = startX + index * step;
      const y = bottom - (values[index] / maximum) * (bottom - top);
      return [x, Math.min(bottom, Math.max(top, y))];
    };

    // Baseline
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(148, 221, 255, 0.09)';
    ctx.lineWidth = 1;
    ctx.moveTo(0, bottom + 0.5);
    ctx.lineTo(width, bottom + 0.5);
    ctx.stroke();

    if (values.length > 1) {
      const points = values.map((_, index) => pointAt(index));

      const area = ctx.createLinearGradient(0, top, 0, bottom);
      area.addColorStop(0, 'rgba(86, 243, 220, 0.26)');
      area.addColorStop(0.65, 'rgba(62, 170, 255, 0.08)');
      area.addColorStop(1, 'rgba(62, 170, 255, 0)');
      ctx.beginPath();
      ctx.moveTo(points[0][0], bottom);
      for (const [x, y] of points) ctx.lineTo(x, y);
      ctx.lineTo(points[points.length - 1][0], bottom);
      ctx.closePath();
      ctx.fillStyle = area;
      ctx.fill();

      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, 'rgba(64, 176, 255, 0.55)');
      gradient.addColorStop(0.7, 'rgba(95, 255, 226, 0.85)');
      gradient.addColorStop(1, 'rgba(230, 255, 250, 0.98)');
      ctx.beginPath();
      points.forEach(([x, y], index) => {
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 1.25;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    const [lastX, lastY] = pointAt(values.length - 1);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 1.7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(203, 255, 246, 0.98)';
    ctx.shadowColor = 'rgba(105, 255, 226, 0.9)';
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

/* --------------------------------------------------------------------------
   DOM
   -------------------------------------------------------------------------- */

const canvas = document.getElementById('scene');
const elements = {
  play: document.getElementById('play'),
  playLabel: document.getElementById('play-label'),
  step: document.getElementById('step'),
  randomize: document.getElementById('randomize'),
  clear: document.getElementById('clear'),
  seed: document.getElementById('seed'),
  speed: document.getElementById('speed'),
  speedOutput: document.getElementById('speed-output'),
  wrap: document.getElementById('wrap'),
  draw: document.getElementById('draw'),
  orbit: document.getElementById('orbit'),
  generation: document.getElementById('generation'),
  population: document.getElementById('population'),
  density: document.getElementById('density'),
  status: document.getElementById('status'),
  statusLabel: document.getElementById('status-label'),
  hint: document.getElementById('hint'),
  chart: document.getElementById('chart'),
};

for (const key of SEED_ORDER) {
  const option = document.createElement('option');
  option.value = key;
  option.textContent = PATTERNS[key].label;
  option.title = PATTERNS[key].description;
  elements.seed.append(option);
}
elements.seed.value = 'soup';

const chart = new PopulationChart(elements.chart);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let sim;
let scene;
let running = true;
let speed = 8;
let drawMode = false;
let accumulator = 0;
let lastFrame = performance.now();

try {
  sim = new Life(44, { wrap: true }).seedRandom(0.28, { aged: true });

  scene = new LifeScene(canvas, {
    sim,
    onEditStart: () => {
      if (running) setRunning(false);
    },
    onToggle: (x, y) => {
      sim.toggleCell(x, y);
      scene.syncColors();
      updateStats();
    },
    onPaint: (cells, value) => {
      for (const [x, y] of cells) sim.setCell(x, y, value);
      scene.syncColors();
      updateStats();
    },
    onPaintEnd: () => {
      updateStats();
    },
  });
} catch (error) {
  console.error(error);
  showFatal(error);
}

if (scene) {
  setupControls();
  syncToggle(elements.orbit, scene.autoOrbit);
  syncToggle(elements.draw, false);
  updateSpeedUI();
  updateHint();
  chart.reset(sim.population);
  updateStats();
  scene.syncColors();
  if (new URLSearchParams(window.location.search).has('debug')) {
    window.__LIFE_DEBUG__ = {
      sim,
      scene,
      get running() {
        return running;
      },
    };
  }
  requestAnimationFrame(loop);
}

/* --------------------------------------------------------------------------
   Interface wiring
   -------------------------------------------------------------------------- */

function setupControls() {
  elements.play.addEventListener('click', togglePlayback);
  elements.step.addEventListener('click', stepOnce);
  elements.randomize.addEventListener('click', randomizeWorld);
  elements.clear.addEventListener('click', clearWorld);

  elements.seed.addEventListener('change', () => {
    applySeed(elements.seed.value);
  });

  elements.speed.addEventListener('input', () => {
    speed = Number(elements.speed.value);
    updateSpeedUI();
  });

  elements.wrap.addEventListener('click', () => {
    sim.wrap = !sim.wrap;
    syncToggle(elements.wrap, sim.wrap);
    updateHint();
  });

  elements.draw.addEventListener('click', () => {
    setDrawMode(!drawMode);
  });

  elements.orbit.addEventListener('click', () => {
    scene.setAutoOrbit(!scene.autoOrbit);
    syncToggle(elements.orbit, scene.autoOrbit);
  });

  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('resize', () => {
    chart.dirty = true;
  });
}

function handleKeydown(event) {
  if (event.repeat) return;

  if (event.key === 'Escape') {
    if (drawMode) {
      event.preventDefault();
      setDrawMode(false);
    }
    return;
  }

  if (event.metaKey || event.ctrlKey || event.altKey) return;

  const target = event.target;
  const isTextEntry =
    target instanceof HTMLElement && target.closest('input, select, textarea, [contenteditable]');
  if (isTextEntry) return;

  // Keep native button activation (Space / Enter) intact, but allow the
  // application's letter shortcuts to work while a button happens to be focused.
  const isButton = target instanceof HTMLElement && target.closest('button');
  if (isButton && (event.code === 'Space' || event.key === 'Enter')) return;

  const key = event.key.toLowerCase();
  if (event.code === 'Space' || key === ' ') {
    event.preventDefault();
    togglePlayback();
  } else if (key === 's') {
    event.preventDefault();
    stepOnce();
  } else if (key === 'r') {
    event.preventDefault();
    randomizeWorld();
  } else if (key === 'c') {
    event.preventDefault();
    clearWorld();
  } else if (key === 'w') {
    event.preventDefault();
    elements.wrap.click();
  } else if (key === 'p') {
    event.preventDefault();
    setDrawMode(!drawMode);
  } else if (key === 'o') {
    event.preventDefault();
    elements.orbit.click();
  }
}

/* --------------------------------------------------------------------------
   Simulation actions
   -------------------------------------------------------------------------- */

function togglePlayback() {
  if (!running && sim.population === 0) {
    randomizeWorld();
    return;
  }
  setRunning(!running);
}

function setRunning(next) {
  running = next;
  accumulator = 0;
  syncPlayButton();
  updateStatus();
}

function syncPlayButton() {
  elements.play.dataset.running = String(running);
  elements.play.setAttribute('aria-label', running ? 'Pause simulation' : 'Play simulation');
  elements.playLabel.textContent = running ? 'Pause' : 'Play';
}

function stepOnce() {
  if (sim.population === 0) {
    setRunning(false);
    updateStatus();
    return;
  }
  setRunning(false);
  advance();
}

function randomizeWorld() {
  sim.seedRandom(0.28, { aged: true });
  elements.seed.value = 'soup';
  chart.reset(sim.population);
  scene.syncColors();
  setRunning(true);
  updateStats();
}

function clearWorld() {
  sim.clear();
  chart.reset(0);
  scene.syncColors();
  setRunning(false);
  updateStats();
}

function applySeed(key) {
  if (key === 'soup') {
    randomizeWorld();
    return;
  }

  const pattern = PATTERNS[key];
  if (!pattern?.rows) return;

  sim.clear();
  sim.stamp(pattern.rows);
  chart.reset(sim.population);
  scene.syncColors();
  setRunning(true);
  updateStats();
}

function advance() {
  sim.step();
  chart.push(sim.population);
  scene.syncColors();
  if (sim.population === 0 && running) setRunning(false);
  updateStats();
}

function setDrawMode(enabled) {
  drawMode = enabled;
  scene.setPaintMode(enabled);
  syncToggle(elements.draw, enabled);
  updateHint();
}

/* --------------------------------------------------------------------------
   UI updates
   -------------------------------------------------------------------------- */

function updateStats() {
  const total = sim.size * sim.size;
  elements.generation.textContent = String(sim.generation).padStart(4, '0');
  elements.population.textContent = String(sim.population).padStart(4, '0');
  elements.density.textContent = `${((sim.population / total) * 100).toFixed(1)}%`;
  chart.dirty = true;
  updateStatus();
}

function updateStatus() {
  let state;
  let label;
  if (running) {
    state = 'running';
    label = 'Running';
  } else if (sim.population === 0 && sim.generation > 0) {
    state = 'extinct';
    label = 'Extinct';
  } else {
    state = 'paused';
    label = 'Paused';
  }

  if (elements.status.dataset.state !== state) {
    elements.status.dataset.state = state;
  }
  if (elements.statusLabel.textContent !== label) {
    elements.statusLabel.textContent = label;
  }
}

function updateSpeedUI() {
  const min = Number(elements.speed.min);
  const max = Number(elements.speed.max);
  const fill = ((speed - min) / (max - min)) * 100;
  elements.speed.style.setProperty('--fill', `${fill}%`);
  elements.speedOutput.textContent = `${speed} /s`;
}

function syncToggle(button, enabled) {
  button.classList.toggle('is-on', enabled);
  button.setAttribute('aria-pressed', String(enabled));
}

function updateHint() {
  if (drawMode) {
    elements.hint.classList.add('is-paint');
    elements.hint.innerHTML =
      '<span class="hint-desktop">Draw mode — drag across cells to paint · <kbd>Esc</kbd> to exit</span>' +
      '<span class="hint-mobile">Draw mode — drag across cells to paint</span>';
  } else {
    elements.hint.classList.remove('is-paint');
    elements.hint.innerHTML =
      '<span class="hint-desktop">Drag to orbit · click a cell to toggle · <kbd>Shift</kbd> + drag to paint</span>' +
      '<span class="hint-mobile">Drag to orbit · tap cells to toggle</span>';
  }
}

/* --------------------------------------------------------------------------
   Main loop
   -------------------------------------------------------------------------- */

function loop(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  if (running) {
    accumulator += dt * speed;
    let steps = 0;
    while (accumulator >= 1 && steps < 8) {
      advance();
      accumulator -= 1;
      steps += 1;
      if (!running) break;
    }
    if (steps === 8) accumulator = 0;
  }

  scene.render(dt, now);
  chart.render();
  requestAnimationFrame(loop);
}

/* --------------------------------------------------------------------------
   Fatal fallback
   -------------------------------------------------------------------------- */

function showFatal(error) {
  const overlay = document.createElement('div');
  overlay.className = 'fatal';
  overlay.innerHTML = `
    <div class="fatal-card">
      <h2>WebGL is unavailable</h2>
      <p>
        This cellular automaton needs WebGL to render its three-dimensional
        cells. Try a current version of Chrome, Firefox or Safari with hardware
        acceleration enabled.
      </p>
    </div>
  `;
  overlay.title = error instanceof Error ? error.message : String(error);
  document.body.append(overlay);
}
