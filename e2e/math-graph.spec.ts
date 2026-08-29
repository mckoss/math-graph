import { expect, test } from '@playwright/test';

test('presents and operates the Math Graph knowledge explorer', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto('./');

  await expect(page).toHaveTitle('Math Graph');
  await expect(page.getByRole('heading', { level: 1, name: 'Math Graph', exact: true })).toBeVisible();
  await expect(page.getByText(/knowledge explorer/i)).toBeVisible();
  await expect(page.getByText('94 concepts', { exact: true })).toBeVisible();
  await expect(page.getByText(/^(163|166) connections$/)).toBeVisible();

  const bands = page.locator('[role="list"][aria-label="Maturity levels"] .band');
  await expect(bands).toHaveCount(4);
  await expect(bands.locator('.band-label')).toHaveText([
    'Elementary · grades 1–8',
    'High School · grades 9–12',
    'Undergraduate',
    'Graduate',
  ]);
  await expect(page.locator('.band[data-maturity-level="graduate"]')).toHaveAttribute(
    'aria-label',
    /Graduate: 0 visible nodes/,
  );

  const canvas = page.locator('.graph canvas').first();
  await expect(canvas).toBeVisible();

  const status = page.getByRole('status');
  const collapsedStatus = await status.textContent();
  expect(collapsedStatus).toMatch(/Showing \d+ nodes and \d+ connections/);

  await page.getByRole('button', { name: /Expand all/ }).click();
  await expect(status).toHaveText(/Showing 94 nodes and (163|166) connections/);
  expect(await status.textContent()).not.toBe(collapsedStatus);

  await page.getByRole('button', { name: /Collapse all/ }).click();
  await expect(status).toHaveText(collapsedStatus!);

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.getByRole('button', { name: 'Fit to view' }).click();
  await expect(canvas).toBeVisible();

  expect(errors).toEqual([]);
});
