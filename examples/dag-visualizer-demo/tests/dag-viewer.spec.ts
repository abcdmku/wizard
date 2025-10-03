import { test, expect } from '@playwright/test';

test.describe('DAG Viewer', () => {
  test('should display connecting arrows between nodes', async ({ page }) => {
    await page.goto('http://localhost:5180');

    // Wait for the DAG to load
    await page.waitForSelector('.wiz-flow');

    // Check that nodes are visible
    const nodes = await page.locator('button[data-id]').count();
    expect(nodes).toBeGreaterThan(0);

    // Check that edges are rendered (React Flow creates buttons for edges)
    const edges = await page.locator('button:has-text("Edge from")').count();
    expect(edges).toBeGreaterThan(0);

    // Verify specific edges exist for the basic form dataset
    await expect(page.locator('button:has-text("Edge from account to personal")')).toBeVisible();
    await expect(page.locator('button:has-text("Edge from personal to address")')).toBeVisible();
    await expect(page.locator('button:has-text("Edge from address to summary")')).toBeVisible();
  });

  test('should display arrows in branching dataset', async ({ page }) => {
    await page.goto('http://localhost:5180');

    // Switch to Advanced Branching dataset
    await page.selectOption('select', 'branching');

    // Wait for layout to complete
    await page.waitForTimeout(500);

    // Check that edges exist
    const edges = await page.locator('button:has-text("Edge from")').count();
    expect(edges).toBeGreaterThan(0);

    // Verify specific branching edges
    await expect(page.locator('button:has-text("Edge from roleSelection")')).toBeVisible();
  });

  test('should display arrows in router dataset', async ({ page }) => {
    await page.goto('http://localhost:5180');

    // Switch to React Router dataset
    await page.selectOption('select', 'router');

    // Wait for layout to complete
    await page.waitForTimeout(500);

    // Check that edges exist
    const edges = await page.locator('button:has-text("Edge from")').count();
    expect(edges).toBeGreaterThan(0);
  });

  test('should not show React Flow edge errors in console', async ({ page }) => {
    const consoleErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'warning' && msg.text().includes('Couldn\'t create edge')) {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('http://localhost:5180');
    await page.waitForSelector('.wiz-flow');

    // No edge creation errors should occur
    expect(consoleErrors.length).toBe(0);
  });
});
