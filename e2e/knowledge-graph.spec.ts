import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { loadKnowledgeBase } from '../src/lib/knowledge-base/load';
import { computeVisible } from '../src/lib/viz/graph-model';
import {
  analyzeLayoutRows,
  rectangleOverlapCount,
} from '../src/lib/viz/layout-row-invariant';

const mathGraph = loadKnowledgeBase(
  readFileSync(new URL('../src/data/graphs/math.yaml', import.meta.url), 'utf8'),
);

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

async function clickNode(page: Page, id: string): Promise<void> {
  const point = await nodePoint(page, id);
  await page.mouse.click(point.x, point.y);
}

test('presents and operates the Knowledge Graph Math domain', async ({ page }) => {
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    if (message.type() === 'warning') warnings.push(message.text());
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
    .toBeGreaterThan(0);

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
  await panel.getByRole('button', { name: 'Addition', exact: true }).click();
  await expect(panel.getByRole('heading', { name: 'Addition', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close panel' }).click();
  await expect(panel).toHaveAttribute('aria-hidden', 'true');
  await page.waitForTimeout(320);
  await clickNode(page, 'numbers');
  await expect(panel.getByRole('heading', { name: 'Numbers & Counting' })).toBeVisible();

  await expect(page.getByRole('status')).toHaveText('Showing 118 nodes and 110 connections.');
  await expect(page.getByRole('button', { name: /Expand|Collapse/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.getByRole('button', { name: 'Fit to view' }).click();
  await expect(canvas).toBeVisible();

  expect(errors).toEqual([]);
  expect(warnings).toEqual([]);
});

test('semantic zoom reveals hierarchy depth without changing canonical geometry', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  await page.goto('./');
  const visualization = page.locator('.viz');
  await page.getByRole('button', { name: 'Fit to view' }).click();
  await page.waitForTimeout(1000);
  await expect(visualization).toHaveAttribute('data-semantic-depth', '0');
  await expect(page.getByRole('button', { name: /Expand|Collapse/ })).toHaveCount(0);

  const captureGeometry = async () => page.locator('.node-probe').evaluateAll((nodes) =>
    Object.fromEntries(nodes.map((node) => [node.getAttribute('data-node-id'), {
      modelX: node.getAttribute('data-node-model-x'),
      modelY: node.getAttribute('data-node-model-y'),
      actualX: node.getAttribute('data-node-actual-model-x'),
      actualY: node.getAttribute('data-node-actual-model-y'),
      parentId: node.getAttribute('data-node-parent-id'),
    }])));
  const vizBounds = await visualization.boundingBox();
  expect(vizBounds).not.toBeNull();
  const hierarchy = await page.locator('.node-probe').evaluateAll(
    (nodes, center) => {
      const parentIds = new Set(nodes.map((node) => node.getAttribute('data-node-parent-id')).filter(Boolean));
      const parentId = nodes
        .filter((node) => parentIds.has(node.getAttribute('data-node-id')))
        .map((node) => ({
          id: node.getAttribute('data-node-id')!,
          distance: Math.hypot(
            Number(node.getAttribute('data-node-center-x')) - center.x,
            Number(node.getAttribute('data-node-center-y')) - center.y,
          ),
        }))
        .sort((left, right) => left.distance - right.distance)[0].id;
      const childId = nodes
        .filter((node) => node.getAttribute('data-node-parent-id') === parentId)
        .sort((left, right) =>
          Math.hypot(
            Number(left.getAttribute('data-node-center-x')) - center.x,
            Number(left.getAttribute('data-node-center-y')) - center.y,
          ) - Math.hypot(
            Number(right.getAttribute('data-node-center-x')) - center.x,
            Number(right.getAttribute('data-node-center-y')) - center.y,
          ),
        )[0].getAttribute('data-node-id')!;
      return { parentId, childId };
    },
    { x: vizBounds!.width / 2, y: vizBounds!.height / 2 },
  );
  const { childId, parentId } = hierarchy;
  const child = nodeProbe(page, childId);
  const childLabel = await child.getAttribute('data-node-label') ?? '';
  expect(parentId).toBeTruthy();
  const parent = nodeProbe(page, parentId);
  const normalizedParentSize = async () => {
    const zoom = Number(await visualization.getAttribute('data-current-zoom'));
    return {
      width: Number(await parent.getAttribute('data-node-rendered-width')) / zoom,
      height: Number(await parent.getAttribute('data-node-rendered-height')) / zoom,
    };
  };
  const overviewSize = await normalizedParentSize();

  const modelPoint = async (probe: Locator) => ({
    x: Number(await probe.getAttribute('data-node-model-x')),
    y: Number(await probe.getAttribute('data-node-model-y')),
  });
  const camera = async () => {
    const zoom = Number(await visualization.getAttribute('data-current-zoom'));
    const reference = nodeProbe(page, childId);
    return {
      zoom,
      panX: Number(await reference.getAttribute('data-node-center-x')) -
        Number(await reference.getAttribute('data-node-actual-model-x')) * zoom,
      panY: Number(await reference.getAttribute('data-node-center-y')) -
        Number(await reference.getAttribute('data-node-actual-model-y')) * zoom,
    };
  };
  const groupBeforeDrag = await modelPoint(parent);
  const childBeforeDrag = await modelPoint(child);
  const cameraBeforeDrag = await camera();
  const parentPoint = await nodePoint(page, parentId);
  await page.mouse.move(parentPoint.x, parentPoint.y);
  await page.mouse.down();
  await page.mouse.move(parentPoint.x + 48, parentPoint.y + 32, { steps: 16 });
  await page.mouse.up();
  await expect.poll(async () => {
    const current = await modelPoint(parent);
    return Math.hypot(current.x - groupBeforeDrag.x, current.y - groupBeforeDrag.y);
  }).toBeGreaterThan(10);
  const groupAfterDrag = await modelPoint(parent);
  const childAfterDrag = await modelPoint(child);
  expect(groupAfterDrag.x - groupBeforeDrag.x).toBeCloseTo(
    childAfterDrag.x - childBeforeDrag.x,
    5,
  );
  expect(groupAfterDrag.y - groupBeforeDrag.y).toBeCloseTo(
    childAfterDrag.y - childBeforeDrag.y,
    5,
  );
  expect(Math.hypot(
    groupAfterDrag.x - groupBeforeDrag.x,
    groupAfterDrag.y - groupBeforeDrag.y,
  )).toBeGreaterThan(10);
  const cameraAfterDrag = await camera();
  expect(cameraAfterDrag.zoom).toBeCloseTo(cameraBeforeDrag.zoom, 12);
  expect(cameraAfterDrag.panX).toBeCloseTo(cameraBeforeDrag.panX, 10);
  expect(cameraAfterDrag.panY).toBeCloseTo(cameraBeforeDrag.panY, 10);
  const baseline = await captureGeometry();

  await clickNode(page, childId);
  await expect(page.locator('.panel').getByRole('heading', { name: childLabel, exact: true }))
    .toHaveCount(0);
  const close = page.getByRole('button', { name: 'Close panel' });
  if (await close.isVisible()) await close.click();

  const zoomToDepth = async (depth: number) => {
    for (let attempt = 0; attempt < 16; attempt++) {
      if (Number(await visualization.getAttribute('data-semantic-depth')) >= depth) return;
      await page.getByRole('button', { name: 'Zoom in' }).click();
      await page.waitForTimeout(220);
    }
    throw new Error(`Semantic depth ${depth} was not reached`);
  };

  await zoomToDepth(1);
  await expect(visualization).toHaveAttribute('data-semantic-depth', '1');
  expect(await captureGeometry()).toEqual(baseline);
  const detailSize = await normalizedParentSize();
  expect(detailSize.width).toBeCloseTo(overviewSize.width, 5);
  expect(detailSize.height).toBeCloseTo(overviewSize.height, 5);

  await clickNode(page, childId);
  await expect(page.locator('.panel').getByRole('heading', {
    name: childLabel,
    exact: true,
  })).toBeVisible();
  await close.click();

  await zoomToDepth(2);
  await expect(visualization).toHaveAttribute('data-semantic-depth', '2');
  expect(await captureGeometry()).toEqual(baseline);
  const depthTwoSize = await normalizedParentSize();
  expect(depthTwoSize.width).toBeCloseTo(overviewSize.width, 5);
  expect(depthTwoSize.height).toBeCloseTo(overviewSize.height, 5);

  const zoomBeforeDoubleClick = Number(await visualization.getAttribute('data-current-zoom'));
  const doubleClickPoint = await nodePoint(page, parentId);
  await page.mouse.dblclick(doubleClickPoint.x, doubleClickPoint.y, { delay: 80 });
  await page.waitForTimeout(400);
  expect(Number(await visualization.getAttribute('data-current-zoom')))
    .toBeCloseTo(zoomBeforeDoubleClick, 10);
  await expect(visualization).toHaveAttribute('data-semantic-depth', '2');
  expect(await captureGeometry()).toEqual(baseline);
});

test('semantic zoom reveals nested Physics subgroups one depth at a time', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('combobox', { name: 'Knowledge domain' }).selectOption('physics');
  const visualization = page.locator('.viz');
  await page.getByRole('button', { name: 'Fit to view' }).click();
  await page.waitForTimeout(1000);

  const mechanics = nodeProbe(page, 'classical-mechanics');
  const kinematics = nodeProbe(page, 'kinematics');
  const motion = nodeProbe(page, 'motion');
  await expect(visualization).toHaveAttribute('data-semantic-depth', '0');
  await expect(mechanics).toHaveAttribute('data-node-title-mode', 'overview');
  await expect(kinematics).toHaveAttribute('data-node-semantic-visible', 'false');
  await expect(motion).toHaveAttribute('data-node-semantic-visible', 'false');

  const zoomToDepth = async (depth: number) => {
    for (let attempt = 0; attempt < 20; attempt++) {
      if (Number(await visualization.getAttribute('data-semantic-depth')) >= depth) return;
      await page.getByRole('button', { name: 'Zoom in' }).click();
      await page.waitForTimeout(220);
    }
    throw new Error(`Semantic depth ${depth} was not reached`);
  };

  await zoomToDepth(1);
  await expect(mechanics).toHaveAttribute('data-node-title-mode', 'detail');
  await expect(kinematics).toHaveAttribute('data-node-semantic-visible', 'true');
  await expect(kinematics).toHaveAttribute('data-node-title-mode', 'overview');
  await expect(motion).toHaveAttribute('data-node-semantic-visible', 'false');

  await zoomToDepth(2);
  await expect(kinematics).toHaveAttribute('data-node-title-mode', 'detail');
  await expect(motion).toHaveAttribute('data-node-semantic-visible', 'true');
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

test('viewport resizing redraws without changing canonical graph geometry', async ({ page }) => {
  await page.goto('./');
  await page.waitForTimeout(1000);
  const visualization = page.locator('.viz');
  const capture = async () => ({
    nodes: await page.locator('.node-probe').evaluateAll((nodes) =>
      Object.fromEntries(nodes.map((node) => [node.getAttribute('data-node-id'), {
        x: Number(node.getAttribute('data-node-model-x')),
        y: Number(node.getAttribute('data-node-model-y')),
      }]))),
    bands: await page.locator('.band').evaluateAll((bands) => bands.map((band) => ({
      top: Number(band.getAttribute('data-model-top')),
      height: Number(band.getAttribute('data-model-height')),
    }))),
  });
  const before = await capture();

  await page.setViewportSize({ width: 600, height: 900 });
  await expect(visualization).toHaveAttribute('data-layout-orientation', 'portrait');
  expect(await capture()).toEqual(before);

  await page.setViewportSize({ width: 1200, height: 700 });
  await expect(visualization).toHaveAttribute('data-layout-orientation', 'landscape');
  expect(await capture()).toEqual(before);
});

test('dependency lines cannot change the selected concept', async ({ page }) => {
  await page.goto('./');
  await page.waitForTimeout(900);
  await clickNode(page, 'numbers');
  const panel = page.locator('.panel');
  await expect(panel.getByRole('heading', { name: 'Numbers & Counting' })).toBeVisible();

  const from = await nodePoint(page, 'numbers');
  const to = await nodePoint(page, 'arithmetic');
  const delta = { x: to.x - from.x, y: to.y - from.y };
  const boundaryDistance = async (id: string): Promise<number> => {
    const probe = nodeProbe(page, id);
    const halfWidth = Number(await probe.getAttribute('data-node-rendered-width')) / 2;
    const halfHeight = Number(await probe.getAttribute('data-node-rendered-height')) / 2;
    return Math.min(
      delta.x === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(delta.x),
      delta.y === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(delta.y),
    );
  };
  const sourceExit = await boundaryDistance('numbers');
  const targetEntry = 1 - await boundaryDistance('arithmetic');
  expect(sourceExit).toBeLessThan(targetEntry);
  const openEdgeMidpoint = (sourceExit + targetEntry) / 2;
  await page.mouse.click(
    from.x + delta.x * openEdgeMidpoint,
    from.y + delta.y * openEdgeMidpoint,
  );
  await page.waitForTimeout(320);

  await expect(panel.getByRole('heading', { name: 'Numbers & Counting' })).toBeVisible();
});

test('Layout Now uses earliest feasible dependency rows without collapsed overlaps', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  await page.goto('./');
  await page.getByRole('button', { name: 'Layout Now' }).click();
  await page.waitForTimeout(1100);

  const visualization = page.locator('.viz');
  const zoom = Number(await visualization.getAttribute('data-current-zoom'));
  const renderedScale = Math.min(zoom, 1);
  const visible = computeVisible(mathGraph, new Set());
  const maturityById = new Map(visible.nodes.map((node) => [node.id, node.maturityLevel]));
  const measured = await page.locator('.node-probe').evaluateAll((probes) => probes
    .filter((probe) => !(probe.getAttribute('data-node-parent-id') ?? ''))
    .map((probe) => ({
      id: probe.getAttribute('data-node-id')!,
      x: Number(probe.getAttribute('data-node-actual-model-x')),
      y: Number(probe.getAttribute('data-node-actual-model-y')),
      renderedWidth: Number(probe.getAttribute('data-node-rendered-width')),
      renderedHeight: Number(probe.getAttribute('data-node-rendered-height')),
    })));
  const nodes = measured.map((node) => ({
    id: node.id,
    band: maturityById.get(node.id) ?? '',
    x: node.x,
    y: node.y,
    width: node.renderedWidth / renderedScale,
  }));
  const heights = new Map(measured.map((node) => [node.id, node.renderedHeight / renderedScale]));
  const bounds = await visualization.boundingBox();
  expect(bounds).not.toBeNull();

  const analysis = analyzeLayoutRows(nodes, visible.edges, bounds!.width - 64, 12, 1);
  expect(analysis.violations).toEqual([]);
  expect(rectangleOverlapCount(nodes, heights)).toBe(0);
  await expect(visualization).toHaveAttribute('data-root-overlap-count', '0');
});

test('viewport resize round trips do not accumulate model, band, or camera drift', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  await page.goto('./');
  await page.getByRole('button', { name: 'Layout Now' }).click();
  await page.waitForTimeout(1100);

  const visualization = page.locator('.viz');
  const capture = async () => {
    const zoomText = await visualization.getAttribute('data-current-zoom');
    const zoom = Number(zoomText);
    const reference = nodeProbe(page, 'numbers');
    const modelX = Number(await reference.getAttribute('data-node-actual-model-x'));
    const modelY = Number(await reference.getAttribute('data-node-actual-model-y'));
    const renderedX = Number(await reference.getAttribute('data-node-center-x'));
    const renderedY = Number(await reference.getAttribute('data-node-center-y'));
    return {
      zoomText,
      pan: {
        x: renderedX - modelX * zoom,
        y: renderedY - modelY * zoom,
      },
      nodes: await page.locator('.node-probe').evaluateAll((nodes) =>
        nodes.map((node) => ({
          id: node.getAttribute('data-node-id'),
          x: node.getAttribute('data-node-actual-model-x'),
          y: node.getAttribute('data-node-actual-model-y'),
        }))),
      bands: await page.locator('.band').evaluateAll((bands) =>
        bands.map((band) => ({
          id: band.getAttribute('data-maturity-level'),
          top: band.getAttribute('data-model-top'),
          height: band.getAttribute('data-model-height'),
        }))),
    };
  };
  const baseline = await capture();
  const expectRestored = async () => {
    const restored = await capture();
    expect(restored.nodes).toEqual(baseline.nodes);
    expect(restored.bands).toEqual(baseline.bands);
    expect(restored.zoomText).toBe(baseline.zoomText);
    expect(restored.pan.x).toBeCloseTo(baseline.pan.x, 8);
    expect(restored.pan.y).toBeCloseTo(baseline.pan.y, 8);
  };

  await page.setViewportSize({ width: 700, height: 1000 });
  await expect(visualization).toHaveAttribute('data-layout-orientation', 'portrait');
  await page.waitForTimeout(1200);
  await page.setViewportSize({ width: 1200, height: 700 });
  await expect(visualization).toHaveAttribute('data-layout-orientation', 'landscape');
  await page.waitForTimeout(1200);
  await expectRestored();

  for (const viewport of [
    { width: 1210, height: 706 },
    { width: 1194, height: 691 },
    { width: 1206, height: 704 },
    { width: 1200, height: 700 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(320);
  }
  await expectRestored();
});

test('keeps every block strictly below all visible prerequisites while dragging', async ({ page }) => {
  await page.goto('./');
  const visualization = page.locator('.viz');
  await expect(visualization).toHaveAttribute('data-vertical-order-violation-count', '0');

  for (let attempt = 0; attempt < 12; attempt++) {
    if (await visualization.getAttribute('data-semantic-depth') === '1') break;
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.waitForTimeout(220);
  }
  await expect(visualization).toHaveAttribute('data-semantic-depth', '1');
  await page.setViewportSize({ width: 2400, height: 1600 });
  await page.waitForTimeout(300);

  // Exercise a visible dependency near the camera center; zooming is allowed
  // to move peripheral groups off screen without changing their geometry.
  const visibleNodes = await page.locator('.node-probe').evaluateAll((probes) => {
    const viewport = document.querySelector('.viz')!.getBoundingClientRect();
    return probes
      .filter((probe) =>
        probe.getAttribute('data-node-semantic-visible') === 'true' &&
        Boolean(probe.getAttribute('data-node-parent-id')) &&
        Number(probe.getAttribute('data-node-center-x')) >= 20 &&
        Number(probe.getAttribute('data-node-center-x')) <= viewport.width - 20 &&
        Number(probe.getAttribute('data-node-center-y')) >= 20 &&
        Number(probe.getAttribute('data-node-center-y')) <= viewport.height - 20)
      .map((probe) => ({
        id: probe.getAttribute('data-node-id')!,
        parentId: probe.getAttribute('data-node-parent-id')!,
      }));
  });
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const parentById = new Map(visibleNodes.map((node) => [node.id, node.parentId]));
  const visibleDependency = mathGraph.edges.find(
    (edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to) &&
      parentById.get(edge.from) === parentById.get(edge.to),
  );
  expect(visibleDependency).toBeDefined();
  const prerequisite = nodeProbe(page, visibleDependency!.from);
  const dependent = nodeProbe(page, visibleDependency!.to);
  await expect(prerequisite).toHaveCount(1);
  await expect(dependent).toHaveCount(1);
  await page.waitForTimeout(300);
  await expect(visualization).toHaveAttribute('data-vertical-order-violation-count', '0');

  const dragToRenderedY = async (node: typeof prerequisite, renderedY: number): Promise<void> => {
    const vizBounds = await visualization.boundingBox();
    expect(vizBounds).not.toBeNull();
    const x = vizBounds!.x + Number(await node.getAttribute('data-node-center-x'));
    const y = vizBounds!.y + Number(await node.getAttribute('data-node-center-y'));
    await page.mouse.move(x, y);
    await page.mouse.down();
    await expect(visualization).toHaveAttribute(
      'data-grabbed-node-id',
      (await node.getAttribute('data-node-id')) ?? '',
    );
    await page.mouse.move(x, vizBounds!.y + renderedY, { steps: 18 });
    await page.mouse.up();
    await page.waitForTimeout(700);
  };

  const prerequisiteRenderedY = Number(await prerequisite.getAttribute('data-node-center-y'));
  const prerequisitePositionBeforeChildDrag = {
    x: Number(await prerequisite.getAttribute('data-node-model-x')),
    y: Number(await prerequisite.getAttribute('data-node-model-y')),
  };
  await dragToRenderedY(dependent, prerequisiteRenderedY - 80);
  const dependencyClearance =
    (Number(await prerequisite.getAttribute('data-node-model-height')) +
      Number(await dependent.getAttribute('data-node-model-height'))) /
      2 +
    12;
  await expect
    .poll(async () => Number(await dependent.getAttribute('data-node-model-y')))
    .toBeGreaterThanOrEqual(
      Number(await prerequisite.getAttribute('data-node-model-y')) + dependencyClearance - 0.5,
    );
  await expect(visualization).toHaveAttribute('data-vertical-order-violation-count', '0');
  expect(Number(await prerequisite.getAttribute('data-node-model-x'))).toBeCloseTo(
    prerequisitePositionBeforeChildDrag.x,
    2,
  );
  expect(Number(await prerequisite.getAttribute('data-node-model-y'))).toBeCloseTo(
    prerequisitePositionBeforeChildDrag.y,
    2,
  );

  const dependentModelYBeforeDownwardDrag = Number(
    await dependent.getAttribute('data-node-model-y'),
  );
  const dependentRenderedY = Number(await dependent.getAttribute('data-node-center-y'));
  await dragToRenderedY(prerequisite, dependentRenderedY + 300);
  await expect
    .poll(async () => Number(await prerequisite.getAttribute('data-node-model-y')))
    .toBeGreaterThan(dependentModelYBeforeDownwardDrag);
  await expect
    .poll(async () => Number(await dependent.getAttribute('data-node-model-y')))
    .toBeGreaterThanOrEqual(
      Number(await prerequisite.getAttribute('data-node-model-y')) + dependencyClearance - 0.5,
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
  await expect(page.getByRole('status')).toHaveText('Showing 118 nodes and 110 connections.');
  await page.waitForTimeout(700);
  const movingNode = nodeProbe(page, 'arithmetic');
  const beforeDrag = {
    x: Number(await movingNode.getAttribute('data-node-model-x')),
    y: Number(await movingNode.getAttribute('data-node-model-y')),
  };
  const dragPoint = await nodePoint(page, 'arithmetic');
  const dragX = dragPoint.x;
  const dragY = dragPoint.y;
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  await page.mouse.move(dragX + 120, dragY + 60, { steps: 24 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  const beforeLayoutNow = {
    x: Number(await movingNode.getAttribute('data-node-model-x')),
    y: Number(await movingNode.getAttribute('data-node-model-y')),
  };
  expect(Math.hypot(
    beforeLayoutNow.x - beforeDrag.x,
    beforeLayoutNow.y - beforeDrag.y,
  )).toBeGreaterThan(20);
  const animatedLeaf = nodeProbe(page, 'addition');
  const leafPosition = async () => ({
    x: Number(await animatedLeaf.getAttribute('data-node-actual-model-x')),
    y: Number(await animatedLeaf.getAttribute('data-node-actual-model-y')),
  });
  const leafBeforeLayoutNow = await leafPosition();
  await page.getByRole('button', { name: 'Layout Now', exact: true }).click();
  const immediatelyAfterLayoutNow = await leafPosition();
  await page.waitForTimeout(120);
  const earlyInLayoutAnimation = await leafPosition();
  await page.waitForTimeout(880);
  const leafAfterLayoutNow = await leafPosition();
  const afterLayoutNow = {
    x: Number(await movingNode.getAttribute('data-node-model-x')),
    y: Number(await movingNode.getAttribute('data-node-model-y')),
  };
  const distance = (
    left: { x: number; y: number },
    right: { x: number; y: number },
  ): number => Math.hypot(left.x - right.x, left.y - right.y);
  expect(distance(beforeLayoutNow, afterLayoutNow)).toBeGreaterThan(20);
  expect(distance(immediatelyAfterLayoutNow, leafBeforeLayoutNow)).toBeLessThan(
    distance(immediatelyAfterLayoutNow, leafAfterLayoutNow),
  );
  const totalMovement = distance(leafBeforeLayoutNow, leafAfterLayoutNow);
  const earlyMovement = distance(leafBeforeLayoutNow, earlyInLayoutAnimation);
  expect(earlyMovement).toBeGreaterThan(0);
  expect(earlyMovement).toBeLessThan(totalMovement);

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
  await expect(page.getByRole('status')).toHaveText('Showing 118 nodes and 110 connections.');
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
    expect(Math.abs(node.centerX - before.centerX), node.id ?? `${index}`).toBeLessThan(1.5);
    expect(Math.abs(node.centerY - before.centerY), node.id ?? `${index}`).toBeLessThan(1.5);
    expect(node.modelX, node.id ?? `${index}`).toBeCloseTo(before.modelX, 8);
    expect(node.modelY, node.id ?? `${index}`).toBeCloseTo(before.modelY, 8);
  });
});
