#!/usr/bin/env python3
"""
Dynahex Level Generator
========================
Generates hex-grid logic puzzle levels for the Dynahex game.

Each level:
1. Creates a hex grid of given radius
2. Randomly assigns which cells are "true" (must be marked) vs "false" (must be cleared)
3. Places clue cells with adjacency counts (how many neighbors are true)
4. Configures drift parameters per volume

Output: JSON files in public/levels/ — one per volume + index.json manifest
"""

import json
import os
import random
import math
import hashlib
from typing import List, Tuple, Dict, Set, Optional

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'levels')

# Axial direction offsets for flat-topped hex grid
HEX_DIRS = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)]


def hex_grid_coords(radius: int) -> List[Tuple[int, int]]:
    """Generate all hex coordinates within a given radius."""
    coords = []
    for q in range(-radius, radius + 1):
        r1 = max(-radius, -q - radius)
        r2 = min(radius, -q + radius)
        for r in range(r1, r2 + 1):
            coords.append((q, r))
    return coords


def get_neighbors(q: int, r: int) -> List[Tuple[int, int]]:
    """Get the 6 axial neighbors of a hex."""
    return [(q + dq, r + dr) for dq, dr in HEX_DIRS]


def hex_distance(q1: int, r1: int, q2: int, r2: int) -> int:
    """Axial hex distance."""
    return (abs(q1 - q2) + abs(r1 - r2) + abs(q1 + r1 - q2 - r2)) // 2


def generate_solution(coords: List[Tuple[int, int]], rng: random.Random, density: float = 0.5) -> Dict[Tuple[int, int], bool]:
    """Generate a random solution (which cells are true vs false)."""
    solution = {}
    for coord in coords:
        solution[coord] = rng.random() < density
    # Ensure at least 20% and at most 80% are true
    true_count = sum(1 for v in solution.values() if v)
    total = len(coords)
    if true_count < total * 0.2:
        # Add some trues
        falses = [c for c, v in solution.items() if not v]
        rng.shuffle(falses)
        for c in falses[:int(total * 0.2) - true_count]:
            solution[c] = True
    elif true_count > total * 0.8:
        # Remove some trues
        trues = [c for c, v in solution.items() if v]
        rng.shuffle(trues)
        for c in trues[:true_count - int(total * 0.8)]:
            solution[c] = False
    return solution


def place_clues(coords: List[Tuple[int, int]], solution: Dict[Tuple[int, int], bool],
                rng: random.Random, clue_set: Set[Tuple[int, int]],
                coord_cap: Optional[int] = None) -> Tuple[Set[Tuple[int, int]], Dict[Tuple[int, int], int]]:
    """
    Place clue cells from the provided clue_set (already chosen) and compute
    their adjacency counts. Clue cells are always SAFE (isTrue=False).
    Clue counts only count NON-CLUE neighbors that are true.
    `coord_cap` optionally caps the total number of clues (unused for the
    initial placement; used by the uniqueness loop to bound growth).
    Returns (set of clue coords, map of clue coord to count).
    """
    coord_set = set(coords)
    clue_cells: Set[Tuple[int, int]] = set(clue_set)
    # Ensure clues are marked safe in the solution
    for coord in clue_cells:
        solution[coord] = False

    # Now compute clue counts: only count NON-CLUE true neighbors
    clue_counts: Dict[Tuple[int, int], int] = {}
    for coord in clue_cells:
        q, r = coord
        count = 0
        for nq, nr in get_neighbors(q, r):
            if (nq, nr) in coord_set and (nq, nr) not in clue_cells and solution.get((nq, nr), False):
                count += 1
        clue_counts[coord] = count

    return clue_cells, clue_counts


