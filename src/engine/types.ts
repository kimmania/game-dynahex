// ============================================================
// Dynahex — Core Types & Constants
// ============================================================

export type CellType = 'clue' | 'unknown';

export type CellResolution = 'unknown' | 'marked' | 'cleared';

// Drift frequency variants
export type DriftVariant = 'glacial' | 'tidal' | 'storm' | 'quake';

export const DRIFT_VARIANTS: Record<DriftVariant, { interval: number; label: string }> = {
  glacial: { interval: 8, label: 'Glacial' },
  tidal: { interval: 5, label: 'Tidal' },
  storm: { interval: 3, label: 'Storm' },
  quake: { interval: 2, label: 'Quake' },
};

// Score badges — ✓ / 🔒 per user preference (no 4-star system)
export interface LevelScores {
  stabilized: boolean;
  conservation: boolean;
  noLosses: boolean;
  foresight: boolean;
  speedrun: boolean;
}

export interface CellDef {
  q: number;
  r: number;
  type: CellType;
  isTrue: boolean; // part of the solution (must be Marked)
  isGiven?: boolean; // clue is a given (visible at start)
  clueCount?: number; // for clue cells: how many neighbors are true
}

export interface LevelDef {
  id: string;
  name: string;
  volume: string;
  volumeLabel: string;
  gridRadius: number;
  driftFrequency: number;
  anchorBudget: number;
  lossTolerance: number;
  driftSeed: string;
  driftVariant: DriftVariant;
  cells: CellDef[];
  parTime?: number; // seconds for speedrun badge
}

export interface CellState {
  q: number;
  r: number;
  type: CellType;
  resolution: CellResolution;
  isTrue: boolean;
  anchored: boolean;
  stale: boolean;
  driftCount: number; // how many times this cell has drifted
  clueCount: number; // computed: how many marked neighbors
  isGiven: boolean;
  originalQ: number;
  originalR: number;
}

export interface GameState {
  levelId: string;
  cells: CellState[];
  moves: number;
  movesSinceDrift: number;
  driftCount: number;
  anchorsUsed: number;
  cellsLost: number;
  everStale: boolean;
  compromised: boolean;
  won: boolean;
  startTime: number;
  elapsedTime: number;
  version: number;
}

export interface Settings {
  sound: boolean;
  reducedMotion: boolean;
}

export interface SaveData {
  settings: Settings;
  progress: Record<string, LevelScores>;
  unlocked: string[];
  hasSeenHelp: boolean;
}

// Axial direction offsets for flat-topped hex grid
// Flat-topped: neighbors at [q+1,r], [q+1,r-1], [q,r-1], [q-1,r], [q-1,r+1], [q,r+1]
export const HEX_DIRECTIONS: ReadonlyArray<[number, number]> = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

export const STORAGE_KEY = 'dynahex-save';
export const SAVE_VERSION = 1;
export const FIRST_LEVEL_ID = 'dh-v1-l01';
