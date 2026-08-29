<script lang="ts">
  import type { ConceptGraph, GraphNode } from './lib/types';
  import GraphView from './lib/viz/GraphView.svelte';
  import { maturityPaint, orderedMaturityLevels } from './lib/viz/colors';
  import {
    ancestorsOf,
    childrenByParent,
    computeVisible,
    conceptCountOf,
    nodesById,
  } from './lib/viz/graph-model';

  let { graph }: { graph: ConceptGraph } = $props();

  let selectedId = $state<string | null>(null);
  let expanded = $state<ReadonlySet<string>>(new Set());
  let graphView = $state<GraphView>();

  const byId = $derived(nodesById(graph));
  const children = $derived(childrenByParent(graph));
  const groupIds = $derived(graph.nodes.filter((n) => n.isGroup).map((n) => n.id));
  const conceptCount = $derived(graph.nodes.filter((n) => !n.isGroup).length);
  const visibleGraph = $derived(computeVisible(graph, expanded));
  const maturityLevels = $derived(orderedMaturityLevels(graph.maturityLevels));

  const selected = $derived(selectedId === null ? null : (byId.get(selectedId) ?? null));
  const prerequisites = $derived(
    selected === null
      ? []
      : graph.edges
          .filter((e) => e.to === selected.id)
          .map((e) => byId.get(e.from))
          .filter((n): n is GraphNode => n !== undefined),
  );
  const dependents = $derived(
    selected === null
      ? []
      : graph.edges
          .filter((e) => e.from === selected.id)
          .map((e) => byId.get(e.to))
          .filter((n): n is GraphNode => n !== undefined),
  );

  /** Select a node; expand its ancestor groups so it is actually visible. */
  function selectNode(id: string | null): void {
    if (id !== null) {
      const ancestors = ancestorsOf(byId, id).filter((a) => !expanded.has(a));
      if (ancestors.length > 0) expanded = new Set([...expanded, ...ancestors]);
    }
    selectedId = id;
  }

  function toggleGroup(id: string): void {
    const next = new Set(expanded);
    if (next.has(id)) {
      next.delete(id);
      // If the selection just got swallowed by the collapse, select the group.
      if (selectedId !== null && (selectedId === id || ancestorsOf(byId, selectedId).includes(id))) {
        selectedId = id;
      }
    } else {
      next.add(id);
    }
    expanded = next;
  }

  function expandAll(): void {
    expanded = new Set(groupIds);
    if (selectedId !== null && byId.get(selectedId)?.isGroup) selectedId = null;
  }

  function collapseAll(): void {
    expanded = new Set();
    if (selectedId !== null) {
      const ancestors = ancestorsOf(byId, selectedId);
      if (ancestors.length > 0) selectedId = ancestors[ancestors.length - 1];
    }
  }
</script>

