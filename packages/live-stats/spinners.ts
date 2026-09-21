/**
 * Two-cell braille spinner animations for the working line.
 *
 * Every frame is exactly two code points from the braille block (U+2800..U+28FF), so a frame
 * covers two terminal columns and the working line never changes width. Each cell holds a 2x4 dot
 * grid, and both cells together hold a 4x4 dot grid, which is the canvas every animation draws on.
 */

export type BrailleSpinner = {
  id: string;
  name: string;
  description: string;
  intervalMs: number;
  frames: readonly string[];
};

const BRAILLE_BASE = 0x2800;
const ROWS = 4;
const COLS = 4;

type Grid = boolean[][];

/** A dot on the 4x4 canvas: the row, then the column. */
type Cell = readonly [number, number];

/** Clockwise cells of the 4x4 border, starting at the top left corner. */
const PERIMETER: readonly Cell[] = [
  [0, 0],
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 3],
  [2, 3],
  [3, 3],
  [3, 2],
  [3, 1],
  [3, 0],
  [2, 0],
  [1, 0],
];

/** Inward spiral through all sixteen cells. */
const SPIRAL: readonly Cell[] = [
  [0, 0],
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 3],
  [2, 3],
  [3, 3],
  [3, 2],
  [3, 1],
  [3, 0],
  [2, 0],
  [1, 0],
  [1, 1],
  [1, 2],
  [2, 2],
  [2, 1],
];

/** The inward spiral plus its outward return, so one lap reaches the middle and comes back. */
const SPIRAL_RUN: readonly Cell[] = [...SPIRAL, ...SPIRAL.slice(1, -1).reverse()];

/** The same lap wound the other way around. */
const SPIRAL_RUN_REVERSED: readonly Cell[] = mirrorPath(SPIRAL_RUN);

/** Right lobe of the infinity sign: the ring of the right two columns, clockwise. */
const RIGHT_LOBE: readonly Cell[] = [
  [1, 2],
  [0, 2],
  [0, 3],
  [1, 3],
  [2, 3],
  [3, 3],
  [3, 2],
  [2, 2],
];

/** Left lobe of the infinity sign, entered from the middle and circled the other way. */
const LEFT_LOBE: readonly Cell[] = [
  [2, 1],
  [3, 1],
  [3, 0],
  [2, 0],
  [1, 0],
  [0, 0],
  [0, 1],
  [1, 1],
];

/** The infinity sign: right lobe, cross to the left lobe, and back. */
const INFINITY_PATH: readonly Cell[] = [...RIGHT_LOBE, ...LEFT_LOBE];

/** The standing eight: the same loop turned through a quarter turn. */
const EIGHT_PATH: readonly Cell[] = rotatePath(INFINITY_PATH);

/** One lap of the snake: a wave to the right, a climb, a wave back to the left, and a drop. */
const SNAKE_TRACK: readonly Cell[] = [
  [2, 0],
  [3, 0],
  [3, 1],
  [2, 1],
  [2, 2],
  [3, 2],
  [3, 3],
  [2, 3],
  [1, 3],
  [0, 3],
  [0, 2],
  [1, 2],
  [1, 1],
  [0, 1],
  [0, 0],
  [1, 0],
];

/** Cells the snake keeps behind its head. The body length never changes. */
const SNAKE_LENGTH = 6;

/** The same lap stood on end, so the snake climbs one wave and drops down the other. */
const SIDEWINDER_TRACK: readonly Cell[] = rotatePath(SNAKE_TRACK);

/** Cells of the hurdle that Hop jumps over, and the arc the dot takes over it. */
const HOP_PATH: readonly Cell[] = [
  [3, 0],
  [2, 1],
  [1, 1],
  [1, 2],
  [2, 2],
  [3, 3],
];

/** Heights of the bouncing dot inside its lane. */
const BOUNCE_LIFTS: readonly number[] = [2, 1, 0, 1, 2, 3];

/** Four drops of Rain: the column, the step size, and the start offset. */
const RAIN_DROPS: readonly (readonly [number, number, number])[] = [
  [0, 1, 0],
  [1, 3, 2],
  [2, 1, 5],
  [3, 3, 6],
];

