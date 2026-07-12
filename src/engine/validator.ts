// ============================================================
// Validator — Win check, clue consistency, compromise detection
// ============================================================

import { CellState, CellResolution, GameState, LevelDef, LevelScores } from './types';
import { getNeighbors, hexKey } from './hexgrid';
import { buildCellMap, computeDrift } from './drift';

// Check if all cells are resolved (none in 'unknown' state)
export function allResolved(cells: CellState[]): boolean {
  return cells.every((c) => c.resolution !== 'unknown');
}

// Validate the board against the true solution.
// The win condition is strict and unambiguous: every cell's resolution must
// match the actual answer. A true cell (isTrue) must be 'marked'; a safe
// cell (clue or non-true) must be 'cleared'. This is intentionally stronger
// than the clue-count check, which is NOT sufficient — on boards where clues
// are sparse, a wrong arrangement can accidentally satisfy every clue count
// while still leaving true cells uncleared or safe cells marked. Clue counts
// are implied by this check for given clues, so no separate loop is needed.
export function solutionValid(cells: CellState[]): boolean {
  if (!allResolved(cells)) return false;
  for (const cell of cells) {
    const expected: CellResolution = cell.isTrue ? 'marked' : 'cleared';
    if (cell.resolution !== expected) return false;
  }
  return true;
}

// Compute scores after a win
export function computeScores(
  state: GameState,
  level: LevelDef,
  driftSeed: string,
): LevelScores {
  const anchorsConservation = Math.ceil(level.anchorBudget * 0.5);
  // "Stabilized" = the solved board survives the next drift tick with zero
  // movement (fully packed, no further cell can migrate off / shift).
  const nextDrift = computeDrift(state, level.gridRadius, driftSeed, level.driftVariant);
  return {
    stabilized: nextDrift.length === 0,
    conservation: state.anchorsUsed <= anchorsConservation,
    noLosses: state.cellsLost === 0,
    foresight: !state.everStale,
    speedrun: level.parTime ? state.elapsedTime <= level.parTime : false,
  };
}

// Check if the current board state is compromised (unsolvable due to drift).
// Two independent causes:
//  1. ATTRITION — more cells have shed off-board than the level tolerates.
//     `cellsLost > lossTolerance` means the player has lost too many cells
//     (lossTolerance 0 = any loss compromises the level). This is the hard
//     attrition mechanic, gated per-level, and only actual on storm/quake
//     variants where off-board drift is allowed at all.
//  2. TOPOLOGY — a given clue's target count can no longer be satisfied by
//     the remaining non-clue neighbors (target > available neighbors).
export function isCompromised(
  cells: CellState[],
  lossTolerance: number,
  cellsLost: number,
): boolean {
  // 1. Attrition gate
  if (cellsLost > lossTolerance) return true;

  const cellMap = buildCellMap(cells);
  const unresolved = cells.filter((c) => c.resolution === 'unknown' && c.type !== 'clue');
  if (unresolved.length === 0) return false;

  // 2. Clue impossibility
  for (const cell of cells) {
    if (cell.type !== 'clue' || !cell.isGiven) continue;

    const neighbors = getNeighbors(cell.q, cell.r);
    let nonClueNeighbors = 0;

    for (const { q, r } of neighbors) {
      const neighbor = cellMap.get(hexKey(q, r));
      if (!neighbor) continue;
      if (neighbor.type === 'clue') continue;
      nonClueNeighbors++;
    }

    const targetCount = cell.clueCount;

    // If target > total non-clue neighbors, can't satisfy the clue
    if (targetCount > nonClueNeighbors) {
      return true;
    }
  }

  return false;
}
