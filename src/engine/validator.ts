// ============================================================
// Validator — Win check, clue consistency, compromise detection
// ============================================================

import { CellState, GameState, LevelScores } from './types';
import { getNeighbors, hexKey } from './hexgrid';
import { buildCellMap, computeDrift } from './drift';

// Recompute all clue counts from current cell positions
// Clue counts only count NON-CLUE neighbors that are marked (true)
export function recomputeClues(cells: CellState[]): void {
  const cellMap = buildCellMap(cells);
  for (const cell of cells) {
    if (cell.type === 'clue') {
      const neighbors = getNeighbors(cell.q, cell.r);
      let count = 0;
      for (const { q, r } of neighbors) {
        const neighbor = cellMap.get(hexKey(q, r));
        // Only count non-clue cells that are marked (true)
        if (neighbor && neighbor.type !== 'clue' && neighbor.resolution === 'marked') {
          count++;
        }
      }
      cell.clueCount = count;
    }
  }
}

// Check if all cells are resolved (none in 'unknown' state)
export function allResolved(cells: CellState[]): boolean {
  return cells.every((c) => c.resolution !== 'unknown');
}

// Check if all resolved cells match the solution
// Clue cells are always safe (must be cleared), non-clue cells checked against isTrue
export function solutionValid(cells: CellState[]): boolean {
  return cells.every((c) => {
    if (c.type === 'clue') {
      // Clue cells are always safe — they should not be marked
      return c.resolution !== 'marked';
    }
    if (c.resolution === 'marked') return c.isTrue;
    if (c.resolution === 'cleared') return !c.isTrue;
    return false; // unknown = not fully resolved
  });
}

// Check if the puzzle is fully stabilized:
// All cells resolved AND a drift tick produces zero movement
export function isStabilized(state: GameState, gridRadius: number, driftSeed: string): boolean {
  if (!allResolved(state.cells)) return false;
  if (!solutionValid(state.cells)) return false;
  const moves = computeDrift(state, gridRadius, driftSeed);
  return moves.length === 0;
}

// Compute scores after a win
export function computeScores(
  state: GameState,
  level: { anchorBudget: number; parTime?: number; lossTolerance: number },
  driftSeed: string,
  gridRadius: number,
): LevelScores {
  const anchorsConservation = Math.ceil(level.anchorBudget * 0.5);
  return {
    stabilized: true, // if we won, it's stabilized
    conservation: state.anchorsUsed <= anchorsConservation,
    noLosses: state.cellsLost === 0,
    foresight: !state.everStale,
    speedrun: level.parTime ? state.elapsedTime <= level.parTime : false,
  };
}

// Check if the current board state is compromised (unsolvable due to drift)
// A board is compromised if any given clue's count is impossible:
// - clueCount > number of unresolved neighbors (too many need to be marked)
// - clueCount < 0 (impossible)
// - Or if remaining unresolved cells can't satisfy all clues
export function isCompromised(cells: CellState[], gridRadius: number): boolean {
  const cellMap = buildCellMap(cells);
  const unresolved = cells.filter((c) => c.resolution === 'unknown');
  if (unresolved.length === 0) return false;

  // Check each clue for impossibility
  for (const cell of cells) {
    if (cell.type !== 'clue' || !cell.isGiven) continue;

    const neighbors = getNeighbors(cell.q, cell.r);
    let markedCount = 0;
    let unresolvedNeighbors = 0;
    let totalNeighbors = 0;

    for (const { q, r } of neighbors) {
      const neighbor = cellMap.get(hexKey(q, r));
      if (!neighbor) continue;
      // Skip clue neighbors — they don't count toward the clue's target
      if (neighbor.type === 'clue') continue;
      totalNeighbors++;
      if (neighbor.resolution === 'marked') markedCount++;
      else if (neighbor.resolution === 'unknown') unresolvedNeighbors++;
    }

    // The clue shows the target count of marked neighbors
    // Currently marked + potentially markable = max possible
    const targetCount = cell.clueCount;
    const maxPossible = markedCount + unresolvedNeighbors;
    const minPossible = markedCount;

    // If we need more marked than possible, or fewer than already marked
    if (targetCount > maxPossible || targetCount < minPossible) {
      return true;
    }
  }

  return false;
}
