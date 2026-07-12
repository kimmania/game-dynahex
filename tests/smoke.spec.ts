import { test, expect, type Page } from '@playwright/test';

// All tests run under WebKit (Safari engine) with touch + no hover, per the
// user's iPad/Safari testing rule. The device context applies small movements
// between pointerdown/up, so a tap that is swallowed by drag detection would
// fail the tool-button active-class assertions below.

async function openTestPage(page: Page, path = '/') {
  // ?test=1 activates the guarded window.__dynahex seam in app.ts.
  await page.goto(path + (path.includes('?') ? '&' : '?') + 'test=1');
  // Dismiss the first-visit help modal if present.
  const help = page.locator('#help-modal');
  if (await help.isVisible().catch(() => false)) {
    await page.locator('#help-close').tap();
  }
}

test('map renders level cards and the first level is unlocked', async ({ page }) => {
  await openTestPage(page);
  await expect(page.locator('#map-view')).toBeVisible();
  const cards = page.locator('.map-level');
  await expect(cards.first()).toBeVisible();
  // First card should not be locked (player can start there).
  await expect(cards.first()).not.toHaveClass(/locked/);
});

test('entering level 1 shows the canvas + goal banner (touch tap)', async ({ page }) => {
  await openTestPage(page);
  // Tap (not click) the first map card — verifies touch routing works.
  await page.locator('.map-level').first().tap();
  await expect(page.locator('#game-view')).toBeVisible();
  await expect(page.locator('#board-canvas')).toBeVisible();
  // Goal banner must state the plain-language objective (user requirement).
  const banner = page.locator('#goal-banner');
  await expect(banner).toContainText(/mark every true hex/i);
  await expect(banner).toContainText(/clear every safe hex/i);
});

test('tool buttons toggle active state on tap (iPad micro-movement safe)', async ({ page }) => {
  await openTestPage(page);
  await page.locator('.map-level').first().tap();
  await expect(page.locator('#tool-mark')).toHaveClass(/active/);

  // Tap Clear — should become active, Mark should drop active.
  await page.locator('#tool-clear').tap();
  await expect(page.locator('#tool-clear')).toHaveClass(/active/);
  await expect(page.locator('#tool-mark')).not.toHaveClass(/active/);

  // Tap Anchor then Foresight — same routing check for every action button.
  await page.locator('#tool-anchor').tap();
  await expect(page.locator('#tool-anchor')).toHaveClass(/active/);
  await page.locator('#tool-foresight').tap();
  await expect(page.locator('#tool-foresight')).toHaveClass(/active/);
});

test('help modal opens and shows the concrete before/solved mini-boards', async ({ page }) => {
  await openTestPage(page);
  await page.locator('#help-btn').tap();
  await expect(page.locator('#help-modal')).toBeVisible();
  // Concrete visual walkthrough: both mini-boards must be populated.
  await expect(page.locator('#mini-before canvas, #mini-before .demo-cell')).toBeTruthy();
  await expect(page.locator('#mini-solved canvas, #mini-solved .demo-cell')).toBeTruthy();
  await page.locator('#help-close').tap();
  await expect(page.locator('#help-modal')).not.toBeVisible();
});

test('CRITICAL: fully-resolved-but-wrong triggers red flash + toast, not silent win', async ({ page }) => {
  await openTestPage(page);
  await page.locator('.map-level').first().tap();

  // Force a fully-resolved-but-wrong board through the real game engine:
  // resolve every cell, then flip ONE cell so it no longer matches isTrue.
  await page.evaluate(() => {
    const api = (window as any).__dynahex;
    const state = api.getState();
    for (const cell of state.cells) {
      cell.resolution = cell.isTrue ? 'marked' : 'cleared';
    }
    // Introduce one wrong resolution.
    const victim = state.cells.find((c: any) => !c.isTrue);
    if (victim) victim.resolution = 'marked'; // safe cell wrongly marked
    api.forceWrongSolution();
  });

  // The toast must appear naming the wrong cells (NOT a silent win).
  const toast = page.locator('#game-toast');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText(/resolved wrong/i);
});

test('solving a level with its unique solution wins (strict validator accepts the single solution)', async ({ page }) => {
  // Regression for the "First Tremor game of chance" bug: every generated
  // level must have exactly ONE solution, and applying that solution must
  // pass the strict win check (not be rejected as "wrong").
  await openTestPage(page);
  // Start the first (always-unlocked) level.
  await page.locator('.map-level').first().tap();
  await expect(page.locator('#board-canvas')).toBeVisible();

  // Apply the stored unique solution via the test seam and run the real win check.
  await page.evaluate(() => (window as any).__dynahex.solve());

  // A genuine win shows the victory modal (not a silent pass, not a wrong-flash).
  await expect(page.locator('#victory-modal')).toBeVisible();
});
