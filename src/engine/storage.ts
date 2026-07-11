// ============================================================
// Storage — localStorage save/load
// ============================================================

import { SaveData, Settings, STORAGE_KEY, SAVE_VERSION } from './types';

const DEFAULT_SETTINGS: Settings = {
  sound: true,
  reducedMotion: false,
};

const DEFAULT_SAVE: SaveData = {
  settings: { ...DEFAULT_SETTINGS },
  progress: {},
  unlocked: [],
  hasSeenHelp: false,
};

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SAVE };
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    return {
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
      progress: parsed.progress ?? {},
      unlocked: parsed.unlocked ?? [],
      hasSeenHelp: parsed.hasSeenHelp ?? false,
    };
  } catch {
    return { ...DEFAULT_SAVE };
  }
}

export function saveSave(data: SaveData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore quota errors
  }
}

export function updateSettings(updater: (s: Settings) => Settings): SaveData {
  const current = loadSave();
  current.settings = updater(current.settings);
  saveSave(current);
  return current;
}

export function markLevelComplete(levelId: string, scores: SaveData['progress'][string]): SaveData {
  const current = loadSave();
  current.progress[levelId] = scores;
  saveSave(current);
  return current;
}

export function unlockLevel(levelId: string): SaveData {
  const current = loadSave();
  if (!current.unlocked.includes(levelId)) {
    current.unlocked.push(levelId);
    saveSave(current);
  }
  return current;
}

export function setHelpSeen(): SaveData {
  const current = loadSave();
  current.hasSeenHelp = true;
  saveSave(current);
  return current;
}

export { SAVE_VERSION };
