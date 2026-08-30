<script lang="ts">
  import { untrack } from 'svelte';
  import cytoscape from 'cytoscape';
  import dagre from 'cytoscape-dagre';
  import type { DagreLayoutOptions } from 'cytoscape-dagre';
  import type { ConceptEdge, ConceptGraph, GraphNode, MaturityLevel } from '../types';
  import {
    ancestorsOf,
    childrenByParent,
    computeVisible,
    conceptCountOf,
    descendantsOf,
    nodesById,
    representativeOf,
    type VisibleGraph,
  } from './graph-model';
  import { groupPaint, maturityPaint, orderedMaturityLevels } from './colors';
  import { compactRanksTowardCenterline } from './centerline-layout';
  import {
    assignMaturityBands,
    clampPointToMaturityBand,
    constrainPointAgainstMaturityBandNodes,
    expandMaturityBandRects,
    fitMaturityBandsToNodes,
    packMaturityBandNodes,
    placeInMaturityBands,
    separateMaturityBandNodes,
    separateMaturityPeersFromPinned,
    type MaturityBandRect,
  } from './maturity-bands';
  import {
    captureLocalLayout,
    restoreLocalLayout,
    type SavedLocalPosition,
  } from './session-layout';
  import {
    deriveSpacing,
    responsiveGeometryFor,
    transformBBox,
    viewportFor,
    zoomBoundsFor,
    type BBox,
    type Size,
  } from './layout';
  import {
    createSpringSystem,
    setAnchor,
    springStep,
    HOP_WEIGHTS,
    type SpringNodeInput,
    type SpringSystem,
  } from './springs';
  import {
    constrainPointToVerticalDependencyOrder,
    countVerticalDependencyOrderViolations,
    enforceVerticalDependencyOrder,
  } from './vertical-order';
  import { clampOffset, UserStore } from './user-store';

  cytoscape.use(dagre);

  interface Props {
    graph: ConceptGraph;
    /** Ids of currently expanded groups. */
    expanded: ReadonlySet<string>;
    selectedId: string | null;
    /** Node clicked (or null when the background is clicked). */
    onSelect: (id: string | null) => void;
    /** Group should toggle open/closed (double-click on a group or on a child). */
    onToggleGroup: (id: string) => void;
  }

  let { graph, expanded, selectedId, onSelect, onToggleGroup }: Props = $props();

  let container: HTMLDivElement;
  let cy: cytoscape.Core | undefined;
  let previousExpanded = new Set<string>();
  let compoundGroupCount = $state(0);
  let currentZoom = $state(1);
  let focusAnchorDeltaX = $state(0);
  let surroundingPositionDrift = $state(0);
  let rootOverlapCount = $state(0);
  let verticalOrderViolationCount = $state(0);
  let savedLayoutNodeCount = $state(0);
  let restoredLayoutNodeCount = $state(0);
  let restoredUserPositionCount = $state(0);
  const savedGroupLayouts = new Map<string, Map<string, SavedLocalPosition>>();
  const layoutBaselines = new Map<string, cytoscape.Position>();
  let userStore: UserStore | undefined;
  let infoButtons = $state<Array<{
    id: string;
    label: string;
    left: number;
    top: number;
    nodeCenterX: number;
    nodeCenterY: number;
    modelX: number;
    modelY: number;
    modelHeight: number;
  }>>([]);
  let infoButtonFrame = 0;

  const FIT_PADDING = 36;
  const LAYOUT_MS = 480;
  const DEPENDENCY_GAP = 12;
  const MAX_PERSISTED_OFFSET = 10_000;

  function currentUserStore(): UserStore {
    userStore ??= new UserStore(undefined, 250, graph.metadata.id);
    return userStore;
  }

  function containerSize(): Size {
    return { width: container.clientWidth, height: container.clientHeight };
  }

  /** Apply domain-scoped drag offsets to a freshly computed layout baseline. */
  function restoreUserPositions(
    nodes: cytoscape.NodeCollection,
    targets: Map<string, cytoscape.Position>,
    ids?: ReadonlySet<string>,
  ): void {
    let restoredCount = 0;
    nodes.forEach((node) => {
      if (ids !== undefined && !ids.has(node.id())) return;
      const baseline = targets.get(node.id()) ?? node.position();
      layoutBaselines.set(node.id(), { ...baseline });
      const stored = currentUserStore().state.positionOffsets[node.id()];
      if (stored === undefined) return;
      restoredCount += 1;
      const offset = clampOffset(stored, MAX_PERSISTED_OFFSET);
      const band = bandAssignments.get(node.id()) ?? 0;
      const bandRect = bandModelRects[band];
      const restored = stored.bandOffsetY !== undefined && bandRect !== undefined
        ? { x: baseline.x + offset.dx, y: bandRect.y1 + stored.bandOffsetY }
        : stored.bandFraction === undefined
        ? undefined
        : restoreLocalLayout(
            baseline.x,
            new Map([[node.id(), { dx: offset.dx, bandFraction: stored.bandFraction }]]),
            [{
              id: node.id(),
              band,
              point: baseline,
              width: node.outerWidth(),
              height: node.outerHeight(),
            }],
            bandModelRects,
          ).get(node.id());
      targets.set(
        node.id(),
        restored ?? { x: baseline.x + offset.dx, y: baseline.y + offset.dy },
      );
    });
    restoredUserPositionCount = ids === undefined
      ? restoredCount
      : restoredUserPositionCount + restoredCount;
  }

  /** Persist every visible movement caused by a drag, including pushed peers. */
  function rootUnitId(node: cytoscape.NodeSingular): string {
    let root = node;
    while (root.parent().nonempty()) root = root.parent()[0];
    return root.id();
  }

  function persistVisiblePositions(draggedNode: cytoscape.NodeSingular): void {
    const c = cy;
    if (!c) return;
    c.nodes().not(':parent').forEach((node) => {
      const baseline = layoutBaselines.get(node.id());
      if (baseline === undefined) return;
      const offset = {
        dx: node.position().x - baseline.x,
        dy: node.position().y - baseline.y,
      };
      const band = bandAssignments.get(node.id()) ?? 0;
      const local = captureLocalLayout(
        baseline.x,
        [{
          id: node.id(),
          band,
          point: node.position(),
          width: node.outerWidth(),
          height: node.outerHeight(),
        }],
        bandModelRects,
      ).get(node.id());
      const bandRect = bandModelRects[band];
      currentUserStore().setOffset(
        node.id(),
        Math.hypot(offset.dx, offset.dy) < 0.5
          ? null
          : {
              ...clampOffset(offset, MAX_PERSISTED_OFFSET),
              ...(bandRect === undefined
                ? {}
                : { bandOffsetY: node.position().y - bandRect.y1 }),
              ...(local === undefined ? {} : { bandFraction: local.bandFraction }),
            },
      );
    });
    currentUserStore().setLayoutAnchor(rootUnitId(draggedNode));
    // A refresh can immediately follow pointer release, so do not leave the
    // final drag state waiting on the normal debounce timer.
    currentUserStore().flush();
  }

  const byId = $derived(nodesById(graph));
  const children = $derived(childrenByParent(graph));
  const maturityLevels = $derived(orderedMaturityLevels(graph.maturityLevels));
  const bandAssignments = $derived(assignMaturityBands(graph));
  /** Group id -> paint, by order of appearance in the graph. */
  const groupPaintById = $derived.by(() => {
    const map = new Map<string, ReturnType<typeof groupPaint>>();
    let i = 0;
    for (const n of graph.nodes) {
      if (n.isGroup) map.set(n.id, groupPaint(i++));
    }
    return map;
  });

  // ---- Public controls (used by App via bind:this) -------------------------

  export function fit(): void {
    const c = cy;
    if (!c || layoutBounds === undefined) return;
    const positions = new Map<string, cytoscape.Position>();
    c.nodes().forEach((node) => {
      positions.set(node.id(), { ...node.position() });
    });
    animateViewport(c, targetBBox(c, positions), containerSize(), true);
  }

  export function zoomBy(factor: number): void {
    if (!cy) return;
    cy.stop();
    const level = cy.zoom() * factor;
    cy.animate(
      { zoom: { level, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } } },
      { duration: 180, easing: 'ease-out' },
    );
  }

  export function layoutNow(): void {
    currentUserStore().clearOffsets();
    currentUserStore().flush();
    layoutBaselines.clear();
    savedGroupLayouts.clear();
    savedLayoutNodeCount = 0;
    restoredLayoutNodeCount = 0;
    restoredUserPositionCount = 0;
    runLayout(false);
  }

  // ---- Element construction ------------------------------------------------

  /** The hue of the nearest group ancestor, used to tie children together. */
  function haloFor(n: GraphNode): string | undefined {
    let cur = n.parent;
    while (cur !== undefined) {
      const paint = groupPaintById.get(cur);
      if (paint) return paint.halo;
      cur = byId.get(cur)?.parent;
    }
    return undefined;
  }

  function nodeData(n: GraphNode): Record<string, unknown> {
    const parent = n.parent !== undefined && expanded.has(n.parent) ? n.parent : undefined;
    if (n.isGroup) {
      const paint = groupPaintById.get(n.id) ?? groupPaint(0);
      const count = conceptCountOf(children, n.id);
      return {
        id: n.id,
        ...(parent === undefined ? {} : { parent }),
        kind: 'group',
        expanded: expanded.has(n.id) ? 1 : 0,
        label: `${n.label}\n${expanded.has(n.id) ? '⊟' : '⊞'} ${count} concept${count === 1 ? '' : 's'}`,
        fill: paint.tint,
        border: paint.color,
        text: paint.color,
      };
    }
    const paint = maturityPaint(maturityLevels, n.maturityLevel);
    const data: Record<string, unknown> = {
      id: n.id,
      ...(parent === undefined ? {} : { parent }),
      kind: 'concept',
      label: n.label,
      fill: paint.tint,
      border: paint.color,
      text: '#33302a',
    };
    const halo = haloFor(n);
    if (halo !== undefined) data.halo = halo;
    return data;
  }

  /**
   * Where a newly visible node should appear before the layout animates it to
   * its place: children emerge from their just-expanded group's old spot;
   * a just-collapsed group appears at the centroid of its old children.
   */
  function spawnPosition(
    n: GraphNode,
    oldPos: Map<string, cytoscape.Position>,
  ): cytoscape.Position | undefined {
    for (const anc of ancestorsOf(byId, n.id)) {
      const p = oldPos.get(anc);
      if (p) return { ...p };
    }
    if (n.isGroup) {
      const pts = descendantsOf(children, n.id)
        .map((id) => oldPos.get(id))
        .filter((p): p is cytoscape.Position => p !== undefined);
      if (pts.length > 0) {
        return {
          x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
          y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
        };
      }
    }
    return undefined;
  }

  function syncElements(vis: VisibleGraph, focusId?: string): void {
    const c = cy;
    if (!c) return;
    c.nodes(':parent')
      .filter((node) => !expanded.has(node.id()))
      .forEach((node: cytoscape.NodeSingular) => saveGroupLayout(node.id()));
    const oldPos = new Map<string, cytoscape.Position>();
    c.nodes().forEach((node) => {
      oldPos.set(node.id(), { ...node.position() });
    });

    const wantNodes = new Set(vis.nodes.map((n) => n.id));
    const wantEdges = new Set(vis.edges.map((e) => `${e.from}\0${e.to}`));

    c.batch(() => {
      c.edges()
        .filter((e) => !wantEdges.has(`${e.data('source')}\0${e.data('target')}`))
        .remove();
      c.nodes()
        .filter((node) => !wantNodes.has(node.id()))
        .remove();

      const fallback = { x: (c.extent().x1 + c.extent().x2) / 2, y: (c.extent().y1 + c.extent().y2) / 2 };
      const orderedNodes = [...vis.nodes].sort(
        (a, b) => ancestorsOf(byId, a.id).length - ancestorsOf(byId, b.id).length,
      );
      for (const n of orderedNodes) {
        const existing = c.getElementById(n.id);
        if (existing.nonempty()) {
          existing.data(nodeData(n));
        } else {
          c.add({ group: 'nodes', data: nodeData(n), position: spawnPosition(n, oldPos) ?? { ...fallback } });
        }
      }
      for (const e of vis.edges) {
        const id = `e\0${e.from}\0${e.to}`;
        if (c.getElementById(id).empty()) {
          c.add({ group: 'edges', data: { id, source: e.from, target: e.to } });
        }
      }
    });

    c.nodes(':parent').ungrabify();
    c.nodes().not(':parent').grabify();
    compoundGroupCount = c.nodes(':parent').length;
    rootOverlapCount = countRootUnitOverlaps(c);

    runLayout(
      oldPos.size === 0,
      focusId,
      focusId === undefined ? undefined : oldPos.get(focusId),
      oldPos,
    );
    scheduleInfoButtons();
  }

  /** Keep accessible DOM detail buttons pinned inside canvas-rendered nodes. */
  function updateInfoButtons(): void {
    infoButtonFrame = 0;
    const c = cy;
    if (!c) {
      infoButtons = [];
      return;
    }
    compoundGroupCount = c.nodes(':parent').length;
    verticalOrderViolationCount = countVerticalDependencyOrderViolations(
      currentLeafPositions(c),
      currentVisibleEdges(c),
      verticalSeparation(c),
    );
    infoButtons = c.nodes().map((node: cytoscape.NodeSingular) => {
      const box = node.renderedBoundingBox({ includeLabels: false, includeOverlays: false });
      return {
        id: node.id(),
        label: String(node.data('label')).split('\n')[0],
        left: box.x2 - 12,
        top: box.y1 + 12,
        nodeCenterX: (box.x1 + box.x2) / 2,
        nodeCenterY: (box.y1 + box.y2) / 2,
        modelX: node.position().x,
        modelY: node.position().y,
        modelHeight: node.outerHeight(),
      };
    });
  }

  function scheduleInfoButtons(): void {
    if (infoButtonFrame !== 0) return;
    infoButtonFrame = requestAnimationFrame(updateInfoButtons);
  }

  // ---- Maturity-band background ------------------------------------------

  let bandModelRects: MaturityBandRect[] = [];
  let layoutBounds: BBox | undefined;
  let lastLayoutSize: Size = { width: 0, height: 0 };
  let runningLayout: cytoscape.Layouts | undefined;

  interface BandStripe {
    level: MaturityLevel;
    top: number;
    height: number;
    label: string;
    color: string;
    count: number;
  }

  let bandStripes = $state<BandStripe[]>([]);
  let layoutOrientation = $state<'landscape' | 'portrait'>('landscape');
  let layoutMode = $state<'flow' | 'bounded'>('flow');

  function maturityBandLabel(level: MaturityLevel): string {
    return level.displaySuffix === undefined
      ? level.label
      : `${level.label} · ${level.displaySuffix}`;
  }

  /** Project model-space band rectangles into rendered CSS coordinates. */
  function updateBandStripes(): void {
    const c = cy;
    if (!c || bandModelRects.length === 0) return;
    const zoom = c.zoom();
    const pan = c.pan();
    bandStripes = bandModelRects.flatMap((rect) => {
      const level = maturityLevels[rect.band];
      if (level === undefined) return [];
      return [{
        level,
        top: rect.y1 * zoom + pan.y,
        height: (rect.y2 - rect.y1) * zoom,
        label: maturityBandLabel(level),
        color: level.color,
        count: rect.count,
      }];
    });
  }

  /** Model bbox at target positions, including labels and all maturity bands. */
  function targetBBox(c: cytoscape.Core, targets: ReadonlyMap<string, cytoscape.Position>): BBox {
    const bbox: BBox = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
    c.nodes().not(':parent').forEach((node) => {
      const point = targets.get(node.id()) ?? node.position();
      const halfWidth = node.outerWidth() / 2;
      const halfHeight = node.outerHeight() / 2;
      bbox.x1 = Math.min(bbox.x1, point.x - halfWidth);
      bbox.x2 = Math.max(bbox.x2, point.x + halfWidth);
      bbox.y1 = Math.min(bbox.y1, point.y - halfHeight);
      bbox.y2 = Math.max(bbox.y2, point.y + halfHeight);
    });
    if (bandModelRects.length > 0) {
      bbox.y1 = Math.min(bbox.y1, bandModelRects[0].y1);
      bbox.y2 = Math.max(bbox.y2, bandModelRects.at(-1)!.y2);
    }
    return bbox;
  }

  /** Separate root compound containers and standalone blocks as whole units. */
  function separateRootUnits(
    c: cytoscape.Core,
    targets: Map<string, cytoscape.Position>,
    gap = 18,
    anchoredRootId?: string,
  ): void {
    const roots = c.nodes().filter((node) => node.parent().empty());
    const shiftRoot = (root: cytoscape.NodeSingular, dx: number): void => {
      const leaves = root.isParent() ? root.descendants().not(':parent') : root;
      leaves.forEach((leaf: cytoscape.NodeSingular) => {
        const current = leaf.position();
        const shifted = { x: current.x + dx, y: current.y };
        leaf.position(shifted);
        targets.set(leaf.id(), shifted);
      });
    };
    const ordered: cytoscape.NodeSingular[] = [];
    roots.forEach((root: cytoscape.NodeSingular) => {
      ordered.push(root);
    });
    ordered.sort((a, b) => a.position().x - b.position().x);
    const anchorIndex = Math.max(0, ordered.findIndex((root) => root.id() === anchoredRootId));
    const verticalOverlap = (a: cytoscape.NodeSingular, b: cytoscape.NodeSingular): boolean => {
      const ab = a.boundingBox({ includeLabels: true, includeOverlays: false });
      const bb = b.boundingBox({ includeLabels: true, includeOverlays: false });
      return Math.min(ab.y2, bb.y2) - Math.max(ab.y1, bb.y1) + gap > 0;
    };

    // Pack rigid root units away from the anchor in both directions. Checking
    // every already-fixed unit makes the result deterministic and prevents the
    // pairwise oscillation that dense same-zone roots can otherwise cause.
    for (let index = anchorIndex + 1; index < ordered.length; index++) {
      const moving = ordered[index];
      const movingBox = moving.boundingBox({ includeLabels: true, includeOverlays: false });
      let requiredX1 = movingBox.x1;
      for (let fixedIndex = anchorIndex; fixedIndex < index; fixedIndex++) {
        const fixed = ordered[fixedIndex];
        if (!verticalOverlap(fixed, moving)) continue;
        requiredX1 = Math.max(
          requiredX1,
          fixed.boundingBox({ includeLabels: true, includeOverlays: false }).x2 + gap,
        );
      }
      shiftRoot(moving, requiredX1 - movingBox.x1);
    }
    for (let index = anchorIndex - 1; index >= 0; index--) {
      const moving = ordered[index];
      const movingBox = moving.boundingBox({ includeLabels: true, includeOverlays: false });
      let requiredX2 = movingBox.x2;
      for (let fixedIndex = anchorIndex; fixedIndex > index; fixedIndex--) {
        const fixed = ordered[fixedIndex];
        if (!verticalOverlap(fixed, moving)) continue;
        requiredX2 = Math.min(
          requiredX2,
          fixed.boundingBox({ includeLabels: true, includeOverlays: false }).x1 - gap,
        );
      }
      shiftRoot(moving, requiredX2 - movingBox.x2);
    }
  }

  function rootUnitOverlapPairs(c: cytoscape.Core, gap = 17.5): string[] {
    const roots = c.nodes().filter((node) => node.parent().empty());
    const pairs: string[] = [];
    for (let i = 0; i < roots.length; i++) {
      for (let j = i + 1; j < roots.length; j++) {
        const a = roots[i].boundingBox({ includeLabels: true, includeOverlays: false });
        const b = roots[j].boundingBox({ includeLabels: true, includeOverlays: false });
        if (
          Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) + gap > 0 &&
          Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) + gap > 0
        ) pairs.push(`${roots[i].id()}->${roots[j].id()}`);
      }
    }
    return pairs;
  }

  function countRootUnitOverlaps(c: cytoscape.Core, gap = 17.5): number {
    return rootUnitOverlapPairs(c, gap).length;
  }

  function resolveRootUnitOverlaps(
    c: cytoscape.Core,
    targets: Map<string, cytoscape.Position>,
    anchoredRootId?: string,
  ): number {
    const roots = c.nodes().filter((node) => node.parent().empty());
    const anchorX = anchoredRootId === undefined
      ? 0
      : c.getElementById(anchoredRootId).position().x;
    const shiftRoot = (root: cytoscape.NodeSingular, dx: number): void => {
      const leaves = root.isParent() ? root.descendants().not(':parent') : root;
      leaves.forEach((leaf: cytoscape.NodeSingular) => {
        const shifted = { x: leaf.position().x + dx, y: leaf.position().y };
        leaf.position(shifted);
        targets.set(leaf.id(), shifted);
      });
    };
    const maxPasses = Math.max(8, roots.length * roots.length * 2);
    for (let pass = 0; pass < maxPasses; pass++) {
      separateRootUnits(c, targets, 18, anchoredRootId);
      let collision: [cytoscape.NodeSingular, cytoscape.NodeSingular] | undefined;
      for (let left = 0; left < roots.length && collision === undefined; left++) {
        for (let right = left + 1; right < roots.length; right++) {
          const a = roots[left];
          const b = roots[right];
          const ab = a.boundingBox({ includeLabels: true, includeOverlays: false });
          const bb = b.boundingBox({ includeLabels: true, includeOverlays: false });
          if (
            Math.min(ab.x2, bb.x2) - Math.max(ab.x1, bb.x1) + 18 > 0 &&
            Math.min(ab.y2, bb.y2) - Math.max(ab.y1, bb.y1) + 18 > 0
          ) {
            collision = [a, b];
            break;
          }
        }
      }
      if (collision === undefined) return 0;

      const [a, b] = collision;
      const moving = a.id() === anchoredRootId
        ? b
        : b.id() === anchoredRootId
          ? a
          : Math.abs(a.position().x - anchorX) > Math.abs(b.position().x - anchorX)
            ? a
            : b;
      const fixed = moving === a ? b : a;
      const movingBox = moving.boundingBox({ includeLabels: true, includeOverlays: false });
      const fixedBox = fixed.boundingBox({ includeLabels: true, includeOverlays: false });
      const direction = moving.position().x === fixed.position().x
        ? (moving.id() < fixed.id() ? -1 : 1)
        : Math.sign(moving.position().x - fixed.position().x);
      const dx = direction < 0
        ? fixedBox.x1 - 18 - movingBox.x2
        : fixedBox.x2 + 18 - movingBox.x1;
      shiftRoot(moving, dx);
    }
    return countRootUnitOverlaps(c);
  }

  function focusedNodeBoxes(focusNode: cytoscape.NodeSingular): Array<{
    id: string;
    band: number;
    point: cytoscape.Position;
    width: number;
    height: number;
  }> {
    return focusNode.descendants().not(':parent').map((node: cytoscape.NodeSingular) => ({
      id: node.id(),
      band: bandAssignments.get(node.id()) ?? 0,
      point: node.position(),
      width: node.outerWidth(),
      height: node.outerHeight(),
    }));
  }

  function saveGroupLayout(groupId: string): void {
    const group = cy?.getElementById(groupId);
    if (!group?.nonempty() || !group.isParent()) return;
    const saved = captureLocalLayout(group.position().x, focusedNodeBoxes(group), bandModelRects);
    if (saved.size === 0) return;
    savedGroupLayouts.set(groupId, saved);
    savedLayoutNodeCount = saved.size;
  }

  function resolveCurrentRootCollisions(anchoredRootId: string): void {
    const c = cy;
    if (!c) return;
    const targets = new Map<string, cytoscape.Position>();
    c.nodes().not(':parent').forEach((node) => {
      targets.set(node.id(), { ...node.position() });
    });
    rootOverlapCount = resolveRootUnitOverlaps(c, targets, anchoredRootId);
    layoutBounds = targetBBox(c, targets);
    scheduleInfoButtons();
  }

  function allVisibleNodeBoxes(): Array<{
    id: string;
    band: number;
    point: cytoscape.Position;
    width: number;
    height: number;
  }> {
    return cy?.nodes().not(':parent').map((node: cytoscape.NodeSingular) => ({
      id: node.id(),
      band: bandAssignments.get(node.id()) ?? 0,
      point: node.position(),
      width: node.outerWidth(),
      height: node.outerHeight(),
    })) ?? [];
  }

  function deriveBandsForTargets(
    nodes: cytoscape.NodeCollection,
    targets: Map<string, cytoscape.Position>,
  ): void {
    const boxes = nodes.map((node: cytoscape.NodeSingular) => ({
      id: node.id(),
      band: bandAssignments.get(node.id()) ?? 0,
      point: targets.get(node.id()) ?? node.position(),
      width: node.outerWidth(),
      height: node.outerHeight(),
    }));
    const result = fitMaturityBandsToNodes(boxes, bandModelRects, 42, 7);
    bandModelRects = result.bands;
    result.positions.forEach((point, id) => targets.set(id, point));
    nodes.positions((node) => targets.get(node.id()) ?? node.position());
  }

  function currentVisibleEdges(c: cytoscape.Core): ConceptEdge[] {
    return c.edges().map((edge: cytoscape.EdgeSingular) => ({
      from: edge.data('source') as string,
      to: edge.data('target') as string,
    }));
  }

  function currentLeafPositions(c: cytoscape.Core): Map<string, cytoscape.Position> {
    const positions = new Map<string, cytoscape.Position>();
    c.nodes().not(':parent').forEach((node) => {
      positions.set(node.id(), { ...node.position() });
    });
    return positions;
  }

  function verticalSeparation(c: cytoscape.Core): (edge: ConceptEdge) => number {
    return (edge) => {
      const prerequisite = c.getElementById(edge.from);
      const dependent = c.getElementById(edge.to);
      if (prerequisite.empty() || dependent.empty()) return DEPENDENCY_GAP;
      return (prerequisite.outerHeight() + dependent.outerHeight()) / 2 + DEPENDENCY_GAP;
    };
  }

  /** Apply hard prerequisite order, then resolve any resulting collision horizontally. */
  function enforceVerticalOrderForTargets(
    nodes: cytoscape.NodeCollection,
    targets: Map<string, cytoscape.Position>,
  ): void {
    const c = cy;
    if (!c) return;
    const separation = verticalSeparation(c);
    const ordered = enforceVerticalDependencyOrder(targets, currentVisibleEdges(c), separation);
    ordered.forEach((point, id) => targets.set(id, point));

    for (let band = 0; band < bandModelRects.length; band++) {
      const members = nodes
        .filter((node) => (bandAssignments.get(node.id()) ?? 0) === band)
        .map((node: cytoscape.NodeSingular) => ({
          id: node.id(),
          band,
          point: targets.get(node.id()) ?? node.position(),
          width: node.outerWidth(),
          height: node.outerHeight(),
        }))
        .sort((a, b) => a.point.y - b.point.y || a.point.x - b.point.x || a.id.localeCompare(b.id));
      if (members.length === 0) continue;
      const separated = separateMaturityPeersFromPinned(members[0], members.slice(1), 10);
      separated.forEach((point, id) => targets.set(id, point));
    }
    verticalOrderViolationCount = countVerticalDependencyOrderViolations(
      targets,
      currentVisibleEdges(c),
      separation,
    );
  }

  /** Push only violating dependents down; the relaxation never changes prerequisites. */
  function pushViolatingDependentsDown(): void {
    const c = cy;
    if (!c) return;
    const nodes = c.nodes().not(':parent');
    const targets = currentLeafPositions(c);
    enforceVerticalOrderForTargets(nodes, targets);
    nodes.positions((node) => targets.get(node.id()) ?? node.position());
  }

  /** Restore an expanded compound's horizontal anchor after child collision resolution. */
  function anchorFocusedGroupX(
    focusNode: cytoscape.NodeSingular,
    anchorX: number,
    targets: Map<string, cytoscape.Position>,
  ): void {
    const descendants = focusNode.descendants().not(':parent');
    descendants.positions((node) => targets.get(node.id()) ?? node.position());
    const dx = anchorX - focusNode.position().x;
    if (Math.abs(dx) <= 1e-6) return;
    descendants.forEach((leaf: cytoscape.NodeSingular) => {
      const point = targets.get(leaf.id()) ?? leaf.position();
      const anchored = { x: point.x + dx, y: point.y };
      leaf.position(anchored);
      targets.set(leaf.id(), anchored);
    });
  }

  function deriveBandsFromVisibleNodes(anchoredNodeId?: string): void {
    const c = cy;
    if (!c) return;
    const result = fitMaturityBandsToNodes(
      allVisibleNodeBoxes(),
      bandModelRects,
      42,
      7,
      anchoredNodeId,
    );
    bandModelRects = result.bands;
    c.nodes().not(':parent').positions(
      (node) => result.positions.get(node.id()) ?? node.position(),
    );
    if (springSystem !== undefined) {
      for (let index = 0; index < springNodes.length; index++) {
        springSystem.x[index] = springNodes[index].position().x;
        springSystem.y[index] = springNodes[index].position().y;
      }
    }
    updateBandStripes();
    scheduleInfoButtons();
  }

  function movePeersFromDraggedNode(node: cytoscape.NodeSingular): void {
    const c = cy;
    if (!c || node.isParent()) return;
    const band = bandAssignments.get(node.id()) ?? 0;
    const upstreamIds = visibleUpstreamIds(c, node.id());
    const peers = c.nodes().not(':parent')
      .filter((candidate) =>
        candidate.id() !== node.id() &&
        !upstreamIds.has(candidate.id()) &&
        (bandAssignments.get(candidate.id()) ?? 0) === band,
      )
      .map((candidate: cytoscape.NodeSingular) => ({
        id: candidate.id(),
        band,
        point: candidate.position(),
        width: candidate.outerWidth(),
        height: candidate.outerHeight(),
      }));
    const positions = separateMaturityPeersFromPinned({
      id: node.id(),
      band,
      point: node.position(),
      width: node.outerWidth(),
      height: node.outerHeight(),
    }, peers);
    c.nodes().not(':parent').positions(
      (candidate) => positions.get(candidate.id()) ?? candidate.position(),
    );
  }

  function requiredFocusedBandHeights(
    focusNode: cytoscape.NodeSingular,
    gap = 8,
  ): Map<number, number> {
    const required = new Map<number, number>();
    for (let band = 0; band < bandModelRects.length; band++) {
      const members = focusNode.descendants().not(':parent').filter(
        (node) => (bandAssignments.get(node.id()) ?? 0) === band,
      );
      if (members.length === 0) continue;
      const columns = Math.min(2, members.length);
      const rows = Math.ceil(members.length / columns);
      const cellHeight = Math.max(...members.map((node) => node.outerHeight())) + gap;
      required.set(band, rows * cellHeight - gap + 32);
    }
    return required;
  }

  /** Pack focused descendants tightly around the collapsed group's x anchor. */
  function packFocusedDescendants(
    focusNode: cytoscape.NodeSingular,
    anchorX: number,
    targets: Map<string, cytoscape.Position>,
    gap = 8,
  ): void {
    const descendants = focusNode.descendants().not(':parent');
    for (let bandIndex = 0; bandIndex < bandModelRects.length; bandIndex++) {
      const band = bandModelRects[bandIndex];
      const members = descendants
        .filter((node) => (bandAssignments.get(node.id()) ?? 0) === bandIndex)
        .toArray() as cytoscape.NodeSingular[];
      members.sort((a, b) => {
          const ap = targets.get(a.id()) ?? a.position();
          const bp = targets.get(b.id()) ?? b.position();
          return ap.y - bp.y || ap.x - bp.x || a.id().localeCompare(b.id());
        });
      if (members.length === 0) continue;

      const columns = Math.min(2, members.length);
      const rows = Math.ceil(members.length / columns);
      const cellWidth = Math.max(...members.map((node) => node.outerWidth())) + gap;
      const cellHeight = Math.max(...members.map((node) => node.outerHeight())) + gap;
      const contentHeight = rows * cellHeight - gap;
      const firstY = (band.y1 + band.y2 - contentHeight) / 2 + (cellHeight - gap) / 2;

      for (let row = 0; row < rows; row++) {
        const rowMembers = members.slice(row * columns, (row + 1) * columns);
        const rowWidth = rowMembers.length * cellWidth - gap;
        const firstX = anchorX - rowWidth / 2 + (cellWidth - gap) / 2;
        rowMembers.forEach((node, column) => {
          targets.set(node.id(), {
            x: firstX + column * cellWidth,
            y: clampPointToMaturityBand(
              { x: anchorX, y: firstY + row * cellHeight },
              band,
              node.outerHeight(),
              7,
            ).y,
          });
        });
      }
    }
  }

  /** Fit a model bbox and derive usable zoom limits from that fitted scale. */
  function animateViewport(
    c: cytoscape.Core,
    bbox: BBox,
    size: Size,
    animated: boolean,
    minimumZoom = 0,
    zoomExtent: BBox = bbox,
  ): void {
    const viewport = viewportFor(bbox, size, FIT_PADDING);
    if (viewport.zoom < minimumZoom) {
      viewport.zoom = minimumZoom;
      viewport.pan = {
        x: size.width / 2 - minimumZoom * (bbox.x1 + bbox.x2) / 2,
        y: FIT_PADDING - minimumZoom * bbox.y1,
      };
    }
    const wholeGraphFit = viewportFor(zoomExtent, size, FIT_PADDING).zoom;
    const wholeGraphBounds = zoomBoundsFor(wholeGraphFit);
    const bounds = {
      min: wholeGraphBounds.min,
      max: Math.max(wholeGraphBounds.max, viewport.zoom * 6),
    };
    c.minZoom(Math.min(bounds.min, c.zoom()));
    c.maxZoom(Math.max(bounds.max, c.zoom()));
    if (animated) {
      c.stop();
      c.animate(
        { zoom: viewport.zoom, pan: viewport.pan },
        {
          duration: LAYOUT_MS,
          easing: 'ease-in-out-cubic',
          complete: () => {
            c.minZoom(bounds.min);
            c.maxZoom(bounds.max);
          },
        },
      );
    } else {
      c.viewport(viewport);
      c.minZoom(bounds.min);
      c.maxZoom(bounds.max);
    }
  }

  /** Dagre TB layout, aspect-aware fill, maturity-band placement, and fit. */
  function runLayout(
    first = false,
    focusId?: string,
    focusAnchor?: cytoscape.Position,
    previousPositions?: ReadonlyMap<string, cytoscape.Position>,
  ): void {
    const c = cy;
    if (!c || c.nodes().length === 0) return;
    cancelSprings();
    runningLayout?.stop();

    const size = containerSize();
    if (size.width === 0 || size.height === 0) return;
    lastLayoutSize = size;
    const layoutNodes = c.nodes().not(':parent');
    const snapshot = new Map<string, cytoscape.Position>();
    layoutNodes.forEach((node) => {
      snapshot.set(node.id(), { ...node.position() });
    });
    c.nodes().removeClass('focus-group focus-child');
    const styledFocusNode = focusId === undefined ? undefined : c.getElementById(focusId);
    if (styledFocusNode?.nonempty() && styledFocusNode.isParent()) {
      styledFocusNode.addClass('focus-group');
      styledFocusNode.descendants().not(':parent').addClass('focus-child');
    }

    // Opening one group is a local semantic-zoom operation. Existing graph
    // blocks keep their exact model positions; only newly revealed descendants
    // receive local positions inside the anchored containing group.
    if (
      !first &&
      styledFocusNode?.nonempty() &&
      styledFocusNode.isParent() &&
      focusAnchor !== undefined &&
      previousPositions !== undefined &&
      bandModelRects.length > 0
    ) {
      const targets = new Map<string, cytoscape.Position>();
      layoutNodes.forEach((node) => {
        targets.set(node.id(), previousPositions.get(node.id()) ?? node.position());
      });
      const previousBands = bandModelRects;
      bandModelRects = expandMaturityBandRects(
        bandModelRects,
        requiredFocusedBandHeights(styledFocusNode),
      );
      layoutNodes.forEach((node) => {
        const band = bandAssignments.get(node.id()) ?? 0;
        const before = previousBands[band];
        const after = bandModelRects[band];
        const point = targets.get(node.id());
        if (before !== undefined && after !== undefined && point !== undefined) {
          targets.set(node.id(), { x: point.x, y: point.y + after.y1 - before.y1 });
        }
      });
      const saved = savedGroupLayouts.get(styledFocusNode.id());
      const restored = saved === undefined
        ? new Map<string, cytoscape.Position>()
        : restoreLocalLayout(
            focusAnchor.x,
            saved,
            focusedNodeBoxes(styledFocusNode),
            bandModelRects,
          );
      restoredLayoutNodeCount = restored.size;
      if (restored.size > 0) {
        restored.forEach((point, id) => targets.set(id, point));
      } else {
        packFocusedDescendants(styledFocusNode, focusAnchor.x, targets);
      }
      const newlyVisibleIds = new Set(
        layoutNodes
          .filter((node) => !previousPositions.has(node.id()))
          .map((node) => node.id()),
      );
      // The in-memory group layout already contains the user's offsets. Apply
      // persisted offsets only on a fresh expansion after page load, otherwise
      // the same child drag would be counted twice on close/reopen.
      if (saved === undefined) restoreUserPositions(layoutNodes, targets, newlyVisibleIds);
      layoutNodes.positions((node) => targets.get(node.id()) ?? node.position());
      anchorFocusedGroupX(styledFocusNode, focusAnchor.x, targets);
      enforceVerticalOrderForTargets(layoutNodes, targets);
      anchorFocusedGroupX(styledFocusNode, focusAnchor.x, targets);
      deriveBandsForTargets(layoutNodes, targets);
      rootOverlapCount = resolveRootUnitOverlaps(c, targets, focusId);
      bandModelRects = bandModelRects.map((rect) => ({
        ...rect,
        count: layoutNodes.filter(
          (node) => (bandAssignments.get(node.id()) ?? 0) === rect.band,
        ).length,
      }));
      layoutBounds = targetBBox(c, targets);
      focusAnchorDeltaX = Math.abs(styledFocusNode.position().x - focusAnchor.x);
      surroundingPositionDrift = Math.max(
        0,
        ...layoutNodes
          .filter((node) => !styledFocusNode.descendants().contains(node))
          .map((node) => {
            const before = previousPositions.get(node.id());
            const after = targets.get(node.id());
            return before === undefined || after === undefined
              ? 0
              : Math.hypot(after.x - before.x, after.y - before.y);
          }),
      );
      const focusBox = styledFocusNode.boundingBox({
        includeLabels: true,
        includeOverlays: false,
      });
      const viewportBounds = {
        x1: focusBox.x1 - 40,
        y1: focusBox.y1 - 40,
        x2: focusBox.x2 + 40,
        y2: focusBox.y2 + 40,
      };

      layoutNodes.forEach((node) => {
        const point = snapshot.get(node.id());
        if (point) node.position(point);
      });
      const preset = layoutNodes.layout({
        name: 'preset',
        positions: (node: cytoscape.NodeSingular) => targets.get(node.id()) ?? node.position(),
        animate: true,
        animationDuration: LAYOUT_MS,
        animationEasing: 'ease-in-out-cubic',
        fit: false,
      } as unknown as cytoscape.LayoutOptions);
      runningLayout = preset;
      preset.run();
      layoutNodes.grabify();
      animateViewport(c, viewportBounds, size, true, 0.9, layoutBounds);
      return;
    }

    surroundingPositionDrift = 0;
    rootOverlapCount = 0;
    restoredLayoutNodeCount = 0;
    const spacing = deriveSpacing(size.width, size.height, layoutNodes.length);
    const options: DagreLayoutOptions = {
      name: 'dagre',
      rankDir: 'TB',
      nodeSep: spacing.nodeSep,
      rankSep: spacing.rankSep,
      edgeSep: spacing.edgeSep,
      ranker: 'network-simplex',
      nodeDimensionsIncludeLabels: true,
      animate: false,
      fit: false,
    };
    c.layout(options as unknown as cytoscape.LayoutOptions).run();
    layoutNodes.grabify();

    const raw = new Map<string, cytoscape.Position>();
    layoutNodes.forEach((node) => {
      raw.set(node.id(), { ...node.position() });
    });
    const sourceYs = [...raw.values()].map((point) => point.y);
    const top = sourceYs.length > 0 ? Math.min(...sourceYs) - 48 : 0;
    const sourceHeight = sourceYs.length > 0 ? Math.max(...sourceYs) - Math.min(...sourceYs) : 0;
    // Maturity placement preserves dagre's ordering without inheriting an
    // excessively tall raw rank span that would shrink every label at fit.
    const portrait = size.height > size.width;
    const dense = layoutNodes.length > 24;
    layoutMode = dense ? 'bounded' : 'flow';
    const maxBlockWidth = Math.max(...layoutNodes.map((node) => node.outerWidth()));
    const maxBlockHeight = Math.max(...layoutNodes.map((node) => node.outerHeight()));
    const denseColumns = Math.max(
      1,
      Math.floor((Math.max(240, size.width - 2 * FIT_PADDING) + 12) / (maxBlockWidth + 12)),
    );
    const bandCounts = maturityLevels.map((_, band) =>
      layoutNodes.filter((node) => (bandAssignments.get(node.id()) ?? 0) === band).length,
    );
    const denseBandWeights = bandCounts.map((count) =>
      count === 0
        ? 42
        : Math.ceil(count / denseColumns) * (maxBlockHeight + 12) + 28,
    );
    const denseHeight = denseBandWeights.reduce((sum, height) => sum + height, 0);
    const baseHeight = portrait
      ? Math.max(760, Math.min(900, sourceHeight + 72))
      : Math.max(520, Math.min(640, sourceHeight + 72));
    const totalHeight = dense ? Math.max(baseHeight, denseHeight) : baseHeight;
    const result = placeInMaturityBands(
      raw,
      bandAssignments,
      top,
      totalHeight,
      maturityLevels.length,
      dense ? denseBandWeights : undefined,
    );
    bandModelRects = result.bandRects;
    const sourceBounds = targetBBox(c, result.positions);
    const responsive = responsiveGeometryFor(
      result.positions,
      sourceBounds,
      size,
      FIT_PADDING,
    );
    layoutOrientation = responsive.orientation;
    const targets = new Map(responsive.positions);
    bandModelRects = result.bandRects.map((rect) => {
      const transformed = transformBBox(
        { x1: sourceBounds.x1, y1: rect.y1, x2: sourceBounds.x2, y2: rect.y2 },
        responsive.transform,
      );
      return { ...rect, y1: transformed.y1, y2: transformed.y2 };
    });
    // The affine transform moves centers but does not scale node blocks. Clamp
    // the final centers after transforming the band rectangles so initial
    // placement obeys the same full-block constraint as dragging.
    const nodeBoxes = layoutNodes.map((node: cytoscape.NodeSingular) => ({
        id: node.id(),
        band: bandAssignments.get(node.id()) ?? 0,
        point: targets.get(node.id()) ?? node.position(),
        width: node.outerWidth(),
        height: node.outerHeight(),
      }));
    const separated = dense
      ? packMaturityBandNodes(nodeBoxes, bandModelRects, Math.max(240, size.width - 2 * FIT_PADDING))
      : separateMaturityBandNodes(nodeBoxes, bandModelRects);
    separated.forEach((point, id) => targets.set(id, point));
    const targetXs = [...targets.values()].map((point) => point.x);
    const centerX = targetXs.length === 0
      ? 0
      : (Math.min(...targetXs) + Math.max(...targetXs)) / 2;
    const compacted = compactRanksTowardCenterline(
      nodeBoxes.map((node) => ({ ...node, point: targets.get(node.id) ?? node.point })),
      centerX,
    );
    compacted.forEach((point, id) => targets.set(id, point));
    if (styledFocusNode?.nonempty() && focusAnchor !== undefined && styledFocusNode.isParent()) {
      packFocusedDescendants(styledFocusNode, focusAnchor.x, targets);
    }
    restoreUserPositions(layoutNodes, targets);
    layoutNodes.positions((node) => targets.get(node.id()) ?? node.position());
    const focusNode = focusId === undefined ? undefined : c.getElementById(focusId);
    if (focusNode?.nonempty() && focusAnchor !== undefined && focusNode.isParent()) {
      anchorFocusedGroupX(focusNode, focusAnchor.x, targets);
    }
    enforceVerticalOrderForTargets(layoutNodes, targets);
    if (focusNode?.nonempty() && focusAnchor !== undefined && focusNode.isParent()) {
      anchorFocusedGroupX(focusNode, focusAnchor.x, targets);
    }
    deriveBandsForTargets(layoutNodes, targets);
    rootOverlapCount = resolveRootUnitOverlaps(
      c,
      targets,
      focusId ?? currentUserStore().state.layoutAnchor ?? undefined,
    );
    layoutBounds = targetBBox(c, targets);
    focusAnchorDeltaX =
      focusNode?.nonempty() && focusAnchor !== undefined
        ? Math.abs(focusNode.position().x - focusAnchor.x)
        : 0;
    const focusBox = focusNode?.nonempty()
      ? focusNode.boundingBox({ includeLabels: true, includeOverlays: false })
      : undefined;
    const viewportBounds = focusBox === undefined
      ? layoutBounds
      : {
          x1: focusBox.x1 - 40,
          y1: focusBox.y1 - 40,
          x2: focusBox.x2 + 40,
          y2: focusBox.y2 + 40,
        };

    if (first) {
      layoutNodes.positions((node) => targets.get(node.id()) ?? node.position());
      animateViewport(c, viewportBounds, size, false, focusBox ? 0.9 : 0.75, layoutBounds);
      updateBandStripes();
      return;
    }

    layoutNodes.forEach((node) => {
      const point = snapshot.get(node.id());
      if (point) node.position(point);
    });
    const preset = layoutNodes.layout({
      name: 'preset',
      positions: (node: cytoscape.NodeSingular) => targets.get(node.id()) ?? node.position(),
      animate: true,
      animationDuration: LAYOUT_MS,
      animationEasing: 'ease-in-out-cubic',
      fit: false,
    } as unknown as cytoscape.LayoutOptions);
    runningLayout = preset;
    preset.run();
    layoutNodes.grabify();
    animateViewport(c, viewportBounds, size, true, focusBox ? 0.9 : 0.75, layoutBounds);
  }

  // ---- Drag springs --------------------------------------------------------

  let springSystem: SpringSystem | undefined;
  let springNodes: cytoscape.NodeSingular[] = [];
  let springUpstreamIds = new Set<string>();
  let anchorNode: cytoscape.NodeSingular | undefined;
  let dragFrameId = 0;
  let settleFrameId = 0;
  let dragPending = false;
  let prefersReducedMotion = false;

  function visibleUpstreamIds(c: cytoscape.Core, nodeId: string): Set<string> {
    const incomingByTarget = new Map<string, string[]>();
    for (const edge of currentVisibleEdges(c)) {
      const incoming = incomingByTarget.get(edge.to) ?? [];
      incoming.push(edge.from);
      incomingByTarget.set(edge.to, incoming);
    }
    const upstream = new Set<string>();
    const frontier = [...(incomingByTarget.get(nodeId) ?? [])];
    while (frontier.length > 0) {
      const id = frontier.pop()!;
      if (upstream.has(id)) continue;
      upstream.add(id);
      frontier.push(...(incomingByTarget.get(id) ?? []));
    }
    return upstream;
  }

  function constrainedPoint(
    node: cytoscape.NodeSingular,
    point: cytoscape.Position,
    resizeBand = false,
  ): cytoscape.Position {
    const c = cy;
    const dependencyPoint = c === undefined
      ? point
      : constrainPointToVerticalDependencyOrder(
          node.id(),
          point,
          currentLeafPositions(c),
          currentVisibleEdges(c),
          verticalSeparation(c),
        );
    const bandIndex = bandAssignments.get(node.id()) ?? 0;
    if (resizeBand) return dependencyPoint;
    const band = bandModelRects[bandIndex];
    if (band === undefined || node.isParent()) return dependencyPoint;
    const moving = {
      id: node.id(),
      band: bandIndex,
      point: dependencyPoint,
      width: node.outerWidth(),
      height: node.outerHeight(),
    };
    const others = cy?.nodes().not(':parent')
      .filter((candidate) => candidate.id() !== node.id())
      .map((candidate: cytoscape.NodeSingular) => ({
        id: candidate.id(),
        band: bandAssignments.get(candidate.id()) ?? 0,
        point: candidate.position(),
        width: candidate.outerWidth(),
        height: candidate.outerHeight(),
      })) ?? [];
    const collisionSafe = constrainPointAgainstMaturityBandNodes(
      moving,
      dependencyPoint,
      others,
      band,
    );
    return c === undefined
      ? collisionSafe
      : constrainPointToVerticalDependencyOrder(
          node.id(),
          collisionSafe,
          currentLeafPositions(c),
          currentVisibleEdges(c),
          verticalSeparation(c),
        );
  }

  function cancelSprings(): void {
    if (dragFrameId !== 0) cancelAnimationFrame(dragFrameId);
    if (settleFrameId !== 0) cancelAnimationFrame(settleFrameId);
    dragFrameId = 0;
    settleFrameId = 0;
    dragPending = false;
    springSystem = undefined;
    springNodes = [];
    springUpstreamIds = new Set();
    anchorNode = undefined;
  }

  /** Snapshot the visible two-hop neighborhood around the grabbed anchor. */
  function buildSprings(node: cytoscape.NodeSingular): void {
    const c = cy;
    if (!c) return;
    const hops = new Map<string, number>([[node.id(), 0]]);
    const ordered: cytoscape.NodeSingular[] = [node];
    let frontier: cytoscape.NodeSingular[] = [node];
    for (let hop = 1; hop < HOP_WEIGHTS.length; hop++) {
      const next: cytoscape.NodeSingular[] = [];
      for (const current of frontier) {
        current.neighborhood('node').forEach((neighbor) => {
          if (hops.has(neighbor.id())) return;
          hops.set(neighbor.id(), hop);
          ordered.push(neighbor);
          next.push(neighbor);
        });
      }
      frontier = next;
    }
    if (ordered.length < 2) return;

    springUpstreamIds = visibleUpstreamIds(c, node.id());

    const index = new Map(ordered.map((candidate, i) => [candidate.id(), i]));
    const inputs: SpringNodeInput[] = ordered.map((candidate) => {
      const point = candidate.position();
      return {
        id: candidate.id(),
        x: point.x,
        y: point.y,
        weight: HOP_WEIGHTS[hops.get(candidate.id())!],
      };
    });
    const edgePairs: Array<[number, number]> = [];
    c.edges().forEach((edge) => {
      const from = index.get(edge.data('source') as string);
      const to = index.get(edge.data('target') as string);
      if (from !== undefined && to !== undefined) edgePairs.push([from, to]);
    });

    springSystem = createSpringSystem(inputs, edgePairs);
    springNodes = ordered;
    anchorNode = node;
  }

  function writeSpringPositions(): void {
    const c = cy;
    const system = springSystem;
    if (!c || !system) return;
    c.batch(() => {
      for (let i = 1; i < springNodes.length; i++) {
        if (springUpstreamIds.has(springNodes[i].id())) {
          system.x[i] = springNodes[i].position().x;
          system.y[i] = springNodes[i].position().y;
          continue;
        }
        const point = constrainedPoint(springNodes[i], { x: system.x[i], y: system.y[i] });
        system.x[i] = point.x;
        system.y[i] = point.y;
        springNodes[i].position(point);
      }
    });
  }

  function runDragFrame(): void {
    dragFrameId = 0;
    if (!springSystem || !anchorNode || !dragPending) return;
    dragPending = false;
    const point = constrainedPoint(anchorNode, anchorNode.position(), true);
    anchorNode.position(point);
    setAnchor(springSystem, point.x, point.y);
    springStep(springSystem);
    writeSpringPositions();
    pushViolatingDependentsDown();
    movePeersFromDraggedNode(anchorNode);
    deriveBandsFromVisibleNodes(anchorNode.id());
  }

  /** Brief decaying relaxation after release; positions last until re-layout. */
  function settleSprings(scale: number): void {
    if (!springSystem || !anchorNode) return;
    const point = constrainedPoint(anchorNode, anchorNode.position(), true);
    anchorNode.position(point);
    setAnchor(springSystem, point.x, point.y);
    springStep(springSystem, undefined, scale);
    writeSpringPositions();
    pushViolatingDependentsDown();
    movePeersFromDraggedNode(anchorNode);
    deriveBandsFromVisibleNodes(anchorNode.id());
    if (scale > 0.05) {
      settleFrameId = requestAnimationFrame(() => settleSprings(scale * 0.8));
    } else {
      const parent = anchorNode.parent();
      if (parent.nonempty()) {
        const parentId = parent[0].id();
        resolveCurrentRootCollisions(parentId);
        saveGroupLayout(parentId);
      } else {
        resolveCurrentRootCollisions(anchorNode.id());
      }
      persistVisiblePositions(anchorNode);
      cancelSprings();
    }
  }

  function applyHighlight(): void {
    const c = cy;
    if (!c) return;
    c.batch(() => {
      c.elements().removeClass('picked hilite faded');
      const repId = selectedId === null ? null : representativeOf(byId, expanded, selectedId);
      if (repId === null) return;
      const node = c.getElementById(repId);
      if (node.empty()) return;
      const hood = node.closedNeighborhood();
      c.elements().not(hood).addClass('faded');
      hood.addClass('hilite');
      node.removeClass('hilite').addClass('picked');
    });
  }

  // ---- Cytoscape stylesheet ------------------------------------------------

  const FONT = 'Inter';
  const style: cytoscape.StylesheetJson = [
    {
      selector: 'node',
      style: {
        shape: 'round-rectangle',
        width: 'label',
        height: 'label',
        padding: '14px',
        'background-color': 'data(fill)',
        'border-color': 'data(border)',
        'border-width': 1.5,
        label: 'data(label)',
        color: 'data(text)',
        'font-family': FONT,
        'font-size': 15,
        'font-weight': 600,
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-max-width': '170',
        'transition-property': 'opacity',
        'transition-duration': 150,
      } as never,
    },
    {
      selector: 'node[halo]',
      style: {
        'underlay-color': 'data(halo)',
        'underlay-opacity': 0.22,
        'underlay-padding': 5,
        'underlay-shape': 'round-rectangle',
      } as never,
    },
    {
      selector: 'node[kind = "group"][expanded = 0]',
      style: {
        padding: '20px',
        'font-size': 17,
        'font-weight': 700,
        'border-width': 2.5,
        'text-max-width': '210',
        'line-height': 1.35,
      } as never,
    },
    {
      selector: 'node[kind = "group"][expanded = 1]',
      style: {
        shape: 'round-rectangle',
        padding: '30px',
        'background-color': 'data(fill)',
        'background-opacity': 0.22,
        'border-color': 'data(border)',
        'border-width': 2.5,
        'border-style': 'dashed',
        label: 'data(label)',
        color: 'data(text)',
        'font-size': 17,
        'font-weight': 700,
        'text-valign': 'top',
        'text-halign': 'center',
        'text-margin-y': 16,
        'compound-sizing-wrt-labels': 'include',
        'text-max-width': '210',
        'line-height': 1.25,
      } as never,
    },
    {
      selector: 'node.focus-child',
      style: {
        padding: '5px',
        'font-size': 8,
        'text-max-width': '82',
        'border-width': 1,
        'underlay-padding': 2,
      } as never,
    },
    {
      selector: 'node.focus-group',
      style: {
        padding: '12px',
        'font-size': 8,
        'text-margin-y': 6,
        'text-max-width': '110',
        'border-width': 1.25,
      } as never,
    },
    {
      selector: 'edge',
      style: {
        width: 1.6,
        'curve-style': 'bezier',
        'line-color': '#c9c2b4',
        'target-arrow-shape': 'triangle',
        'target-arrow-color': '#c9c2b4',
        'arrow-scale': 0.85,
        'transition-property': 'opacity',
        'transition-duration': 150,
      } as never,
    },
    { selector: '.faded', style: { opacity: 0.15 } as never },
    { selector: 'node.hover', style: { 'border-width': 3 } as never },
    { selector: 'node.hilite', style: { 'border-width': 2.5 } as never },
    {
      selector: 'edge.hilite',
      style: { width: 2.6, 'line-color': '#8a8271', 'target-arrow-color': '#8a8271' } as never,
    },
    {
      selector: 'node.picked',
      style: {
        'border-width': 3.5,
        'overlay-color': 'data(border)',
        'overlay-opacity': 0.14,
        'overlay-padding': 8,
        'overlay-shape': 'round-rectangle',
      } as never,
    },
  ];

  // ---- Lifecycle -----------------------------------------------------------

  $effect(() => {
    prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const c = cytoscape({
      container,
      style,
      minZoom: 1e-3,
      maxZoom: 1e3,
      wheelSensitivity: 0.6,
      boxSelectionEnabled: false,
      autounselectify: true,
    });
    cy = c;

    c.on('tap', (e) => {
      if (e.target === c) onSelect(null);
    });
    // Double-click a group to expand it; double-click a child to collapse
    // its parent group.
    c.on('dbltap', 'node', (e) => {
      const id: string = e.target.id();
      const n = byId.get(id);
      if (!n) return;
      // Expansion is a navigation action. Keep the full graph viewport
      // available instead of leaving the single-node detail panel over it.
      onSelect(null);
      if (n.isGroup) onToggleGroup(id);
      else if (n.parent !== undefined) onToggleGroup(n.parent);
    });
    c.on('mouseover', 'node', (e) => {
      e.target.addClass('hover');
      container.style.cursor = 'pointer';
    });
    c.on('mouseout', 'node', (e) => {
      e.target.removeClass('hover');
      container.style.cursor = '';
    });
    c.on('pan zoom resize', updateBandStripes);
    c.on('zoom', () => {
      currentZoom = c.zoom();
    });
    c.on('render', scheduleInfoButtons);

    c.on('grab', 'node', (e) => {
      if (prefersReducedMotion) return;
      cancelSprings();
      buildSprings(e.target);
    });
    c.on('drag', 'node', (e) => {
      const point = constrainedPoint(e.target, e.target.position(), true);
      e.target.position(point);
      pushViolatingDependentsDown();
      movePeersFromDraggedNode(e.target);
      deriveBandsFromVisibleNodes(e.target.id());
      if (!springSystem || !anchorNode || e.target !== anchorNode) return;
      dragPending = true;
      if (dragFrameId === 0) dragFrameId = requestAnimationFrame(runDragFrame);
    });
    c.on('free', 'node', (e) => {
      const point = constrainedPoint(e.target, e.target.position(), true);
      e.target.position(point);
      pushViolatingDependentsDown();
      movePeersFromDraggedNode(e.target);
      deriveBandsFromVisibleNodes(e.target.id());
      const isSpringAnchor = springSystem && anchorNode && e.target === anchorNode;
      if (isSpringAnchor) {
        if (dragFrameId !== 0) cancelAnimationFrame(dragFrameId);
        dragFrameId = 0;
        settleSprings(0.8);
        return;
      }
      const parent = e.target.parent();
      if (parent.nonempty()) {
        resolveCurrentRootCollisions(parent.id());
        saveGroupLayout(parent.id());
      } else {
        resolveCurrentRootCollisions(e.target.id());
      }
      persistVisiblePositions(e.target);
    });

    // Re-run layout after meaningful size changes, including orientation flips.
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const resizeObserver = new ResizeObserver(() => {
      c.resize();
      if (resizeTimer !== undefined) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = undefined;
        const size = containerSize();
        if (size.width === 0 || size.height === 0) return;
        const meaningful =
          Math.abs(size.width - lastLayoutSize.width) > 24 ||
          Math.abs(size.height - lastLayoutSize.height) > 24;
        if (meaningful) runLayout(false);
      }, 250);
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      if (resizeTimer !== undefined) clearTimeout(resizeTimer);
      cancelSprings();
      userStore?.flush();
      if (infoButtonFrame !== 0) cancelAnimationFrame(infoButtonFrame);
      infoButtonFrame = 0;
      infoButtons = [];
      c.destroy();
      cy = undefined;
    };
  });

  // Rebuild the visible graph when data or expansion state changes.
  $effect(() => {
    const vis = computeVisible(graph, expanded);
    const newlyExpanded = [...expanded].filter((id) => !previousExpanded.has(id));
    // A deliberate single-group expansion is a local navigation action.
    // Bulk expansion retains the whole-graph overview instead.
    const focusId = newlyExpanded.length === 1 ? newlyExpanded[0] : undefined;
    previousExpanded = new Set(expanded);
    syncElements(vis, focusId);
    untrack(() => applyHighlight());
  });

  // Re-apply selection highlighting when the selection changes.
  $effect(() => {
    void selectedId;
    applyHighlight();
  });
