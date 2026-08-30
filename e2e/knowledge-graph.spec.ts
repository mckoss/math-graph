import { expect, test } from '@playwright/test';

test('presents and operates the Knowledge Graph Math domain', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto('./');

  await expect(page).toHaveTitle('Knowledge Graph');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Knowledge Graph', exact: true }),
  ).toBeVisible();
  const domain = page.getByRole('combobox', { name: 'Knowledge domain' });
  await expect(domain).toHaveValue('math');
  await expect(domain.locator('option')).toHaveText(['Math', 'Physics']);
  await expect(page.getByText('94 concepts', { exact: true })).toBeVisible();
  await expect(page.getByText('163 connections', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'More information about Algebra', exact: true }),
  ).toHaveCount(2);

  const bands = page.locator('[role="list"][aria-label="Knowledge levels"] .band');
  await expect(bands).toHaveCount(4);
  const visualization = page.locator('.viz');
  await expect(visualization).toHaveAttribute('data-layout-orientation', 'landscape');
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

  await page.setViewportSize({ width: 600, height: 900 });
  await expect(visualization).toHaveAttribute('data-layout-orientation', 'portrait');
  await expect(bands).toHaveCount(4);
  const portraitVizBounds = await visualization.boundingBox();
  const portraitBandBounds = await bands.evaluateAll((items) =>
    items.map((item) => item.getBoundingClientRect().toJSON()),
  );
  for (const band of await bands.all()) {
    const bounds = await band.boundingBox();
    expect(bounds?.height).toBeGreaterThan(0);
  }
  const occupiedBandHeight =
    portraitBandBounds.at(-1)!.bottom - portraitBandBounds[0].top;
  expect(occupiedBandHeight).toBeGreaterThan(portraitVizBounds!.height * 0.45);

  await page.setViewportSize({ width: 1200, height: 700 });
  await expect(visualization).toHaveAttribute('data-layout-orientation', 'landscape');
  await expect
    .poll(async () => Number(await visualization.getAttribute('data-current-zoom')))
    .toBeGreaterThanOrEqual(0.74);

  const canvas = page.locator('.graph canvas').first();
  await expect(canvas).toBeVisible();
  await page.getByRole('button', { name: 'Fit to view' }).click();
  await page.waitForTimeout(600);

  const panel = page.locator('.panel');
  const numbersInfo = page.getByRole('button', {
    name: 'More information about Numbers & Counting',
  });
  await expect(numbersInfo).toBeVisible();
  const infoBounds = await numbersInfo.boundingBox();
  expect(infoBounds).not.toBeNull();
  await page.mouse.click(infoBounds!.x - 24, infoBounds!.y + 18);
  await expect(panel).toHaveAttribute('aria-hidden', 'true');

  await numbersInfo.click();
  await expect(panel).toHaveAttribute('aria-hidden', 'false');
  await expect(panel.getByRole('heading', { name: 'Numbers & Counting' })).toBeVisible();
  await page.getByRole('button', { name: 'Close panel' }).click();
  await expect(panel).toHaveAttribute('aria-hidden', 'true');

  const status = page.getByRole('status');
  const collapsedStatus = await status.textContent();
  expect(collapsedStatus).toMatch(/Showing \d+ nodes and \d+ connections/);

  const numbersButtonBounds = await numbersInfo.boundingBox();
  expect(numbersButtonBounds).not.toBeNull();
  await page.mouse.dblclick(numbersButtonBounds!.x - 28, numbersButtonBounds!.y + 18, {
    delay: 80,
  });
  await expect(status).toHaveText(/Showing 26 nodes and \d+ connections/);
  await expect(visualization).toHaveAttribute('data-compound-group-count', '1');
  await expect
    .poll(async () => Number(await visualization.getAttribute('data-focus-anchor-delta-x')))
    .toBeLessThan(0.5);
  await expect(visualization).toHaveAttribute('data-root-overlap-count', '0');
  await page.waitForTimeout(600);

  const initialFocusedZoom = Number(await visualization.getAttribute('data-current-zoom'));
  const countingInfo = page.getByRole('button', { name: 'More information about Counting' });
  await expect(countingInfo).toBeVisible();
  const elementaryBand = page.locator('.band[data-maturity-level="elementary"]');
  const focusedVizBounds = await visualization.boundingBox();
  expect(focusedVizBounds).not.toBeNull();
  let elementaryBeforeDrag = await elementaryBand.boundingBox();
  expect(elementaryBeforeDrag).not.toBeNull();
  const countingCenter = {
    x: focusedVizBounds!.x + Number(await countingInfo.getAttribute('data-node-center-x')),
    y: focusedVizBounds!.y + Number(await countingInfo.getAttribute('data-node-center-y')),
  };
  await page.mouse.move(countingCenter.x, countingCenter.y);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.move(
    countingCenter.x + 30,
    elementaryBeforeDrag!.y - 50,
    { steps: 24 },
  );
  await page.waitForTimeout(100);
  const elementaryDuringDrag = await elementaryBand.boundingBox();
  expect(elementaryDuringDrag!.height).toBeGreaterThan(elementaryBeforeDrag!.height + 35);
  await page.mouse.up();
  await expect
    .poll(async () => Number(await visualization.getAttribute('data-saved-layout-node-count')))
    .toBeGreaterThanOrEqual(4);
  await expect(visualization).toHaveAttribute('data-root-overlap-count', '0');
  await expect
    .poll(async () =>
      (await elementaryBand.boundingBox())?.height ?? 0,
    )
    .toBeLessThanOrEqual(elementaryDuringDrag!.height + 2);
  const savedCountingOffsetX =
    Number(await countingInfo.getAttribute('data-node-model-x')) -
    Number(await numbersInfo.getAttribute('data-node-model-x'));

  for (let step = 0; step < 4; step++) {
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await page.waitForTimeout(220);
  }
  const zoomedOut = Number(await visualization.getAttribute('data-current-zoom'));
  expect(zoomedOut).toBeLessThan(initialFocusedZoom * 0.6);

  await page.getByRole('button', { name: /Collapse all/ }).click();
  await expect(status).toHaveText(collapsedStatus!);
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Fit to view' }).click();
  await page.waitForTimeout(600);
  await expect(numbersInfo).toBeVisible();
  const reopenedVizBounds = await visualization.boundingBox();
  expect(reopenedVizBounds).not.toBeNull();
  await page.mouse.dblclick(
    reopenedVizBounds!.x + Number(await numbersInfo.getAttribute('data-node-center-x')),
    reopenedVizBounds!.y + Number(await numbersInfo.getAttribute('data-node-center-y')),
    { delay: 80 },
  );
  await expect(status).toHaveText(/Showing 26 nodes and \d+ connections/);
  await expect
    .poll(async () => Number(await visualization.getAttribute('data-restored-layout-node-count')))
    .toBeGreaterThanOrEqual(4);
  await expect(visualization).toHaveAttribute('data-root-overlap-count', '0');
  await expect
    .poll(async () =>
      Math.abs(
        Number(await countingInfo.getAttribute('data-node-model-x')) -
          Number(await numbersInfo.getAttribute('data-node-model-x')) -
          savedCountingOffsetX,
      ),
    )
    .toBeLessThan(1);
  await page.getByRole('button', { name: /Collapse all/ }).click();
  await expect(status).toHaveText(collapsedStatus!);

  await page.getByRole('button', { name: /Expand all/ }).click();
  await expect(status).toHaveText('Showing 116 nodes and 163 connections.');
  await expect(visualization).toHaveAttribute('data-layout-mode', 'bounded');
  await expect(visualization).toHaveAttribute('data-compound-group-count', '22');
  expect(await status.textContent()).not.toBe(collapsedStatus);

  await page.getByRole('button', { name: /Collapse all/ }).click();
  await expect(status).toHaveText(collapsedStatus!);
  await expect(visualization).toHaveAttribute('data-layout-mode', 'flow');
  await expect(visualization).toHaveAttribute('data-compound-group-count', '0');

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.getByRole('button', { name: 'Fit to view' }).click();
  await expect(canvas).toBeVisible();

  expect(errors).toEqual([]);
});

