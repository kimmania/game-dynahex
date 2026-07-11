// ============================================================
// App Orchestrator — State machine, UI, game flow
// ============================================================

import { LevelDef, GameState, CellState, LevelScores, SaveData, FIRST_LEVEL_ID } from './engine/types';
import { createGameState, loadLevels, cloneState } from './engine/levels';
import { recomputeClues, allResolved, solutionValid, isCompromised, computeScores } from './engine/validator';
import { computeDrift, applyDrift } from './engine/drift';
import { loadSave, unlockLevel, markLevelComplete, setHelpSeen, updateSettings } from './engine/storage';
import { setSoundEnabled, playMark, playClear, playAnchor, playDrift, playInvalid, playWin } from './engine/audio';
import { BoardRenderer, ToolMode } from './ui/board';

const VOLUME_LABELS: Record<string, string> = {
  'v1': 'The Drift Awakens',
  'v2': 'Tidal Zones',
  'v3': 'Storm Fronts',
  'v4': 'The Collapse',
};

export class App {
  private levels: LevelDef[] = [];
  private currentLevel: LevelDef | null = null;
  private state: GameState | null = null;
  private renderer: BoardRenderer | null = null;
  private save: SaveData;
  private tool: ToolMode = 'mark';
  private history: GameState[] = [];
  private timerInterval: number | null = null;

  // DOM elements
  private els: Record<string, HTMLElement> = {};

  constructor() {
    this.save = loadSave();
    setSoundEnabled(this.save.settings.sound);
  }

  async bootstrap() {
    this.cacheElements();
    this.bindControls();
    this.renderMap();
    this.showMap();

    // Show help on first visit
    if (!this.save.hasSeenHelp) {
      this.openHelp();
    }
  }

  private cacheElements() {
    const ids = [
      'back-btn', 'title', 'help-btn', 'settings-btn',
      'map-view', 'map-scroll',
      'game-view', 'goal-banner', 'canvas-wrap',
      'tool-mark', 'tool-anchor', 'tool-foresight', 'undo-btn', 'reset-btn',
      'move-count', 'drift-count', 'drift-freq', 'anchor-count', 'resolved-count', 'total-count',
      'help-modal', 'help-close',
      'settings-modal', 'settings-close', 'setting-sound', 'setting-motion',
      'victory-modal', 'victory-title', 'victory-badges', 'victory-stats', 'victory-retry', 'victory-next',
      'compromised-modal', 'compromised-close',
    ];
    for (const id of ids) {
      this.els[id] = document.getElementById(id)!;
    }
  }

  // ============================================================
  // Map View
  // ============================================================

  private async renderMap() {
    const container = this.els['map-scroll'];
    container.innerHTML = '';

    if (this.levels.length === 0) {
      container.innerHTML = '<p class="loading">Loading levels…</p>';
      try {
        this.levels = await loadLevels();
      } catch (e) {
        container.innerHTML = '<p class="error">Failed to load levels. Please refresh.</p>';
        return;
      }
    }

    // Group levels by volume
    const volumes = new Map<string, LevelDef[]>();
    for (const level of this.levels) {
      if (!volumes.has(level.volume)) volumes.set(level.volume, []);
      volumes.get(level.volume)!.push(level);
    }

    for (const [volId, volLevels] of volumes) {
      const volLabel = VOLUME_LABELS[volId] ?? volId;

      const volDiv = document.createElement('div');
      volDiv.className = 'map-volume';
      volDiv.innerHTML = `<h3 class="vol-title">${volLabel}</h3>`;

      const grid = document.createElement('div');
      grid.className = 'map-grid';

      for (const level of volLevels) {
        const isUnlocked = this.isUnlocked(level.id);
        const scores = this.save.progress[level.id];
        const isCompleted = !!scores;

        const card = document.createElement('div');
        card.className = 'map-level';
        if (!isUnlocked) card.classList.add('locked');
        if (isCompleted) card.classList.add('completed');

        const badges = this.renderScoreBadges(scores);
        const driftLabel = level.driftVariant.charAt(0).toUpperCase() + level.driftVariant.slice(1);

        card.innerHTML = `
          <div class="level-name">${level.name}</div>
          <div class="level-info">${level.cells.length} cells · ${driftLabel}</div>
          <div class="level-badges">${badges}</div>
          ${!isUnlocked ? '<div class="lock-icon">🔒</div>' : ''}
        `;

        if (isUnlocked) {
          card.addEventListener('click', () => this.startLevel(level.id));
        }

        grid.appendChild(card);
      }

      volDiv.appendChild(grid);
      container.appendChild(volDiv);
    }
  }

