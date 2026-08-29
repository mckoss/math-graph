# Development Plan — Math Graph

Living checklist toward **v1.0**. Update this file as work lands; bump the
`version` in `package.json` ([semver](https://semver.org/)) at each milestone —
the site displays it under the title.

## Design decisions

- The product and browser title is exactly **Math Graph**. It is an interactive
  mathematics **knowledge explorer**, not a prescribed course sequence.
- `src/data/knowledge-base.yaml` is the canonical knowledge base. Generated
  JSON or other artifacts must be derived reproducibly and must never become a
  competing source of truth.
- The canonical YAML is JSON-shaped and every data object is covered by the
  checked-in schema. It defines display metadata as well as content:
  `maturityLevels`, recursively nested `groups`, flat `concepts` with group
  references, and prerequisite `dependencies`. All ids use one shared
  kebab-case namespace.
- The earlier DSL/PEG direction is abandoned. There is no custom syntax
  parser: `loadKnowledgeBase()` uses the standard YAML library for mechanical
  loading, while a checked-in JSON Schema and unit tests enforce structural
  and semantic validity.
- Schema and graph invariants are covered by unit tests; Playwright provides
  browser-level smoke coverage of the built application.
- Every dependency points from prerequisite to dependent. Stored edges connect
  concepts only; group edges are display aggregates derived from underlying
  concept relationships. A later visualization checkpoint will weight them by
  how many concept edges they represent.
- The graph flows generally from top to bottom, from foundations toward more
  mature concepts. Backward maturity edges require an explicit justification;
  non-universal links such as `sets -> functions`,
  `coordinate-geometry -> graphing`, and `combinatorics -> probability` are
  omitted rather than promoting introductory concepts to a later level.
- Maturity ids, labels, order, descriptions, colors, and tints come entirely
  from YAML. The current data defines `elementary` (grades 1–8), `high-school`
  (grades 9–12), `undergraduate`, and `graduate`; all configured horizontal
  bands are shown in data order, including empty bands. Groups use a
  deterministic representative level derived from descendants at any depth.
- Client-side layout is responsive and space-filling, optimized separately for
  landscape and portrait viewports with dynamic zoom. The dedicated layout
  worktree remains the source for later spring dragging and persistence work;
  those experiments are adapted intentionally, not copied wholesale.
- Historical metadata describes a development period or meaningful milestones,
  not necessarily a single moment of invention. Notes distinguish discovery,
  notation, formalization, publication, and generalization; attributions favor
  honest cultural, co-discovery, and collaborative context over false
  precision. Historical claims need multiple citations and explicit provenance
  before the content is considered reviewed.
- Before merge, the user reviews meaningful interface changes through
  `npm run dev`; automated checks complement rather than replace that review.

## Delivery checkpoints

1. **Data-driven foundation and first visual review (completed):** canonical YAML,
   recursive groups, schema/runtime normalization, top-to-bottom colored
   maturity bands, unit validation, and minimal Playwright smoke coverage.
   Reviewed through `npm run dev` and accepted on 2026-08-29.
2. **Responsive interaction layout:** landscape/portrait space filling, dynamic
   zoom, weighted aggregate group edges, spring-coupled dragging, and locally
   persisted positions resilient to added or removed nodes.
3. **Study and history experience:** `to-learn` / `have-learned` bookmarks,
   history UI, and reviewed multi-source provenance for historical claims.

## v0.1 — Walking skeleton (in progress)

- [x] Scaffold Vite + Svelte 5 + TypeScript project
- [x] Shared data model (`src/lib/types.ts`: ConceptGraph / nodes / edges)
- [x] GitHub Actions workflow: test → build → deploy to Pages
- [x] YAML knowledge base (`src/data/knowledge-base.yaml`) + standard YAML
      loading, checked-in schema, and semantic validation (duplicate ids,
      dangling refs, cycle detection)
- [x] Initial knowledge graph: 12 groups, 94 concepts, elementary →
      2nd-year undergraduate, every node linked to Wikipedia
- [x] Interactive graph: Cytoscape + dagre, zoom/pan, prerequisite→dependent
      top-to-bottom flow
- [x] Multilevel view: groups collapse/expand in place (edge aggregation)
- [x] Data-driven maturity bands and maturity-colored nodes
- [x] Info panel: description, maturity badge, prerequisite/dependent chips,
      Wikipedia link
- [x] Version number displayed under site title
- [x] Public GitHub repo, Pages enabled, first deploy live
      (https://mckoss.com/math-graph/)

## v0.2 — Content & correctness

- [ ] Review the knowledge base for pedagogical accuracy (edges = true prerequisites)
- [ ] Verify all Wikipedia links resolve (automated link check in CI)
- [ ] Verify historical ranges, contributors, collaboration claims, citations,
      and provenance end-to-end
- [x] Data-format direction settled: YAML knowledge base (comments +
      diff-friendly), checked-in schema, extensible per-node attributes
- [x] Data principle settled: the knowledge base records concept-level
      dependencies only; group-to-group links are subjective
      simplifications, derived by the visualization's aggregation (the
      semantic checks reject dependencies that reference group ids)
- [x] Removed non-universal backward dependencies that conflicted with the
      maturity progression
- [x] Playwright smoke coverage for title, graph rendering, maturity bands,
      controls, and expand/collapse state
- [ ] Richer node attributes (e.g. importance/centrality, typical course name)

## v0.3 — Navigation & engagement

- [ ] Search / jump-to-concept box with autocomplete
- [ ] "Learning path" view: select a target concept, highlight the full
      prerequisite subtree in topological order
- [ ] URL state (deep links to a selected node / expansion state)
- [ ] Smooth guided animations when expanding groups
- [ ] Local `to-learn` / `have-learned` bookmarks for an interactive study guide
- [ ] Persist user rearrangements locally by node id, retaining positions across
      knowledge-base additions and safely ignoring removed nodes

## v0.4 — Depth

- [ ] Second-level subgraphs where warranted (e.g. Calculus → limits,
      derivatives, integrals as their own expandable clusters)
- [ ] Per-node "aha" blurbs: why the concept matters, not just what it is
- [ ] Optional maturity filtering (show only through high school, etc.)
- [ ] Weighted spring dragging: nearby nodes follow with distance-decayed
      coupling and settle smoothly after release

## v0.5 — Polish

- [ ] Mobile / touch support (pinch zoom, tap targets, responsive panel)
- [ ] Accessibility pass (keyboard navigation, ARIA, reduced motion)
- [ ] Performance check with full graph expanded (layout time, FPS)
- [ ] Tune responsive space-filling layout independently for landscape and
      portrait viewports, including dynamic zoom bounds
- [ ] Dark mode

## Beyond v1.0 — Wikipedia-scale ingestion

Goal: programmatically ingest ALL mathematics articles on Wikipedia to fill
out the concept/topic tree. Pure code — no AI-in-the-loop ingestion. Optimize
for bandwidth: bulk offline snapshots, never per-article API crawling.

- [ ] Acquire the corpus offline (pick most efficient source):
      - Kiwix ZIM of the Wikipedia mathematics subset (prebuilt, smallest), or
      - enwiki `pages-articles` dump + `categorylinks`/`page` SQL dumps from
        dumps.wikimedia.org, scoping via transitive closure of
        Category:Mathematics (bounded depth + blocklist — the category graph
        is noisy), cross-checked against WikiProject Mathematics' article
        list (~30k articles)
- [ ] Offline extraction pipeline (Node script, checked into repo, cached
      artifacts): wikitext/HTML → title, lead-paragraph summary, internal
      links, categories, and History-section dates per article
- [ ] Candidate dependency edges from article structure with heuristics
      (links in the lead/definition sections, mutual linking, "generalization
      of"/"special case of" phrasing) — candidates only, distinct from the
      hand-curated ground truth
- [ ] Two-layer knowledge base: generated data (bulk, regenerable) +
      hand-curated overrides/approvals; curation queue for promoting
      candidate edges
- [ ] Scale work this forces: algorithmic multi-level clustering (categories
      of categories), on-demand subgraph loading, search over 10⁴ nodes

## v1.0 — Release

- [ ] Full knowledge-base coverage reviewed end-to-end
- [ ] About page: inspiration, how to read the graph, how to contribute
- [ ] Contribution guide for adding concepts (edit the data file, PR checks)
- [ ] Final visual design pass
- [ ] Announceable: stable URL, README screenshots, license
