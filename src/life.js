/**
 * A fast, dependency-free Conway's Game of Life engine.
 *
 * Cells live in a flat Uint8Array. The age of every living cell is tracked
 * separately so the renderer can grow and tint cells as they survive.
 */
export class Life {
  constructor(size = 56, { wrap = true } = {}) {
    this.size = size;
    this.wrap = wrap;
    this.alive = new Uint8Array(size * size);
    this.next = new Uint8Array(size * size);
    this.age = new Uint16Array(size * size);
    this.generation = 0;
    this.population = 0;
    this._rng = Math.random;
  }

  index(x, y) {
    return y * this.size + x;
  }

  clear() {
    this.alive.fill(0);
    this.next.fill(0);
    this.age.fill(0);
    this.generation = 0;
    this.population = 0;
  }

  /** Sets a cell directly. Returns true when the value changed. */
  setCell(x, y, value) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return false;
    const i = y * this.size + x;
    const nextValue = value ? 1 : 0;
    if (this.alive[i] === nextValue) return false;

    this.alive[i] = nextValue;
    this.population += nextValue ? 1 : -1;
    this.age[i] = nextValue ? 1 : 0;
    return true;
  }

  toggleCell(x, y) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return false;
    const i = y * this.size + x;
    this.setCell(x, y, this.alive[i] ? 0 : 1);
    return Boolean(this.alive[i]);
  }

  /**
   * Fill the board with random cells. `aged` gives the initial soup a richer
   * mix of heights and colours for the opening frame.
   */
  seedRandom(density = 0.24, { rng = Math.random, aged = true } = {}) {
    this.clear();
    const maxAge = Math.max(2, Math.round(density * 72));
    for (let i = 0; i < this.alive.length; i += 1) {
      if (rng() < density) {
        this.alive[i] = 1;
        this.age[i] = aged ? 1 + Math.floor(rng() * maxAge) : 1;
        this.population += 1;
      }
    }
    return this;
  }

  /** Stamp a pattern (array of strings) at the centre of the board. */
  stamp(rows, { x = null, y = null } = {}) {
    const height = rows.length;
    const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
    const startX = x ?? Math.floor((this.size - width) / 2);
    const startY = y ?? Math.floor((this.size - height) / 2);

    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        if (rows[row][col] === 'O' || rows[row][col] === 'o' || rows[row][col] === '1') {
          this.setCell(startX + col, startY + row, 1);
        }
      }
    }
    return this;
  }

  /** Count neighbours around a cell, honouring the wrap setting. */
  neighbours(x, y) {
    const size = this.size;
    const wrap = this.wrap;
    const cells = this.alive;
    let count = 0;

    for (let dy = -1; dy <= 1; dy += 1) {
      let ny = y + dy;
      if (ny < 0) ny = wrap ? size - 1 : -1;
      else if (ny >= size) ny = wrap ? 0 : size;
      if (ny < 0 || ny >= size) continue;

      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        let nx = x + dx;
        if (nx < 0) nx = wrap ? size - 1 : -1;
        else if (nx >= size) nx = wrap ? 0 : size;
        if (nx < 0 || nx >= size) continue;
        count += cells[ny * size + nx];
      }
    }
    return count;
  }

  /** Advance exactly one generation. */
  step() {
    const { size, alive, next, age } = this;
    let population = 0;

    for (let y = 0; y < size; y += 1) {
      const row = y * size;
      for (let x = 0; x < size; x += 1) {
        const i = row + x;
        const n = this.neighbours(x, y);
        const wasAlive = alive[i] === 1;
        const isAlive = n === 3 || (wasAlive && n === 2);
        next[i] = isAlive ? 1 : 0;

        if (isAlive) {
          population += 1;
          if (wasAlive) {
            age[i] = Math.min(age[i] + 1, 65535);
          } else {
            age[i] = 1;
          }
        } else {
          age[i] = 0;
        }
      }
    }

    // Swap buffers so the next generation can be written into the old one.
    this.alive = next;
    this.next = alive;
    this.population = population;
    this.generation += 1;
    return population;
  }
}