  private renderScoreBadges(scores?: LevelScores): string {
    if (!scores) return '';
    const badges: string[] = [];
    if (scores.stabilized) badges.push('<span class="badge done" title="Stabilized">✓</span>');
    if (scores.conservation) badges.push('<span class="badge done" title="Conservation">✓</span>');
    if (scores.noLosses) badges.push('<span class="badge done" title="No Losses">✓</span>');
    if (scores.foresight) badges.push('<span class="badge done" title="Foresight">✓</span>');
    if (scores.speedrun) badges.push('<span class="badge done" title="Speedrun">✓</span>');
    return badges.join('');
  }

  private isUnlocked(levelId: string): boolean {
    if (levelId === FIRST_LEVEL_ID) return true;
    return this.save.unlocked.includes(levelId);
  }

  private showMap() {
    this.els['map-view'].style.display = '';
    this.els['game-view'].style.display = 'none';
    this.els['back-btn'].style.display = 'none';
    this.els['title'].textContent = 'Dynahex';
    this.stopTimer();
  }

  private showGame() {
    this.els['map-view'].style.display = 'none';
    this.els['game-view'].style.display = 'flex';
    this.els['back-btn'].style.display = '';
    this.startTimer();
  }

  // ============================================================
  // Game Flow
  // ============================================================

  private startLevel(levelId: string) {
    const level = this.levels.find((l) => l.id === levelId);
    if (!level) return;
    this.currentLevel = level;
    this.state = createGameState(level);
    this.history = [cloneState(this.state)];
    this.tool = 'mark';

    this.els['title'].textContent = level.name;
    this.renderGoalBanner();
    this.showGame();

    // Setup canvas
    const canvas = document.getElementById('board-canvas') as HTMLCanvasElement;
    if (this.renderer) {
      this.renderer.setLevel(level, this.state);
    } else {
      this.renderer = new BoardRenderer(
        canvas,
        level,
        this.state,
        (q, r) => this.handleTap(q, r),
        () => this.refresh(),
      );
    }

    this.setTool('mark');
    this.refresh();
  }

  private renderGoalBanner() {
    if (!this.currentLevel) return;
    const level = this.currentLevel;
    const driftLabel = level.driftVariant.charAt(0).toUpperCase() + level.driftVariant.slice(1);
    this.els['goal-banner'].innerHTML = `
      <div class="goal-title">${level.name}</div>
      <div class="goal-objective">Mark every true hex <span class="obj-mark">orange</span> and clear every safe hex <span class="obj-clear">blue</span> to solve the puzzle.</div>
      <div class="goal-info">
        <span class="goal-pill">${level.cells.length} cells</span>
        <span class="goal-pill">${driftLabel} drift (every ${level.driftFrequency} moves)</span>
        <span class="goal-pill">${level.anchorBudget - (this.state?.anchorsUsed ?? 0)} anchors left</span>
        ${level.lossTolerance > 0 ? `<span class="goal-pill warn">${level.lossTolerance} loss OK</span>` : '<span class="goal-pill warn">No losses</span>'}
      </div>
    `;
  }

  private handleTap(q: number, r: number) {
    if (!this.state || !this.currentLevel || this.state.won || this.state.compromised) return;
    const cell = this.state.cells.find((c) => c.q === q && c.r === r);
    if (!cell) return;

    if (this.tool === 'anchor') {
      this.handleAnchorTap(cell);
    } else {
      this.handleMarkTap(cell);
    }
  }

  private handleMarkTap(cell: CellState) {
    if (cell.anchored && cell.resolution !== 'unknown') return; // Can't change anchored resolved cells
    if (cell.isGiven && cell.type === 'clue') return; // Can't change given clues

    // Cycle: unknown → marked → cleared → unknown
    const oldResolution = cell.resolution;
    if (oldResolution === 'unknown') {
      cell.resolution = 'marked';
      playMark();
    } else if (oldResolution === 'marked') {
      cell.resolution = 'cleared';
      playClear();
    } else {
      cell.resolution = 'unknown';
    }

    this.postMove();
  }

