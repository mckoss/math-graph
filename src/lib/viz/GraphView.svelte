<script lang="ts">
  import { untrack } from 'svelte';
  import cytoscape from 'cytoscape';
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
  import {
    assignMaturityBands,
    clampPointToMaturityBand,
    constrainPointAgainstMaturityBandNodes,
    fitMaturityBandsAroundFixedBand,
    fitMaturityBandsToNodes,
    separateMaturityPeersFromPinned,
    type MaturityBandRect,
  } from './maturity-bands';
  import {
    captureLocalLayout,
    captureParentLocalLayout,
    restoreLocalLayout,
    type ParentLocalPosition,
    type SavedLocalPosition,
  } from './session-layout';
  import {
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
  import { dependencyRanks } from './expansion-feasibility';
  import {
    semanticDepthForZoom,
    semanticProjection,
    thresholdForGroupDepth,
  } from './semantic-zoom';

  interface Props {
    graph: ConceptGraph;
    selectedId: string | null;
    /** Node clicked (or null when the background is clicked). */
    onSelect: (id: string | null) => void;
  }

  let {
    graph,
    selectedId,
    onSelect,
  }: Props = $props();

  let container: HTMLDivElement;
  let cy: cytoscape.Core | undefined;
  const effectiveExpanded = new Set(
    untrack(() => graph.nodes.filter((node) => node.isGroup).map((node) => node.id)),
  );
  let semanticDepth = $state(0);
  let compoundGroupCount = $state(0);
  let currentZoom = $state(1);
  let focusAnchorDeltaX = $state(0);
  let surroundingPositionDrift = $state(0);
  let rootOverlapCount = $state(0);
  let verticalOrderViolationCount = $state(0);
  let verticalOrderViolationEdges = $state('');
  let historicalOrderMismatchEdgeCount = $state(0);
  let savedLayoutNodeCount = $state(0);
  let restoredLayoutNodeCount = $state(0);
  let restoredUserPositionCount = $state(0);
  let globalLayoutCount = $state(0);
  let groupDragEventCount = $state(0);
  let manualGroupDrag: null | {
    group: cytoscape.NodeSingular;
    clientX: number;
    clientY: number;
    anchor: cytoscape.Position;
    descendants: Map<string, cytoscape.Position>;
    moved: boolean;
  } = null;
  const savedGroupLayouts = new Map<string, Map<string, ParentLocalPosition>>();
  const canonicalGroupAnchors = new Map<string, cytoscape.Position>();
  const canonicalParentLocal = new Map<string, cytoscape.Position>();
  const canonicalRootPositions = new Map<string, cytoscape.Position>();
  const canonicalZoneOrigins = new Map<number, cytoscape.Position>();
  const canonicalRootZoneLocal = new Map<string, cytoscape.Position>();
  let canonicalBandRects: MaturityBandRect[] = [];
  const layoutBaselines = new Map<string, cytoscape.Position>();
  let userStore: UserStore | undefined;
  let renderDiagnosticsFrame = 0;
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
    parentId: string;
    semanticVisible: boolean;
    titleMode: string;
  }>>([]);

  const FIT_PADDING = 36;
  // Give the eye enough time to follow a re-layout. Cytoscape applies the
  // cubic curve to every node and the viewport together, so motion starts and
  // settles gently instead of reading as an instantaneous redraw.
  const LAYOUT_MS = 900;
  const DEPENDENCY_GAP = 12;
  const BLOCK_GAP = 18;
  const ROOT_OVERLAP_DIAGNOSTIC_GAP = 17.5;
  const MATURITY_BAND_MIN_HEIGHT = 42;
  const MATURITY_BAND_PADDING = 7;
  const DEPENDENCY_RANK_GAP = BLOCK_GAP;
  const EMPTY_ZONE_HEIGHT = 56;
  const POPULATED_ZONE_MIN_HEIGHT = 84;
  const ZONE_VERTICAL_PADDING = 56;
  const DRAG_DISTANCE_THRESHOLD = 0.75;
  const DOUBLE_CLICK_DELAY_MS = 240;
  const DETAIL_GROUP_LABEL_INSET = 22;
  const BASE_NODE_FONT_SIZE = 17;
  const CONCEPT_INNER_PADDING = 14;
  const OVERVIEW_GROUP_FONT_MIN = 8;
  const OVERVIEW_GROUP_FONT_MAX = 64;
  const OVERVIEW_TITLE_VERTICAL_INSET = 14;
  const GROUP_TITLE_HORIZONTAL_INSET = 18;
  const GROUP_TITLE_MIN_WRAP_WIDTH = 40;
  const DETAIL_TITLE_TEXT_WIDTH_ESTIMATE = 0.62;
  const HIERARCHY_FONT_RATIO = 0.7;
  const USER_STORE_DEBOUNCE_MS = 250;
  const POSITION_OFFSET_EPSILON = 0.5;
  const ZOOM_CONTROL_ANIMATION_MS = 180;
  const VERTICAL_ORDER_EPSILON = 0.01;
  const ROOT_COLLISION_MIN_PASSES = 8;
  const ROOT_COLLISION_PASS_FACTOR = 2;
  const DRAGGED_PEER_GAP = 10;
  const COMPOUND_ANCHOR_CORRECTION_PASSES = 4;
  const VIEWPORT_MAX_ZOOM_FACTOR = 6;
  const SPRING_SETTLE_THRESHOLD = 0.05;
  const SPRING_SETTLE_DECAY = 0.8;
  const CYTOSCAPE_MIN_ZOOM = 1e-3;
  const CYTOSCAPE_MAX_ZOOM = 1e3;
  const CONCEPT_TEXT_MAX_WIDTH = 170;
  const GROUP_TEXT_MAX_WIDTH = 210;
  const CONCEPT_HORIZONTAL_CHROME = 31;
  const CONCEPT_VERTICAL_CHROME = 31;
  const GROUP_HORIZONTAL_CHROME = 45;
  const GROUP_VERTICAL_CHROME = 45;
  const CONCEPT_LINE_HEIGHT = 1.2;
  const GROUP_LINE_HEIGHT = 1.35;
  const TEXT_EM_WIDTH_ESTIMATE = 0.62;
  const EXPANDED_GROUP_INNER_PADDING = 36;
  const EXPANDED_GROUP_PADDING = 2 * (EXPANDED_GROUP_INNER_PADDING + BLOCK_GAP);
  const MAX_PERSISTED_OFFSET = 10_000;

  function hierarchyFontSize(node: GraphNode): number {
    return BASE_NODE_FONT_SIZE * Math.pow(
      HIERARCHY_FONT_RATIO,
      ancestorsOf(byId, node.id).length,
    );
  }

  function displayedNodeLabel(node: GraphNode): string {
    if (!node.isGroup) return node.label;
    const count = conceptCountOf(children, node.id);
    return `${node.label}\n${count} concept${count === 1 ? '' : 's'}`;
  }

  /** Deterministic 100% block envelope; independent of headless font metrics. */
  function canonicalBlockSize(node: GraphNode): CanonicalUnitSize {
    const fontSize = hierarchyFontSize(node);
    const maxTextWidth = node.isGroup ? GROUP_TEXT_MAX_WIDTH : CONCEPT_TEXT_MAX_WIDTH;
    const lineHeight = node.isGroup ? GROUP_LINE_HEIGHT : CONCEPT_LINE_HEIGHT;
    const paragraphs = displayedNodeLabel(node).split('\n');
    let lineCount = 0;
    let widestLine = 0;
    for (const paragraph of paragraphs) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      let lineWidth = 0;
      if (words.length === 0) {
        lineCount += 1;
        continue;
      }
      for (const word of words) {
        const wordWidth = word.length * fontSize * TEXT_EM_WIDTH_ESTIMATE;
        const spaceWidth = lineWidth === 0 ? 0 : fontSize * TEXT_EM_WIDTH_ESTIMATE;
        if (lineWidth > 0 && lineWidth + spaceWidth + wordWidth > maxTextWidth) {
          widestLine = Math.max(widestLine, lineWidth);
          lineCount += 1;
          lineWidth = wordWidth;
        } else {
          lineWidth += spaceWidth + wordWidth;
        }
      }
      widestLine = Math.max(widestLine, lineWidth);
      lineCount += 1;
    }
    return {
      width: Math.min(maxTextWidth, widestLine) +
        (node.isGroup ? GROUP_HORIZONTAL_CHROME : CONCEPT_HORIZONTAL_CHROME),
      height: lineCount * fontSize * lineHeight +
        (node.isGroup ? GROUP_VERTICAL_CHROME : CONCEPT_VERTICAL_CHROME),
    };
  }

  function wrappedLineCount(label: string, fontSize: number, maxWidth: number): number {
    let lines = 0;
    for (const paragraph of label.split('\n')) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      let lineWidth = 0;
      for (const word of words) {
        const wordWidth = word.length * fontSize * TEXT_EM_WIDTH_ESTIMATE;
        const spaceWidth = lineWidth === 0 ? 0 : fontSize * TEXT_EM_WIDTH_ESTIMATE;
        if (lineWidth > 0 && lineWidth + spaceWidth + wordWidth > maxWidth) {
          lines += 1;
          lineWidth = wordWidth;
        } else {
          lineWidth += spaceWidth + wordWidth;
        }
      }
      lines += 1;
    }
    return Math.max(1, lines);
  }

  function fittedOverviewFontSize(label: string, width: number, height: number): number {
    const availableWidth = Math.max(GROUP_TITLE_MIN_WRAP_WIDTH, width);
    const availableHeight = Math.max(
      OVERVIEW_GROUP_FONT_MIN * GROUP_LINE_HEIGHT,
      height - 2 * OVERVIEW_TITLE_VERTICAL_INSET,
    );
    let low = OVERVIEW_GROUP_FONT_MIN;
    let high = OVERVIEW_GROUP_FONT_MAX;
    const longestWordLength = Math.max(
      1,
      ...label.split(/\s+/).map((word) => word.length),
    );
    for (let iteration = 0; iteration < 12; iteration++) {
      const candidate = (low + high) / 2;
      const requiredHeight = wrappedLineCount(
        label,
        candidate,
        availableWidth,
      ) * candidate * GROUP_LINE_HEIGHT;
      const requiredWordWidth = longestWordLength * candidate * TEXT_EM_WIDTH_ESTIMATE;
      if (requiredHeight <= availableHeight && requiredWordWidth <= availableWidth) low = candidate;
      else high = candidate;
    }
    return low;
  }

  function currentUserStore(): UserStore {
    userStore ??= new UserStore(undefined, USER_STORE_DEBOUNCE_MS, graph.metadata.id);
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

  /** Restore rigid group translations after the canonical child layout exists. */
  function restoreGroupTranslations(targets: Map<string, cytoscape.Position>): void {
    const cumulative = new Map<string, cytoscape.Position>();
    const groups = graph.nodes
      .filter((node) => node.isGroup)
      .sort((left, right) => ancestorsOf(byId, left.id).length - ancestorsOf(byId, right.id).length);
    for (const group of groups) {
      const canonical = composedCanonicalPosition(group.id, undefined, true);
      if (canonical === undefined) continue;
      const parentShift = group.parent === undefined
        ? { x: 0, y: 0 }
        : cumulative.get(group.parent) ?? { x: 0, y: 0 };
      const baseline = { x: canonical.x + parentShift.x, y: canonical.y + parentShift.y };
      layoutBaselines.set(group.id, baseline);
      const stored = currentUserStore().state.positionOffsets[group.id];
      const own = stored === undefined
        ? { dx: 0, dy: 0 }
        : clampOffset(stored, MAX_PERSISTED_OFFSET);
      if (stored !== undefined) restoredUserPositionCount += 1;
      for (const descendantId of descendantsOf(children, group.id)) {
        const target = targets.get(descendantId);
        if (target !== undefined) {
          targets.set(descendantId, { x: target.x + own.dx, y: target.y + own.dy });
        }
      }
      const total = { x: parentShift.x + own.dx, y: parentShift.y + own.dy };
      cumulative.set(group.id, total);
      canonicalGroupAnchors.set(group.id, {
        x: canonical.x + total.x,
        y: canonical.y + total.y,
      });
    }
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
        Math.hypot(offset.dx, offset.dy) < POSITION_OFFSET_EPSILON
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

  function persistGroupTranslation(group: cytoscape.NodeSingular): void {
    const anchor = canonicalGroupAnchors.get(group.id());
    const baseline = layoutBaselines.get(group.id());
    if (anchor === undefined || baseline === undefined) return;
    const offset = clampOffset({
      dx: anchor.x - baseline.x,
      dy: anchor.y - baseline.y,
    }, MAX_PERSISTED_OFFSET);
    const band = bandAssignments.get(group.id()) ?? 0;
    const bandRect = bandModelRects[band];
    currentUserStore().setOffset(
      group.id(),
      Math.hypot(offset.dx, offset.dy) < POSITION_OFFSET_EPSILON
        ? null
        : {
            ...offset,
            ...(bandRect === undefined ? {} : { bandOffsetY: anchor.y - bandRect.y1 }),
          },
    );
    currentUserStore().setLayoutAnchor(rootUnitId(group));
    currentUserStore().flush();
  }

  function expandCanonicalZoneEnvelopeForGroup(group: cytoscape.NodeSingular): void {
    const band = bandAssignments.get(group.id()) ?? 0;
    const current = bandModelRects[band];
    if (current === undefined) return;
    const box = group.boundingBox({ includeLabels: true, includeOverlays: false });
    const expanded = {
      ...current,
      y1: Math.min(current.y1, box.y1 - MATURITY_BAND_PADDING),
      y2: Math.max(current.y2, box.y2 + MATURITY_BAND_PADDING),
    };
    bandModelRects = bandModelRects.map((rect, index) => index === band ? expanded : rect);
    canonicalBandRects = canonicalBandRects.map((rect, index) => index === band ? expanded : rect);
    updateBandStripes();
  }

  function beginGroupDrag(groupId: string, event: MouseEvent): void {
    const c = cy;
    if (!c || event.button !== 0 || !effectiveExpanded.has(groupId)) return;
    const group = c.getElementById(groupId);
    if (group.empty()) return;
    event.preventDefault();
    event.stopPropagation();
    manualGroupDrag = {
      group,
      clientX: event.clientX,
      clientY: event.clientY,
      anchor: { ...(canonicalGroupAnchors.get(groupId) ?? group.position()) },
      descendants: new Map(group.descendants().not(':parent').map((node: cytoscape.NodeSingular) => [
        node.id(),
        { ...node.position() },
      ])),
      moved: false,
    };
    groupDragEventCount += 1;
  }

  function continueGroupDrag(event: MouseEvent): void {
    const c = cy;
    const drag = manualGroupDrag;
    if (!c || drag === null) return;
    event.preventDefault();
    const dx = (event.clientX - drag.clientX) / c.zoom();
    const dy = (event.clientY - drag.clientY) / c.zoom();
    if (Math.hypot(dx, dy) >= DRAG_DISTANCE_THRESHOLD) drag.moved = true;
    groupDragEventCount += 1;
    drag.group.descendants().not(':parent').positions((node) => {
      const start = drag.descendants.get(node.id()) ?? node.position();
      return { x: start.x + dx, y: start.y + dy };
    });
    canonicalGroupAnchors.set(drag.group.id(), {
      x: drag.anchor.x + dx,
      y: drag.anchor.y + dy,
    });
    scheduleRenderDiagnostics();
  }

  function finishGroupDrag(): void {
    const c = cy;
    const drag = manualGroupDrag;
    if (!c || drag === null) return;
    manualGroupDrag = null;
    if (!drag.moved) {
      onSelect(drag.group.id());
      return;
    }
    const anchor = canonicalGroupAnchors.get(drag.group.id());
    const graphNode = byId.get(drag.group.id());
    if (anchor !== undefined && graphNode?.parent !== undefined) {
      const parentAnchor = canonicalGroupAnchors.get(graphNode.parent) ??
        c.getElementById(graphNode.parent).position();
      canonicalParentLocal.set(drag.group.id(), {
        x: anchor.x - parentAnchor.x,
        y: anchor.y - parentAnchor.y,
      });
    }
    expandCanonicalZoneEnvelopeForGroup(drag.group);
    persistGroupTranslation(drag.group);
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
    animateViewport(c, targetBBox(c, positions), containerSize(), true);
  }

  export function zoomBy(factor: number): void {
    if (!cy) return;
    cy.stop();
    const level = cy.zoom() * factor;
    cy.animate(
      { zoom: { level, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } } },
      { duration: ZOOM_CONTROL_ANIMATION_MS, easing: 'ease-out' },
    );
  }

  export function layoutNow(): void {
    const c = cy;
    if (!c) return;
    const store = currentUserStore();
    store.clearOffsets();
    store.flush();
    layoutBaselines.clear();
    savedGroupLayouts.clear();
    savedLayoutNodeCount = 0;
    restoredLayoutNodeCount = 0;
    restoredUserPositionCount = 0;
    rebuildCanonicalHierarchyLayout();
    // The complete hierarchy is permanent. Keeping the current Cytoscape
    // elements in place gives the preset layout genuine start positions, so
    // Layout Now animates from the user's view instead of snapping through a
    // remove/recreate cycle.
    runLayout(false);
  }

  // ---- Element construction ------------------------------------------------

  function nodeData(n: GraphNode): Record<string, unknown> {
    const parent = n.parent !== undefined && effectiveExpanded.has(n.parent) ? n.parent : undefined;
    const fontSize = hierarchyFontSize(n);
    const hierarchyDepth = ancestorsOf(byId, n.id).length;
    if (n.isGroup) {
      const paint = maturityPaint(maturityLevels, n.maturityLevel);
      const count = conceptCountOf(children, n.id);
      return {
        id: n.id,
        ...(parent === undefined ? {} : { parent }),
        kind: 'group',
        expanded: effectiveExpanded.has(n.id) ? 1 : 0,
        label: displayedNodeLabel(n),
        groupTitle: n.label,
        overviewLabel: displayedNodeLabel(n),
        fill: paint.tint,
        border: paint.color,
        text: paint.color,
        fontSize,
        overviewFontSize: fontSize,
        detailFontSize: fontSize,
        groupTextMaxWidth: GROUP_TITLE_MIN_WRAP_WIDTH,
        detailTitleOffsetY: 0,
        hierarchyDepth,
      };
    }
    const paint = maturityPaint(maturityLevels, n.maturityLevel);
    const blockSize = canonicalBlockSize(n);
    return {
      id: n.id,
      ...(parent === undefined ? {} : { parent }),
      kind: 'concept',
      label: n.label,
      fill: paint.tint,
      border: paint.color,
      text: '#33302a',
      fontSize,
      blockWidth: Math.max(1, blockSize.width - 2 * CONCEPT_INNER_PADDING),
      blockHeight: Math.max(1, blockSize.height - 2 * CONCEPT_INNER_PADDING),
      hierarchyDepth,
    };
  }

  function maximumSemanticDepth(): number {
    return Math.max(0, ...graph.nodes.map((node) => ancestorsOf(byId, node.id).length)) + 1;
  }

  function addSemanticProjectionEdges(c: cytoscape.Core): void {
    const fullDepth = maximumSemanticDepth();
    for (let depth = 0; depth < fullDepth; depth++) {
      for (const edge of semanticProjection(graph, depth).edges) {
        c.add({
          group: 'edges',
          selectable: false,
          data: {
            id: `semantic-${depth}\0${edge.from}\0${edge.to}`,
            source: edge.from,
            target: edge.to,
            semanticDepth: depth,
            sourceSupported: edge.provenance === 'source-supported' ? 1 : 0,
            historicalOrderMismatch: edge.historicalOrderMismatch ? 1 : 0,
          },
        });
      }
    }
  }

  function applySemanticPresentation(c: cytoscape.Core): void {
    const depth = Math.min(semanticDepthForZoom(c.zoom()), maximumSemanticDepth());
    semanticDepth = depth;
    c.batch(() => {
      c.nodes().forEach((node: cytoscape.NodeSingular) => {
        const nodeDepth = Number(node.data('hierarchyDepth'));
        const visible = nodeDepth <= depth;
        const detailedGroup = node.isParent() && nodeDepth < depth;
        if (node.isParent()) {
          const titleWidth = Math.max(
            GROUP_TITLE_MIN_WRAP_WIDTH,
            node.outerWidth() - 2 * GROUP_TITLE_HORIZONTAL_INSET,
          );
          node.data(
            'groupTextMaxWidth',
            titleWidth,
          );
          node.data('detailFontSize', Math.min(
            Number(node.data('fontSize')),
            titleWidth /
              (Math.max(1, String(node.data('groupTitle')).length) * DETAIL_TITLE_TEXT_WIDTH_ESTIMATE),
          ));
          node.data(
            'detailTitleOffsetY',
            -node.outerHeight() / 2 + DETAIL_GROUP_LABEL_INSET,
          );
          node.data('label', detailedGroup ? node.data('groupTitle') : node.data('overviewLabel'));
        }
        if (visible && node.isParent() && !detailedGroup) {
          node.data('overviewFontSize', fittedOverviewFontSize(
            String(node.data('overviewLabel')),
            Number(node.data('groupTextMaxWidth')),
            node.outerHeight(),
          ));
        }
        node.toggleClass('semantic-hidden', !visible);
        node.toggleClass('semantic-overview-group', visible && node.isParent() && !detailedGroup);
        node.toggleClass('semantic-detail-group', visible && detailedGroup);
      });
      c.edges().forEach((edge: cytoscape.EdgeSingular) => {
        edge.toggleClass('semantic-hidden', Number(edge.data('semanticDepth')) !== depth);
      });
    });
    applyHighlight();
    scheduleRenderDiagnostics();
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
    const composed = composedCanonicalPosition(n.id, oldPos);
    if (composed !== undefined) return composed;
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

  function composedCanonicalPosition(
    id: string,
    existingRoots?: ReadonlyMap<string, cytoscape.Position>,
    useCanonicalRoot = false,
  ): cytoscape.Position | undefined {
    let node = byId.get(id);
    if (node === undefined) return undefined;
    let x = 0;
    let y = 0;
    while (node.parent !== undefined) {
      const local = canonicalParentLocal.get(node.id);
      if (local === undefined) return undefined;
      x += local.x;
      y += local.y;
      node = byId.get(node.parent);
      if (node === undefined) return undefined;
    }
    const root = useCanonicalRoot
      ? canonicalRootPositions.get(node.id)
      : canonicalGroupAnchors.get(node.id) ?? existingRoots?.get(node.id) ?? canonicalRootPositions.get(node.id);
    return root === undefined ? undefined : { x: root.x + x, y: root.y + y };
  }

  function syncElements(vis: VisibleGraph): void {
    const c = cy;
    if (!c || c.elements().nonempty()) return;
    const orderedNodes = [...vis.nodes].sort(
      (a, b) => ancestorsOf(byId, a.id).length - ancestorsOf(byId, b.id).length,
    );
    c.batch(() => {
      for (const node of orderedNodes) {
        c.add({ group: 'nodes', data: nodeData(node), position: { x: 0, y: 0 } });
      }
      for (const edge of vis.edges) {
        c.add({
          group: 'edges',
          selectable: false,
          data: {
            id: `e\0${edge.from}\0${edge.to}`,
            source: edge.from,
            target: edge.to,
            semanticDepth: maximumSemanticDepth(),
            sourceSupported: edge.provenance === 'source-supported' ? 1 : 0,
            historicalOrderMismatch: edge.historicalOrderMismatch ? 1 : 0,
          },
        });
      }
      addSemanticProjectionEdges(c);
    });
    c.nodes(':parent').ungrabify();
    c.nodes().not(':parent').grabify();
    compoundGroupCount = effectiveExpanded.size;
    historicalOrderMismatchEdgeCount = c.edges(
      `[semanticDepth = ${maximumSemanticDepth()}][historicalOrderMismatch = 1]`,
    ).length;
    runLayout(true);
    scheduleRenderDiagnostics();
  }

  function updateRenderDiagnostics(): void {
    renderDiagnosticsFrame = 0;
    const c = cy;
    if (!c) return;
    compoundGroupCount = [...effectiveExpanded].filter(
      (id) => c.getElementById(id).nonempty(),
    ).length;
    rootOverlapCount = countRootUnitOverlaps(c);
    const positions = currentLeafPositions(c);
    const edges = currentVisibleEdges(c);
    const separation = verticalSeparation(c);
    const violations = edges.filter((edge) => {
      const prerequisite = positions.get(edge.from);
      const dependent = positions.get(edge.to);
      return prerequisite !== undefined && dependent !== undefined &&
        dependent.y + VERTICAL_ORDER_EPSILON < prerequisite.y + separation(edge);
    });
    verticalOrderViolationCount = violations.length;
    verticalOrderViolationEdges = violations.map((edge) => `${edge.from}->${edge.to}`).join(',');
    nodeDiagnostics = c.nodes().map((node) => {
      const box = node.renderedBoundingBox({ includeLabels: false, includeOverlays: false });
      // Expanded compound positions are derived Cytoscape presentation bounds;
      // the pre-expansion anchor is the authoritative parent-local model
      // coordinate and avoids leaking sub-ulp renderer rounding into state.
      const authoritativePoint = node.isParent()
        ? canonicalGroupAnchors.get(node.id())
        : undefined;
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
        parentId: String(node.data('parent') ?? ''),
        semanticVisible: !node.hasClass('semantic-hidden'),
        titleMode: node.hasClass('semantic-overview-group')
          ? 'overview'
          : node.hasClass('semantic-detail-group') ? 'detail' : 'concept',
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
    gap = BLOCK_GAP,
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

  function rootUnitOverlapPairs(c: cytoscape.Core, gap = ROOT_OVERLAP_DIAGNOSTIC_GAP): string[] {
    const roots = c.nodes().filter((node) => node.parent().empty());
    const pairs: string[] = [];
    const canonicalBox = (node: cytoscape.NodeSingular) => {
      const center = canonicalGroupAnchors.get(node.id()) ?? node.position();
      const halfWidth = node.outerWidth() / 2;
      const halfHeight = node.outerHeight() / 2;
      return {
        x1: center.x - halfWidth,
        x2: center.x + halfWidth,
        y1: center.y - halfHeight,
        y2: center.y + halfHeight,
      };
    };
    for (let i = 0; i < roots.length; i++) {
      for (let j = i + 1; j < roots.length; j++) {
        const a = canonicalBox(roots[i]);
        const b = canonicalBox(roots[j]);
        if (
          Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) + gap > 0 &&
          Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) + gap > 0
        ) pairs.push(`${roots[i].id()}->${roots[j].id()}`);
      }
    }
    return pairs;
  }

  function countRootUnitOverlaps(c: cytoscape.Core, gap = ROOT_OVERLAP_DIAGNOSTIC_GAP): number {
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
    const maxPasses = Math.max(
      ROOT_COLLISION_MIN_PASSES,
      roots.length * roots.length * ROOT_COLLISION_PASS_FACTOR,
    );
    for (let pass = 0; pass < maxPasses; pass++) {
      separateRootUnits(c, targets, BLOCK_GAP, anchoredRootId);
      let collision: [cytoscape.NodeSingular, cytoscape.NodeSingular] | undefined;
      for (let left = 0; left < roots.length && collision === undefined; left++) {
        for (let right = left + 1; right < roots.length; right++) {
          const a = roots[left];
          const b = roots[right];
          const ab = a.boundingBox({ includeLabels: true, includeOverlays: false });
          const bb = b.boundingBox({ includeLabels: true, includeOverlays: false });
          if (
            Math.min(ab.x2, bb.x2) - Math.max(ab.x1, bb.x1) + BLOCK_GAP > 0 &&
            Math.min(ab.y2, bb.y2) - Math.max(ab.y1, bb.y1) + BLOCK_GAP > 0
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
        ? fixedBox.x1 - BLOCK_GAP - movingBox.x2
        : fixedBox.x2 + BLOCK_GAP - movingBox.x1;
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
    saved.forEach((point, id) => canonicalParentLocal.set(id, { x: point.dx, y: point.dy }));
    savedLayoutNodeCount = saved.size;
  }

  /** Keep the current anchor map in sync without rewriting reset-layout targets. */
  function updateDraggedGroupAnchor(node: cytoscape.NodeSingular): void {
    const graphNode = byId.get(node.id());
    if (graphNode?.isGroup !== true || node.isParent()) return;
    const point = { ...node.position() };
    canonicalGroupAnchors.set(node.id(), point);
    if (graphNode.parent === undefined) return;
    const parentAnchor = canonicalGroupAnchors.get(graphNode.parent) ??
      composedCanonicalPosition(graphNode.parent) ??
      node.cy().getElementById(graphNode.parent).position();
    canonicalParentLocal.set(node.id(), {
      x: point.x - parentAnchor.x,
      y: point.y - parentAnchor.y,
    });
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

  function currentVisibleEdges(c: cytoscape.Core): ConceptEdge[] {
    return c.edges(`[semanticDepth = ${maximumSemanticDepth()}]`).map((edge: cytoscape.EdgeSingular) => ({
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
      const separated = separateMaturityPeersFromPinned(
        members[0],
        members.slice(1),
        DRAGGED_PEER_GAP,
      );
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
    for (let pass = 0; pass < COMPOUND_ANCHOR_CORRECTION_PASSES; pass++) {
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
    const boxes = allVisibleNodeBoxes();
    const fixedBand = anchoredNodeId === undefined
      ? undefined
      : bandAssignments.get(anchoredNodeId);
    const result = fixedBand === undefined
      ? fitMaturityBandsToNodes(
          boxes,
          bandModelRects,
          MATURITY_BAND_MIN_HEIGHT,
          MATURITY_BAND_PADDING,
        )
      : fitMaturityBandsAroundFixedBand(
          boxes,
          bandModelRects,
          fixedBand,
          MATURITY_BAND_MIN_HEIGHT,
          MATURITY_BAND_PADDING,
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

  interface CanonicalUnitSize {
    width: number;
    height: number;
  }

  /** Recursive TB layout for direct child units, centered in parent coordinates. */
  function packFocusedDescendants(
    focusNode: cytoscape.NodeSingular,
    anchor: cytoscape.Position,
    targets: Map<string, cytoscape.Position>,
    canonicalUnitSizes: Map<string, CanonicalUnitSize> = new Map(),
  ): CanonicalUnitSize {
    const directChildren = focusNode.children().toArray() as cytoscape.NodeSingular[];
    if (directChildren.length === 0) {
      return canonicalUnitSizes.get(focusNode.id()) ?? { width: 0, height: 0 };
    }

    // Layout nested scopes first so each subgroup is a measured rigid unit in
    // its parent's layout rather than flattening nested descendants.
    for (const child of directChildren) {
      if (child.isParent()) {
        canonicalUnitSizes.set(
          child.id(),
          packFocusedDescendants(child, { ...child.position() }, targets, canonicalUnitSizes),
        );
      }
    }
    focusNode.cy().forceRender();

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

    // Barycentric ordering reduces crossings. Use
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

    const gap = BLOCK_GAP;
    const rankGap = DEPENDENCY_RANK_GAP;
    const layouts = orderedRanks.map(([rank, members]) => {
      // Dependency depth defines the earliest feasible row. Do not introduce
      // arbitrary extra rows: a rank wraps only when a real width constraint
      // is supplied by its container (canonical groups currently grow to fit).
      const sizeOf = (node: cytoscape.NodeSingular): CanonicalUnitSize => {
        return canonicalUnitSizes.get(node.id()) ?? {
          width: 0,
          height: 0,
        };
      };
      const height = Math.max(...members.map((node) => sizeOf(node).height));
      return { rank, members, height, sizeOf };
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
      const rowWidth = rank.members.reduce(
        (sum, unit) => sum + rank.sizeOf(unit).width,
        gap * Math.max(0, rank.members.length - 1),
      );
      let cursorX = anchor.x - rowWidth / 2;
      for (const unit of rank.members) {
        const size = rank.sizeOf(unit);
        const point = {
          x: cursorX + size.width / 2,
          y: rankTop + rank.height / 2,
        };
        moveUnit(unit, point);
        if (unit.isParent()) anchorFocusedGroup(unit, point, targets);
        cursorX += size.width + gap;
      }
      rankTop += rank.height + rankGap;
    }

    const childBoxes = directChildren.map((unit) => {
      const size = canonicalUnitSizes.get(unit.id()) ?? {
        width: 0,
        height: 0,
      };
      const point = unit.position();
      return {
        x1: point.x - size.width / 2,
        y1: point.y - size.height / 2,
        x2: point.x + size.width / 2,
        y2: point.y + size.height / 2,
      };
    });
    const expanded = {
      width: Math.max(...childBoxes.map((box) => box.x2)) -
        Math.min(...childBoxes.map((box) => box.x1)) + EXPANDED_GROUP_PADDING,
      height: Math.max(...childBoxes.map((box) => box.y2)) -
        Math.min(...childBoxes.map((box) => box.y1)) + EXPANDED_GROUP_PADDING,
    };
    const collapsed = canonicalUnitSizes.get(focusNode.id());
    return {
      width: Math.max(expanded.width, collapsed?.width ?? 0),
      height: Math.max(expanded.height, collapsed?.height ?? 0),
    };
  }

  /**
   * Lay out the complete hierarchy, including currently hidden descendants,
   * into the one canonical immediate-parent coordinate map. The scratch graph
   * is never presented; visibility later projects these cached transforms.
   */
  function rebuildCanonicalHierarchyLayout(): void {
    const ordered = [...graph.nodes].sort(
      (a, b) => ancestorsOf(byId, a.id).length - ancestorsOf(byId, b.id).length ||
        a.id.localeCompare(b.id),
    );
    // A group is a rigid unit in its parent's layout. Reserve the union of its
    // fully expanded compound and this conservative collapsed presentation
    // envelope so visibility never changes the legality of canonical centers.
    const canonicalUnitSizes = new Map<string, CanonicalUnitSize>(
      ordered.map((node) => [node.id, canonicalBlockSize(node)]),
    );
    const syntheticRootId = '__canonical-root__';
    const zoneId = (band: number): string => `__canonical-zone-${band}__`;
    const scratch = cytoscape({
      headless: true,
      styleEnabled: true,
      style,
      elements: [
        {
          group: 'nodes' as const,
          data: {
            id: syntheticRootId,
            kind: 'group',
            expanded: 1,
            label: '',
            fill: 'transparent',
            border: 'transparent',
            text: 'transparent',
            fontSize: BASE_NODE_FONT_SIZE,
            groupTextMaxWidth: GROUP_TITLE_MIN_WRAP_WIDTH,
          },
        },
        ...maturityLevels.map((_, band) => ({
          group: 'nodes' as const,
          data: {
            id: zoneId(band),
            parent: syntheticRootId,
            kind: 'group',
            expanded: 1,
            label: '',
            fill: 'transparent',
            border: 'transparent',
            text: 'transparent',
            fontSize: BASE_NODE_FONT_SIZE,
            groupTextMaxWidth: GROUP_TITLE_MIN_WRAP_WIDTH,
          },
        })),
        ...ordered.map((node) => ({
          group: 'nodes' as const,
          data: {
            ...nodeData(node),
            parent: node.parent ?? zoneId(bandAssignments.get(node.id) ?? 0),
            expanded: node.isGroup ? 1 : 0,
          },
          position: { x: 0, y: 0 },
        })),
        ...graph.edges.map((edge) => ({
          group: 'edges' as const,
          data: {
            id: `canonical\0${edge.from}\0${edge.to}`,
            source: edge.from,
            target: edge.to,
            semanticDepth: maximumSemanticDepth(),
          },
        })),
      ],
    });
    const targets = new Map<string, cytoscape.Position>();
    scratch.nodes().not(':parent').forEach((node) => {
      targets.set(node.id(), { ...node.position() });
    });
    let bandCursor = 0;
    canonicalZoneOrigins.clear();
    canonicalRootZoneLocal.clear();
    const rootUnits: cytoscape.NodeSingular[] = [];
    canonicalBandRects = maturityLevels.map((_, band) => {
      const zone = scratch.getElementById(zoneId(band));
      const zoneSize = packFocusedDescendants(zone, { x: 0, y: 0 }, targets, canonicalUnitSizes);
      anchorFocusedGroup(zone, { x: 0, y: 0 }, targets);
      const units = zone.children().toArray() as cytoscape.NodeSingular[];
      rootUnits.push(...units);
      const height = units.length === 0
        ? EMPTY_ZONE_HEIGHT
        : Math.max(POPULATED_ZONE_MIN_HEIGHT, zoneSize.height + ZONE_VERTICAL_PADDING);
      const y1 = bandCursor;
      const y2 = y1 + height;
      const desiredCenterY = (y1 + y2) / 2;
      const shift = desiredCenterY - zone.position().y;
      zone.descendants().not(':parent').forEach((leaf: cytoscape.NodeSingular) => {
        const point = targets.get(leaf.id()) ?? leaf.position();
        const shifted = { x: point.x, y: point.y + shift };
        targets.set(leaf.id(), shifted);
        leaf.position(shifted);
      });
      const zoneOrigin = { ...zone.position() };
      canonicalZoneOrigins.set(band, zoneOrigin);
      units.forEach((unit) => canonicalRootZoneLocal.set(unit.id(), {
        x: unit.position().x - zoneOrigin.x,
        y: unit.position().y - zoneOrigin.y,
      }));
      bandCursor = y2;
      return { band, y1, y2, count: units.length };
    });

    canonicalParentLocal.clear();
    canonicalRootPositions.clear();
    rootUnits.forEach((node) => canonicalRootPositions.set(node.id(), { ...node.position() }));
    scratch.nodes().filter((node) =>
      node.id() !== syntheticRootId && !node.id().startsWith('__canonical-zone-'),
    ).forEach((node: cytoscape.NodeSingular) => {
      const parent = node.parent();
      if (parent.empty() || parent[0].id() === syntheticRootId) return;
      canonicalParentLocal.set(node.id(), {
        x: node.position().x - parent[0].position().x,
        y: node.position().y - parent[0].position().y,
      });
    });
    scratch.destroy();
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
      max: Math.max(
        wholeGraphBounds.max,
        viewport.zoom * VIEWPORT_MAX_ZOOM_FACTOR,
        thresholdForGroupDepth(maximumSemanticDepth() - 1),
      ),
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

  /** Present the canonical layout and coordinate its camera animation. */
  function runLayout(first = false): void {
    const c = cy;
    if (!c || c.nodes().length === 0) return;
    cancelSprings();
    runningLayout?.stop();

    const size = containerSize();
    if (size.width === 0 || size.height === 0) return;
    const layoutNodes = c.nodes().not(':parent');
    surroundingPositionDrift = 0;
    rootOverlapCount = 0;
    restoredLayoutNodeCount = 0;
    // This is the sole whole-graph layout entry point. Initial construction
    // and the explicit Layout Now command may reach it; visibility, camera,
    // zoom, and resize synchronization must return through local paths above.
    // This diagnostic is rendered for tests, but it is not graph input. Read
    // it outside the surrounding visibility effect so incrementing it cannot
    // recursively schedule another synchronization/layout pass.
    globalLayoutCount = untrack(() => globalLayoutCount) + 1;
    if (canonicalRootPositions.size === 0 || canonicalBandRects.length !== maturityLevels.length) {
      throw new Error('Canonical layout was not constructed before presentation');
    }
    const targets = new Map<string, cytoscape.Position>();
    layoutNodes.forEach((node) => {
      targets.set(
        node.id(),
        composedCanonicalPosition(node.id(), undefined, true) ?? node.position(),
      );
    });
    restoreUserPositions(layoutNodes, targets);
    restoreGroupTranslations(targets);
    bandModelRects = canonicalBandRects.map((band) => ({
      ...band,
      count: layoutNodes.filter(
        (node) => (bandAssignments.get(node.id()) ?? 0) === band.band,
      ).length,
    }));
    layoutBounds = targetBBox(c, targets);
    layoutOrientation = size.height > size.width ? 'portrait' : 'landscape';
    if (first) {
      layoutNodes.positions((node) => targets.get(node.id()) ?? node.position());
      animateViewport(c, layoutBounds, size, false, 0, layoutBounds);
      updateBandStripes();
      return;
    }
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
    animateViewport(c, layoutBounds, size, true, 0, layoutBounds);
    updateBandStripes();
  }

  // ---- Drag springs --------------------------------------------------------

  let springSystem: SpringSystem | undefined;
  let springNodes: cytoscape.NodeSingular[] = [];
  let springUpstreamIds = new Set<string>();
  let anchorNode: cytoscape.NodeSingular | undefined;
  let dragFrameId = 0;
  let settleFrameId = 0;
  let dragPending = false;
  let grabbedNodeId = $state<string | undefined>();
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
    if (scale > SPRING_SETTLE_THRESHOLD) {
      settleFrameId = requestAnimationFrame(() => settleSprings(scale * SPRING_SETTLE_DECAY));
    } else {
      const parent = anchorNode.parent();
      if (parent.nonempty()) {
        const parentId = parent[0].id();
        resolveCurrentRootCollisions(parentId);
        saveGroupLayout(parentId);
      } else {
        resolveCurrentRootCollisions(anchorNode.id());
      }
      updateDraggedGroupAnchor(anchorNode);
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
  }

  // ---- Cytoscape stylesheet ------------------------------------------------

  const FONT = 'Inter';
  const style: cytoscape.StylesheetJson = [
    {
      selector: 'node',
      style: {
        shape: 'round-rectangle',
        'font-family': FONT,
        'transition-property': 'opacity, font-size, text-margin-y',
        'transition-duration': 350,
        'transition-timing-function': 'ease-in-out',
      } as never,
    },
    {
      selector: 'node[kind = "concept"]',
      style: {
        width: 'data(blockWidth)',
        height: 'data(blockHeight)',
        padding: `${CONCEPT_INNER_PADDING}px`,
        'background-color': 'data(fill)',
        'border-color': 'data(border)',
        'border-width': 1.5,
        label: 'data(label)',
        color: 'data(text)',
        'font-size': 'data(fontSize)',
        'font-weight': 600,
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-max-width': '170',
      } as never,
    },
    {
      selector: 'node[kind = "group"]',
      style: {
        shape: 'round-rectangle',
        padding: `${EXPANDED_GROUP_INNER_PADDING}px`,
        'background-color': 'data(fill)',
        'background-opacity': 0.22,
        'border-color': 'data(border)',
        'border-width': 2.5,
        'border-style': 'dashed',
        label: 'data(label)',
        color: 'data(text)',
        'font-size': 'data(fontSize)',
        'font-weight': 700,
        'text-valign': 'top',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-margin-y': DETAIL_GROUP_LABEL_INSET,
        // Compound geometry belongs to its descendants. Including a long,
        // wrapped title here makes Cytoscape recompute and shift the compound
        // bounds as font metrics round between animation frames.
        'compound-sizing-wrt-labels': 'exclude',
        'text-max-width': 'data(groupTextMaxWidth)',
        'line-height': 1.25,
      } as never,
    },
    {
      selector: 'node.semantic-overview-group',
      style: {
        'font-size': 'data(overviewFontSize)',
        'text-valign': 'center',
        'text-margin-y': 0,
        'text-max-width': 'data(groupTextMaxWidth)',
        'background-opacity': 0.32,
      } as never,
    },
    {
      selector: 'node.semantic-detail-group',
      style: {
        'font-size': 'data(detailFontSize)',
        'text-valign': 'center',
        'text-margin-y': 'data(detailTitleOffsetY)',
        'text-max-width': 'data(groupTextMaxWidth)',
        'text-wrap': 'none',
        'background-opacity': 0.22,
      } as never,
    },
    {
      selector: '.semantic-hidden',
      style: {
        opacity: 0,
        events: 'no',
      } as never,
    },
    {
      selector: 'edge',
      style: {
        events: 'no',
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
      selector: 'edge[sourceSupported = 1]',
      style: {
        'line-color': '#2f7d67',
        'target-arrow-color': '#2f7d67',
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
      minZoom: CYTOSCAPE_MIN_ZOOM,
      maxZoom: CYTOSCAPE_MAX_ZOOM,
      boxSelectionEnabled: false,
      autounselectify: true,
    });
    cy = c;
    // Canonical precomputation must not make the Cytoscape lifecycle depend on
    // expansion state; visibility changes project into this same instance.
    untrack(() => rebuildCanonicalHierarchyLayout());

    const nodeAtRenderedPoint = (x: number, y: number): cytoscape.NodeSingular | undefined =>
      c.nodes()
        .filter((node) => !node.hasClass('semantic-hidden') && (() => {
          const box = node.renderedBoundingBox({ includeLabels: true, includeOverlays: false });
          return x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2;
        })())
        .sort((left, right) => {
          const depth = ancestorsOf(byId, right.id()).length - ancestorsOf(byId, left.id()).length;
          if (depth !== 0) return depth;
          const leftBox = left.renderedBoundingBox({ includeLabels: true, includeOverlays: false });
          const rightBox = right.renderedBoundingBox({ includeLabels: true, includeOverlays: false });
          return leftBox.w * leftBox.h - rightBox.w * rightBox.h;
        })[0];

    const beginPaintedGroupDrag = (event: MouseEvent): void => {
      if (event.button !== 0) return;
      const rect = container.getBoundingClientRect();
      const hit = nodeAtRenderedPoint(event.clientX - rect.left, event.clientY - rect.top);
      if (hit?.isParent()) {
        beginGroupDrag(hit.id(), event);
      }
    };

    window.addEventListener('mousemove', continueGroupDrag, true);
    window.addEventListener('mouseup', finishGroupDrag, true);
    container.addEventListener('mousedown', beginPaintedGroupDrag, true);

    const handleTap = (event: cytoscape.EventObject): void => {
      const eventNode = event.target === c || event.target.isNode?.() !== true
        ? undefined
        : event.target as cytoscape.NodeSingular;
      const hit = eventNode !== undefined && !eventNode.isParent()
        ? eventNode
        : nodeAtRenderedPoint(event.renderedPosition.x, event.renderedPosition.y);
      if (hit !== undefined) onSelect(hit.id());
    };
    c.on('tap', handleTap);
    c.on('mouseover', 'node', (e) => {
      e.target.addClass('hover');
      container.style.cursor = e.target.isParent() ? 'move' : 'pointer';
    });
    c.on('mouseout', 'node', (e) => {
      e.target.removeClass('hover');
      container.style.cursor = '';
    });
    c.on('pan zoom resize', updateBandStripes);
    c.on('zoom', () => {
      currentZoom = c.zoom();
      applySemanticPresentation(c);
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
      if (!grabbedNodeMoved && draggedDistance < DRAG_DISTANCE_THRESHOLD) return;
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
        settleSprings(SPRING_SETTLE_DECAY);
        return;
      }
      const parent = e.target.parent();
      if (parent.nonempty()) {
        resolveCurrentRootCollisions(parent.id());
        saveGroupLayout(parent.id());
      } else {
        resolveCurrentRootCollisions(e.target.id());
      }
      updateDraggedGroupAnchor(e.target);
      persistVisiblePositions(e.target);
    });

    // Resize is presentation-only. Canonical node and maturity-band geometry
    // changes only during initial layout or an explicit Layout Now request.
    const resizeObserver = new ResizeObserver(() => {
      c.resize();
      const size = containerSize();
      if (size.width === 0 || size.height === 0) return;
      layoutOrientation = size.height > size.width ? 'portrait' : 'landscape';
      updateBandStripes();
      scheduleRenderDiagnostics();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('mousemove', continueGroupDrag, true);
      window.removeEventListener('mouseup', finishGroupDrag, true);
      container.removeEventListener('mousedown', beginPaintedGroupDrag, true);
      c.off('tap', handleTap);
      cancelSprings();
      userStore?.flush();
      if (renderDiagnosticsFrame !== 0) cancelAnimationFrame(renderDiagnosticsFrame);
      renderDiagnosticsFrame = 0;
      c.destroy();
      cy = undefined;
    };
  });

  // Build the complete hierarchy once. Semantic zoom changes paint and
  // interaction only; it never adds, removes, reparents, or repositions nodes.
  $effect(() => {
    const vis = computeVisible(graph, effectiveExpanded);
    untrack(() => syncElements(vis));
    if (cy !== undefined) {
      untrack(() => applySemanticPresentation(cy!));
      requestAnimationFrame(() => {
        if (cy === undefined) return;
        cy.forceRender();
        applySemanticPresentation(cy);
      });
    }
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
  data-semantic-depth={semanticDepth}
  data-global-layout-count={globalLayoutCount}
  data-group-drag-event-count={groupDragEventCount}
  data-grabbed-node-id={grabbedNodeId ?? ''}
  data-compound-group-count={effectiveExpanded.size}
  data-current-zoom={currentZoom}
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
        data-node-parent-id={node.parentId}
        data-node-semantic-visible={node.semanticVisible}
        data-node-title-mode={node.titleMode}
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
