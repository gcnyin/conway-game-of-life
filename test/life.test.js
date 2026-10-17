import test from 'node:test';
import assert from 'node:assert/strict';
import { Life } from '../src/life.js';
import { PATTERNS, patternPopulation } from '../src/patterns.js';

const live = (grid) => {
  const cells = [];
  for (let y = 0; y < grid.size; y += 1) {
    for (let x = 0; x < grid.size; x += 1) {
      if (grid.alive[y * grid.size + x]) cells.push(`${x},${y}`);
    }
  }
  return cells.sort();
};

test('blinker oscillates with a period of two', () => {
  const grid = new Life(7, { wrap: false });
  grid.setCell(3, 2, 1);
  grid.setCell(3, 3, 1);
  grid.setCell(3, 4, 1);

  assert.equal(grid.population, 3);
  grid.step();
  assert.deepEqual(live(grid), ['2,3', '3,3', '4,3'].sort());
  assert.equal(grid.generation, 1);

  grid.step();
  assert.deepEqual(live(grid), ['3,2', '3,3', '3,4'].sort());
  assert.equal(grid.generation, 2);
});

test('block is a still life', () => {
  const grid = new Life(6, { wrap: false });
  grid.stamp(['OO', 'OO']);
  const before = live(grid);

  grid.step();
  assert.deepEqual(live(grid), before);
  assert.equal(grid.population, 4);
});

test('glider translates one cell diagonally every four generations', () => {
  const grid = new Life(20, { wrap: false });
  const rows = PATTERNS.glider.rows;
  grid.stamp(rows, { x: 3, y: 3 });
  const before = live(grid);

  for (let i = 0; i < 4; i += 1) grid.step();
  const after = live(grid);

  const shifted = before
    .map((cell) => cell.split(',').map(Number))
    .map(([x, y]) => `${x + 1},${y + 1}`)
    .sort();
  assert.deepEqual(after, shifted);
  assert.equal(grid.population, 5);
});

test('wrapping lets a blinker cross the board edge', () => {
  const grid = new Life(8, { wrap: true });
  grid.setCell(7, 3, 1);
  grid.setCell(0, 3, 1);
  grid.setCell(1, 3, 1);
  const before = live(grid);

  grid.step();
  assert.deepEqual(live(grid), ['0,2', '0,3', '0,4'].sort());
  grid.step();
  assert.deepEqual(live(grid), before);
});

test('without wrapping, edge neighbours are ignored', () => {
  const grid = new Life(8, { wrap: false });
  grid.setCell(7, 3, 1);
  grid.setCell(0, 3, 1);
  grid.setCell(1, 3, 1);

  // x=7 has one neighbour, x=0 has one, x=1 has two: all die.
  grid.step();
  assert.equal(grid.population, 0);
});

test('age grows for survivors and resets for newborns', () => {
  const grid = new Life(9, { wrap: false });
  grid.setCell(4, 4, 1);
  grid.setCell(4, 5, 1);
  grid.setCell(4, 6, 1);
  grid.age.fill(0);
  grid.age[grid.index(4, 5)] = 9;

  grid.step();
  const middle = grid.index(4, 5);
  assert.equal(grid.alive[middle], 1);
  assert.equal(grid.age[middle], 10);

  const left = grid.index(3, 5);
  assert.equal(grid.alive[left], 1);
  assert.equal(grid.age[left], 1);
});

test('seeded patterns have the expected population and location', () => {
  for (const [key, pattern] of Object.entries(PATTERNS)) {
    if (!pattern.rows) continue;
    const grid = new Life(56);
    grid.stamp(pattern.rows);
    assert.equal(grid.population, patternPopulation(key), `${key} population mismatch`);
  }
});

test('the Gosper gun fits and emits a glider', () => {
  const grid = new Life(56, { wrap: true });
  grid.stamp(PATTERNS.gun.rows);
  const initial = grid.population;
  assert.equal(initial, 36);

  for (let i = 0; i < 30; i += 1) grid.step();
  // A healthy gun keeps its structure and has released a glider.
  assert.ok(grid.population >= 40, `expected population to grow, got ${grid.population}`);
  assert.ok(grid.population <= 60, `expected a stable gun, got ${grid.population}`);
});

test('setCell maintains the population and can be undone', () => {
  const grid = new Life(5);
  assert.equal(grid.setCell(1, 1, 1), true);
  assert.equal(grid.setCell(1, 1, 1), false);
  assert.equal(grid.population, 1);
  assert.equal(grid.toggleCell(1, 1), false);
  assert.equal(grid.population, 0);
  assert.equal(grid.toggleCell(1, 1), true);
  assert.equal(grid.population, 1);
});

test('seedRandom is deterministic with a supplied random source', () => {
  let seed = 42;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const a = new Life(30).seedRandom(0.3, { rng, aged: false });
  const b = new Life(30).seedRandom(0.3, { rng, aged: false });
  assert.ok(a.population > 200 && a.population < 330, `got ${a.population}`);
  assert.ok(b.population > 200 && b.population < 330, `got ${b.population}`);
  assert.ok(a.alive.every((value) => value === 0 || value === 1));
});


test('every seed pattern fits on the 44x44 playfield', () => {
  for (const [key, pattern] of Object.entries(PATTERNS)) {
    if (!pattern.rows) continue;
    const width = Math.max(...pattern.rows.map((row) => row.length));
    const height = pattern.rows.length;
    assert.ok(width <= 44, `${key} is ${width} cells wide`);
    assert.ok(height <= 44, `${key} is ${height} cells tall`);

    const grid = new Life(44);
    grid.stamp(pattern.rows);
    assert.equal(grid.population, patternPopulation(key), `${key} was clipped on the board`);
  }
});