  private handleAnchorTap(cell: CellState) {
    if (cell.anchored) {
      // Can't un-anchor (anchors are permanent)
      playInvalid();
      return;
    }
    if (this.state!.anchorsUsed >= this.currentLevel!.anchorBudget) {
      playInvalid();
      return;
    }

    cell.anchored = true;
    this.state!.anchorsUsed++;
    playAnchor();
    this.postMove();
  }

  // Called after long-press in mark mode → switch to anchor action
  // (the renderer's onTap still fires, but we check tool state)

  private postMove() {
    if (!this.state || !this.currentLevel) return;

    // Do NOT recompute clue counts here — they are target values from the
    // level definition (how many neighbors SHOULD be marked). They only
    // change when the topology changes (drift), not when the player marks/clears.

    // Increment move count
    this.state.moves++;
    this.state.movesSinceDrift++;

    // Save history
    this.history.push(cloneState(this.state));
    if (this.history.length > 30) this.history.shift();

    // Check for drift tick
    if (this.state.movesSinceDrift >= this.currentLevel.driftFrequency) {
      this.triggerDrift();
    }

    // Check for win
    if (this.checkWin()) {
      this.handleWin();
    }

    this.refresh();
  }

  private triggerDrift() {
    if (!this.state || !this.currentLevel) return;

    const moves = computeDrift(this.state, this.currentLevel.gridRadius, this.currentLevel.driftSeed);
    if (moves.length === 0) return;

    // Animate drift
    if (this.renderer) {
      this.renderer.animateDrift(moves);
    }

    // Apply drift after animation duration
    const duration = this.save.settings.reducedMotion ? 0 : 300;
    setTimeout(() => {
      const result = applyDrift(this.state!, moves);
      if (result.staleCreated) {
        this.state!.everStale = true;
      }
      recomputeClues(this.state!.cells);
      playDrift();

      // Check for compromise after drift
      if (isCompromised(this.state!.cells, this.currentLevel!.gridRadius)) {
        this.handleCompromised();
      }

      // Check for win after drift (stabilization requires zero-movement tick)
      if (this.checkWin()) {
        this.handleWin();
      }

      this.refresh();
    }, duration);
  }

  private checkWin(): boolean {
    if (!this.state || !this.currentLevel) return false;
    if (!allResolved(this.state.cells)) return false;
    if (!solutionValid(this.state.cells)) return false;
    // Win when all cells are correctly resolved
    // "Stabilized" (surviving a drift tick) is a bonus star, not a hard gate
    return true;
  }

  private handleWin() {
    if (!this.state || !this.currentLevel) return;
    this.state.won = true;
    this.stopTimer();

    const scores = computeScores(
      this.state,
      this.currentLevel,
      this.currentLevel.driftSeed,
      this.currentLevel.gridRadius,
    );

    // Save progress
    this.save = markLevelComplete(this.currentLevel.id, scores);

    // Unlock next level
    const idx = this.levels.findIndex((l) => l.id === this.currentLevel!.id);
    const next = this.levels[idx + 1];
    if (next) {
      this.save = unlockLevel(next.id);
    }

    playWin();

    // Show victory modal after delay
    setTimeout(() => {
      this.showVictory(scores, next);
    }, 600);
  }

