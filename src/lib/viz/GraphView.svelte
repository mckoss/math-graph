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
  import { maturityPaint, orderedMaturityLevels } from './colors';
  import { compactRanksTowardCenterline } from './centerline-layout';
  import {
    assignMaturityBands,
    clampPointToMaturityBand,
    constrainPointAgainstMaturityBandNodes,
    fitMaturityBandsToNodes,
    packMaturityBandNodes,
    placeInMaturityBands,
    separateMaturityBandNodes,
    separateMaturityPeersFromPinned,
    type MaturityBandRect,
  } from './maturity-bands';
  import {
    captureLocalLayout,
    captureParentLocalLayout,
    restoreLocalLayout,
    restoreParentLocalLayout,
    type ParentLocalPosition,
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
  import {
    dependencyRanks,
    feasibleRequestedGroups,
    minimumFeasibleZoom,
    nonContainmentOverlapCount,
  } from './expansion-feasibility';

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
    /** Reports the subset that is currently safe to render at this zoom. */
    onEffectiveExpanded: (ids: ReadonlySet<string>) => void;
  }

  let { graph, expanded, selectedId, onSelect, onToggleGroup, onEffectiveExpanded }: Props = $props();

  let container: HTMLDivElement;
  let cy: cytoscape.Core | undefined;
  // Stored expansions are part of the initial view, not a new focus action.
  let effectiveExpanded = $state<ReadonlySet<string>>(new Set(untrack(() => expanded)));
  let previousExpanded = new Set(untrack(() => expanded));
  let previousRequestedExpanded = new Set(untrack(() => expanded));
  const requiredExpansionZoom = new Map<string, number>();
  let measuringZoom = false;
  let animatingExpansionZoom = false;
  let feasibilityFrame = 0;
  let compoundGroupCount = $state(0);
  let currentZoom = $state(1);
  let focusLocalCoordinateScale = $state(1);
  let focusRequiredZoom = $state(1);
  let focusAnchorDeltaX = $state(0);
  let surroundingPositionDrift = $state(0);
  let rootOverlapCount = $state(0);
  let verticalOrderViolationCount = $state(0);
  let verticalOrderViolationEdges = $state('');
  let historicalOrderMismatchEdgeCount = $state(0);
  let savedLayoutNodeCount = $state(0);
  let restoredLayoutNodeCount = $state(0);
  let restoredUserPositionCount = $state(0);
  const savedGroupLayouts = new Map<string, Map<string, ParentLocalPosition>>();
  interface ExpansionCameraSnapshot {
    zoom: number;
    pan: cytoscape.Position;
    cameraChanged: boolean;
  }
  const expansionSnapshots = new Map<string, ExpansionCameraSnapshot>();
  const canonicalGroupAnchors = new Map<string, cytoscape.Position>();
  const collapsedGroupFootprints = new Map<string, BBox>();
  const layoutBaselines = new Map<string, cytoscape.Position>();
  let userStore: UserStore | undefined;
  let renderDiagnosticsFrame = 0;
  let pendingTapTimer: ReturnType<typeof setTimeout> | undefined;
  let nodeDiagnostics = $state<Array<{
    id: string;
    label: string;
    centerX: number;
    centerY: number;
    width: number;
    height: number;
    modelX: number;
    modelY: number;
    actualModelX: number;
    actualModelY: number;
    modelHeight: number;
  }>>([]);

  const FIT_PADDING = 36;
  // Give the eye enough time to follow a re-layout. Cytoscape applies the
  // cubic curve to every node and the viewport together, so motion starts and
  // settles gently instead of reading as an instantaneous redraw.
  const LAYOUT_MS = 900;
  const DEPENDENCY_GAP = 12;
  const MAX_PERSISTED_OFFSET = 10_000;

  /**
   * Below 100%, Cytoscape's camera scales blocks normally. Above 100%, shrink
   * their model-space styling by the reciprocal zoom so rendered boxes and
   * typography remain at their nominal on-screen size while centers spread.
   */
  function applyZoomRenderScale(c: cytoscape.Core): void {
    const inverseZoom = 1 / Math.max(c.zoom(), 1);
    c.batch(() => {
      c.nodes().forEach((node) => {
        const isGroup = node.data('kind') === 'group';
        const isExpanded = isGroup && node.data('expanded') === 1;
        const padding = isExpanded ? 30 : isGroup ? 20 : 14;
        const fontSize = isGroup ? 17 : 15;
        const textMaxWidth = isGroup ? 210 : 170;
        // Interaction emphasis must not change a block's measured geometry:
        // doing so can invalidate an already accepted prerequisite clearance.
        // Hover and selection use overlays below, which do not affect layout.
        const borderWidth = isGroup ? 2.5 : 1.5;
        node.style({
          padding: padding * inverseZoom,
          'font-size': fontSize * inverseZoom,
          'text-max-width': textMaxWidth * inverseZoom,
          'border-width': borderWidth * inverseZoom,
          'text-margin-y': (isExpanded ? 16 : 0) * inverseZoom,
          'overlay-padding': 8 * inverseZoom,
        });
      });
    });
    scheduleRenderDiagnostics();
  }

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
  // ---- Public controls (used by App via bind:this) -------------------------

  export function fit(): void {
    const c = cy;
    if (!c || layoutBounds === undefined) return;
    const positions = new Map<string, cytoscape.Position>();
    c.nodes().forEach((node) => {
      positions.set(node.id(), { ...node.position() });
    });
    expansionSnapshots.forEach((snapshot) => {
      snapshot.cameraChanged = true;
    });
    animateViewport(c, targetBBox(c, positions), containerSize(), true);
  }

  export function zoomBy(factor: number): void {
    if (!cy) return;
    expansionSnapshots.forEach((snapshot) => {
      snapshot.cameraChanged = true;
    });
    cy.stop();
    const level = cy.zoom() * factor;
    cy.animate(
      { zoom: { level, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } } },
      { duration: 180, easing: 'ease-out' },
    );
  }

  export function layoutNow(): void {
    const c = cy;
    if (!c) return;
    const store = currentUserStore();
    store.setExpanded(
      expanded,
      new Set(graph.nodes.filter((node) => node.isGroup).map((node) => node.id)),
    );
    store.clearOffsets();
    store.flush();
    layoutBaselines.clear();
    savedGroupLayouts.clear();
    savedLayoutNodeCount = 0;
    restoredLayoutNodeCount = 0;
    restoredUserPositionCount = 0;
    // Dagre uses Cytoscape's element iteration order as a tie-breaker. An
    // incrementally expanded graph has a different insertion history than the
    // same visible graph after refresh, so rebuild it in canonical data order
    // before an explicit reset. Preserve every current position across that
    // synchronous rebuild so the subsequent preset layout visibly animates
    // blocks from where the user last saw them instead of redrawing at zero.
    const visible = computeVisible(graph, effectiveExpanded);
    const currentPositions = new Map<string, cytoscape.Position>();
    c.nodes().not(':parent').forEach((node) => {
      currentPositions.set(node.id(), { ...node.position() });
    });
    const orderedNodes = [...visible.nodes].sort(
      (a, b) => ancestorsOf(byId, a.id).length - ancestorsOf(byId, b.id).length,
    );
    c.batch(() => {
      c.elements().remove();
      for (const node of orderedNodes) {
        c.add({
          group: 'nodes',
          data: nodeData(node),
          position: currentPositions.get(node.id) ?? { x: 0, y: 0 },
        });
      }
      for (const edge of visible.edges) {
        c.add({
          group: 'edges',
          data: {
            id: `e\0${edge.from}\0${edge.to}`,
            source: edge.from,
            target: edge.to,
            historicalOrderMismatch: edge.historicalOrderMismatch ? 1 : 0,
          },
        });
      }
    });
    c.nodes(':parent').ungrabify();
    c.nodes().not(':parent').grabify();
    compoundGroupCount = c.nodes(':parent').length;
    runLayout(false);
  }

  export function persistExpanded(
    expandedIds: Iterable<string>,
    knownGroupIds: ReadonlySet<string>,
  ): void {
    currentUserStore().setExpanded(expandedIds, knownGroupIds);
    currentUserStore().flush();
  }

  // ---- Element construction ------------------------------------------------

  function nodeData(n: GraphNode): Record<string, unknown> {
    const parent = n.parent !== undefined && effectiveExpanded.has(n.parent) ? n.parent : undefined;
    if (n.isGroup) {
      const paint = maturityPaint(maturityLevels, n.maturityLevel);
      const count = conceptCountOf(children, n.id);
      return {
        id: n.id,
        ...(parent === undefined ? {} : { parent }),
        kind: 'group',
        expanded: effectiveExpanded.has(n.id) ? 1 : 0,
        label: `${n.label}\n${effectiveExpanded.has(n.id) ? '⊟' : '⊞'} ${count} concept${count === 1 ? '' : 's'}`,
        fill: paint.tint,
        border: paint.color,
        text: paint.color,
      };
    }
    const paint = maturityPaint(maturityLevels, n.maturityLevel);
    return {
      id: n.id,
      ...(parent === undefined ? {} : { parent }),
      kind: 'concept',
      label: n.label,
      fill: paint.tint,
      border: paint.color,
      text: '#33302a',
    };
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
    const canonicalAnchor = canonicalGroupAnchors.get(n.id);
    if (canonicalAnchor !== undefined) return { ...canonicalAnchor };
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

  function syncElements(
    vis: VisibleGraph,
    focusId?: string,
    collapsedId?: string,
  ): void {
    const c = cy;
    if (!c) return;
    if (focusId !== undefined && !expansionSnapshots.has(focusId)) {
      const focusNode = c.getElementById(focusId);
      canonicalGroupAnchors.set(focusId, { ...focusNode.position() });
      const collapsedBox = focusNode.boundingBox({ includeLabels: true, includeOverlays: false });
      collapsedGroupFootprints.set(focusId, {
        x1: collapsedBox.x1,
        y1: collapsedBox.y1,
        x2: collapsedBox.x2,
        y2: collapsedBox.y2,
      });
      expansionSnapshots.set(focusId, {
        zoom: c.zoom(),
        pan: { ...c.pan() },
        cameraChanged: false,
      });
    }
    const collapseSnapshot = collapsedId === undefined
      ? undefined
      : expansionSnapshots.get(collapsedId);
    c.nodes(':parent')
      .filter((node) => !effectiveExpanded.has(node.id()))
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

      const fallback = oldPos.size === 0
        ? { x: 0, y: 0 }
        : { x: (c.extent().x1 + c.extent().x2) / 2, y: (c.extent().y1 + c.extent().y2) / 2 };
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
        const existing = c.getElementById(id);
        if (existing.empty()) {
          c.add({
            group: 'edges',
            data: {
              id,
              source: e.from,
              target: e.to,
              historicalOrderMismatch: e.historicalOrderMismatch ? 1 : 0,
            },
          });
        } else {
          existing.data(
            'historicalOrderMismatch',
            e.historicalOrderMismatch ? 1 : 0,
          );
        }
      }
    });

    c.nodes(':parent').ungrabify();
    c.nodes().not(':parent').grabify();
    compoundGroupCount = c.nodes(':parent').length;
    historicalOrderMismatchEdgeCount = c.edges(
      '[historicalOrderMismatch = 1]',
    ).length;
    rootOverlapCount = countRootUnitOverlaps(c);
    applyZoomRenderScale(c);

    runLayout(
      oldPos.size === 0,
      focusId,
      focusId === undefined ? undefined : oldPos.get(focusId),
      oldPos,
      collapseSnapshot,
      collapsedId,
    );
    if (collapsedId !== undefined) {
      expansionSnapshots.delete(collapsedId);
    }
    scheduleRenderDiagnostics();
  }

  function updateRenderDiagnostics(): void {
    renderDiagnosticsFrame = 0;
    const c = cy;
    if (!c) return;
    compoundGroupCount = c.nodes(':parent').length;
    rootOverlapCount = renderedBlockOverlapCount(c);
    const positions = currentLeafPositions(c);
    const edges = currentVisibleEdges(c);
    const separation = verticalSeparation(c);
    const violations = edges.filter((edge) => {
      const prerequisite = positions.get(edge.from);
      const dependent = positions.get(edge.to);
      return prerequisite !== undefined && dependent !== undefined &&
        dependent.y + 0.01 < prerequisite.y + separation(edge);
    });
    verticalOrderViolationCount = violations.length;
    verticalOrderViolationEdges = violations.map((edge) => `${edge.from}->${edge.to}`).join(',');
    nodeDiagnostics = c.nodes().map((node) => {
      const box = node.renderedBoundingBox({ includeLabels: false, includeOverlays: false });
      // Expanded compound positions are derived Cytoscape presentation bounds;
      // the pre-expansion anchor is the authoritative parent-local model
      // coordinate and avoids leaking sub-ulp renderer rounding into state.
      const authoritativePoint = canonicalGroupAnchors.get(node.id());
      return {
        id: node.id(),
        label: String(node.data('label')).split('\n')[0],
        centerX: (box.x1 + box.x2) / 2,
        centerY: (box.y1 + box.y2) / 2,
        width: box.w,
        height: box.h,
        modelX: authoritativePoint?.x ?? node.position().x,
        modelY: authoritativePoint?.y ?? node.position().y,
        actualModelX: node.position().x,
        actualModelY: node.position().y,
        modelHeight: node.outerHeight(),
      };
    });
  }

  function scheduleRenderDiagnostics(): void {
    if (renderDiagnosticsFrame !== 0) return;
    renderDiagnosticsFrame = requestAnimationFrame(updateRenderDiagnostics);
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
    modelTop: number;
    modelHeight: number;
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
        modelTop: rect.y1,
        modelHeight: rect.y2 - rect.y1,
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

  function renderedBlockOverlapCount(c: cytoscape.Core, gap = 18): number {
    return nonContainmentOverlapCount(
      c.nodes().map((node: cytoscape.NodeSingular) => {
        const box = node.renderedBoundingBox({ includeLabels: true, includeOverlays: false });
        const parent = node.parent();
        return {
          id: node.id(),
          ...(parent.empty() ? {} : { parentId: parent[0].id() }),
          x1: box.x1,
          y1: box.y1,
          x2: box.x2,
          y2: box.y2,
        };
      }),
      gap,
    );
  }

  /** Measure the real Cytoscape compound geometry without presenting a frame. */
  function isFeasibleAtZoom(c: cytoscape.Core, zoom: number): boolean {
    const originalZoom = c.zoom();
    const originalPan = { ...c.pan() };
    const originalMaximumZoom = c.maxZoom();
    measuringZoom = true;
    c.maxZoom(Math.max(originalMaximumZoom, zoom));
    c.zoom(zoom);
    applyZoomRenderScale(c);
    const feasible = renderedBlockOverlapCount(c) === 0 &&
      countVerticalDependencyOrderViolations(
        currentLeafPositions(c),
        currentVisibleEdges(c),
        verticalSeparation(c),
      ) === 0;
    c.viewport({ zoom: originalZoom, pan: originalPan });
    c.maxZoom(originalMaximumZoom);
    applyZoomRenderScale(c);
    measuringZoom = false;
    return feasible;
  }

  function requiredZoomForCurrentGeometry(c: cytoscape.Core): number | null {
    return minimumFeasibleZoom(
      (zoom) => isFeasibleAtZoom(c, zoom),
      { startZoom: c.zoom(), maximumZoom: Math.max(64, c.zoom()) },
    );
  }

  function reconcileEffectiveExpansions(): void {
    const c = cy;
    if (!c || measuringZoom || animatingExpansionZoom) return;
    const parents = new Map(
      graph.nodes
        .filter((node) => node.isGroup)
        .map((node) => [node.id, node.parent] as const),
    );
    const next = feasibleRequestedGroups(
      new Set(expanded),
      effectiveExpanded,
      requiredExpansionZoom,
      c.zoom(),
      parents,
    );
    if (
      next.size === effectiveExpanded.size &&
      [...next].every((id) => effectiveExpanded.has(id))
    ) return;
    effectiveExpanded = next;
    onEffectiveExpanded(new Set(next));
  }

  function scheduleFeasibilityReconcile(): void {
    if (feasibilityFrame !== 0) return;
    feasibilityFrame = requestAnimationFrame(() => {
      feasibilityFrame = 0;
      reconcileEffectiveExpansions();
    });
  }

  function animateToRequiredZoom(
    c: cytoscape.Core,
    requiredZoom: number,
    anchor: cytoscape.Position,
    targetBox: BBox,
  ): void {
    if (requiredZoom <= c.zoom() + 1e-4) return;
    const renderedAnchor = {
      x: anchor.x * c.zoom() + c.pan().x,
      y: anchor.y * c.zoom() + c.pan().y,
    };
    const pan = {
      x: renderedAnchor.x - anchor.x * requiredZoom,
      y: renderedAnchor.y - anchor.y * requiredZoom,
    };
    const renderedWidth = (targetBox.x2 - targetBox.x1) * requiredZoom;
    const renderedHeight = (targetBox.y2 - targetBox.y1) * requiredZoom;
    if (renderedWidth <= c.width() - 2 * FIT_PADDING) {
      pan.x = Math.max(
        FIT_PADDING - targetBox.x1 * requiredZoom,
        Math.min(pan.x, c.width() - FIT_PADDING - targetBox.x2 * requiredZoom),
      );
    }
    if (renderedHeight <= c.height() - 2 * FIT_PADDING) {
      pan.y = Math.max(
        FIT_PADDING - targetBox.y1 * requiredZoom,
        Math.min(pan.y, c.height() - FIT_PADDING - targetBox.y2 * requiredZoom),
      );
    }
    c.maxZoom(Math.max(c.maxZoom(), requiredZoom * 1.25));
    animatingExpansionZoom = true;
    c.animate(
      { zoom: requiredZoom, pan },
      {
        duration: LAYOUT_MS,
        easing: 'ease-in-out-cubic',
        complete: () => {
          animatingExpansionZoom = false;
          reconcileEffectiveExpansions();
        },
      },
    );
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
    // Cytoscape derives a compound's presentation center from child and label
    // bounds. It is never an authoritative coordinate and must not leak into
    // the one canonical parent-local child layout.
    const anchor = canonicalGroupAnchors.get(groupId) ?? group.position();
    const saved = captureParentLocalLayout(anchor, focusedNodeBoxes(group));
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
    scheduleRenderDiagnostics();
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

  /** Restore an expanded compound's exact pre-expansion center. */
  function anchorFocusedGroup(
    focusNode: cytoscape.NodeSingular,
    anchor: cytoscape.Position,
    targets: Map<string, cytoscape.Position>,
  ): void {
    const descendants = focusNode.descendants().not(':parent');
    descendants.positions((node) => targets.get(node.id()) ?? node.position());
    // Compound centers are derived presentation output. Iterate the inverse
    // translation down to exact floating-point equality so the authoritative
    // parent anchor never changes through visibility/camera operations.
    for (let pass = 0; pass < 4; pass++) {
      focusNode.cy().forceRender();
      focusNode.boundingBox({ includeLabels: true, includeOverlays: false });
      const dx = anchor.x - focusNode.position().x;
      const dy = anchor.y - focusNode.position().y;
      if (dx === 0 && dy === 0) return;
      descendants.forEach((leaf: cytoscape.NodeSingular) => {
        const point = targets.get(leaf.id()) ?? leaf.position();
        const anchored = { x: point.x + dx, y: point.y + dy };
        leaf.position(anchored);
        targets.set(leaf.id(), anchored);
      });
    }
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
    scheduleRenderDiagnostics();
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

  /** Recursive TB layout for direct child units, centered in parent coordinates. */
  function packFocusedDescendants(
    focusNode: cytoscape.NodeSingular,
    anchor: cytoscape.Position,
    targets: Map<string, cytoscape.Position>,
  ): void {
    const directChildren = focusNode.children().toArray() as cytoscape.NodeSingular[];
    if (directChildren.length === 0) return;

    // Layout nested scopes first so each subgroup is a measured rigid unit in
    // its parent's layout rather than flattening nested descendants.
    for (const child of directChildren) {
      if (child.isParent()) packFocusedDescendants(child, child.position(), targets);
    }

    const unitByDescendant = new Map<string, string>();
    for (const unit of directChildren) {
      unitByDescendant.set(unit.id(), unit.id());
      unit.descendants().forEach((node) => {
        unitByDescendant.set(node.id(), unit.id());
      });
    }
    const unitEdges = currentVisibleEdges(focusNode.cy()).flatMap((edge) => {
      const from = unitByDescendant.get(edge.from);
      const to = unitByDescendant.get(edge.to);
      return from === undefined || to === undefined || from === to ? [] : [{ from, to }];
    });
    const ranks = dependencyRanks(directChildren.map((node) => node.id()), unitEdges);
    const byRank = new Map<number, cytoscape.NodeSingular[]>();
    for (const unit of directChildren) {
      const rank = ranks.get(unit.id()) ?? 0;
      const members = byRank.get(rank) ?? [];
      members.push(unit);
      byRank.set(rank, members);
    }

    // Barycentric ordering is Dagre's essential crossing-reduction step. Use
    // the current stable x order as the deterministic tie-breaker.
    const orderedRanks = [...byRank.entries()].sort(([a], [b]) => a - b);
    const previousOrder = new Map<string, number>();
    for (const [, members] of orderedRanks) {
      members.sort((a, b) => a.position().x - b.position().x || a.id().localeCompare(b.id()));
      members.sort((a, b) => {
        const barycenter = (id: string): number => {
          const predecessors = unitEdges
            .filter((edge) => edge.to === id)
            .flatMap((edge) => previousOrder.get(edge.from) ?? []);
          return predecessors.length === 0
            ? Number.POSITIVE_INFINITY
            : predecessors.reduce((sum, value) => sum + value, 0) / predecessors.length;
        };
        return barycenter(a.id()) - barycenter(b.id()) || a.id().localeCompare(b.id());
      });
      members.forEach((member, index) => previousOrder.set(member.id(), index));
    }

    const gap = 14;
    const rankGap = 28;
    const layouts = orderedRanks.map(([rank, members]) => {
      const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(members.length))));
      const rows = Math.ceil(members.length / columns);
      const cellWidth = Math.max(...members.map((node) => node.outerWidth())) + gap;
      const cellHeight = Math.max(...members.map((node) => node.outerHeight())) + gap;
      return { rank, members, columns, rows, cellWidth, cellHeight, height: rows * cellHeight - gap };
    });
    const totalHeight = layouts.reduce((sum, rank) => sum + rank.height, 0) +
      Math.max(0, layouts.length - 1) * rankGap;
    let rankTop = anchor.y - totalHeight / 2;

    const moveUnit = (unit: cytoscape.NodeSingular, point: cytoscape.Position): void => {
      const leaves = unit.isParent() ? unit.descendants().not(':parent') : unit;
      const dx = point.x - unit.position().x;
      const dy = point.y - unit.position().y;
      leaves.forEach((leaf: cytoscape.NodeSingular) => {
        const current = targets.get(leaf.id()) ?? leaf.position();
        const moved = { x: current.x + dx, y: current.y + dy };
        targets.set(leaf.id(), moved);
        leaf.position(moved);
      });
    };
    for (const rank of layouts) {
      for (let row = 0; row < rank.rows; row++) {
        const members = rank.members.slice(row * rank.columns, (row + 1) * rank.columns);
        const rowWidth = members.length * rank.cellWidth - gap;
        const firstX = anchor.x - rowWidth / 2 + (rank.cellWidth - gap) / 2;
        members.forEach((unit, column) => moveUnit(unit, {
          x: firstX + column * rank.cellWidth,
          y: rankTop + row * rank.cellHeight + (rank.cellHeight - gap) / 2,
        }));
      }
      rankTop += rank.height + rankGap;
    }
  }

  /**
   * Express a recursive child layout in the collapsed group's local coordinate
   * system. The uniform factor is derived from the actual collapsed footprint,
   * never a fixed compression constant. At higher camera zoom the centers
   * spread while nominal-size boxes remain readable.
   */
  function fitFocusedCentersToSafeNeighborhood(
    focusNode: cytoscape.NodeSingular,
    anchor: cytoscape.Position,
    targets: Map<string, cytoscape.Position>,
    collapsedBounds: BBox | undefined,
  ): number {
    if (collapsedBounds === undefined) return 1;
    const descendants = focusNode.descendants().not(':parent');
    if (descendants.length < 2) return 1;
    const points = descendants.map((node: cytoscape.NodeSingular) =>
      targets.get(node.id()) ?? node.position(),
    );
    const spanX = Math.max(...points.map((point) => point.x)) -
      Math.min(...points.map((point) => point.x));
    const spanY = Math.max(...points.map((point) => point.y)) -
      Math.min(...points.map((point) => point.y));
    const availableWidth = Math.max(0, collapsedBounds.x2 - collapsedBounds.x1);
    const availableHeight = Math.max(0, collapsedBounds.y2 - collapsedBounds.y1);
    const collapsedScale = Math.min(
      1,
      spanX <= 1e-6 ? 1 : availableWidth / spanX,
      spanY <= 1e-6 ? 1 : availableHeight / spanY,
    );
    const baseOffsets = new Map(descendants.map((node: cytoscape.NodeSingular) => {
      const point = targets.get(node.id()) ?? node.position();
      return [node.id(), { x: point.x - anchor.x, y: point.y - anchor.y }] as const;
    }));
    const applyScale = (scale: number): void => {
      descendants.forEach((node: cytoscape.NodeSingular) => {
        const offset = baseOffsets.get(node.id())!;
        const fitted = {
          x: anchor.x + offset.x * scale,
          y: anchor.y + offset.y * scale,
        };
        targets.set(node.id(), fitted);
        node.position(fitted);
      });
      anchorFocusedGroup(focusNode, anchor, targets);
    };

    // Search the real fixed neighborhood rather than assuming the collapsed
    // box is the only available space. Required zoom generally falls as local
    // scale grows, until descendants approach an exterior center. Choose the
    // lowest collision-free camera threshold, preferring the largest uniform
    // transform when thresholds are effectively equal.
    let bestScale = collapsedScale;
    let bestZoom = Number.POSITIVE_INFINITY;
    let bestPositions = new Map<string, cytoscape.Position>();
    const evaluate = (scale: number): void => {
      applyScale(scale);
      const zoom = requiredZoomForCurrentGeometry(focusNode.cy());
      if (zoom === null) return;
      if (zoom < bestZoom - 1e-3 || (Math.abs(zoom - bestZoom) <= 1e-3 && scale > bestScale)) {
        bestScale = scale;
        bestZoom = zoom;
        bestPositions = new Map(
          descendants.map((node: cytoscape.NodeSingular) => [
            node.id(),
            { ...(targets.get(node.id()) ?? node.position()) },
          ]),
        );
      }
    };
    const steps = 16;
    for (let index = 0; index <= steps; index++) {
      evaluate(collapsedScale + (1 - collapsedScale) * index / steps);
    }
    if (bestPositions.size === 0) {
      applyScale(collapsedScale);
      bestScale = collapsedScale;
    } else {
      bestPositions.forEach((point, id) => {
        targets.set(id, point);
        focusNode.cy().getElementById(id).position(point);
      });
      anchorFocusedGroup(focusNode, anchor, targets);
    }
    focusLocalCoordinateScale = bestScale;
    focusRequiredZoom = Number.isFinite(bestZoom) ? bestZoom : focusNode.cy().zoom();
    return bestScale;
  }

  /** Fit a model bbox and derive usable zoom limits from that fitted scale. */
  function animateViewport(
    c: cytoscape.Core,
    bbox: BBox,
    size: Size,
    animated: boolean,
    minimumZoom = 0,
    zoomExtent: BBox = bbox,
    maximumZoom = Number.POSITIVE_INFINITY,
  ): void {
    const viewport = viewportFor(bbox, size, FIT_PADDING);
    if (viewport.zoom < minimumZoom) {
      viewport.zoom = minimumZoom;
      viewport.pan = {
        x: size.width / 2 - minimumZoom * (bbox.x1 + bbox.x2) / 2,
        y: FIT_PADDING - minimumZoom * bbox.y1,
      };
    }
    if (viewport.zoom > maximumZoom) {
      viewport.zoom = maximumZoom;
      viewport.pan = {
        x: size.width / 2 - maximumZoom * (bbox.x1 + bbox.x2) / 2,
        y: size.height / 2 - maximumZoom * (bbox.y1 + bbox.y2) / 2,
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
    collapseSnapshot?: ExpansionCameraSnapshot,
    collapsedId?: string,
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
    const styledFocusNode = focusId === undefined ? undefined : c.getElementById(focusId);

    // Closing a group is the inverse of opening it, not a request for a new
    // global Dagre layout. Restore the exact pre-expansion geometry unless the
    // user deliberately rearranged the graph while the group was open.
    if (!first && collapseSnapshot !== undefined) {
      const targets = new Map<string, cytoscape.Position>();
      layoutNodes.forEach((node) => {
        targets.set(node.id(), node.position());
      });
      if (collapsedId !== undefined) {
        const anchor = canonicalGroupAnchors.get(collapsedId);
        if (anchor !== undefined) {
          targets.set(collapsedId, anchor);
          c.getElementById(collapsedId).position(anchor);
        }
      }
      bandModelRects = bandModelRects.map((band) => ({
        ...band,
        count: layoutNodes.filter(
          (node) => (bandAssignments.get(node.id()) ?? 0) === band.band,
        ).length,
      }));
      layoutBounds = targetBBox(c, targets);
      layoutNodes.positions((node) => targets.get(node.id()) ?? node.position());
      scheduleRenderDiagnostics();
      layoutNodes.grabify();
      if (!collapseSnapshot.cameraChanged) {
        const wholeGraphFit = viewportFor(layoutBounds, size, FIT_PADDING).zoom;
        const bounds = zoomBoundsFor(wholeGraphFit);
        c.minZoom(Math.min(bounds.min, c.zoom(), collapseSnapshot.zoom));
        c.maxZoom(Math.max(bounds.max, c.zoom(), collapseSnapshot.zoom));
        c.animate(
          { zoom: collapseSnapshot.zoom, pan: collapseSnapshot.pan },
          {
            duration: LAYOUT_MS,
            easing: 'ease-in-out-cubic',
            complete: () => {
              c.viewport({ zoom: collapseSnapshot.zoom, pan: collapseSnapshot.pan });
              c.minZoom(bounds.min);
              c.maxZoom(bounds.max);
            },
          },
        );
      }
      return;
    }

    // Opening one group is a local reveal. Existing graph blocks keep their
    // exact model positions; only newly revealed descendants receive local
    // positions inside the anchored containing group.
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
      const saved = savedGroupLayouts.get(styledFocusNode.id());
      const restored = saved === undefined
        ? new Map<string, cytoscape.Position>()
        : restoreParentLocalLayout(focusAnchor, saved);
      restoredLayoutNodeCount = restored.size;
      if (restored.size > 0) {
        restored.forEach((point, id) => targets.set(id, point));
      } else {
        packFocusedDescendants(styledFocusNode, focusAnchor, targets);
        fitFocusedCentersToSafeNeighborhood(
          styledFocusNode,
          focusAnchor,
          targets,
          collapsedGroupFootprints.get(styledFocusNode.id()),
        );
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
      if (saved === undefined) anchorFocusedGroup(styledFocusNode, focusAnchor, targets);
      rootOverlapCount = countRootUnitOverlaps(c);
      bandModelRects = bandModelRects.map((rect) => ({
        ...rect,
        count: layoutNodes.filter(
          (node) => (bandAssignments.get(node.id()) ?? 0) === rect.band,
        ).length,
      }));
      layoutBounds = targetBBox(c, targets);
      focusAnchorDeltaX = Math.hypot(
        styledFocusNode.position().x - focusAnchor.x,
        styledFocusNode.position().y - focusAnchor.y,
      );
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
      const measuredRequiredZoom = requiredZoomForCurrentGeometry(c);
      // Zoom feasibility probes temporarily restyle compound nodes. Cytoscape
      // may round the compound's derived bounds while doing so, so restore the
      // exact pre-expansion center once more before committing animation
      // targets. No exterior target is changed by this correction.
      if (saved === undefined) anchorFocusedGroup(styledFocusNode, focusAnchor, targets);
      layoutBounds = targetBBox(c, targets);
      focusAnchorDeltaX = Math.hypot(
        styledFocusNode.position().x - focusAnchor.x,
        styledFocusNode.position().y - focusAnchor.y,
      );
      const requiredZoom = measuredRequiredZoom === null
        ? Number.POSITIVE_INFINITY
        : measuredRequiredZoom <= c.zoom() + 1e-4
          ? measuredRequiredZoom
          : measuredRequiredZoom * 1.002;
      requiredExpansionZoom.set(styledFocusNode.id(), requiredZoom);
      const focusTargetBox = styledFocusNode.boundingBox({
        includeLabels: true,
        includeOverlays: false,
      });

      // Visibility changes are atomic. Children are revealed directly at their
      // one canonical parent-local positions; only the camera animates.
      layoutNodes.positions((node) => targets.get(node.id()) ?? node.position());
      layoutNodes.grabify();
      // Expansion changes no exterior model center. Increase global zoom only
      // when nominal-size blocks need more rendered separation; an impossible
      // expansion is suppressed while its requested intent remains stored.
      if (Number.isFinite(requiredZoom)) {
        animateToRequiredZoom(
          c,
          requiredZoom,
          focusAnchor,
          focusTargetBox,
        );
      } else {
        scheduleFeasibilityReconcile();
      }
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
      packFocusedDescendants(styledFocusNode, focusAnchor, targets);
      fitFocusedCentersToSafeNeighborhood(
        styledFocusNode,
        focusAnchor,
        targets,
        collapsedGroupFootprints.get(styledFocusNode.id()),
      );
    }
    restoreUserPositions(layoutNodes, targets);
    layoutNodes.positions((node) => targets.get(node.id()) ?? node.position());
    const focusNode = focusId === undefined ? undefined : c.getElementById(focusId);
    if (focusNode?.nonempty() && focusAnchor !== undefined && focusNode.isParent()) {
      anchorFocusedGroup(focusNode, focusAnchor, targets);
    }
    enforceVerticalOrderForTargets(layoutNodes, targets);
    if (focusNode?.nonempty() && focusAnchor !== undefined && focusNode.isParent()) {
      anchorFocusedGroup(focusNode, focusAnchor, targets);
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
      animateViewport(
        c,
        viewportBounds,
        size,
        false,
        focusBox ? 0 : 0.75,
        layoutBounds,
        focusBox ? c.zoom() : Number.POSITIVE_INFINITY,
      );
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
    animateViewport(
      c,
      viewportBounds,
      size,
      true,
      focusBox ? 0 : 0.75,
      layoutBounds,
      focusBox ? c.zoom() : Number.POSITIVE_INFINITY,
    );
  }

  // ---- Drag springs --------------------------------------------------------

  let springSystem: SpringSystem | undefined;
  let springNodes: cytoscape.NodeSingular[] = [];
  let springUpstreamIds = new Set<string>();
  let anchorNode: cytoscape.NodeSingular | undefined;
  let dragFrameId = 0;
  let settleFrameId = 0;
  let dragPending = false;
  let grabbedNodeId: string | undefined;
  let grabbedStart: cytoscape.Position | undefined;
  let grabbedNodeMoved = false;
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
    if (!c || !system || !anchorNode) return;
    const anchorBand = bandAssignments.get(anchorNode.id()) ?? 0;
    c.batch(() => {
      for (let i = 1; i < springNodes.length; i++) {
        const springNode = springNodes[i];
        // Maturity zones have independent, content-derived vertical geometry.
        // A spring response must not resize an adjacent zone by pulling one of
        // its blocks while the directly manipulated block remains pinned.
        if (
          springUpstreamIds.has(springNode.id()) ||
          (bandAssignments.get(springNode.id()) ?? 0) !== anchorBand
        ) {
          system.x[i] = springNode.position().x;
          system.y[i] = springNode.position().y;
          continue;
        }
        const point = constrainedPoint(springNode, { x: system.x[i], y: system.y[i] });
        system.x[i] = point.x;
        system.y[i] = point.y;
        springNode.position(point);
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
      const repId = selectedId === null ? null : representativeOf(byId, effectiveExpanded, selectedId);
      if (repId === null) return;
      const node = c.getElementById(repId);
      if (node.empty()) return;
      node.addClass('picked');
    });
    applyZoomRenderScale(c);
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
        // Compound geometry belongs to its descendants. Including a long,
        // wrapped title here makes Cytoscape recompute and shift the compound
        // bounds as inverse-zoom font metrics round between animation frames.
        'compound-sizing-wrt-labels': 'exclude',
        'text-max-width': '210',
        'line-height': 1.25,
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
    {
      selector: 'edge[historicalOrderMismatch = 1]',
      style: {
        'line-style': 'dashed',
        'line-dash-pattern': [8, 6],
      } as never,
    },
    {
      selector: 'node.hover',
      style: {
        'overlay-color': 'data(border)',
        'overlay-opacity': 0.08,
        'overlay-padding': 6,
        'overlay-shape': 'round-rectangle',
      } as never,
    },
    {
      selector: 'node.picked',
      style: {
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

    const nodeAtRenderedPoint = (x: number, y: number): cytoscape.NodeSingular | undefined =>
      c.nodes()
        .filter((node) => {
          const box = node.renderedBoundingBox({ includeLabels: true, includeOverlays: false });
          return x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2;
        })
        .sort((left, right) => {
          const depth = ancestorsOf(byId, right.id()).length - ancestorsOf(byId, left.id()).length;
          if (depth !== 0) return depth;
          const leftBox = left.renderedBoundingBox({ includeLabels: true, includeOverlays: false });
          const rightBox = right.renderedBoundingBox({ includeLabels: true, includeOverlays: false });
          return leftBox.w * leftBox.h - rightBox.w * rightBox.h;
        })[0];

    const toggleTappedGroup = (id: string): void => {
      const n = byId.get(id);
      if (!n) return;
      onSelect(id);
      if (n.isGroup) onToggleGroup(id);
      else if (n.parent !== undefined) onToggleGroup(n.parent);
    };
    let lastTapTargetId: string | undefined;
    const handleTap = (event: cytoscape.EventObject): void => {
      const eventNode = event.target === c || event.target.isNode?.() !== true
        ? undefined
        : event.target as cytoscape.NodeSingular;
      lastTapTargetId = eventNode?.id();
      const hit = eventNode !== undefined && !eventNode.isParent()
        ? eventNode
        : nodeAtRenderedPoint(event.renderedPosition.x, event.renderedPosition.y);
      if (hit === undefined) return;
      const id = hit.id();
      if (pendingTapTimer !== undefined) clearTimeout(pendingTapTimer);
      pendingTapTimer = setTimeout(() => {
        pendingTapTimer = undefined;
        onSelect(id);
      }, 240);
    };
    c.on('tap', handleTap);
    const handleDoubleClick = (event: MouseEvent): void => {
      if (pendingTapTimer !== undefined) clearTimeout(pendingTapTimer);
      pendingTapTimer = undefined;
      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const tapped = lastTapTargetId === undefined
        ? undefined
        : c.getElementById(lastTapTargetId);
      const hit = tapped?.nonempty() && tapped.isNode()
        ? tapped
        : nodeAtRenderedPoint(x, y);
      lastTapTargetId = undefined;
      if (hit !== undefined) toggleTappedGroup(hit.id());
    };
    container.addEventListener('dblclick', handleDoubleClick, true);
    c.on('mouseover', 'node', (e) => {
      e.target.addClass('hover');
      applyZoomRenderScale(c);
      container.style.cursor = 'pointer';
    });
    c.on('mouseout', 'node', (e) => {
      e.target.removeClass('hover');
      applyZoomRenderScale(c);
      container.style.cursor = '';
    });
    c.on('pan zoom resize', updateBandStripes);
    c.on('pan zoom', (event) => {
      if (!animatingExpansionZoom && !measuringZoom && event.originalEvent !== undefined) {
        expansionSnapshots.forEach((snapshot) => {
          snapshot.cameraChanged = true;
        });
      }
    });
    c.on('zoom', () => {
      if (measuringZoom) return;
      currentZoom = c.zoom();
      applyZoomRenderScale(c);
      scheduleFeasibilityReconcile();
    });
    c.on('render', scheduleRenderDiagnostics);

    c.on('grab', 'node', (e) => {
      grabbedNodeId = e.target.id();
      grabbedStart = { ...e.target.position() };
      grabbedNodeMoved = false;
      if (prefersReducedMotion) return;
      cancelSprings();
      buildSprings(e.target);
    });
    c.on('drag', 'node', (e) => {
      if (grabbedNodeId !== e.target.id() || grabbedStart === undefined) return;
      const draggedDistance = Math.hypot(
        e.target.position().x - grabbedStart.x,
        e.target.position().y - grabbedStart.y,
      );
      if (!grabbedNodeMoved && draggedDistance < 0.75) return;
      grabbedNodeMoved = true;
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
      const wasDragged = grabbedNodeId === e.target.id() && grabbedNodeMoved;
      grabbedNodeId = undefined;
      grabbedStart = undefined;
      grabbedNodeMoved = false;
      if (!wasDragged) {
        cancelSprings();
        return;
      }
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
      container.removeEventListener('dblclick', handleDoubleClick, true);
      c.off('tap', handleTap);
      if (resizeTimer !== undefined) clearTimeout(resizeTimer);
      if (pendingTapTimer !== undefined) clearTimeout(pendingTapTimer);
      pendingTapTimer = undefined;
      cancelSprings();
      userStore?.flush();
      if (renderDiagnosticsFrame !== 0) cancelAnimationFrame(renderDiagnosticsFrame);
      renderDiagnosticsFrame = 0;
      if (feasibilityFrame !== 0) cancelAnimationFrame(feasibilityFrame);
      feasibilityFrame = 0;
      c.destroy();
      cy = undefined;
    };
  });

  // Requested intent is persistent. Effective visibility may temporarily be a
  // subset while the current camera zoom cannot separate expanded compounds.
  $effect(() => {
    const requested = new Set(expanded);
    for (const id of previousRequestedExpanded) {
      if (!requested.has(id)) requiredExpansionZoom.delete(id);
    }
    const next = new Set(
      [...effectiveExpanded].filter((id) => requested.has(id)),
    );
    for (const id of requested) {
      if (!previousRequestedExpanded.has(id)) next.add(id);
    }
    previousRequestedExpanded = requested;
    if (
      next.size !== effectiveExpanded.size ||
      [...next].some((id) => !effectiveExpanded.has(id))
    ) {
      effectiveExpanded = next;
      onEffectiveExpanded(new Set(next));
    }
  });

  // Rebuild the visible graph when effective expansion state changes.
  $effect(() => {
    const vis = computeVisible(graph, effectiveExpanded);
    const newlyExpanded = [...effectiveExpanded].filter((id) => !previousExpanded.has(id));
    const newlyCollapsed = [...previousExpanded].filter((id) => !effectiveExpanded.has(id));
    // A deliberate single-group expansion is a local navigation action.
    // Bulk expansion retains the whole-graph overview instead.
    const focusId = newlyExpanded.length === 1 ? newlyExpanded[0] : undefined;
    previousExpanded = new Set(effectiveExpanded);
    syncElements(
      vis,
      focusId,
      newlyCollapsed.length === 1 ? newlyCollapsed[0] : undefined,
    );
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
  data-focus-local-coordinate-scale={focusLocalCoordinateScale}
  data-focus-required-zoom={focusRequiredZoom}
  data-focus-anchor-delta-x={focusAnchorDeltaX}
  data-surrounding-position-drift={surroundingPositionDrift}
  data-root-overlap-count={rootOverlapCount}
  data-vertical-order-violation-count={verticalOrderViolationCount}
  data-vertical-order-violation-edges={verticalOrderViolationEdges}
  data-historical-order-mismatch-edge-count={historicalOrderMismatchEdgeCount}
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
        data-model-top={stripe.modelTop}
        data-model-height={stripe.modelHeight}
        aria-label={`${stripe.label}: ${stripe.count} visible nodes`}
        style:top={`${stripe.top}px`}
        style:height={`${stripe.height}px`}
        style:background={`color-mix(in srgb, ${stripe.color} 15%, var(--paper))`}
        style:border-top-color={`color-mix(in srgb, ${stripe.color} 38%, var(--paper))`}
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
  <div hidden aria-hidden="true" data-testid="node-diagnostics">
    {#each nodeDiagnostics as node (node.id)}
      <span
        class="node-probe"
        data-node-id={node.id}
        data-node-label={node.label}
        data-node-center-x={node.centerX}
        data-node-center-y={node.centerY}
        data-node-rendered-width={node.width}
        data-node-rendered-height={node.height}
        data-node-model-x={node.modelX}
        data-node-model-y={node.modelY}
        data-node-actual-model-x={node.actualModelX}
        data-node-actual-model-y={node.actualModelY}
        data-node-model-height={node.modelHeight}
      ></span>
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