</script>

<div
  class="viz"
  data-layout-orientation={layoutOrientation}
  data-layout-mode={layoutMode}
  data-compound-group-count={compoundGroupCount}
  data-current-zoom={currentZoom}
  data-focus-anchor-delta-x={focusAnchorDeltaX}
  data-surrounding-position-drift={surroundingPositionDrift}
  data-root-overlap-count={rootOverlapCount}
  data-vertical-order-violation-count={verticalOrderViolationCount}
  data-saved-layout-node-count={savedLayoutNodeCount}
  data-restored-layout-node-count={restoredLayoutNodeCount}
  data-restored-user-position-count={restoredUserPositionCount}
>
  <div class="bands" role="list" aria-label="Knowledge levels">
    {#each bandStripes as stripe (stripe.level.id)}
      <div
        class="band"
        role="listitem"
        data-maturity-level={stripe.level.id}
        aria-label={`${stripe.label}: ${stripe.count} visible nodes`}
        style:top={`${stripe.top}px`}
        style:height={`${stripe.height}px`}
        style:background={`color-mix(in srgb, ${stripe.color} 7%, transparent)`}
      >
        <span class="band-label" style:color={stripe.color}>{stripe.label}</span>
      </div>
    {/each}
  </div>
  <div
    class="graph"
    aria-label={`${graph.metadata.topic} knowledge dependency graph`}
    bind:this={container}
  ></div>
  <div class="node-info-layer">
    {#each infoButtons as button (button.id)}
      <button
        class="node-info"
        type="button"
        aria-label={`More information about ${button.label}`}
        title={`More information about ${button.label}`}
        data-node-center-x={button.nodeCenterX}
        data-node-center-y={button.nodeCenterY}
        data-node-model-x={button.modelX}
        data-node-model-y={button.modelY}
        data-node-model-height={button.modelHeight}
        style:left={`${button.left}px`}
        style:top={`${button.top}px`}
        onclick={(event) => {
          event.stopPropagation();
          onSelect(button.id);
        }}
      >?</button>
    {/each}
  </div>
</div>

<style>
  .viz {
    position: absolute;
    inset: 0;
  }
  .graph {
    position: absolute;
    inset: 0;
  }
  .node-info-layer {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .node-info {
    position: absolute;
    z-index: 2;
    width: 20px;
    height: 20px;
    padding: 0;
    transform: translate(-50%, -50%);
    border: 1px solid rgba(45, 42, 36, 0.34);
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.92);
    color: #514b41;
    font: 700 13px/18px Inter, sans-serif;
    cursor: pointer;
    pointer-events: auto;
    box-shadow: 0 1px 3px rgba(36, 31, 24, 0.16);
  }
  .node-info:hover,
  .node-info:focus-visible {
    border-color: #2f6fc2;
    color: #2f6fc2;
    outline: 2px solid rgba(47, 111, 194, 0.28);
    outline-offset: 1px;
  }
  .bands {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .band {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px solid rgba(0, 0, 0, 0.055);
  }
  .band:first-child {
    border-top: none;
  }
  .band-label {
    position: absolute;
    left: 12px;
    top: 8px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.68;
  }
</style>