  private showVictory(scores: LevelScores, next?: LevelDef) {
    const modal = this.els['victory-modal'] as HTMLElement;
    this.els['victory-title'].textContent = 'Level Complete';

    const badges: string[] = [];
    if (scores.stabilized) badges.push('<span class="badge done">✓ Stabilized</span>');
    if (scores.conservation) badges.push('<span class="badge done">✓ Conservation</span>');
    if (scores.noLosses) badges.push('<span class="badge done">✓ No Losses</span>');
    if (scores.foresight) badges.push('<span class="badge done">✓ Foresight</span>');
    if (scores.speedrun) badges.push('<span class="badge done">✓ Speedrun</span>');
    this.els['victory-badges'].innerHTML = badges.join('');

    const stats = this.state!;
    this.els['victory-stats'].innerHTML = `
      <div class="stat-row">Moves: ${stats.moves}</div>
      <div class="stat-row">Anchors used: ${stats.anchorsUsed}/${this.currentLevel!.anchorBudget}</div>
      <div class="stat-row">Cells lost: ${stats.cellsLost}</div>
      <div class="stat-row">Time: ${this.formatTime(stats.elapsedTime)}</div>
    `;

    // Show/hide next button
    const nextBtn = this.els['victory-next'] as HTMLElement;
    if (next) {
      nextBtn.style.display = '';
      nextBtn.textContent = `Next: ${next.name}`;
      nextBtn.onclick = () => {
        modal.style.display = 'none';
        this.startLevel(next.id);
      };
    } else {
      nextBtn.style.display = 'none';
    }

    (this.els['victory-retry'] as HTMLElement).onclick = () => {
      modal.style.display = 'none';
      this.startLevel(this.currentLevel!.id);
    };

    modal.style.display = 'flex';
  }

  private handleCompromised() {
    if (!this.state) return;
    this.state.compromised = true;
    const modal = this.els['compromised-modal'] as HTMLElement;
    (this.els['compromised-close'] as HTMLElement).onclick = () => {
      modal.style.display = 'none';
      this.startLevel(this.currentLevel!.id);
    };
    modal.style.display = 'flex';
  }

  private undo() {
    if (this.history.length < 2) return;
    this.history.pop(); // Remove current state
    const prev = this.history[this.history.length - 1];
    this.state = cloneState(prev);
    this.refresh();
  }

  private resetLevel() {
    if (this.currentLevel) {
      this.startLevel(this.currentLevel.id);
    }
  }

  // ============================================================
  // UI Update
  // ============================================================

  private refresh() {
    if (!this.state || !this.currentLevel) return;

    this.els['move-count'].textContent = String(this.state.moves);
    this.els['drift-count'].textContent = String(this.state.movesSinceDrift);
    this.els['drift-freq'].textContent = String(this.currentLevel.driftFrequency);
    this.els['anchor-count'].textContent = String(this.currentLevel.anchorBudget - this.state.anchorsUsed);

    const resolved = this.state.cells.filter((c) => c.resolution !== 'unknown').length;
    this.els['resolved-count'].textContent = String(resolved);
    this.els['total-count'].textContent = String(this.state.cells.length);

    // Update tool buttons
    this.updateToolButtons();

    // Update undo button
    (this.els['undo-btn'] as HTMLElement).classList.toggle('disabled', this.history.length < 2);

    // Update goal banner (anchor count changes)
    this.renderGoalBanner();

    // Update renderer
    if (this.renderer) {
      this.renderer.setState(this.state);
    }
  }

  private updateToolButtons() {
    for (const tool of ['mark', 'anchor', 'foresight'] as ToolMode[]) {
      const btn = this.els[`tool-${tool}`] as HTMLElement;
      btn.classList.toggle('active', this.tool === tool);
    }
  }

  private setTool(tool: ToolMode) {
    this.tool = tool;
    if (this.renderer) {
      this.renderer.setTool(tool);
    }
    this.updateToolButtons();
  }

  private startTimer() {
    this.stopTimer();
    this.timerInterval = window.setInterval(() => {
      if (this.state && !this.state.won && !this.state.compromised) {
        this.state.elapsedTime = Math.floor((Date.now() - this.state.startTime) / 1000);
      }
    }, 1000);
  }