def count_solutions(coords: List[Tuple[int, int]],
                    clue_cells: Set[Tuple[int, int]],
                    clue_counts: Dict[Tuple[int, int], int],
                    cap: int = 2) -> int:
    """
    Count the number of arrangements consistent with every clue
    (clue count = number of true non-clue neighbors), using constraint
    propagation + backtracking. Returns the count, capped at `cap`
    (we only care whether it is exactly 1 — more than `cap`-1
    means "ambiguous / needs guessing"). This is the correct
    uniqueness test: a puzzle is valid iff this returns 1.
    """
    coord_set = set(coords)
    # resolution: None=unknown, True=marked(true), False=cleared(safe)
    res: Dict[Tuple[int, int], Optional[bool]] = {c: None for c in coords}
    for c in clue_cells:
        res[c] = False  # clues are always safe

    # Precompute each clue's non-clue neighbor list once.
    clue_nbrs: Dict[Tuple[int, int], List[Tuple[int, int]]] = {}
    for clue in clue_cells:
        clue_nbrs[clue] = [(nq, nr) for nq, nr in get_neighbors(*clue)
                            if (nq, nr) in coord_set and (nq, nr) not in clue_cells]

    def propagate() -> bool:
        """Apply the two simple deduction rules until stable.
        Returns False if a contradiction is found."""
        changed = True
        while changed:
            changed = False
            for clue in clue_cells:
                c = clue_counts[clue]
                nbrs = clue_nbrs[clue]
                marked = sum(1 for n in nbrs if res[n] is True)
                cleared = sum(1 for n in nbrs if res[n] is False)
                unknown = [n for n in nbrs if res[n] is None]
                if marked > c or cleared > c:
                    return False  # contradiction
                if c == marked and unknown:
                    for n in unknown:
                        res[n] = False
                    changed = True
                elif c == marked + len(unknown) and unknown:
                    for n in unknown:
                        res[n] = True
                    changed = True
        return True

    def recurse() -> int:
        if not propagate():
            return 0
        # Any contradiction already handled; find an unresolved cell.
        unknown = [c for c in coords if res[c] is None]
        if not unknown:
            return 1  # fully resolved, one valid arrangement
        # Branch on the first unknown (True/False).
        cell = unknown[0]
        total = 0
        for val in (True, False):
            saved = res[cell]
            res[cell] = val
            total += recurse()
            res[cell] = saved
            if total >= cap:
                return total  # early-out: ambiguous enough
        return total

    return recurse()


def is_uniquely_solvable(coords: List[Tuple[int, int]],
                         clue_cells: Set[Tuple[int, int]],
                         clue_counts: Dict[Tuple[int, int], int]) -> bool:
    """True iff exactly one arrangement satisfies every clue (no guessing)."""
    return count_solutions(coords, clue_cells, clue_counts) == 1