/** Four bars of the plus sign, the X, the two bars, and the X again. */
const STAR_SHAPES: readonly (readonly Cell[])[] = [
  [
    [0, 1],
    [0, 2],
    [1, 1],
    [1, 2],
    [2, 1],
    [2, 2],
    [3, 1],
    [3, 2],
  ],
  [
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [0, 3],
    [1, 2],
    [2, 1],
    [3, 0],
  ],
  [
    [1, 0],
    [1, 1],
    [1, 2],
    [1, 3],
    [2, 0],
    [2, 1],
    [2, 2],
    [2, 3],
  ],
  [
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [0, 3],
    [1, 2],
    [2, 1],
    [3, 0],
  ],
];

/** Open and shut eyes of Blink: 2 is open, 0 is shut. */
const BLINK_POSES: readonly Cell[] = [
  [2, 2],
  [0, 0],
  [2, 0],
  [0, 0],
  [0, 2],
  [0, 0],
];

type ShapeName = "dot" | "small" | "medium" | "full";

/** Centered shapes that keep the 4x4 canvas symmetric about its middle. */
const SHAPES: Record<ShapeName, readonly Cell[]> = {
  dot: [[1, 1]],
  small: [
    [1, 1],
    [1, 2],
    [2, 1],
    [2, 2],
  ],
  medium: [
    [0, 1],
    [0, 2],
    [1, 0],
    [1, 1],
    [1, 2],
    [1, 3],
    [2, 0],
    [2, 1],
    [2, 2],
    [2, 3],
    [3, 1],
    [3, 2],
  ],
  full: [
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 0],
    [1, 1],
    [1, 2],
    [1, 3],
    [2, 0],
    [2, 1],
    [2, 2],
    [2, 3],
    [3, 0],
    [3, 1],
    [3, 2],
    [3, 3],
  ],
};

/** Turns a path through a quarter turn, so the two lobes of the infinity stand on top of each other. */
function rotatePath(path: readonly Cell[]): Cell[] {
  return path.map(([row, col]) => [col, ROWS - 1 - row]);
}

/** Flips a path across the middle column, which reverses the way it winds. */
function mirrorPath(path: readonly Cell[]): Cell[] {
  return path.map(([row, col]) => [row, COLS - 1 - col]);
}

function createGrid(): Grid {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => false));
}

function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < ROWS && col >= 0 && col < COLS;
}

function setDot(grid: Grid, row: number, col: number): void {
  if (!inBounds(row, col)) return;
  const line = grid.at(row);
  if (line === undefined) return;
  line[col] = true;
}

/** Braille bit of one dot. Rows 0-2 make the six upper dots, row 3 the two lower dots. */
function dotBit(row: number, cellColumn: number): number {
  return row < 3 ? 1 << (row + 3 * cellColumn) : 0x40 << cellColumn;
}

/** Draws a frame from the 4x4 canvas: the left cell and the right cell side by side. */
function brailleOf(grid: Grid): string {
  let left = 0;
  let right = 0;
  for (const [row, line] of grid.entries()) {
    for (const [col, filled] of line.entries()) {
      if (!filled) continue;
      const bit = dotBit(row, col % 2);
      if (col < 2) left |= bit;
      else right |= bit;
    }
  }
  return String.fromCharCode(BRAILLE_BASE + left, BRAILLE_BASE + right);
}

/** Fills a column from the bottom up. */
function fillColumn(grid: Grid, col: number, height: number): void {
  for (let index = 0; index < height; index += 1) setDot(grid, ROWS - 1 - index, col);
}

/** Fills one of the centered shapes. */
function fillShape(grid: Grid, shape: ShapeName): void {
  for (const [row, col] of SHAPES[shape]) setDot(grid, row, col);
}

/** Draws a head with a constant-length tail that follows the head along a path. */
function drawTrail(grid: Grid, path: readonly Cell[], step: number, length: number): void {
  for (let index = 0; index < length; index += 1) {
    const [row, col] = cycleEntry(path, step - index);
    setDot(grid, row, col);
  }
}

/** Triangle wave that counts up to the period and back down. */
function triangle(step: number, period: number): number {
  const cycle = period * 2 - 2;
  const index = step % cycle;
  return index < period ? index : cycle - index;
}

