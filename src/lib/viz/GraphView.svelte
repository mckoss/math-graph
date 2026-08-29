<script lang="ts">
  import { untrack } from 'svelte';
  import cytoscape from 'cytoscape';
  import dagre from 'cytoscape-dagre';
  import type { DagreLayoutOptions } from 'cytoscape-dagre';
  import type { ConceptGraph, GraphNode, MaturityLevel } from '../types';
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
  import {
    assignMaturityBands,
    clampPointToMaturityBand,
    constrainPointAgainstMaturityBandNodes,
    packMaturityBandNodes,
    placeInMaturityBands,
    separateMaturityBandNodes,
    type MaturityBandRect,
  } from './maturity-bands';
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
  let infoButtons = $state<Array<{ id: string; label: string; left: number; top: number }>>([]);
  let infoButtonFrame = 0;

  const FIT_PADDING = 36;
  const LAYOUT_MS = 480;

  function containerSize(): Size {
    return { width: container.clientWidth, height: container.clientHeight };
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
    const level = cy.zoom() * factor;
    cy.animate(
      { zoom: { level, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } } },
      { duration: 180, easing: 'ease-out' },
    );
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

    runLayout(oldPos.size === 0, focusId);
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
    infoButtons = c.nodes().map((node: cytoscape.NodeSingular) => {
      const box = node.renderedBoundingBox({ includeLabels: false, includeOverlays: false });
      return {
        id: node.id(),
        label: String(node.data('label')).split('\n')[0],
        left: box.x2 - 12,
        top: box.y1 + 12,
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
    const range = level.gradeRange;
    return range === undefined
      ? level.label
      : `${level.label} · grades ${range.from}–${range.to}`;
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
  ): void {
    const roots = c.nodes().filter((node) => node.parent().empty());
    const maxPasses = Math.max(12, roots.length * roots.length * 2);

    const shiftRoot = (root: cytoscape.NodeSingular, dx: number): void => {
      const leaves = root.isParent() ? root.descendants().not(':parent') : root;
      leaves.forEach((leaf: cytoscape.NodeSingular) => {
        const current = leaf.position();
        const shifted = { x: current.x + dx, y: current.y };
        leaf.position(shifted);
        targets.set(leaf.id(), shifted);
      });
    };

    for (let pass = 0; pass < maxPasses; pass++) {
      let changed = false;
      for (let i = 0; i < roots.length; i++) {
        for (let j = i + 1; j < roots.length; j++) {
          const a = roots[i];
          const b = roots[j];
          const ab = a.boundingBox({ includeLabels: true, includeOverlays: false });
          const bb = b.boundingBox({ includeLabels: true, includeOverlays: false });
          const overlapX = Math.min(ab.x2, bb.x2) - Math.max(ab.x1, bb.x1) + gap;
          const overlapY = Math.min(ab.y2, bb.y2) - Math.max(ab.y1, bb.y1) + gap;
          if (overlapX <= 0 || overlapY <= 0) continue;
          const direction = (bb.x1 + bb.x2) / 2 >= (ab.x1 + ab.x2) / 2 ? 1 : -1;
          shiftRoot(b, direction * overlapX);
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  /** Fit a model bbox and derive usable zoom limits from that fitted scale. */
  function animateViewport(
    c: cytoscape.Core,
    bbox: BBox,
    size: Size,
    animated: boolean,
    minimumZoom = 0,
  ): void {
    const viewport = viewportFor(bbox, size, FIT_PADDING);
    if (viewport.zoom < minimumZoom) {
      viewport.zoom = minimumZoom;
      viewport.pan = {
        x: size.width / 2 - minimumZoom * (bbox.x1 + bbox.x2) / 2,
        y: FIT_PADDING - minimumZoom * bbox.y1,
      };
    }
    const bounds = zoomBoundsFor(viewport.zoom);
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
  function runLayout(first = false, focusId?: string): void {
    const c = cy;
    if (!c || c.nodes().length === 0) return;
    cancelSprings();
    runningLayout?.stop();

    const size = containerSize();
    if (size.width === 0 || size.height === 0) return;
    lastLayoutSize = size;
    const layoutNodes = c.nodes().not(':parent');
    const spacing = deriveSpacing(size.width, size.height, layoutNodes.length);
    const snapshot = new Map<string, cytoscape.Position>();
    layoutNodes.forEach((node) => {
      snapshot.set(node.id(), { ...node.position() });
    });

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
    layoutNodes.positions((node) => targets.get(node.id()) ?? node.position());
    separateRootUnits(c, targets);
    layoutBounds = targetBBox(c, targets);
    const focusNode = focusId === undefined ? undefined : c.getElementById(focusId);
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
      animateViewport(c, viewportBounds, size, false, focusBox ? 0.9 : dense ? 0.75 : 0);
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
    animateViewport(c, viewportBounds, size, true, focusBox ? 0.9 : dense ? 0.75 : 0);
  }

  // ---- Drag springs --------------------------------------------------------

  let springSystem: SpringSystem | undefined;
  let springNodes: cytoscape.NodeSingular[] = [];
  let anchorNode: cytoscape.NodeSingular | undefined;
  let dragFrameId = 0;
  let settleFrameId = 0;
  let dragPending = false;
  let prefersReducedMotion = false;

  function constrainedPoint(
    node: cytoscape.NodeSingular,
    point: cytoscape.Position,
  ): cytoscape.Position {
    const bandIndex = bandAssignments.get(node.id()) ?? 0;
    const band = bandModelRects[bandIndex];
    if (band === undefined || node.isParent()) return point;
    const moving = {
      id: node.id(),
      band: bandIndex,
      point,
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
    return constrainPointAgainstMaturityBandNodes(moving, point, others, band);
  }

  function cancelSprings(): void {
    if (dragFrameId !== 0) cancelAnimationFrame(dragFrameId);
    if (settleFrameId !== 0) cancelAnimationFrame(settleFrameId);
    dragFrameId = 0;
    settleFrameId = 0;
    dragPending = false;
    springSystem = undefined;
    springNodes = [];
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
    const point = constrainedPoint(anchorNode, anchorNode.position());
    anchorNode.position(point);
    setAnchor(springSystem, point.x, point.y);
    springStep(springSystem);
    writeSpringPositions();
  }

  /** Brief decaying relaxation after release; positions last until re-layout. */
  function settleSprings(scale: number): void {
    if (!springSystem || !anchorNode) return;
    const point = constrainedPoint(anchorNode, anchorNode.position());
    anchorNode.position(point);
    setAnchor(springSystem, point.x, point.y);
    springStep(springSystem, undefined, scale);
    writeSpringPositions();
    if (scale > 0.05) {
      settleFrameId = requestAnimationFrame(() => settleSprings(scale * 0.8));
    } else {
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
    c.on('render', scheduleInfoButtons);

    c.on('grab', 'node', (e) => {
      if (prefersReducedMotion) return;
      cancelSprings();
      buildSprings(e.target);
    });
    c.on('drag', 'node', (e) => {
      const point = constrainedPoint(e.target, e.target.position());
      e.target.position(point);
      if (!springSystem || !anchorNode || e.target !== anchorNode) return;
      dragPending = true;
      if (dragFrameId === 0) dragFrameId = requestAnimationFrame(runDragFrame);
    });
    c.on('free', 'node', (e) => {
      const point = constrainedPoint(e.target, e.target.position());
      e.target.position(point);
      if (!springSystem || !anchorNode || e.target !== anchorNode) return;
      if (dragFrameId !== 0) cancelAnimationFrame(dragFrameId);
      dragFrameId = 0;
      settleSprings(0.8);
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
>
  <div class="bands" role="list" aria-label="Maturity levels">
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
  <div class="graph" aria-label="Mathematics dependency graph" bind:this={container}></div>
  <div class="node-info-layer">
    {#each infoButtons as button (button.id)}
      <button
        class="node-info"
        type="button"
        aria-label={`More information about ${button.label}`}
        title={`More information about ${button.label}`}
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
