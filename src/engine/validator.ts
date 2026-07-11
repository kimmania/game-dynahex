// ============================================================
// Validator — Win check, clue consistency, compromise detection
// ============================================================

import { CellState, GameState, LevelScores } from './types';
import { getNeighbors, hexKey } from './hexgrid';
import { buildCellMap, computeDrift } from './drift';

// Recompute all clue counts from current cell positions
// After drift, clue counts must reflect the NEW topology: how many non-clue
// neighbors are actually TRUE (the target the player must satisfy).
// This is NOT how many are currently marked — it's the puzzle constraint.
export function recomputeClues(cells: CellState[]): void {
  const cellMap = buildCellMap(cells);
  for (const cell of cells) {
    if (cell.type === 'clue') {
      const neighbors = getNeighbors(cell.q, cell.r);
      let count = 0;
      for (const { q, r } of neighbors) {
        const neighbor = cellMap.get(hexKey(q, r));
        // Count non-clue neighbors that are TRUE (part of the solution)
        if (neighbor && neighbor.type !== 'clue' && neighbor.isTrue) {
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

// Validate the board against clue constraints — NOT against a stored solution.
// This allows multiple valid solutions: any arrangement where every clue's
// marked-neighbor count matches its displayed number is a correct solution.
// Clue cells must be cleared (not marked), and all cells must be resolved.
export function solutionValid(cells: CellState[]): boolean {
  const cellMap = buildCellMap(cells);

  // Check that all cells are resolved (no unknowns)
  if (!allResolved(cells)) return false;

  // Check that clue cells are not marked
  for (const cell of cells) {
    if (cell.type === 'clue' && cell.resolution === 'marked') return false;
  }

  // Check that every clue's count matches its actual marked non-clue neighbors
  for (const cell of cells) {
    if (cell.type !== 'clue' || !cell.isGiven) continue;

    const neighbors = getNeighbors(cell.q, cell.r);
    let markedCount = 0;
    for (const { q, r } of neighbors) {
      const neighbor = cellMap.get(hexKey(q, r));
      if (neighbor && neighbor.type !== 'clue' && neighbor.resolution === 'marked') {
        markedCount++;
      }
    }

    if (markedCount !== cell.clueCount) return false;
  }

  return true;
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
// After drift, the topology may have changed. A board is compromised if any
// clue's target count cannot be satisfied by the remaining non-clue neighbors:
// - target > total non-clue neighbors (impossible to mark enough)
// - target < 0 (impossible)
export function isCompromised(cells: CellState[], gridRadius: number): boolean {
  const cellMap = buildCellMap(cells);
  const unresolved = cells.filter((c) => c.resolution === 'unknown' && c.type !== 'clue');
  if (unresolved.length === 0) return false;

  // Check each clue for impossibility
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