test('persists recursive aware, familiar, and mastered self-evaluations', async ({ page }) => {
  await page.goto('./');
  await page
    .getByRole('button', { name: 'More information about Numbers & Counting' })
    .click();

  const knowledge = page.getByRole('group', { name: 'Your knowledge of Numbers & Counting' });
  await expect(knowledge.getByRole('button')).toHaveText(['Aware', 'Familiar', 'Mastered']);
  await expect(page.getByText('Applies recursively to all 4 concepts in this group.')).toBeVisible();
  await knowledge.getByRole('button', { name: 'Mastered' }).click();
  await expect(knowledge.getByRole('button', { name: 'Mastered' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('knowledge-graph:math:knowledge-ratings:v1') ?? '{}'),
  );
  expect(stored).toEqual({
    counting: 'mastered',
    'natural-numbers': 'mastered',
    'number-line': 'mastered',
    'place-value': 'mastered',
  });

  await page.reload();
  await page
    .getByRole('button', { name: 'More information about Numbers & Counting' })
    .click();
  await expect(
    page
      .getByRole('group', { name: 'Your knowledge of Numbers & Counting' })
      .getByRole('button', { name: 'Mastered' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('restores user-dragged layout positions after refresh', async ({ page }) => {
  await page.goto('./');
  const visualization = page.locator('.viz');
  const arithmetic = page.getByRole('button', {
    name: 'More information about Arithmetic',
    exact: true,
  });
  const numbers = page.getByRole('button', {
    name: 'More information about Numbers & Counting',
    exact: true,
  });
  await expect(arithmetic).toBeVisible();

  const vizBounds = await visualization.boundingBox();
  expect(vizBounds).not.toBeNull();
  const startX = Number(await arithmetic.getAttribute('data-node-model-x'));
  const renderedX = vizBounds!.x + Number(await arithmetic.getAttribute('data-node-center-x'));
  const renderedY = vizBounds!.y + Number(await arithmetic.getAttribute('data-node-center-y'));
  await page.mouse.move(renderedX, renderedY);
  await page.mouse.down();
  await page.mouse.move(renderedX + 260, renderedY, { steps: 24 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await arithmetic.getAttribute('data-node-model-x')))
    .toBeGreaterThan(startX + 100);
  await page.waitForTimeout(900);

  const storedOffset = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('knowledge-graph:math:user:v1') ?? '{}');
    return state.positionOffsets?.arithmetic;
  });
  expect(storedOffset?.dx).toBeGreaterThan(100);

  await page.reload();
  await expect(arithmetic).toBeVisible();
  await expect
    .poll(async () => Number(await visualization.getAttribute('data-restored-user-position-count')))
    .toBeGreaterThan(0);
  const restoredOffsetFromNumbers =
    Number(await arithmetic.getAttribute('data-node-model-x')) -
    Number(await numbers.getAttribute('data-node-model-x'));

  await page.getByRole('button', { name: 'Layout Now', exact: true }).click();
  await page.waitForTimeout(600);
  const resetOffsetFromNumbers =
    Number(await arithmetic.getAttribute('data-node-model-x')) -
    Number(await numbers.getAttribute('data-node-model-x'));
  expect(Math.abs(restoredOffsetFromNumbers - resetOffsetFromNumbers)).toBeGreaterThan(100);
  const resetState = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('knowledge-graph:math:user:v1') ?? '{}'),
  );
  expect(resetState.positionOffsets).toEqual({});
  expect(resetState.layoutAnchor).toBeNull();
});

test('restores a block dragged downward and re-expands its maturity band', async ({ page }) => {
  await page.goto('./');
  const visualization = page.locator('.viz');
  const arithmetic = page.getByRole('button', {
    name: 'More information about Arithmetic',
    exact: true,
  });
  const numbers = page.getByRole('button', {
    name: 'More information about Numbers & Counting',
    exact: true,
  });
  await expect(arithmetic).toBeVisible();

  const vizBounds = await visualization.boundingBox();
  expect(vizBounds).not.toBeNull();
  const startY = Number(await arithmetic.getAttribute('data-node-model-y'));
  const renderedX = vizBounds!.x + Number(await arithmetic.getAttribute('data-node-center-x'));
  const renderedY = vizBounds!.y + Number(await arithmetic.getAttribute('data-node-center-y'));
  await page.mouse.move(renderedX, renderedY);
  await page.mouse.down();
  await page.mouse.move(renderedX, renderedY + 220, { steps: 24 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await arithmetic.getAttribute('data-node-model-y')))
    .toBeGreaterThan(startY + 100);
  await page.waitForTimeout(900);

  const storedPosition = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('knowledge-graph:math:user:v1') ?? '{}');
    return state.positionOffsets?.arithmetic;
  });
  expect(storedPosition?.bandOffsetY).toBeGreaterThan(0);

  await page.reload();
  await expect(arithmetic).toBeVisible();
  await expect
    .poll(async () => Number(await visualization.getAttribute('data-restored-user-position-count')))
    .toBeGreaterThan(0);
  const restoredVerticalOffset =
    Number(await arithmetic.getAttribute('data-node-model-y')) -
    Number(await numbers.getAttribute('data-node-model-y'));

  await page.getByRole('button', { name: 'Layout Now', exact: true }).click();
  await page.waitForTimeout(600);
  const resetVerticalOffset =
    Number(await arithmetic.getAttribute('data-node-model-y')) -
    Number(await numbers.getAttribute('data-node-model-y'));
  expect(restoredVerticalOffset - resetVerticalOffset).toBeGreaterThan(100);
});

