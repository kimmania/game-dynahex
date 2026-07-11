// ============================================================
// Drift Engine — deterministic cell migration
// ============================================================

import { CellState, GameState } from './types';
import { getNeighbors, hexKey } from './hexgrid';
import { makeRng, shuffle } from './prng';

// Build a map from hexKey to cell for fast lookup
export function buildCellMap(cells: CellState[]): Map<string, CellState> {
  const map = new Map<string, CellState>();
  for (const cell of cells) {
    map.set(hexKey(cell.q, cell.r), cell);
  }
  return map;
}

// Identify all cells that are eligible to drift:
// Unknown AND unanchored AND have at least one unoccupied adjacent hex
export function getDriftEligible(cells: CellState[]): CellState[] {
  const cellMap = buildCellMap(cells);
  const eligible: CellState[] = [];
  for (const cell of cells) {
    // Only unknown-resolution cells drift (not marked, not cleared, not given clues)
    if (cell.resolution !== 'unknown') continue;
    if (cell.anchored) continue;
    // Given clues also drift if unanchored (they're not resolved)
    if (cell.type === 'clue' && cell.isGiven) {
      // Given clues drift too — they're still "unknown" resolution in a sense
      // Actually, given clues are always visible but they do drift
      // They should drift since they're not resolved
    }
    // Check for at least one unoccupied adjacent hex
    const neighbors = getNeighbors(cell.q, cell.r);
    const hasUnoccupied = neighbors.some(({ q, r }) => !cellMap.has(hexKey(q, r)));
    if (hasUnoccupied) {
      eligible.push(cell);
    }
  }
  return eligible;
}

// Check if a position is off the board (outside the grid radius)
export function isOffBoard(q: number, r: number, gridRadius: number): boolean {
  const dist = (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
  return dist > gridRadius;
}

// Compute the next drift tick deterministically
// Returns the list of moves: [{ cellIndex, fromQ, fromR, toQ, toR, lost }]
export interface DriftMove {
  cellIndex: number;
  fromQ: number;
  fromR: number;
  toQ: number;
  toR: number;
  lost: boolean; // true if cell drifted off the board edge
}

export function computeDrift(
  state: GameState,
  gridRadius: number,
  driftSeed: string,
): DriftMove[] {
  const cells = state.cells;
  const cellMap = buildCellMap(cells);
  const rng = makeRng(`${driftSeed}-tick${state.driftCount}`);

  // Get eligible cells (unknown, unanchored, have unoccupied neighbor)
  const eligible = getDriftEligible(cells);

  // Process in seeded shuffle order for deterministic fairness
  const shuffled = shuffle(
    eligible.map((_, i) => i),
    rng,
  );
  const orderedEligible = shuffled.map((i) => eligible[i]);

  // Compute all target positions first (simultaneous swap)
  const moves: DriftMove[] = [];
  const occupiedKeys = new Set(cells.map((c) => hexKey(c.q, c.r)));

  // Track planned moves so we don't have two cells targeting the same position
  const claimedKeys = new Set<string>();

  for (const cell of orderedEligible) {
    const neighbors = getNeighbors(cell.q, cell.r);

    // Find unoccupied adjacent hexes (not occupied by another cell, not claimed)
    const availableTargets: { q: number; r: number; offBoard: boolean }[] = [];
    for (const { q, r } of neighbors) {
      const key = hexKey(q, r);
      if (claimedKeys.has(key)) continue;
      if (cellMap.has(key)) continue; // currently occupied
      const offBoard = isOffBoard(q, r, gridRadius);
      availableTargets.push({ q, r, offBoard });
    }

    if (availableTargets.length === 0) continue;

    let target: { q: number; r: number; offBoard: boolean };

    if (availableTargets.length === 1) {
      target = availableTargets[0];
    } else {
      // Weighted random selection using seeded PRNG
      // Prefer on-board targets slightly over off-board
      const onBoard = availableTargets.filter((t) => !t.offBoard);
      const pool = onBoard.length > 0 ? onBoard : availableTargets;
      const idx = Math.floor(rng() * pool.length);
      target = pool[idx];
    }

    const cellIndex = cells.indexOf(cell);
    const fromKey = hexKey(cell.q, cell.r);
    const toKey = hexKey(target.q, target.r);

    // Claim the target position
    claimedKeys.add(toKey);
    // Free the source position (it becomes unoccupied)
    occupiedKeys.delete(fromKey);

    moves.push({
      cellIndex,
      fromQ: cell.q,
      fromR: cell.r,
      toQ: target.q,
      toR: target.r,
      lost: target.offBoard,
    });
  }

  return moves;
}

// Apply drift moves to the game state (mutates cells array in place)
export function applyDrift(state: GameState, moves: DriftMove[]): {
  lostCells: number;
  staleCreated: boolean;
} {
  let lostCells = 0;
  let staleCreated = false;

  // First, remove lost cells
  const lostIndices = new Set(moves.filter((m) => m.lost).map((m) => m.cellIndex));
  if (lostIndices.size > 0) {
    lostCells = lostIndices.size;
  }

  // Apply position changes for non-lost cells
  for (const move of moves) {
    if (move.lost) continue;
    const cell = state.cells[move.cellIndex];
    cell.q = move.toQ;
    cell.r = move.toR;
    cell.driftCount++;
  }

  // Remove lost cells from the array
  if (lostIndices.size > 0) {
    state.cells = state.cells.filter((_, i) => !lostIndices.has(i));
  }

  // After movement, recompute clue counts and check for stale cells
  const cellMap = buildCellMap(state.cells);

  // Recompute clue counts
  for (const cell of state.cells) {
    if (cell.type === 'clue') {
      const oldCount = cell.clueCount;
      const neighbors = getNeighbors(cell.q, cell.r);
      let count = 0;
      for (const { q, r } of neighbors) {
        const neighbor = cellMap.get(hexKey(q, r));
        if (neighbor && neighbor.resolution === 'marked') {
          count++;
        }
      }
      cell.clueCount = count;

      // Check if this clue's movement caused any marked cells to become stale
      // A marked cell becomes stale if the clue that originally validated it has moved
      // (its original position is now empty or occupied by a different cell)
      if (cell.driftCount > 0 && oldCount !== count) {
        // The clue moved and its count changed — mark neighbors as potentially stale
        // We only mark stale if the clue actually drifted this tick
        for (const { q, r } of neighbors) {
          const neighbor = cellMap.get(hexKey(q, r));
          if (neighbor && neighbor.resolution === 'marked' && !neighbor.anchored) {
            if (!neighbor.stale) {
              neighbor.stale = true;
              staleCreated = true;
            }
          }
        }
      }
    }
  }

  state.driftCount++;
  state.movesSinceDrift = 0;
  state.cellsLost += lostCells;

  return { lostCells, staleCreated };
}

// Preview drift without applying (for Foresight Mode)
export function previewDrift(
  state: GameState,
  gridRadius: number,
  driftSeed: string,
): DriftMove[] {
  return computeDrift(state, gridRadius, driftSeed);
}
