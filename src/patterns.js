/**
 * Seed patterns and palette metadata shared by the app and the tests.
 * Only live cells are written as "O"; everything else is treated as dead.
 */
export const PATTERNS = {
  soup: {
    label: 'Random soup',
    description: 'Dense primordial chaos — a new world every time.',
  },
  glider: {
    label: 'Glider',
    description: 'The smallest spaceship. Travels one cell diagonally every four generations.',
    rows: [
      '.O.',
      '..O',
      'OOO',
    ],
  },
  lwss: {
    label: 'Lightweight spaceship',
    description: 'A zippy four-row spaceship that glides horizontally across the grid.',
    rows: [
      '.O..O',
      'O....',
      'O...O',
      'OOOO.',
    ],
  },
  pulsar: {
    label: 'Pulsar',
    description: 'A large, symmetric oscillator with a period of three generations.',
    rows: [
      '..OOO...OOO..',
      '.............',
      'O....O.O....O',
      'O....O.O....O',
      'O....O.O....O',
      '..OOO...OOO..',
      '.............',
      '..OOO...OOO..',
      'O....O.O....O',
      'O....O.O....O',
      'O....O.O....O',
      '.............',
      '..OOO...OOO..',
    ],
  },
  rpentomino: {
    label: 'R-pentomino',
    description: 'Five cells that erupt into a long-lived, chaotic colony.',
    rows: [
      '.OO',
      'OO.',
      '.O.',
    ],
  },
  acorn: {
    label: 'Acorn',
    description: 'Seven cells that unfold into a sprawling, 5,000-generation dynasty.',
    rows: [
      '.O.....',
      '...O...',
      'OO..OOO',
    ],
  },
  gun: {
    label: 'Gosper glider gun',
    description: 'The first known gun: fires a fresh glider every 30 generations.',
    rows: [
      '........................O...........',
      '......................O.O...........',
      '............OO......OO............OO',
      '...........O...O....OO............OO',
      'OO........O.....O...OO..............',
      'OO........O...O.OO....O.O...........',
      '..........O.....O.......O...........',
      '...........O...O....................',
      '............OO......................',
    ],
  },
};

export const SEED_ORDER = ['soup', 'glider', 'lwss', 'pulsar', 'rpentomino', 'acorn', 'gun'];

/** Count living cells in a pattern without touching a board. */
export function patternPopulation(key) {
  const pattern = PATTERNS[key];
  if (!pattern?.rows) return 0;
  return pattern.rows.reduce(
    (total, row) => total + [...row].filter((char) => char === 'O').length,
    0,
  );
}