<div class="shell">
  <header class="masthead">
    <div class="masthead-text">
      <div class="masthead-titleline">
        <h1>Math Graph</h1>
        <span class="version">v{__APP_VERSION__}</span>
      </div>
      <p class="tagline">An interactive mathematics knowledge explorer — from counting to calculus.</p>
    </div>
    <div class="masthead-stats">
      <span><strong>{conceptCount}</strong> concepts</span>
      <span class="dot">·</span>
      <span><strong>{graph.edges.length}</strong> connections</span>
    </div>
  </header>

  <main class="graph-area">
    <GraphView
      bind:this={graphView}
      {graph}
      {expanded}
      {selectedId}
      onSelect={selectNode}
      onToggleGroup={toggleGroup}
    />

    <p class="sr-only" role="status" aria-live="polite">
      Showing {visibleGraph.nodes.length} nodes and {visibleGraph.edges.length} connections.
    </p>

    <div class="controls" role="toolbar" aria-label="Graph controls">
      <div class="control-group">
        <button class="ctl" title="Zoom in" aria-label="Zoom in" onclick={() => graphView?.zoomBy(1.3)}>+</button>
        <button class="ctl" title="Zoom out" aria-label="Zoom out" onclick={() => graphView?.zoomBy(0.75)}>−</button>
        <button class="ctl" title="Fit to view" aria-label="Fit to view" onclick={() => graphView?.fit()}>⛶</button>
      </div>
      <div class="control-group">
        <button class="ctl wide" onclick={expandAll}>⊞ Expand all</button>
        <button class="ctl wide" onclick={collapseAll}>⊟ Collapse all</button>
      </div>
    </div>

    <div class="legend">
      <span class="legend-title">Maturity</span>
      {#each maturityLevels as level (level.id)}
        <span class="legend-item">
          <span class="swatch" style:background={level.tint} style:border-color={level.color}
          ></span>
          {level.label}
        </span>
      {/each}
    </div>

    <p class="hint" hidden={selected !== null}>
      Click a node to explore it · double-click a group to open it
    </p>

    <aside class="panel" class:open={selected !== null} aria-hidden={selected === null}>
      {#if selected}
        <button class="close" aria-label="Close panel" onclick={() => (selectedId = null)}>×</button>

        <div class="panel-badges">
          {#if selected.isGroup}
            <span class="badge badge-group">
              Group · {conceptCountOf(children, selected.id)} concepts
            </span>
          {/if}
          {#if selected.maturityLevel !== undefined}
            <span
              class="badge"
              style:background={maturityPaint(maturityLevels, selected.maturityLevel).tint}
              style:color={maturityPaint(maturityLevels, selected.maturityLevel).color}
              style:border-color={maturityPaint(maturityLevels, selected.maturityLevel).color}
            >
              {maturityPaint(maturityLevels, selected.maturityLevel).label}
            </span>
          {/if}
        </div>

        <h2 class="panel-title">{selected.label}</h2>

        {#if selected.description !== undefined}
          <p class="panel-desc">{selected.description}</p>
        {/if}

        {#if selected.isGroup}
          <button class="expand-btn" onclick={() => toggleGroup(selected.id)}>
            {expanded.has(selected.id) ? '⊟ Collapse group' : '⊞ Expand group'}
          </button>
        {/if}

        {#if prerequisites.length > 0}
          <h3 class="panel-sub">Builds on</h3>
          <div class="chips">
            {#each prerequisites as n (n.id)}
              <button class="chip" onclick={() => selectNode(n.id)}>
                <span class="chip-dot" style:background={maturityPaint(maturityLevels, n.maturityLevel).color}></span>
                {n.label}
              </button>
            {/each}
          </div>
        {/if}

        {#if dependents.length > 0}
          <h3 class="panel-sub">Leads to</h3>
          <div class="chips">
            {#each dependents as n (n.id)}
              <button class="chip" onclick={() => selectNode(n.id)}>
                <span class="chip-dot" style:background={maturityPaint(maturityLevels, n.maturityLevel).color}></span>
                {n.label}
              </button>
            {/each}
          </div>
        {/if}

        {#if selected.wikipedia !== undefined}
          <a
            class="wiki"
            href={`https://en.wikipedia.org/wiki/${selected.wikipedia}`}
            target="_blank"
            rel="noreferrer"
          >
            Read on Wikipedia →
          </a>
        {/if}
      {/if}
    </aside>
  </main>
</div>

<style>
  .shell {
    height: 100svh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ---- Header ---- */
  .masthead {
    flex: none;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 24px;
    padding: 18px 28px 16px;
    background: var(--ink);
    color: var(--paper);
    border-bottom: 3px solid var(--gold);
  }
  .masthead h1 {
    margin: 0;
    font-family: var(--display);
    font-weight: 600;
    font-size: 28px;
    letter-spacing: 0.2px;
    color: var(--cream);
  }
  .masthead-titleline {
    display: flex;
    align-items: baseline;
    gap: 4px;
  }
  .version {
    font-family: var(--sans);
    font-weight: 500;
    font-size: 11px;
    letter-spacing: 0.04em;
    color: var(--cream-dim);
  }
  .tagline {
    margin: 4px 0 0;
    font-size: 13.5px;
    color: var(--cream-dim);
  }
  .masthead-stats {
    flex: none;
    font-size: 13px;
    color: var(--cream-dim);
    white-space: nowrap;
  }
  .masthead-stats strong {
    color: var(--cream);
    font-weight: 600;
  }
  .masthead-stats .dot {
    margin: 0 6px;
  }

  /* ---- Graph area ---- */
  .graph-area {
    position: relative;
    flex: 1;
    min-height: 0;
    background:
      radial-gradient(circle, var(--grid-dot) 1px, transparent 1px) 0 0 / 26px 26px,
      var(--paper);
    overflow: hidden;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* ---- Floating controls ---- */
  .controls {
    position: absolute;
    top: 16px;
    left: 16px;
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .control-group {
    display: flex;
    flex-direction: column;
    border-radius: 10px;
    overflow: hidden;
    box-shadow: var(--soft-shadow);
    border: 1px solid var(--line);
    background: var(--card);
    width: max-content;
  }
  .ctl {
    appearance: none;
    border: none;
    background: transparent;
    padding: 8px 12px;
    min-width: 38px;
    font: 600 15px/1 var(--sans);
    color: var(--ink);
    cursor: pointer;
    text-align: center;
  }
  .ctl.wide {
    font-size: 12.5px;
    padding: 9px 12px;
    text-align: left;
  }
  .ctl + .ctl {
    border-top: 1px solid var(--line);
  }
  .ctl:hover {
    background: var(--hover);
  }

  /* ---- Legend ---- */
  .legend {
    position: absolute;
    left: 16px;
    bottom: 16px;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 9px 14px;
    border-radius: 10px;
    background: var(--card);
    border: 1px solid var(--line);
    box-shadow: var(--soft-shadow);
    font-size: 12px;
    color: var(--ink-soft);
  }
  .legend-title {
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 10.5px;
    color: var(--ink-faint);
  }
  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .swatch {
    width: 13px;
    height: 13px;
    border-radius: 4px;
    border: 1.5px solid;
    display: inline-block;
  }

  /* ---- Hint ---- */
  .hint {
    position: absolute;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 4;
    margin: 0;
    font-size: 12.5px;
    color: var(--ink-faint);
    background: color-mix(in srgb, var(--paper) 75%, transparent);
    padding: 4px 12px;
    border-radius: 999px;
    pointer-events: none;
  }

  /* ---- Info panel ---- */
  .panel {
    position: absolute;
    top: 16px;
    right: 16px;
    bottom: 16px;
    z-index: 6;
    width: min(330px, calc(100vw - 64px));
    box-sizing: border-box;
    padding: 22px 22px 26px;
    overflow-y: auto;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 16px;
    box-shadow: var(--panel-shadow);
    transform: translateX(calc(100% + 32px));
    transition: transform 0.28s cubic-bezier(0.3, 0.9, 0.3, 1);
  }
  .panel.open {
    transform: translateX(0);
  }
  .close {
    position: absolute;
    top: 10px;
    right: 12px;
    appearance: none;
    border: none;
    background: transparent;
    font-size: 22px;
    line-height: 1;
    color: var(--ink-faint);
    cursor: pointer;
    padding: 4px;
  }
  .close:hover {
    color: var(--ink);
  }
  .panel-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 10px;
  }
  .badge {
    display: inline-block;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.03em;
    padding: 3px 9px;
    border-radius: 999px;
    border: 1px solid;
  }
  .badge-group {
    background: var(--hover);
    color: var(--ink-soft);
    border-color: var(--line);
  }
  .panel-title {
    margin: 0 0 8px;
    font-family: var(--display);
    font-weight: 600;
    font-size: 24px;
    line-height: 1.15;
    color: var(--ink);
  }
  .panel-desc {
    margin: 0 0 14px;
    font-size: 13.5px;
    line-height: 1.55;
    color: var(--ink-soft);
  }
  .expand-btn {
    appearance: none;
    border: 1px solid var(--line);
    background: var(--hover);
    color: var(--ink);
    font: 600 13px/1 var(--sans);
    padding: 9px 14px;
    border-radius: 9px;
    cursor: pointer;
    margin-bottom: 8px;
  }
  .expand-btn:hover {
    background: var(--line);
  }
  .panel-sub {
    margin: 18px 0 8px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--ink-faint);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font: 500 12.5px/1 var(--sans);
    padding: 6px 11px;
    border-radius: 999px;
    cursor: pointer;
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
  }
  .chip:hover {
    border-color: var(--ink-faint);
    box-shadow: var(--soft-shadow);
  }
  .chip-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
  }
  .wiki {
    display: inline-block;
    margin-top: 20px;
    font-weight: 600;
    font-size: 14px;
    color: var(--link);
    text-decoration: none;
    border-bottom: 2px solid color-mix(in srgb, var(--link) 35%, transparent);
    padding-bottom: 1px;
  }
  .wiki:hover {
    border-bottom-color: var(--link);
  }

  @media (max-width: 720px) {
    .masthead {
      flex-direction: column;
      gap: 4px;
      align-items: flex-start;
    }
    .masthead-stats {
      display: none;
    }
    .legend {
      flex-wrap: wrap;
      max-width: calc(100vw - 32px);
    }
    .hint {
      display: none;
    }
  }
</style>