  private stopTimer() {
    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ============================================================
  // Help & Settings
  // ============================================================

  private openHelp() {
    this.renderHelpMiniBoards();
    this.els['help-modal'].style.display = 'flex';
  }

  private renderHelpMiniBoards() {
    // Render two mini boards: before (all unknown + clue) and solved (2 marked, rest cleared)
    // Layout: 7 hexes in a small cluster — 1 center clue + 6 neighbors
    // Use absolute positioning within .mini-board (180×180)

    // Mini hex geometry: pointy-top, ~52px wide, 60px tall
    // Center at (90, 90), neighbors at 60° intervals
    const cx = 90;
    const cy = 90;
    const hexW = 52;
    const hexH = 60;
    const radius = 42; // distance from center to neighbor centers

    // 6 neighbor positions (flat-topped: angles 0, 60, 120, 180, 240, 300)
    const neighborPositions: { x: number; y: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      neighborPositions.push({
        x: cx + radius * Math.cos(angle) - hexW / 2,
        y: cy + radius * Math.sin(angle) * 0.75 - hexH / 2,
      });
    }
    const centerPos = { x: cx - hexW / 2, y: cy - hexH / 2 };

    // Before: center clue "2", all 6 neighbors unknown
    const beforeBoard = document.getElementById('mini-before');
    if (beforeBoard) {
      beforeBoard.innerHTML = '';
      // Center clue
      const clue = document.createElement('div');
      clue.className = 'mini-hex clue';
      clue.style.left = `${centerPos.x}px`;
      clue.style.top = `${centerPos.y}px`;
      clue.textContent = '2';
      beforeBoard.appendChild(clue);
      // Neighbors — all unknown
      for (const pos of neighborPositions) {
        const hex = document.createElement('div');
        hex.className = 'mini-hex unknown';
        hex.style.left = `${pos.x}px`;
        hex.style.top = `${pos.y}px`;
        beforeBoard.appendChild(hex);
      }
    }

    // Solved: center clue "2", 2 neighbors marked (orange), 4 cleared (blue)
    // Mark the first 2 neighbors (top and top-right)
    const solvedBoard = document.getElementById('mini-solved');
    if (solvedBoard) {
      solvedBoard.innerHTML = '';
      // Center clue
      const clue = document.createElement('div');
      clue.className = 'mini-hex clue';
      clue.style.left = `${centerPos.x}px`;
      clue.style.top = `${centerPos.y}px`;
      clue.textContent = '2';
      solvedBoard.appendChild(clue);
      // Neighbors — 2 marked, 4 cleared
      for (let i = 0; i < 6; i++) {
        const pos = neighborPositions[i];
        const hex = document.createElement('div');
        hex.className = i < 2 ? 'mini-hex marked' : 'mini-hex cleared';
        hex.style.left = `${pos.x}px`;
        hex.style.top = `${pos.y}px`;
        solvedBoard.appendChild(hex);
      }
    }
  }

  private closeHelp() {
    this.els['help-modal'].style.display = 'none';
    if (!this.save.hasSeenHelp) {
      this.save = setHelpSeen();
    }
  }

  private openSettings() {
    const soundCheckbox = this.els['setting-sound'] as HTMLInputElement;
    const motionCheckbox = this.els['setting-motion'] as HTMLInputElement;
    soundCheckbox.checked = this.save.settings.sound;
    motionCheckbox.checked = this.save.settings.reducedMotion;
    this.els['settings-modal'].style.display = 'flex';
  }

  private closeSettings() {
    this.els['settings-modal'].style.display = 'none';
  }

  private bindControls() {
    this.els['back-btn'].addEventListener('click', () => this.showMap());
    this.els['help-btn'].addEventListener('click', () => this.openHelp());
    this.els['help-close'].addEventListener('click', () => this.closeHelp());
    this.els['settings-btn'].addEventListener('click', () => this.openSettings());
    this.els['settings-close'].addEventListener('click', () => this.closeSettings());

    this.els['tool-mark'].addEventListener('click', () => this.setTool('mark'));
    this.els['tool-anchor'].addEventListener('click', () => this.setTool('anchor'));
    this.els['tool-foresight'].addEventListener('click', () => this.setTool('foresight'));
    this.els['undo-btn'].addEventListener('click', () => this.undo());
    this.els['reset-btn'].addEventListener('click', () => this.resetLevel());

    // Settings
    this.els['setting-sound'].addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      this.save = updateSettings((s) => ({ ...s, sound: checked }));
      setSoundEnabled(checked);
    });
    this.els['setting-motion'].addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      this.save = updateSettings((s) => ({ ...s, reducedMotion: checked }));
      if (this.renderer) this.renderer.setReducedMotion(checked);
    });

    // Window resize
    window.addEventListener('resize', () => {
      if (this.renderer) this.renderer.resize();
    });
  }
}
