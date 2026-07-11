// ============================================================
// Level Loader & Game State Initialization
// ============================================================

import { LevelDef, CellDef, CellState, GameState, SAVE_VERSION } from './types';
import { recomputeClues } from './validator';

let levelCache: Record<string, LevelDef[]> | null = null;

export async function loadLevels(): Promise<LevelDef[]> {
  if (levelCache) {
    const all = Object.values(levelCache).flat();
    return all;
  }
  const stamp = typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : Date.now();
  const base = import.meta.env.BASE_URL;
  const url = `${base}levels/index.json?v=${stamp}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load levels index: ${res.status}`);
  const manifest = await res.json() as string[];
  const volumes: Record<string, LevelDef[]> = {};
  const all: LevelDef[] = [];
  for (const volFile of manifest) {
    const volUrl = `${base}levels/${volFile}?v=${stamp}`;
    const volRes = await fetch(volUrl);
    if (!volRes.ok) continue;
    const levels = await volRes.json() as LevelDef[];
    volumes[volFile] = levels;
    all.push(...levels);
  }
  levelCache = volumes;
  return all;
}

export function createGameState(level: LevelDef): GameState {
  const cells: CellState[] = level.cells.map((def: CellDef) => ({
    q: def.q,
    r: def.r,
    type: def.type,
    // Clue cells are pre-resolved as "cleared" (safe) — they're information, not part of the solution
    resolution: (def.type === 'clue' ? 'cleared' : 'unknown') as CellState['resolution'],
    isTrue: def.isTrue,
    anchored: false,
    stale: false,
    driftCount: 0,
    clueCount: def.type === 'clue' ? (def.clueCount ?? 0) : 0,
    isGiven: def.isGiven ?? (def.type === 'clue'),
    originalQ: def.q,
    originalR: def.r,
  }));

  // Compute initial clue counts
  recomputeClues(cells);

  return {
    levelId: level.id,
    cells,
    moves: 0,
    movesSinceDrift: 0,
    driftCount: 0,
    anchorsUsed: 0,
    cellsLost: 0,
    everStale: false,
    compromised: false,
    won: false,
    startTime: Date.now(),
    elapsedTime: 0,
    version: SAVE_VERSION,
  };
}

export function cloneState(state: GameState): GameState {
  return {
    ...state,
    cells: state.cells.map((c) => ({ ...c })),
  };
}

// Get the grid radius for a level
export function getGridRadius(state: GameState): number {
  // Find the maximum distance from center
  let maxDist = 0;
  for (const cell of state.cells) {
    const dist = (Math.abs(cell.q) + Math.abs(cell.r) + Math.abs(cell.q + cell.r)) / 2;
    if (dist > maxDist) maxDist = dist;
  }
  return Math.ceil(maxDist);
}