/** Reads one entry of a repeating sequence. A sequence always holds at least one entry. */
function cycleEntry<T>(entries: readonly T[], index: number): T {
  const entry = entries[((index % entries.length) + entries.length) % entries.length];
  if (entry === undefined) throw new Error("a repeating sequence must not be empty");
  return entry;
}

function defineSpinner(
  id: string,
  name: string,
  description: string,
  steps: number,
  intervalMs: number,
  draw: (step: number) => Grid,
): BrailleSpinner {
  const frames: string[] = [];
  for (let step = 0; step < steps; step += 1) frames.push(brailleOf(draw(step)));
  return { id, name, description, intervalMs, frames };
}

export const BRAILLE_SPINNERS: readonly BrailleSpinner[] = [
  defineSpinner(
    "infinity",
    "Infinity",
    "A dot circles the infinity sign and crosses over in the middle.",
    16,
    90,
    (step) => {
      const grid = createGrid();
      drawTrail(grid, INFINITY_PATH, step, 4);
      return grid;
    },
  ),
  defineSpinner(
    "eight",
    "Eight",
    "The same loop on end: a dot circles a standing eight and crosses at the waist.",
    16,
    90,
    (step) => {
      const grid = createGrid();
      drawTrail(grid, EIGHT_PATH, step, 4);
      return grid;
    },
  ),
  defineSpinner(
    "comet",
    "Comet",
    "A long tail circles the outer edge of both cells.",
    12,
    80,
    (step) => {
      const grid = createGrid();
      drawTrail(grid, PERIMETER, step, 5);
      return grid;
    },
  ),
  defineSpinner(
    "gyro",
    "Gyro",
    "Two dots spin around the outer edge, always opposite each other.",
    6,
    70,
    (step) => {
      const grid = createGrid();
      for (const offset of [0, 6]) {
        const [row, col] = cycleEntry(PERIMETER, step + offset);
        setDot(grid, row, col);
      }
      return grid;
    },
  ),
  defineSpinner(
    "snake",
    "Snake",
    "A six-dot snake slithers right along the lower wave, then back left along the upper wave.",
    16,
    90,
    (step) => {
      const grid = createGrid();
      drawTrail(grid, SNAKE_TRACK, step, SNAKE_LENGTH);
      return grid;
    },
  ),
  defineSpinner(
    "sidewinder",
    "Sidewinder",
    "The same snake stood on end: it slithers down one wave and up the other.",
    16,
    90,
    (step) => {
      const grid = createGrid();
      drawTrail(grid, SIDEWINDER_TRACK, step, SNAKE_LENGTH);
      return grid;
    },
  ),
  defineSpinner(
    "chase",
    "Chase",
    "A three-dot snake crawls along the reading order and wraps around.",
    8,
    90,
    (step) => {
      const grid = createGrid();
      const head = step * 2;
      for (let index = 0; index < 3; index += 1) {
        const cell = (head - index + 16) % 16;
        setDot(grid, Math.floor(cell / COLS), cell % COLS);
      }
      return grid;
    },
  ),
  defineSpinner(
    "worm",
    "Worm",
    "A caterpillar lifts its head and crawls along the ground.",
    4,
    120,
    (step) => {
      const grid = createGrid();
      for (let col = 0; col < COLS; col += 1) setDot(grid, 3, col);
      const head = step % COLS;
      setDot(grid, 2, head);
      setDot(grid, 1, head);
      return grid;
    },
  ),
  defineSpinner(
    "orbit",
    "Orbit",
    "A dot runs around the edge of both cells with a short tail.",
    12,
    100,
    (step) => {
      const grid = createGrid();
      drawTrail(grid, PERIMETER, step, 3);
      return grid;
    },
  ),
  defineSpinner(
    "spiral",
    "Spiral",
    "A dot runs to the middle of the spiral and back out to the edge in one motion.",
    30,
    70,
    (step) => {
      const grid = createGrid();
      drawTrail(grid, SPIRAL_RUN, step, 5);
      return grid;
    },
  ),
  defineSpinner(
    "eddy",
    "Eddy",
    "The same run to the middle and back out, wound the other way around.",
    30,
    70,
    (step) => {
      const grid = createGrid();
      drawTrail(grid, SPIRAL_RUN_REVERSED, step, 5);
      return grid;
    },
  ),
  defineSpinner("bounce", "Bounce", "A ball bounces beside a gap in the floor.", 12, 80, (step) => {
    const grid = createGrid();
    const lane = step < 6 ? 0 : 3;
    for (let col = 0; col < COLS; col += 1) {
      if (col !== lane) setDot(grid, 3, col);
    }
    setDot(grid, cycleEntry(BOUNCE_LIFTS, step), lane);
    return grid;
  }),
  defineSpinner("hop", "Hop", "A dot hops over a hurdle that spans both cells.", 6, 110, (step) => {
    const grid = createGrid();
    setDot(grid, 3, 1);
    setDot(grid, 3, 2);
    const [row, col] = cycleEntry(HOP_PATH, step);
    setDot(grid, row, col);
    return grid;
  }),
  defineSpinner("equalizer", "Equalizer", "Four bars dance to their own beat.", 16, 80, (step) => {
    const grid = createGrid();
    for (let col = 0; col < COLS; col += 1) {
      const phase = (step / 16) * Math.PI * 2 + col * 1.1;
      fillColumn(grid, col, Math.max(0, Math.round(2 + 2 * Math.sin(phase))));
    }
    return grid;
  }),
  defineSpinner(
    "breathe",
    "Breathe",
    "A shape grows from one dot to the full canvas and settles back.",
    6,
    140,
    (step) => {
      const grid = createGrid();
      fillShape(
        grid,
        cycleEntry<ShapeName>(["dot", "small", "medium", "full", "medium", "small"], step),
      );
      return grid;
    },
  ),
  defineSpinner(
    "heartbeat",
    "Heartbeat",
    "A shape beats twice and rests between beats.",
    14,
    80,
    (step) => {
      const grid = createGrid();
      const beat: readonly ShapeName[] = [
        "small",
        "medium",
        "full",
        "medium",
        "small",
        "small",
        "small",
        "small",
      ];
      fillShape(grid, cycleEntry(beat, step));
      return grid;
    },
  ),
  defineSpinner(
    "star",
    "Star",
    "A plus sign spins into an X and on to the next bar.",
    4,
    150,
    (step) => {
      const grid = createGrid();
      for (const [row, col] of cycleEntry(STAR_SHAPES, step)) setDot(grid, row, col);
      return grid;
    },
  ),
  defineSpinner(
    "rain",
    "Rain",
    "Four drops fall through both cells at different speeds.",
    8,
    90,
    (step) => {
      const grid = createGrid();
      for (const [col, speed, offset] of RAIN_DROPS) {
        setDot(grid, Math.floor(((step * speed + offset) % 8) / 2), col);
      }
      return grid;
    },
  ),
  defineSpinner(
    "blink",
    "Blink",
    "Two eyes blink together and then wink at each other.",
    6,
    120,
    (step) => {
      const grid = createGrid();
      const [left, right] = cycleEntry(BLINK_POSES, step);
      const eye = (col: number, rows: readonly number[]): void => {
        for (const row of rows) {
          setDot(grid, row, col);
          setDot(grid, row, col + 1);
        }
      };
      eye(0, left === 2 ? [1, 2] : [2]);
      eye(2, right === 2 ? [1, 2] : [2]);
      return grid;
    },
  ),
  defineSpinner(
    "fill",
    "Fill",
    "Dots fill both cells in reading order, then drain away to nothing.",
    16,
    70,
    (step) => {
      const grid = createGrid();
      const filled = step < 8 ? 2 + step * 2 : 16 - (step - 7) * 2;
      for (let index = 0; index < filled; index += 1) {
        setDot(grid, Math.floor(index / COLS), index % COLS);
      }
      return grid;
    },
  ),
  defineSpinner("sweep", "Sweep", "A full-height bar sweeps across both cells.", 6, 100, (step) => {
    const grid = createGrid();
    fillColumn(grid, triangle(step, 4), ROWS);
    return grid;
  }),
];

/** Picks one spinner at random, so a session can keep the same animation for its whole life. */
export function pickSpinner(random: () => number = Math.random): BrailleSpinner {
  return cycleEntry(BRAILLE_SPINNERS, Math.floor(random() * BRAILLE_SPINNERS.length));
}
