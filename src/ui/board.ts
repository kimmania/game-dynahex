// ============================================================
// Canvas Renderer — Flat-topped hex grid with tap interaction
// ============================================================

import { CellState, GameState, LevelDef } from '../engine/types';
import { hexToPixel, hexVertices } from '../engine/hexgrid';
import { DriftMove, previewDrift } from '../engine/drift';

export type ToolMode = 'mark' | 'clear' | 'anchor' | 'foresight';

interface DriftAnimation {
  moves: DriftMove[];
  startTime: number;
  duration: number;
}

export class BoardRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private level: LevelDef;
  private state: GameState;
  private dpr = 1;
  private panX = 0;
  private panY = 0;
  private zoom = 1;
  private hexSize = 30; // pixel radius of hex
  private gridRadius: number;

  private tool: ToolMode = 'mark';
  private onTap: (q: number, r: number) => void;

  private driftAnim: DriftAnimation | null = null;
  private foresightMoves: DriftMove[] | null = null;
  private reducedMotion = false;

  // Touch state
  private twoFingerHold = false;
  private touchCount = 0;
  private longPressTimer: number | null = null;
  private longPressFired = false;

  constructor(
    canvas: HTMLCanvasElement,
    level: LevelDef,
    state: GameState,
    onTap: (q: number, r: number) => void,
    _onStateChange: () => void,
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.level = level;
    this.state = state;
    this.gridRadius = level.gridRadius;
    this.onTap = onTap;

    this.resize();
    this.bindEvents();

    // Start animation loop
    this.animate();
  }

  setTool(tool: ToolMode) {
    this.tool = tool;
    if (tool === 'foresight') {
      this.foresightMoves = previewDrift(this.state, this.gridRadius, this.level.driftSeed);
    } else {
      this.foresightMoves = null;
    }
    this.render();
  }

  setState(state: GameState) {
    this.state = state;
    if (this.tool === 'foresight') {
      this.foresightMoves = previewDrift(this.state, this.gridRadius, this.level.driftSeed);
    }
    this.render();
  }

  setReducedMotion(reduced: boolean) {
    this.reducedMotion = reduced;
  }

  private wrongFlashCells: { q: number; r: number }[] = [];
  private wrongFlashUntil = 0;

  flashWrongCells(cells: { q: number; r: number }[]) {
    this.wrongFlashCells = cells;
    this.wrongFlashUntil = performance.now() + 2000; // flash for 2 seconds
    this.render();
  }

  setLevel(level: LevelDef, state: GameState) {
    this.level = level;
    this.state = state;
    this.gridRadius = level.gridRadius;
    this.driftAnim = null;
    this.foresightMoves = null;
    this.tool = 'mark';
    this.resize();
    this.render();
  }

  // Trigger drift animation
  animateDrift(moves: DriftMove[]) {
    if (moves.length === 0) return;
    this.driftAnim = {
      moves,
      startTime: performance.now(),
      duration: this.reducedMotion ? 0 : 300,
    };
  }

  resize() {
    const rect = this.canvas.parentElement!.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * this.dpr;
    this.canvas.height = rect.height * this.dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;

    // Fit grid to canvas
    const padding = 40;
    const availW = rect.width - padding * 2;
    const availH = rect.height - padding * 2;

    // Grid bounding box: width = (2*radius + 1) * 1.5 * size, height = (2*radius + 1) * sqrt(3) * size
    const gridW = (2 * this.gridRadius + 1) * 1.5;
    const gridH = (2 * this.gridRadius + 1) * Math.sqrt(3);
    const sizeW = availW / gridW;
    const sizeH = availH / gridH;
    this.hexSize = Math.min(sizeW, sizeH);

    // Center the grid
    this.panX = rect.width / 2;
    this.panY = rect.height / 2;
    this.zoom = 1;
  }

  // Convert hex coordinates to screen pixel coordinates
  private toScreen(q: number, r: number): { x: number; y: number } {
    const px = hexToPixel(q, r, this.hexSize * this.zoom);
    return {
      x: px.x * this.dpr + this.panX * this.dpr,
      y: px.y * this.dpr + this.panY * this.dpr,
    };
  }

  // Find cell at screen coordinates using distance-based hit detection
  private findCellAt(clientX: number, clientY: number): CellState | null {
    const hitRadius = this.hexSize * this.zoom * 0.9 * this.dpr;

    let closest: CellState | null = null;
    let closestDist = Infinity;

    for (const cell of this.state.cells) {
      const screen = this.toScreen(cell.q, cell.r);
      const dx = (clientX - this.canvas.getBoundingClientRect().left) * this.dpr - screen.x;
      const dy = (clientY - this.canvas.getBoundingClientRect().top) * this.dpr - screen.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < hitRadius && dist < closestDist) {
        closest = cell;
        closestDist = dist;
      }
    }
    return closest;
  }

  private bindEvents() {
    this.canvas.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.handlePointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.handlePointerUp(e));
    this.canvas.addEventListener('pointercancel', () => this.handlePointerCancel());
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private handlePointerDown(e: PointerEvent) {
    e.preventDefault();
    this.touchCount++;
    this.longPressFired = false;

    // Two-finger hold for foresight (mobile)
    if (this.touchCount >= 2) {
      this.twoFingerHold = true;
      if (this.tool !== 'foresight') {
        this.setTool('foresight');
      }
      return;
    }
  }

  private handlePointerMove(e: PointerEvent) {
    if (this.longPressTimer !== null) {
      // Cancel long press if moved
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private handlePointerUp(e: PointerEvent) {
    e.preventDefault();
    this.touchCount = Math.max(0, this.touchCount - 1);

    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }

    if (this.twoFingerHold) {
      if (this.touchCount === 0) {
        this.twoFingerHold = false;
        // Exit foresight mode if we entered it via two-finger hold
        // (only if the tool button wasn't already set to foresight)
        // We'll let the tool button handle toggling; here just go back to mark
        this.setTool('mark');
      }
      return;
    }

    if (this.longPressFired) {
      this.longPressFired = false;
      return; // Long press already handled
    }

    // Normal tap
    const cell = this.findCellAt(e.clientX, e.clientY);
    if (cell) {
      if (this.tool === 'foresight') {
        // Foresight is read-only — no tap action
        return;
      }
      this.onTap(cell.q, cell.r);
    }
  }

  private handlePointerCancel() {
    this.touchCount = 0;
    this.twoFingerHold = false;
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  // ============================================================
  // Rendering
  // ============================================================

  private animate() {
    if (this.driftAnim) {
      const now = performance.now();
      const elapsed = now - this.driftAnim.startTime;
      if (elapsed >= this.driftAnim.duration) {
        this.driftAnim = null;
      }
    }
    this.render();
    requestAnimationFrame(() => this.animate());
  }

  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Clear
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, w, h);

    // Draw cells
    const driftProgress = this.driftAnim
      ? Math.min(1, (performance.now() - this.driftAnim.startTime) / this.driftAnim.duration)
      : 0;
    const easeProgress = driftProgress < 1
      ? 1 - Math.pow(1 - driftProgress, 3) // ease-out cubic
      : 1;

    // Build a set of cells that are currently animating
    const animatingCells = new Map<number, DriftMove>();
    if (this.driftAnim) {
      for (const move of this.driftAnim.moves) {
        if (!move.lost) {
          animatingCells.set(move.cellIndex, move);
        }
      }
    }

    for (let i = 0; i < this.state.cells.length; i++) {
      const cell = this.state.cells[i];
      let renderQ = cell.q;
      let renderR = cell.r;

      // If this cell is animating, interpolate position
      if (animatingCells.has(i)) {
        const move = animatingCells.get(i)!;
        const fromScreen = this.toScreen(move.fromQ, move.fromR);
        const toScreen = this.toScreen(move.toQ, move.toR);
        const x = fromScreen.x + (toScreen.x - fromScreen.x) * easeProgress;
        const y = fromScreen.y + (toScreen.y - fromScreen.y) * easeProgress;
        this.drawHexAt(x, y, cell, i);
        continue;
      }

      const screen = this.toScreen(renderQ, renderR);
      this.drawHexAt(screen.x, screen.y, cell, i);
    }

    // Draw foresight preview
    if (this.foresightMoves && this.tool === 'foresight') {
      this.drawForesight();
    }

    // Draw drift warning indicator if next move triggers drift
    if (this.shouldShowDriftWarning()) {
      this.drawDriftWarning();
    }
  }

  private shouldShowDriftWarning(): boolean {
    const freq = this.level.driftFrequency;
    const movesLeft = freq - this.state.movesSinceDrift;
    return movesLeft <= 1 && !this.state.won;
  }

  private drawDriftWarning() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    // Pulsing red border
    const pulse = 0.5 + 0.3 * Math.sin(performance.now() / 200);
    ctx.strokeStyle = `rgba(248, 113, 113, ${pulse})`;
    ctx.lineWidth = 4 * this.dpr;
    ctx.strokeRect(2 * this.dpr, 2 * this.dpr, w - 4 * this.dpr, this.canvas.height - 4 * this.dpr);
  }

  private drawHexAt(cx: number, cy: number, cell: CellState, index: number) {
    const ctx = this.ctx;
    const size = this.hexSize * this.zoom * this.dpr;

    // Get hex vertices
    const verts = hexVertices(cx, cy, size);

    // Determine fill color based on cell state
    // Clue cells take priority — they always show as clues regardless of resolution
    let fill = '#30363d'; // unknown — slightly lighter, clearly "empty"
    let strokeColor = '#484f58'; // unknown stroke — visible grey
    let strokeWidth = 1.5 * this.dpr;

    if (cell.type === 'clue' && cell.isGiven) {
      // Clue cells: distinct dark fill with bright blue-white border
      // Must be visually unmistakable as a clue, not just "another dark cell"
      fill = '#0a1628'; // very dark blue-black
      strokeColor = '#79c0ff'; // bright sky blue
      strokeWidth = 2.5 * this.dpr;
    } else if (cell.resolution === 'marked') {
      fill = '#d97706'; // orange
      strokeColor = '#f59e0b';
    } else if (cell.resolution === 'cleared') {
      fill = '#1e6feb'; // blue
      strokeColor = '#388bfd';
    }

    // Draw hex path
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) {
      ctx.lineTo(verts[i].x, verts[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();

    // Draw red flash for wrong cells
    const isWrong = this.wrongFlashCells.some((c) => c.q === cell.q && c.r === cell.r);
    if (isWrong && performance.now() < this.wrongFlashUntil) {
      const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 150);
      ctx.beginPath();
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) {
        ctx.lineTo(verts[i].x, verts[i].y);
      }
      ctx.closePath();
      ctx.strokeStyle = `rgba(248, 113, 113, ${pulse})`;
      ctx.lineWidth = 5 * this.dpr;
      ctx.stroke();
    } else if (isWrong) {
      // Remove from wrong flash list after expiry
      this.wrongFlashCells = this.wrongFlashCells.filter((c) => !(c.q === cell.q && c.r === cell.r));
    }

    // Draw anchored rim (cyan)
    if (cell.anchored) {
      ctx.beginPath();
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) {
        ctx.lineTo(verts[i].x, verts[i].y);
      }
      ctx.closePath();
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 4 * this.dpr;
      ctx.stroke();
    }

    // Draw clue number — large, bold, with a subtle glow for emphasis
    if (cell.type === 'clue' && cell.isGiven) {
      // Inner glow ring for clue cells (makes them visually distinct from unknowns)
      ctx.beginPath();
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) {
        ctx.lineTo(verts[i].x, verts[i].y);
      }
      ctx.closePath();
      ctx.shadowColor = 'rgba(121, 192, 255, 0.3)';
      ctx.shadowBlur = 8 * this.dpr;
      ctx.strokeStyle = 'rgba(121, 192, 255, 0.15)';
      ctx.lineWidth = 1 * this.dpr;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Large bold number — the key information the player reads
      ctx.fillStyle = '#e6edf3';
      ctx.font = `bold ${Math.round(size * 0.6)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(cell.clueCount), cx, cy);
    }

    // Draw stale indicator
    if (cell.stale) {
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.15, 0, Math.PI * 2);
      ctx.fillStyle = '#f87171';
      ctx.fill();
    }
  }

  private drawForesight() {
    const ctx = this.ctx;
    const size = this.hexSize * this.zoom * this.dpr;

    for (const move of this.foresightMoves!) {
      const from = this.toScreen(move.fromQ, move.fromR);
      const to = this.toScreen(move.toQ, move.toR);

      if (move.lost) {
        // Red glow for cells that will be lost
        ctx.beginPath();
        ctx.arc(from.x, from.y, size * 0.8, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(248, 113, 113, 0.4)';
        ctx.lineWidth = 3 * this.dpr;
        ctx.stroke();
      } else {
        // Ghost arrow pointing to drift target
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1) continue;

        // Arrow line
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
        ctx.lineWidth = 2 * this.dpr;
        ctx.setLineDash([6 * this.dpr, 4 * this.dpr]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Arrowhead
        const ah = size * 0.3;
        const angle = Math.atan2(dy, dx);
        ctx.beginPath();
        ctx.moveTo(to.x, to.y);
        ctx.lineTo(
          to.x - ah * Math.cos(angle - Math.PI / 6),
          to.y - ah * Math.sin(angle - Math.PI / 6),
        );
        ctx.lineTo(
          to.x - ah * Math.cos(angle + Math.PI / 6),
          to.y - ah * Math.sin(angle + Math.PI / 6),
        );
        ctx.closePath();
        ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
        ctx.fill();
      }
    }
  }

  // Expose for testing
  getCellScreenPos(q: number, r: number): { x: number; y: number } {
    return this.toScreen(q, r);
  }

  getHexSize(): number {
    return this.hexSize;
  }
}
