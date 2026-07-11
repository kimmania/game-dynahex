// ============================================================
// Hex Grid Math — Axial coordinates, flat-topped orientation
// ============================================================

import { HEX_DIRECTIONS } from './types';

export interface HexCoord {
  q: number;
  r: number;
}

export interface PixelCoord {
  x: number;
  y: number;
}

// Flat-topped hex: width = size * 2, height = size * sqrt(3)
// Horizontal spacing: size * 3/2, vertical spacing: size * sqrt(3)
export const HEX_SIZE = 1; // logical unit; renderer scales to pixels

export function hexToPixel(q: number, r: number, size: number): PixelCoord {
  const x = size * (1.5 * q);
  const y = size * (Math.sqrt(3) * (r + q / 2));
  return { x, y };
}

export function pixelToHex(px: number, py: number, size: number): HexCoord {
  const q = (2 / 3) * px / size;
  const r = ((-1 / 3) * px + (Math.sqrt(3) / 3) * py) / size;
  return hexRound(q, r);
}

function hexRound(qf: number, rf: number): HexCoord {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  let s = Math.round(sf);
  const qd = Math.abs(q - qf);
  const rd = Math.abs(r - rf);
  const sd = Math.abs(s - sf);
  if (qd > rd && qd > sd) {
    q = -r - s;
  } else if (rd > sd) {
    r = -q - s;
  }
  return { q, r };
}

export function getNeighbors(q: number, r: number): HexCoord[] {
  return HEX_DIRECTIONS.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
}

export function hexKey(q: number, r: number): string {
  return `${q},${r}`;
}

export function hexDistance(a: HexCoord, b: HexCoord): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

// Generate all hex coords within a given radius (hexagonal grid)
export function hexGridCoords(radius: number): HexCoord[] {
  const coords: HexCoord[] = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) {
      coords.push({ q, r });
    }
  }
  return coords;
}

// Check if a hex is on the edge of the grid (has fewer than 6 neighbors within radius)
export function isEdgeHex(q: number, r: number, radius: number): boolean {
  const neighbors = getNeighbors(q, r);
  return neighbors.some(({ q: nq, r: nr }) => {
    return hexDistance({ q: 0, r: 0 }, { q: nq, r: nr }) > radius;
  });
}

// Hex vertices for flat-topped orientation (6 vertices, starting from angle 0)
export function hexVertices(cx: number, cy: number, size: number): PixelCoord[] {
  const verts: PixelCoord[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i; // 0, 60, 120, 180, 240, 300 degrees
    verts.push({
      x: cx + size * Math.cos(angle),
      y: cy + size * Math.sin(angle),
    });
  }
  return verts;
}
