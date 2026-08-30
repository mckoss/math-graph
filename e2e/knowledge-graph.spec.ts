import { expect, test, type Locator, type Page } from '@playwright/test';

const nodeProbe = (page: Page, id: string): Locator =>
  page.locator(`.node-probe[data-node-id="${id}"]`);

async function nodePoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  const visualization = page.locator('.viz');
  const bounds = await visualization.boundingBox();
  const node = nodeProbe(page, id);
  expect(bounds).not.toBeNull();
  await expect(node).toHaveCount(1);
  return {
    x: bounds!.x + Number(await node.getAttribute('data-node-center-x')),
    y: bounds!.y + Number(await node.getAttribute('data-node-center-y')),
  };
}

async function clickNode(page: Page, id: string, double = false): Promise<void> {
  const point = await nodePoint(page, id);
  if (double) await page.mouse.dblclick(point.x, point.y, { delay: 80 });
  else await page.mouse.click(point.x, point.y);
}

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
  await expect(page.getByText('96 concepts', { exact: true })).toBeVisible();
  await expect(page.getByText('110 connections', { exact: true })).toBeVisible();
  await expect(nodeProbe(page, 'elementary-algebra')).toHaveAttribute(
    'data-node-label',
    'Elementary Algebra',
  );
  await expect(nodeProbe(page, 'high-school-algebra')).toHaveAttribute(
    'data-node-label',
    'High School Algebra',
  );
  await expect(page.getByRole('button', { name: /More information about/ })).toHaveCount(0);

  const bands = page.locator('[role="list"][aria-label="Knowledge levels"] .band');
  await expect(bands).toHaveCount(4);
  const visualization = page.locator('.viz');
  await expect(visualization).toHaveAttribute('data-layout-orientation', 'landscape');
  await expect(visualization).not.toHaveAttribute(
    'data-historical-order-mismatch-edge-count',
    '0',
  );
  await expect(page.getByText('Later-recorded prerequisite', { exact: true })).toBeVisible();
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
  const numbersInfo = nodeProbe(page, 'numbers');
  await expect(numbersInfo).toHaveCount(1);
  await clickNode(page, 'numbers');
  await expect(panel).toHaveAttribute('aria-hidden', 'false');
  await expect(panel.getByRole('heading', { name: 'Numbers & Counting' })).toBeVisible();
  await expect(panel.getByRole('heading', { name: /Depends on \(0\)/ })).toBeVisible();
  await expect(panel.getByRole('heading', { name: /Immediate dependents \([1-9]\d*\)/ })).toBeVisible();
  await panel.getByRole('button', { name: 'Arithmetic', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Arithmetic', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close panel' }).click();
  await expect(panel).toHaveAttribute('aria-hidden', 'true');
  await page.waitForTimeout(320);
  await clickNode(page, 'numbers');
  await expect(panel.getByRole('heading', { name: 'Numbers & Counting' })).toBeVisible();

  const status = page.getByRole('status');
  const collapsedStatus = await status.textContent();
  expect(collapsedStatus).toMatch(/Showing \d+ nodes and \d+ connections/);
  const zoomBeforeExpansion = Number(await visualization.getAttribute('data-current-zoom'));

  await clickNode(page, 'numbers', true);
  await expect(status).toHaveText(/Showing 25 nodes and \d+ connections/);
  await expect(visualization).toHaveAttribute('data-compound-group-count', '1');
  await expect
    .poll(async () => Number(await visualization.getAttribute('data-focus-anchor-delta-x')))
    .toBeLessThan(0.5);
  await page.waitForTimeout(1000);
  await expect(panel).toHaveAttribute('aria-hidden', 'false');
  await expect(panel.getByRole('heading', { name: 'Numbers & Counting' })).toBeVisible();

  const initialFocusedZoom = Number(await visualization.getAttribute('data-current-zoom'));
  expect(initialFocusedZoom).toBeGreaterThan(zoomBeforeExpansion);
  const countingInfo = nodeProbe(page, 'counting');
  await expect(countingInfo).toHaveCount(1);
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.waitForTimeout(320);
  await clickNode(page, 'counting');
  await expect(panel.getByRole('heading', { name: 'Counting', exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Development history' })).toBeVisible();
  await expect(panel.getByText(/BCE|CE/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.waitForTimeout(320);
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
    .toBeGreaterThanOrEqual(3);
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
  await page.waitForTimeout(1000);
  await expect(numbersInfo).toHaveCount(1);
  await clickNode(page, 'numbers', true);
  await expect(status).toHaveText(/Showing 25 nodes and \d+ connections/);
  await expect
    .poll(async () => Number(await visualization.getAttribute('data-restored-layout-node-count')))
    .toBeGreaterThanOrEqual(3);
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
  await expect(status).toHaveText('Showing 118 nodes and 110 connections.');
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
  await clickNode(page, 'numbers');

  const knowledge = page.getByRole('group', { name: 'Your knowledge of Numbers & Counting' });
  await expect(knowledge.getByRole('button')).toHaveText(['Aware', 'Familiar', 'Mastered']);
  await expect(page.getByText('Applies recursively to all 3 concepts in this group.')).toBeVisible();
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
    'place-value': 'mastered',
  });

  await page.reload();
  await clickNode(page, 'numbers');
  await expect(
    page
      .getByRole('group', { name: 'Your knowledge of Numbers & Counting' })
      .getByRole('button', { name: 'Mastered' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('restores user-dragged layout positions after refresh', async ({ page }) => {
  await page.goto('./');
  const visualization = page.locator('.viz');
  const arithmetic = nodeProbe(page, 'arithmetic');
  const numbers = nodeProbe(page, 'numbers');
  await expect(arithmetic).toHaveCount(1);

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
  await expect(arithmetic).toHaveCount(1);
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
  const arithmetic = nodeProbe(page, 'arithmetic');
  const numbers = nodeProbe(page, 'numbers');
  await expect(arithmetic).toHaveCount(1);

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
  await expect(arithmetic).toHaveCount(1);
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
  await expect(nodeProbe(page, 'physical-foundations')).toHaveCount(1);
  await expect(nodeProbe(page, 'numbers')).toHaveCount(0);

  await clickNode(page, 'physical-foundations');
  await page
    .getByRole('group', { name: 'Your knowledge of Physical Foundations' })
    .getByRole('button', { name: 'Aware' })
    .click();
  const storageKeys = await page.evaluate(() => Object.keys(localStorage).sort());
  expect(storageKeys).toContain('knowledge-graph:physics:knowledge-ratings:v1');
  expect(storageKeys).not.toContain('knowledge-graph:math:knowledge-ratings:v1');

  await domain.selectOption('math');
  await expect(page.getByText('96 concepts', { exact: true })).toBeVisible();
  await expect(nodeProbe(page, 'numbers')).toHaveCount(1);
});

test('expands and collapses a group without moving existing nodes or bands', async ({ page }) => {
  await page.goto('./');
  const visualization = page.locator('.viz');
  const capture = async () => ({
    zoom: Number(await visualization.getAttribute('data-current-zoom')),
    bands: await page.locator('.band').evaluateAll((bands) =>
      bands.map((band) => ({
        top: Number(band.getAttribute('data-model-top')),
        height: Number(band.getAttribute('data-model-height')),
      })),
    ),
    nodes: await page.locator('.node-probe').evaluateAll((nodes) =>
      Object.fromEntries(nodes.map((node) => [
        node.getAttribute('data-node-id'),
        {
          x: Number(node.getAttribute('data-node-model-x')),
          y: Number(node.getAttribute('data-node-model-y')),
        },
      ])),
    ),
  });
  await page.waitForTimeout(1300);
  const before = await capture();

  await clickNode(page, 'arithmetic', true);
  for (let sample = 0; sample < 6; sample++) {
    await page.waitForTimeout(120);
    expect({
      x: Number(await nodeProbe(page, 'arithmetic').getAttribute('data-node-model-x')),
      y: Number(await nodeProbe(page, 'arithmetic').getAttribute('data-node-model-y')),
    }).toEqual(before.nodes.arithmetic);
  }
  await expect(page.getByRole('status')).toHaveText(/Showing 34 nodes and \d+ connections/);
  expect(Number(await visualization.getAttribute('data-focus-required-zoom'))).toBeLessThan(6);
  await page.waitForTimeout(300);
  const expanded = await capture();
  expect(expanded.bands).toEqual(before.bands);
  for (const [id, point] of Object.entries(before.nodes)) {
    expect(expanded.nodes[id], id).toEqual(point);
  }

  await page.getByRole('button', { name: 'Close panel' }).click();
  const arithmeticChildIds = [
    'addition', 'subtraction', 'multiplication', 'division', 'fractions', 'decimals',
    'percentages', 'ratios', 'order-of-operations', 'exponentiation', 'square-roots',
  ];
  const visibleChildId = await page.locator('.node-probe').evaluateAll(
    (nodes, ids) => {
      const candidates = nodes
        .filter((node) => ids.includes(node.getAttribute('data-node-id') ?? ''))
        .map((node) => ({
          id: node.getAttribute('data-node-id')!,
          x: Number(node.getAttribute('data-node-center-x')),
          y: Number(node.getAttribute('data-node-center-y')),
        }))
        .filter(({ x, y }) => x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight)
        .sort((a, b) =>
          Math.hypot(a.x - innerWidth / 2, a.y - innerHeight / 2) -
          Math.hypot(b.x - innerWidth / 2, b.y - innerHeight / 2),
        );
      return candidates[0]?.id;
    },
    arithmeticChildIds,
  );
  expect(visibleChildId).toBeDefined();
  await clickNode(page, visibleChildId!, true);
  for (let sample = 0; sample < 6; sample++) {
    await page.waitForTimeout(120);
    expect({
      x: Number(await nodeProbe(page, 'arithmetic').getAttribute('data-node-model-x')),
      y: Number(await nodeProbe(page, 'arithmetic').getAttribute('data-node-model-y')),
    }).toEqual(before.nodes.arithmetic);
  }
  await expect(page.getByRole('status')).toHaveText(/Showing 22 nodes and \d+ connections/);
  await page.waitForTimeout(300);
  const collapsed = await capture();
  expect(collapsed.zoom).toBeCloseTo(before.zoom, 8);
  expect(collapsed.bands).toEqual(before.bands);
  for (const [id, point] of Object.entries(before.nodes)) {
    expect(collapsed.nodes[id], id).toEqual(point);
  }
});

test('Layout Now then Elementary Geometry expansion has no block overlaps', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Layout Now' }).click();
  await page.waitForTimeout(1100);

  const modelCenters = await page.locator('.node-probe').evaluateAll((nodes) =>
    Object.fromEntries(nodes.map((node) => [node.getAttribute('data-node-id'), {
      x: Number(node.getAttribute('data-node-model-x')),
      y: Number(node.getAttribute('data-node-model-y')),
    }])),
  );
  await clickNode(page, 'elementary-geometry', true);
  const childIds = [
    'points-lines-and-planes',
    'angles',
    'triangles',
    'circles',
    'area',
    'volume',
    'congruence',
    'similarity',
    'pythagorean-theorem',
  ];
  await expect(nodeProbe(page, childIds[0])).toHaveCount(1);
  await page.waitForTimeout(1000);
  expect(Number(await page.locator('.viz').getAttribute('data-focus-required-zoom')))
    .toBeLessThan(8);

  const blocks = await page.locator('.node-probe').evaluateAll((nodes) =>
    Object.fromEntries(nodes.map((node) => {
      const x = Number(node.getAttribute('data-node-center-x'));
      const y = Number(node.getAttribute('data-node-center-y'));
      const width = Number(node.getAttribute('data-node-rendered-width'));
      const height = Number(node.getAttribute('data-node-rendered-height'));
      return [node.getAttribute('data-node-id'), {
        x,
        y,
        width,
        height,
        modelX: Number(node.getAttribute('data-node-model-x')),
        modelY: Number(node.getAttribute('data-node-model-y')),
      }];
    })),
  );
  for (const [id, center] of Object.entries(modelCenters)) {
    expect(blocks[id].modelX, id).toBeCloseTo(center.x, 8);
    expect(blocks[id].modelY, id).toBeCloseTo(center.y, 8);
  }

  const exteriorIds = Object.keys(modelCenters).filter((id) => id !== 'elementary-geometry');
  const overlap = (leftId: string, rightId: string): boolean => {
    const left = blocks[leftId];
    const right = blocks[rightId];
    return (
      Math.abs(left.x - right.x) < (left.width + right.width) / 2 + 1 &&
      Math.abs(left.y - right.y) < (left.height + right.height) / 2 + 1
    );
  };
  for (let left = 0; left < childIds.length; left++) {
    for (let right = left + 1; right < childIds.length; right++) {
      expect(overlap(childIds[left], childIds[right]), `${childIds[left]} / ${childIds[right]}`)
        .toBe(false);
    }
    for (const exteriorId of exteriorIds) {
      expect(overlap(childIds[left], exteriorId), `${childIds[left]} / ${exteriorId}`)
        .toBe(false);
    }
  }
  expect(blocks['pythagorean-theorem'].y - blocks.triangles.y)
    .toBeGreaterThan((blocks['pythagorean-theorem'].height + blocks.triangles.height) / 2);
});

test('long expanded group titles do not skew compound geometry during zoom', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  await page.goto('./');
  await page.getByRole('button', { name: 'Layout Now' }).click();
  await page.waitForTimeout(1100);

  await clickNode(page, 'high-school-linear-algebra', true);
  await expect(nodeProbe(page, 'vectors')).toHaveCount(1);

  const childIds = ['vectors', 'dot-product', 'matrices'];
  let canonicalChildren: Record<string, { x: number; y: number }> | undefined;
  for (let frame = 0; frame < 10; frame++) {
    const group = nodeProbe(page, 'high-school-linear-algebra');
    const canonical = {
      x: Number(await group.getAttribute('data-node-model-x')),
      y: Number(await group.getAttribute('data-node-model-y')),
    };
    const actual = {
      x: Number(await group.getAttribute('data-node-actual-model-x')),
      y: Number(await group.getAttribute('data-node-actual-model-y')),
    };
    const offset = { x: actual.x - canonical.x, y: actual.y - canonical.y };
    expect(Math.abs(offset.x), `compound x offset at frame ${frame}`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(offset.y), `compound y offset at frame ${frame}`).toBeLessThanOrEqual(0.5);

    const children = Object.fromEntries(await Promise.all(childIds.map(async (id) => {
      const probe = nodeProbe(page, id);
      return [id, {
        x: Number(await probe.getAttribute('data-node-actual-model-x')),
        y: Number(await probe.getAttribute('data-node-actual-model-y')),
      }];
    })));
    canonicalChildren ??= children;
    for (const id of childIds) {
      expect(
        Math.abs(children[id].x - canonicalChildren[id].x),
        `${id} x at frame ${frame}`,
      ).toBeLessThanOrEqual(0.5);
      expect(
        Math.abs(children[id].y - canonicalChildren[id].y),
        `${id} y at frame ${frame}`,
      ).toBeLessThanOrEqual(0.5);
    }
    await page.waitForTimeout(100);
  }
});

test('keeps every block strictly below all visible prerequisites while dragging', async ({ page }) => {
  await page.goto('./');
  const visualization = page.locator('.viz');
  await expect(visualization).toHaveAttribute('data-vertical-order-violation-count', '0');

  await clickNode(page, 'numbers', true);

  const counting = nodeProbe(page, 'counting');
  const naturalNumbers = nodeProbe(page, 'natural-numbers');
  await expect(counting).toHaveCount(1);
  await expect(naturalNumbers).toHaveCount(1);
  await page.waitForTimeout(1100);
  const detailsClose = page.getByRole('button', { name: 'Close panel' });
  if (await detailsClose.isVisible()) await detailsClose.click();
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
      Number(await counting.getAttribute('data-node-model-y')) + dependencyClearance - 0.5,
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
      Number(await counting.getAttribute('data-node-model-y')) + dependencyClearance - 0.5,
    );
  await expect(visualization).toHaveAttribute('data-vertical-order-violation-count', '0');
});

test('does not expand the preceding knowledge level when a node is dragged upward', async ({
  page,
}) => {
  await page.goto('./');
  await page.waitForTimeout(700);
  const elementaryBand = page.locator('.band[data-maturity-level="elementary"]');
  const highSchoolBand = page.locator('.band[data-maturity-level="high-school"]');
  const geometry = nodeProbe(page, 'high-school-geometry');
  const before = await elementaryBand.boundingBox();
  const ownBand = await highSchoolBand.boundingBox();
  expect(before).not.toBeNull();
  expect(ownBand).not.toBeNull();
  await expect(geometry).toHaveCount(1);

  const geometryPoint = await nodePoint(page, 'high-school-geometry');
  const startX = geometryPoint.x;
  const startY = geometryPoint.y;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, ownBand!.y + 12, { steps: 24 });
  await page.waitForTimeout(200);

  const whilePinned = await elementaryBand.boundingBox();
  expect(whilePinned).not.toBeNull();
  expect(whilePinned!.height).toBeLessThanOrEqual(before!.height + 2);
  await page.mouse.up();
});

test('keeps a layout-now view unchanged across refresh', async ({ page }) => {
  await page.goto('./');
  const visualization = page.locator('.viz');
  await expect(page.getByRole('status')).toHaveText(/Showing 22 nodes and \d+ connections/);
  await page.waitForTimeout(700);
  const movingNode = nodeProbe(page, 'high-school-algebra');
  const dragPoint = await nodePoint(page, 'high-school-algebra');
  const dragX = dragPoint.x;
  const dragY = dragPoint.y;
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  await page.mouse.move(dragX + 260, dragY, { steps: 24 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  const beforeLayoutNow = {
    x: Number(await movingNode.getAttribute('data-node-model-x')),
    y: Number(await movingNode.getAttribute('data-node-model-y')),
  };
  await page.getByRole('button', { name: 'Layout Now', exact: true }).click();
  const immediatelyAfterLayoutNow = {
    x: Number(await movingNode.getAttribute('data-node-model-x')),
    y: Number(await movingNode.getAttribute('data-node-model-y')),
  };
  await page.waitForTimeout(120);
  const earlyInLayoutAnimation = {
    x: Number(await movingNode.getAttribute('data-node-model-x')),
    y: Number(await movingNode.getAttribute('data-node-model-y')),
  };
  await page.waitForTimeout(330);
  const middleOfLayoutAnimation = {
    x: Number(await movingNode.getAttribute('data-node-model-x')),
    y: Number(await movingNode.getAttribute('data-node-model-y')),
  };
  await page.waitForTimeout(550);
  const afterLayoutNow = {
    x: Number(await movingNode.getAttribute('data-node-model-x')),
    y: Number(await movingNode.getAttribute('data-node-model-y')),
  };
  const distance = (
    left: { x: number; y: number },
    right: { x: number; y: number },
  ): number => Math.hypot(left.x - right.x, left.y - right.y);
  expect(distance(beforeLayoutNow, afterLayoutNow)).toBeGreaterThan(20);
  expect(distance(immediatelyAfterLayoutNow, beforeLayoutNow)).toBeLessThan(
    distance(immediatelyAfterLayoutNow, afterLayoutNow),
  );
  const totalMovement = distance(beforeLayoutNow, afterLayoutNow);
  const earlyMovement = distance(beforeLayoutNow, earlyInLayoutAnimation);
  const middleMovement = distance(beforeLayoutNow, middleOfLayoutAnimation);
  expect(earlyMovement).toBeGreaterThan(0);
  expect(earlyMovement).toBeLessThan(totalMovement * 0.2);
  expect(middleMovement).toBeGreaterThan(totalMovement * 0.2);
  expect(middleMovement).toBeLessThan(totalMovement * 0.8);

  const capture = async () => ({
    zoom: Number(await visualization.getAttribute('data-current-zoom')),
    bands: await page.locator('.band').evaluateAll((bands) =>
      bands.map((band) => ({
        top: Number.parseFloat((band as HTMLElement).style.top),
        height: Number.parseFloat((band as HTMLElement).style.height),
      })),
    ),
    nodes: await page.locator('.node-probe').evaluateAll((buttons) =>
      buttons.map((button) => ({
        id: button.getAttribute('data-node-id'),
        centerX: Number(button.getAttribute('data-node-center-x')),
        centerY: Number(button.getAttribute('data-node-center-y')),
        modelX: Number(button.getAttribute('data-node-model-x')),
        modelY: Number(button.getAttribute('data-node-model-y')),
      })),
    ),
  });
  const beforeRefresh = await capture();
  await page.reload();
  await expect(page.getByRole('status')).toHaveText(/Showing 22 nodes and \d+ connections/);
  await page.waitForTimeout(700);
  const afterRefresh = await capture();
  expect(afterRefresh.zoom).toBeCloseTo(beforeRefresh.zoom, 8);
  expect(afterRefresh.bands).toHaveLength(beforeRefresh.bands.length);
  afterRefresh.bands.forEach((band, index) => {
    expect(band.top).toBeCloseTo(beforeRefresh.bands[index].top, 8);
    expect(band.height).toBeCloseTo(beforeRefresh.bands[index].height, 8);
  });
  expect(afterRefresh.nodes.map(({ id }) => id)).toEqual(
    beforeRefresh.nodes.map(({ id }) => id),
  );
  afterRefresh.nodes.forEach((node, index) => {
    const before = beforeRefresh.nodes[index];
    expect(node.centerX, node.id ?? `${index}`).toBeCloseTo(before.centerX, 8);
    expect(node.centerY, node.id ?? `${index}`).toBeCloseTo(before.centerY, 8);
    expect(node.modelX, node.id ?? `${index}`).toBeCloseTo(before.modelX, 8);
    expect(node.modelY, node.id ?? `${index}`).toBeCloseTo(before.modelY, 8);
  });
});