def generate_level(level_id: str, name: str, volume: str, volume_label: str,
                   grid_radius: int, drift_frequency: int, anchor_budget: int,
                   loss_tolerance: int, drift_seed: str, drift_variant: str,
                   par_time: int) -> dict:
    """
    Generate a single level definition.

    The puzzle MUST have exactly ONE solution (no guessing). We build a
    solution, seed a sparse clue set of SAFE cells, then (a) grow clues and
    (b) reroll the solution to new deterministic seeds until
    count_solutions()==1. The user reported "First Tremor has two places a
    clear/mark can be swapped" -- that is genuine ambiguity (count==2),
    which strict win-validation would have rejected as "wrong". This loop
    eliminates it. Each attempt is seeded from drift_seed so a given level
    id always yields the same valid puzzle.
    """
    coords = hex_grid_coords(grid_radius)
    coord_set = set(coords)
    max_clues = int(len(coords) * 0.7)  # bound clue growth; keep it a puzzle

    best = None
    for attempt in range(400):
        rng = random.Random(f"{drift_seed}:sol:{attempt}")
        solution = generate_solution(coords, rng, density=0.45 + rng.random() * 0.15)

        # Sparse initial clue set drawn from SAFE cells only.
        safe_cells = [c for c in coords if not solution.get(c, False)]
        rng.shuffle(safe_cells)
        initial_clues = max(1, int(len(coords) * max(0.25, 0.5 - grid_radius * 0.03)))
        clue_cells: Set[Tuple[int, int]] = set(
            c for c in safe_cells[:initial_clues] if not solution.get(c, False))

        clue_cells, clue_counts = place_clues(coords, solution, rng, clue_cells)

        # Grow clues (add safe unknowns) until unique or we run out of room.
        grow = 0
        while count_solutions(coords, clue_cells, clue_counts) != 1:
            pool = [c for c in safe_cells if c not in clue_cells]
            if not pool or len(clue_cells) >= max_clues:
                break
            rng.shuffle(pool)
            add = pool[: max(1, len(pool) // 4)]
            clue_cells.update(add)
            clue_cells, clue_counts = place_clues(coords, solution, rng, clue_cells)
            grow += 1
            if grow > 600:
                break

        n = count_solutions(coords, clue_cells, clue_counts)
        if n == 1:
            best = (solution, clue_cells, clue_counts)
            break
        # n > 1 (ambiguous) or 0 (over-clued contradiction) -> try next seed.

    if best is None:
        # Should be unreachable; fall back to a fresh solution + max clues.
        rng = random.Random(f"{drift_seed}:fallback")
        solution = generate_solution(coords, rng, density=0.5)
        safe_cells = [c for c in coords if not solution.get(c, False)]
        clue_cells = set(c for c in safe_cells if not solution.get(c, False))
        clue_cells, clue_counts = place_clues(coords, solution, rng, clue_cells)
        best = (solution, clue_cells, clue_counts)

    solution, clue_cells, clue_counts = best

    # Build cells array
    cells = []
    for q, r in coords:
        if (q, r) in clue_cells:
            cells.append({
                "q": q, "r": r,
                "type": "clue",
                "isTrue": False,  # Clues are always safe
                "isGiven": True,
                "clueCount": clue_counts[(q, r)],
            })
        else:
            cells.append({
                "q": q, "r": r,
                "type": "unknown",
                "isTrue": solution.get((q, r), False),
            })

    return {
        "id": level_id,
        "name": name,
        "volume": volume,
        "volumeLabel": volume_label,
        "gridRadius": grid_radius,
        "driftFrequency": drift_frequency,
        "anchorBudget": anchor_budget,
        "lossTolerance": loss_tolerance,
        "driftSeed": drift_seed,
        "driftVariant": drift_variant,
        "cells": cells,
        "parTime": par_time,
    }


# Level names — alchemy/lab themed per user preference
VOLUME_NAMES = {
    "v1": [
        "First Tremor", "Hex Awakening", "Gentle Shift", "Anchor's Echo",
        "Quiet Drift", "Stable Ground", "Measured Steps", "Holding Pattern",
        "Slow Burn", "Foundation Stone",
    ],
    "v2": [
        "Tidal Pull", "Current Count", "Wave Crest", "Ebb and Flow",
        "Surge Watch", "Rising Tide", "Anchor Point", "Deep Current",
        "Wavelength", "Tidal Lock", "Crosscurrent", "Undertow",
        "Rip Zone", "Floodgate",
    ],
    "v3": [
        "Storm Front", "Lightning Count", "Tempest Edge", "Gale Warning",
        "Whirlwind", "Eye of Chaos", "Thunder Clap", "Wind Shear",
        "Pressure Drop", "Storm Lock", "Cyclone Core", "Maelstrom",
    ],
    "v4": [
        "Aftershock", "Fracture Line", "Collapse Point", "Tremor Break",
        "Fault Split", "Cataclysm", "Zero Hour", "Final Stand",
        "Edge of Ruin", "Collapse Lock",
    ],
}


def generate_volume(volume_id: str, volume_label: str, grid_radius: int,
                     drift_frequency: int, drift_variant: str, anchor_budget_fn,
                     loss_tolerance_fn, par_time_fn, num_levels: int,
                     seed_offset: int) -> List[dict]:
    """
    Generate all levels for a volume.
    `loss_tolerance_fn(i, grid_radius)` returns the per-level loss tolerance so
    harder late levels can be tightened while early levels are forgiving.
    """
    levels = []
    names = VOLUME_NAMES.get(volume_id, [f"Level {i+1}" for i in range(num_levels)])

    for i in range(num_levels):
        level_id = f"dh-{volume_id}-l{i+1:02d}"
        name = names[i] if i < len(names) else f"Level {i+1}"
        drift_seed = hashlib.md5(f"{volume_id}-{i:02d}".encode()).hexdigest()[:6]
        anchor_budget = anchor_budget_fn(i, grid_radius)
        loss_tolerance = loss_tolerance_fn(i, grid_radius)
        par_time = par_time_fn(grid_radius)

        level = generate_level(
            level_id=level_id,
            name=name,
            volume=volume_id,
            volume_label=volume_label,
            grid_radius=grid_radius,
            drift_frequency=drift_frequency,
            anchor_budget=anchor_budget,
            loss_tolerance=loss_tolerance,
            drift_seed=drift_seed,
            drift_variant=drift_variant,
            par_time=par_time,
        )
        levels.append(level)

    return levels


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    # Volume configurations
    # Volume I: The Drift Awakens — 19 cells (radius 2), glacial, abundant anchors
    # Early levels have very high drift frequency (essentially no drift) so players
    # can learn the hex deduction mechanic before dealing with movement.
    v1 = generate_volume(
        "v1", "The Drift Awakens",
        grid_radius=2, drift_frequency=99, drift_variant="glacial",
        anchor_budget_fn=lambda i, r: max(3, 8 - i),  # 8 down to 3
        loss_tolerance_fn=lambda i, r: 0,  # glacial is contained — never sheds
        par_time_fn=lambda r: 120,
        num_levels=10,
        seed_offset=0,
    )
    # Increase drift frequency (decrease the number) for later v1 levels
    for i, level in enumerate(v1):
        if i >= 6:
            level["driftFrequency"] = 12  # drift starts on later v1 levels
        elif i >= 3:
            level["driftFrequency"] = 20  # very rare drift
        # levels 0-2: no drift (99 moves = effectively never)

    # Volume II: Tidal Zones — 37 cells (radius 3), tidal (5), 3-4 anchors
    v2 = generate_volume(
        "v2", "Tidal Zones",
        grid_radius=3, drift_frequency=5, drift_variant="tidal",
        anchor_budget_fn=lambda i, r: max(2, 4 - i // 5),
        loss_tolerance_fn=lambda i, r: 0,  # tidal is contained — never sheds
        par_time_fn=lambda r: 180,
        num_levels=14,
        seed_offset=100,
    )

    # Volume III: Storm Fronts — 61 cells (radius 4), storm (3).
    # Storm ALLOWS off-board shed, so loss tolerance is now the gate. Early
    # levels are forgiving (tolerate up to 4 losses); the finale demands
    # near-perfect play (tolerance 1).
    v3 = generate_volume(
        "v3", "Storm Fronts",
        grid_radius=4, drift_frequency=3, drift_variant="storm",
        anchor_budget_fn=lambda i, r: max(2, 5 - i // 4),
        loss_tolerance_fn=lambda i, r: max(1, 4 - i // 3),  # 4 -> 1 across the volume
        par_time_fn=lambda r: 300,
        num_levels=12,
        seed_offset=200,
    )

    # Volume IV: The Collapse — 91 cells (radius 5), quake (2), anchor famine.
    # Quake is the harshest shed variant; tolerance tapers 3 -> 1.
    v4 = generate_volume(
        "v4", "The Collapse",
        grid_radius=5, drift_frequency=2, drift_variant="quake",
        anchor_budget_fn=lambda i, r: max(1, 3 - i // 4),
        loss_tolerance_fn=lambda i, r: max(1, 3 - i // 4),  # 3 -> 1 across the volume
        par_time_fn=lambda r: 420,
        num_levels=10,
        seed_offset=300,
    )

    volumes = {"v1": v1, "v2": v2, "v3": v3, "v4": v4}

    # Write volume files
    manifest = []
    for vol_id, levels in volumes.items():
        filename = f"{vol_id}.json"
        filepath = os.path.join(OUT_DIR, filename)
        with open(filepath, 'w') as f:
            json.dump(levels, f, separators=(',', ':'))
        manifest.append(filename)
        print(f"  {filename}: {len(levels)} levels")

    # Write index manifest
    index_path = os.path.join(OUT_DIR, 'index.json')
    with open(index_path, 'w') as f:
        json.dump(manifest, f, separators=(',', ':'))

    total = sum(len(v) for v in volumes.values())
    print(f"\nGenerated {total} levels across {len(volumes)} volumes")


if __name__ == '__main__':
    main()
