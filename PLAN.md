# Development Plan — Math Graph

Living checklist toward **v1.0**. Update this file as work lands; bump the
`version` in `package.json` ([semver](https://semver.org/)) at each milestone —
the site displays it under the title.

## v0.1 — Walking skeleton (in progress)

- [x] Scaffold Vite + Svelte 5 + TypeScript project
- [x] Shared data model (`src/lib/types.ts`: ConceptGraph / nodes / edges)
- [x] GitHub Actions workflow: test → build → deploy to Pages
- [x] YAML knowledge base (`src/data/curriculum.yaml`) + validating parser
      (duplicate ids, dangling refs, cycle detection) with line-numbered errors
- [x] Initial curriculum: 12 categories, 94 concepts, elementary →
      2nd-year undergraduate, every node linked to Wikipedia
- [x] Interactive graph: Cytoscape + dagre, zoom/pan, DAG left-to-right flow
- [x] Multilevel view: categories collapse/expand in place (edge aggregation)
- [x] Info panel: description, stage badge, prerequisite/dependent chips,
      Wikipedia link
- [x] Version number displayed under site title
- [x] Public GitHub repo, Pages enabled, first deploy live
      (https://mckoss.com/math-graph/)

## v0.2 — Content & correctness

- [ ] Review curriculum for pedagogical accuracy (edges = true prerequisites)
- [ ] Verify all Wikipedia links resolve (automated link check in CI)
- [x] Data-format direction settled: YAML knowledge base (comments +
      diff-friendly), extensible per-node attributes (decided during v0.1;
      custom DSL and PEG grammar explored and abandoned)
- [ ] Richer node attributes (e.g. importance/centrality, typical course name)

## v0.3 — Navigation & engagement

- [ ] Search / jump-to-concept box with autocomplete
- [ ] "Learning path" view: select a target concept, highlight the full
      prerequisite subtree in topological order
- [ ] URL state (deep links to a selected node / expansion state)
- [ ] Smooth guided animations when expanding categories

## v0.4 — Depth

- [ ] Second-level subgraphs where warranted (e.g. Calculus → limits,
      derivatives, integrals as their own expandable clusters)
- [ ] Per-node "aha" blurbs: why the concept matters, not just what it is
- [ ] Optional per-stage filtering (show only through high school, etc.)

## v0.5 — Polish

- [ ] Mobile / touch support (pinch zoom, tap targets, responsive panel)
- [ ] Accessibility pass (keyboard navigation, ARIA, reduced motion)
- [ ] Performance check with full graph expanded (layout time, FPS)
- [ ] Dark mode

## v1.0 — Release

- [ ] Full curriculum coverage reviewed end-to-end
- [ ] About page: inspiration, how to read the graph, how to contribute
- [ ] Contribution guide for adding concepts (edit the data file, PR checks)
- [ ] Final visual design pass
- [ ] Announceable: stable URL, README screenshots, license
