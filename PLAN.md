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
- Local development and GitHub Actions use the same exact current LTS Node.js
  release, pinned in `.nvmrc` and `package.json`; the deployment workflow reads
  `.nvmrc` rather than maintaining a separate version value. Workflow actions
  also use Node.js 24-native major releases rather than deprecated runtimes.
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
  bands are shown in data order, including empty bands. Every group has one
  explicit data-defined maturity level and must reside wholly in that zone;
  concepts and nested groups must match their immediate parent's level. A
  subject spanning levels is represented by sibling groups such as Elementary
  Algebra and High School Algebra, never by one cross-zone container.
- Client-side layout is responsive while prioritizing readability and a clear
  top-to-bottom maturity flow over filling the full width. Nodes and labels
  must remain comfortably legible at the initial fit, ranks should form a
  narrower vertical composition, and empty maturity bands may be compacted to
  avoid large unused areas while remaining visible.
- Dense views such as **Expand all** wrap nodes into maturity-band rows whose
  model width is capped to the current viewport. Extra content grows
  vertically, opens aligned to the earliest visible maturity band, and may
  require downward panning; the explicit Fit control remains the way to
  request a whole-graph overview.
- Focused expansion preserves the group's existing horizontal graph anchor;
  its container grows vertically only as required by its children's maturity
  bands. The initial camera zooms to make the internal concepts readable. If
  the expanded container would overlap surrounding root blocks, the group
  remains anchored and only those surrounding blocks move horizontally by the
  minimum distance needed to clear it.
- Focus is never a viewport lock. Zoom limits remain derived from the entire
  visible graph even while a group is expanded, so users can immediately zoom
  and pan back to surrounding blocks or use Fit to restore global context.
- A node remains assigned to its data-defined maturity zone, but vertical drag
  is not clamped at the current zone edge. Block positions are maintained in a
  coordinate system relative to their zone. Each zone's graph-space height is
  always derived from the envelope of its visible member blocks plus padding;
  ordered zone origins are obtained by stacking those heights. Dragging updates
  the local block coordinate, recomputes the minimum contiguous zone extents,
  and shifts neighboring zone origins with their members while preserving the
  dragged block under the pointer. Empty zones retain a visible minimum height.
- Full block rectangles, including the configured gap, must never overlap.
  Automatic layout, direct dragging, and spring-following motion all resolve
  collisions without violating maturity-band bounds or dense-view width caps.
- Expanding a group preserves the parent hierarchy: the group remains visible
  as a containing group and its direct children appear inside it. Nested
  subgroups remain nested groups rather than promoting descendants to top-level
  graph nodes. This is a visualization state, not a separate schema type.
- An expanded group container remains wholly inside its one maturity zone.
  Maturity zones expand vertically whenever visible nested content needs more
  room, shifting neighboring zones and their blocks together rather than
  compressing, crossing, or overlapping content.
- A normal block click is reserved for direct graph interaction and never
  opens the information panel. Every visible block has a distinct `?` button
  inside its upper-right corner; activating that control opens the panel for
  the block. The affordance is a real keyboard-accessible DOM button even
  though the graph itself is canvas-rendered.
- Users can self-evaluate each concept as `aware`, `familiar`, or `mastered`.
  Applying a level to a group recursively applies it to every descendant leaf
  concept; group details show the shared level or a mixed state. These ratings
  are user-owned state stored in browser local storage, not canonical YAML.
- Every concept will carry a schema-validated positive `familiarStudyHours`
  estimate in canonical YAML: the approximate study time a median learner
  needs to reach `familiar` understanding of that concept itself, excluding
  prerequisite study. The value is an intentionally rough planning estimate,
  not a promise or a personalized prediction.
- “Time to familiarity” for a target concept is the sum of
  `familiarStudyHours` across the unique unmet concepts in the target's full
  prerequisite closure, including the target. Traversal stops at the learner's
  current frontier: a concept rated `familiar` or `mastered` and all knowledge
  behind it contribute zero, while `aware` does not receive a time discount.
  Shared prerequisites are counted once. For a group target, compute the union
  for all descendant leaf concepts. The UI must identify the estimate as
  approximate and show both total time and the remaining concept set so the
  number is explainable.
- Dragging a node gives its visible two-hop neighborhood a subtle,
  distance-decayed spring response and a brief settling motion after release.
  Reduced-motion users receive direct node dragging without coupled animation.
  Child rearrangements are retained by node id when their group is closed and
  reopened. Saved positions are relative to the group anchor and normalized
  within maturity bands so they survive responsive resizing; they remain
  session-only until the separate browser-persistence checkpoint.
- Layout coordinates form an affine transform tree. A block stores coordinates
  relative to its immediate parent; rendered graph coordinates are obtained by
  composing the transforms along root → maturity zone → group → nested group →
  block. Dragging inverse-maps the accepted graph point into that parent-local
  coordinate system. Because groups cannot cross zones, each block has one
  unambiguous transform path. Cytoscape compound bounds are presentation output,
  not authoritative parent coordinates.
- Historical metadata describes a development period or meaningful milestones,
  not necessarily a single moment of invention. Notes distinguish discovery,
  notation, formalization, publication, and generalization; attributions favor
  honest cultural, co-discovery, and collaborative context over false
  precision. Historical claims need multiple citations and explicit provenance
  before the content is considered reviewed.
- The user reviews meaningful interface changes through `npm run dev`;
  automated checks complement rather than replace that review. When requested,
  a checkpoint may be consolidated into the primary local `main` worktree for
  review, but it is not pushed or deployed until accepted.

## Delivery checkpoints

1. **Data-driven foundation and first visual review (completed):** canonical YAML,
   recursive groups, schema/runtime normalization, top-to-bottom colored
   maturity bands, unit validation, and minimal Playwright smoke coverage.
   Reviewed through `npm run dev` and accepted on 2026-08-29.
2. **Responsive interaction layout (completed):** landscape/portrait space
   filling, dynamic zoom, and spring-coupled nearby-node dragging. Reviewed
   through `npm run dev` and accepted on 2026-08-29.
3. **Layout readability and maturity constraints (in progress):** larger nodes
   and labels, denser vertical composition, content-derived maturity zones,
   parent-local coordinates, freely expanding zone-aware dragging, and
   viewport-width wrapping for dense views. Published as v0.2.3 with user
   authorization for continued visual review through `npm run dev`.
   The v0.2.4 follow-up makes non-overlap a hard constraint for layout and
   interaction.
   The v0.2.5 checkpoint adds explicit in-block `?` controls for opening
   details while reserving ordinary clicks for graph interaction.
   The v0.2.6 review checkpoint adds anchored non-overlapping group expansion,
   dynamically content-derived maturity zones, single-zone groups, composed
   parent-local transforms, session close/reopen layout retention, and locally
   persisted aware/familiar/mastered self-evaluation.
4. **Persistence and study controls:** locally persisted positions resilient to
   added or removed nodes, `to-learn` / `have-learned` bookmarks, schema-backed
   median time-to-familiarity estimates, and prerequisite-frontier calculations
   from the user's locally stored knowledge ratings.
5. **Graph meaning and history:** weighted aggregate group-edge styling,
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
- [ ] Tune spring dragging after visual review: nearby nodes follow with
      distance-decayed coupling and settle smoothly after release

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