test('switches between independent knowledge domains', async ({ page }) => {
  await page.goto('./');

  const domain = page.getByRole('combobox', { name: 'Knowledge domain' });
  await domain.selectOption('physics');

  await expect(domain).toHaveValue('physics');
  await expect(page.getByText('15 concepts', { exact: true })).toBeVisible();
  await expect(page.getByText('18 connections', { exact: true })).toBeVisible();
  await expect(page.locator('.graph')).toHaveAttribute(
    'aria-label',
    'Physics knowledge dependency graph',
  );
  const bands = page.locator('[role="list"][aria-label="Knowledge levels"] .band');
  await expect(bands).toHaveCount(3);
  await expect(bands.locator('.band-label')).toHaveText([
    'Foundational',
    'Secondary',
    'Undergraduate',
  ]);
  await expect(
    page.getByRole('button', { name: 'More information about Physical Foundations' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'More information about Numbers & Counting' }),
  ).toHaveCount(0);

  await page
    .getByRole('button', { name: 'More information about Physical Foundations' })
    .click();
  await page
    .getByRole('group', { name: 'Your knowledge of Physical Foundations' })
    .getByRole('button', { name: 'Aware' })
    .click();
  const storageKeys = await page.evaluate(() => Object.keys(localStorage).sort());
  expect(storageKeys).toContain('knowledge-graph:physics:knowledge-ratings:v1');
  expect(storageKeys).not.toContain('knowledge-graph:math:knowledge-ratings:v1');

  await domain.selectOption('math');
  await expect(page.getByText('94 concepts', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'More information about Numbers & Counting' }),
  ).toBeVisible();
});

test('grows a knowledge level for a dense focused group', async ({ page }) => {
  await page.goto('./');
  const elementaryBand = page.locator('.band[data-maturity-level="elementary"]');
  const before = await elementaryBand.boundingBox();
  const arithmetic = page.getByRole('button', {
    name: 'More information about Arithmetic',
    exact: true,
  });
  const buttonBounds = await arithmetic.boundingBox();
  expect(before).not.toBeNull();
  expect(buttonBounds).not.toBeNull();

  await page.mouse.dblclick(buttonBounds!.x - 28, buttonBounds!.y + 18, { delay: 80 });
  await expect(page.getByRole('status')).toHaveText(/Showing 33 nodes and \d+ connections/);
  await expect(page.locator('.viz')).toHaveAttribute('data-root-overlap-count', '0');
  await expect
    .poll(async () => (await elementaryBand.boundingBox())?.height ?? 0)
    .toBeGreaterThan(before!.height * 1.5);
});

test('keeps every block strictly below all visible prerequisites while dragging', async ({ page }) => {
  await page.goto('./');
  const visualization = page.locator('.viz');
  await expect(visualization).toHaveAttribute('data-vertical-order-violation-count', '0');

  const numbers = page.getByRole('button', {
    name: 'More information about Numbers & Counting',
  });
  const initialVizBounds = await visualization.boundingBox();
  expect(initialVizBounds).not.toBeNull();
  await page.mouse.dblclick(
    initialVizBounds!.x + Number(await numbers.getAttribute('data-node-center-x')),
    initialVizBounds!.y + Number(await numbers.getAttribute('data-node-center-y')),
    { delay: 80 },
  );

  const counting = page.getByRole('button', { name: 'More information about Counting' });
  const naturalNumbers = page.getByRole('button', {
    name: 'More information about Natural Numbers',
  });
  await expect(counting).toBeVisible();
  await expect(naturalNumbers).toBeVisible();
  await page.waitForTimeout(700);
  await expect(visualization).toHaveAttribute('data-vertical-order-violation-count', '0');

  const dragToRenderedY = async (node: typeof counting, renderedY: number): Promise<void> => {
    const vizBounds = await visualization.boundingBox();
    expect(vizBounds).not.toBeNull();
    const x = vizBounds!.x + Number(await node.getAttribute('data-node-center-x'));
    const y = vizBounds!.y + Number(await node.getAttribute('data-node-center-y'));
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, vizBounds!.y + renderedY, { steps: 18 });
    await page.mouse.up();
    await page.waitForTimeout(700);
  };

  const countingRenderedY = Number(await counting.getAttribute('data-node-center-y'));
  const countingPositionBeforeChildDrag = {
    x: Number(await counting.getAttribute('data-node-model-x')),
    y: Number(await counting.getAttribute('data-node-model-y')),
  };
  await dragToRenderedY(naturalNumbers, countingRenderedY - 80);
  const dependencyClearance =
    (Number(await counting.getAttribute('data-node-model-height')) +
      Number(await naturalNumbers.getAttribute('data-node-model-height'))) /
      2 +
    12;
  await expect
    .poll(async () => Number(await naturalNumbers.getAttribute('data-node-model-y')))
    .toBeGreaterThanOrEqual(
      Number(await counting.getAttribute('data-node-model-y')) + dependencyClearance - 0.01,
    );
  await expect(visualization).toHaveAttribute('data-vertical-order-violation-count', '0');
  expect(Number(await counting.getAttribute('data-node-model-x'))).toBeCloseTo(
    countingPositionBeforeChildDrag.x,
    2,
  );
  expect(Number(await counting.getAttribute('data-node-model-y'))).toBeCloseTo(
    countingPositionBeforeChildDrag.y,
    2,
  );

  const naturalModelYBeforeDownwardDrag = Number(
    await naturalNumbers.getAttribute('data-node-model-y'),
  );
  const naturalRenderedY = Number(await naturalNumbers.getAttribute('data-node-center-y'));
  await dragToRenderedY(counting, naturalRenderedY + 300);
  await expect
    .poll(async () => Number(await counting.getAttribute('data-node-model-y')))
    .toBeGreaterThan(naturalModelYBeforeDownwardDrag);
  await expect
    .poll(async () => Number(await naturalNumbers.getAttribute('data-node-model-y')))
    .toBeGreaterThanOrEqual(
      Number(await counting.getAttribute('data-node-model-y')) + dependencyClearance - 0.01,
    );
  await expect(visualization).toHaveAttribute('data-vertical-order-violation-count', '0');
});
