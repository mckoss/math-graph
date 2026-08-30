# Development Plan — Knowledge Graph

Living checklist toward **v1.0**. Update this file as work lands. The
`version` in `package.json` ([semver](https://semver.org/)) is bumped when an
accepted checkpoint merges to `main`; review builds append their feature
branch name to the current main version. The site displays the resulting build
version under the title.

## Design decisions

- The product and browser title is exactly **Knowledge Graph**. It is a
  domain-independent knowledge explorer, not a prescribed course sequence.
  The selected graph's topic is the subtitle; the bundled default is **Math**.
- Every YAML file under `src/data/graphs/` is an independent canonical
  knowledge graph. The application discovers the collection automatically and
  provides a domain selector, so adding Physics, Chemistry, Computer Science,
  or another domain requires data and validation work but no registry edit in
  application code. Math and Physics are the initial bundled examples.
- Each graph defines required metadata with a stable kebab-case `id`, display
  `topic`, optional description, and at most one collection-wide `default`.
  Dataset ids namespace all browser-owned ratings and future layout state so
  switching domains never mixes user data. The previous Math-only storage key
  is read solely as a backwards-compatible migration source for `math`.
- Generated JSON or other artifacts must be derived reproducibly and must
  never become a competing source of truth.
- The canonical YAML is JSON-shaped and every data object is covered by the
  checked-in schema. It defines display metadata as well as content:
  `metadata`, `maturityLevels`, recursively nested `groups`, flat `concepts`
  with group references, and prerequisite `dependencies`. Within a dataset,
  all cross-referenced ids use one shared kebab-case namespace.
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
- Dependencies are intentionally sparse and definitional: `a -> b` means
  understanding `b` genuinely depends on `a`. A useful example, visual model,
  solution technique, neighboring field, or conventional teaching order is
  not sufficient. Independent roots are preferable to invented connectivity.
  Linear chains remain concise in YAML (`a -> b -> c`) and expand into adjacent
  immediate dependencies.
- The primary dependency graph excludes ubiquitous background knowledge when
  an edge would not discriminate among targets. Logic, language, basic
  reasoning, and similarly pervasive foundations do not point to every topic
  merely because they inform it. Formal Logic receives a dependency edge only
  where its specific concepts are genuinely required. A future optional
  relationship overlay may expose broader `uses`, `informed-by`, or
  `foundation` connections without adding them to the default layout or to
  prerequisite-frontier calculations.
- Vertical dependency order is a hard interaction and layout constraint: every
  visible block must remain strictly below all visible prerequisite parents,
  with enough center-to-center clearance for both full block heights plus the
  configured gap. The rule applies to concept edges and the aggregate edges
  produced by collapsed groups, both after automatic layout and while a user
  drags a block. An upward drag stops at the greatest prerequisite boundary
  without moving any prerequisite. A downward drag retains the manipulated
  block's position and pushes only violating dependents downward, recursively
  through their descendant dependency closure.
- The graph flows generally from top to bottom, from foundations toward more
  mature concepts. Backward maturity edges require an explicit justification;
  non-universal links such as `sets -> functions`,
  `coordinate-geometry -> graphing`, and `combinatorics -> probability` are
  omitted rather than promoting introductory concepts to a later level.
- Maturity ids, labels, ready-to-render suffixes, order, descriptions, colors,
  and tints come entirely from each graph's YAML. The Math example defines
  `elementary`, `high-school`, `undergraduate`, and `graduate`; the Physics
  example independently defines `foundational`, `secondary`, and
  `undergraduate`. All configured horizontal
  bands are shown in data order, including empty bands. Every group has one
  explicit data-defined maturity level and must reside wholly in that zone;
  concepts and nested groups must match their immediate parent's level. A
  subject spanning levels is represented by sibling groups such as
  `elementary-algebra` and `high-school-algebra`, never by one cross-zone
  container.
- Every group and concept has a graph-wide unique display title so spoken and
  visual references are unambiguous. A group's visible title otherwise omits
  its maturity-level name because the containing band already supplies that
  context; add a maturity or other qualifying prefix only when the same base
  subject appears elsewhere in the graph. Stable ids remain independently
  unique and are still used for every cross-reference.
- Client-side layout is responsive while prioritizing readability and a clear
  top-to-bottom maturity flow over filling the full width. Nodes and labels
  must remain comfortably legible at the initial fit, ranks should form a
  narrower vertical composition, and empty maturity bands may be compacted to
  avoid large unused areas while remaining visible.
- Automatic layout keeps Dagre's dependency-aware, crossing-reduced
  left-to-right rank order, then compacts each rank toward the graph
  centerline without overlap. The explicit **Layout Now** control clears saved
  drag offsets and recomputes this compact layout for the current visible
  graph. Blocks animate from their current displayed positions to the new
  targets with a coordinated, visible approximately 900 ms cubic ease-in and
  ease-out transition for both nodes and camera; the control must never visibly
  clear and redraw the graph from a common origin.
- Dense views such as **Expand all** wrap nodes into maturity-band rows whose
  model width is capped to the current viewport. Extra content grows
  vertically, opens aligned to the earliest visible maturity band, and may
  require downward panning; the explicit Fit control remains the way to
  request a whole-graph overview.
- Expanding or collapsing a group is not a global layout operation. Every
  already-visible node retains its exact model coordinates and the expanded
  compound shares the collapsed block's former geometric center; only newly
  revealed descendants receive compact positions around that center.
- Expansion has separate requested and visible state. Explicit open/close
  actions update the persisted requested set. The visible set contains only
  requested groups whose current compound geometry can avoid external blocks
  at the current zoom. Opening computes the minimum feasible global zoom for
  the requested set and animates to it. Zooming out visually collapses groups
  that are no longer feasible without discarding the request; zooming back in
  restores them automatically. Nested groups restore only with visible
  ancestors, and a small threshold hysteresis prevents flicker.
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
- Full block rectangles, including the configured gap, must not overlap after
  automatic layout, direct dragging, spring-following motion, or group
  expansion. Expansion never moves an existing neighbor: the camera instead
  animates to the minimum globally safe zoom, and an expansion that is not
  feasible at the current zoom is visually collapsed while its requested state
  remains available for automatic restoration after zooming in.
- Expanding a group preserves the parent hierarchy: the group remains visible
  as a containing group and its direct children appear inside it. Nested
  subgroups remain nested groups rather than promoting descendants to top-level
  graph nodes. Expansion and collapse are visibility-and-camera operations,
  never layout operations: every element visible both before and after the
  toggle retains exactly the same model-space center, including the containing
  group's center. Every element has one canonical parent-local coordinate even
  while hidden; expansion atomically reveals children at those coordinates and
  collapse atomically hides them. Node centers never animate during either
  operation—only the camera does. This is a visualization state, not a separate
  schema type.
- Every expanded group recursively applies the same compact top-to-bottom
  dependency-rank layout used at the graph root, except that its children need
  no maturity-band partition because the whole group belongs to one band.
  Direct child concepts and subgroup compounds are rigid units; disconnected
  or wide ranks wrap, barycentric ordering reduces crossings, full boxes cannot
  overlap, and each scope is centerline-compacted in coordinates relative to
  its unchanged parent center. After recursive layout establishes topology and
  ordering, a uniform parent-local transform is optimized against the actual
  fixed exterior neighborhood to minimize the collision-free camera zoom; its
  aspect ratio remains one. Camera zoom, rather than arbitrary fixed
  compression, restores readable box and text size.
- An expanded group remains assigned to its one maturity zone, but expansion
  itself does not restack bands or move their existing members.
- A normal block click selects that block and opens its information sidebar;
  the redundant per-node `?` affordance is not displayed. Double-clicking
  anywhere on a collapsed group expands it. Double-clicking an expanded group
  or one of its descendants toggles the nearest containing group.
- Once a block is selected, its sidebar persists through background clicks,
  group expansion, and bulk expansion until the user explicitly closes it,
  selects another block, or changes domains. Selection emphasizes only the
  chosen block; unrelated blocks and dependency edges retain their normal
  opacity.
- Below 100% zoom, boxes and text scale normally with the graph. At and above
  100%, ordinary boxes and typography remain clamped to their nominal rendered
  size while their center positions continue to spread; groups retain their
  slightly larger type and structural container styling. The transition at
  100% is continuous.
- Color has one semantic meaning: maturity level. Every group, concept, legend
  item, and zone uses the level color and tint defined by that graph's YAML;
  no rotating or arbitrary subject-family palette is applied. Groups are
  distinguished by typography, border, and container treatment instead.
- The information sidebar always lists the selected block's immediate
  prerequisites under **Depends on** and its immediate dependents as
  navigable controls, including an
  explicit empty state. For groups, these are derived external neighbors of
  descendant concept edges and mapped to the currently visible blocks, so a
  collapsed or expanded group remains an exploration entry point.
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
  Spring followers are limited to the directly manipulated block's maturity
  zone; dragging must never resize another zone by moving one of that zone's
  blocks as a secondary animation effect.
  Reduced-motion users receive direct node dragging without coupled animation.
  Child rearrangements are retained by node id when their group is closed and
  reopened. Group children save `{dx, dy}` relative only to their immediate
  parent; top-level blocks separately use maturity-zone-local coordinates so
  both survive responsive resizing. Drag offsets for
  the directly moved block and any collision- or dependency-propagated blocks
  are persisted in domain-namespaced browser local storage and restored from a
  fresh computed layout after refresh; stale ids are safely ignored.
- Layout coordinates form an affine transform tree. A block stores coordinates
  relative to its immediate parent; rendered graph coordinates are obtained by
  composing the transforms along root → maturity zone → group → nested group →
  block. Dragging inverse-maps the accepted graph point into that parent-local
  coordinate system. Because groups cannot cross zones, each block has one
  unambiguous transform path. Cytoscape compound bounds are presentation output,
  not authoritative parent coordinates.
- Expanded and collapsed group state is persisted per knowledge domain. After
  **Layout Now**, refreshing the page must reproduce the same visible blocks,
  model positions, maturity-band geometry, zoom, and camera framing without a
  perceptible jump.
- Optional historical metadata describes a development period or meaningful milestones,
  not necessarily a single moment of invention. Notes distinguish discovery,
  notation, formalization, publication, and generalization; attributions favor
  honest cultural, co-discovery, and collaborative context over false
  precision. A selected concept's sidebar displays its BCE/CE development
  period, approximate-date status, note, and attributed people or cultures;
  group sidebars omit history because the schema restricts it to concepts.
  Historical claims need multiple citations and explicit provenance before the
  content is considered reviewed.
- Discovery chronology is a strong audit signal for dependency quality. When
  the prerequisite's earliest recorded development is later than the
  dependent concept's latest recorded development, the derived edge is shown
  dashed. Missing or overlapping periods remain unclassified. A dashed edge
  indicates a likely modern pedagogical convention and should be reviewed for
  removal, reversal, or replacement with knowledge truly required to
  understand the dependent; it is not automatically invalid because later
  formalization of an older implicit idea is possible. Aggregated group edges
  are dashed when any represented concept dependency carries this signal.
- The user reviews meaningful interface changes through `npm run dev`;
  automated checks complement rather than replace that review. When requested,
  a checkpoint may be consolidated into the primary local `main` worktree for
  review, but it is not pushed or deployed until accepted.
- Review worktrees retain the semantic version currently on `main` and append
  a sanitized feature-branch name to the displayed version. Semantic version
  bumps happen only while integrating accepted work into `main`.

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
4. **Persistence and study controls:** `to-learn` / `have-learned` bookmarks, schema-backed
   median time-to-familiarity estimates, and prerequisite-frontier calculations
   from the user's locally stored knowledge ratings.
5. **Graph meaning and history:** weighted aggregate group-edge styling,
   history UI, and reviewed multi-source provenance for historical claims.
   The Math example's prerequisite set has been critically reduced from 163
   to 110 immediate, definitional dependencies; integer and polynomial
   factorization are separate concepts, and definite historical-order
   mismatches are derived as dashed audit signals.
6. **Multi-domain foundation (completed):** v0.3.0 recasts the application as
   Knowledge Graph, auto-discovers independently authored YAML graphs, displays
   the selected topic as a switchable subtitle, namespaces local state by graph
   id, and bundles Math plus a compact Physics sample. Strict prerequisite
   clearance and asymmetric drag propagation were included in the accepted
   visual checkpoint on 2026-08-29. Stop before adding further domains or
   expanding the generic metadata vocabulary.

## v0.1 — Walking skeleton (in progress)

- [x] Scaffold Vite + Svelte 5 + TypeScript project
- [x] Shared data model (`src/lib/types.ts`: ConceptGraph / nodes / edges)
- [x] GitHub Actions workflow: test → build → deploy to Pages
- [x] YAML knowledge graphs (`src/data/graphs/*.yaml`) + standard YAML
      loading, checked-in schema, and semantic validation (duplicate ids,
      dangling refs, cycle detection)
- [x] Initial Math example graph: 22 groups, 96 concepts, elementary →
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

## v0.2 — Math example content & correctness

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
- [x] Persist user rearrangements locally by node id, retaining positions across
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

## Beyond v1.0 — Domain packs and large-corpus ingestion

Goal: support independently maintained domain packs and programmatic bulk
ingestion without coupling the explorer engine to one field. The Math pack may
eventually ingest the mathematics corpus on Wikipedia; other domains choose
their own authoritative sources. Pipelines remain reproducible, offline-first,
and distinct from hand-curated ground truth.

- [ ] Acquire the corpus offline (pick most efficient source):
      - Kiwix ZIM of a relevant Wikipedia subset (prebuilt, smallest), or
      - enwiki `pages-articles` dump + `categorylinks`/`page` SQL dumps from
        dumps.wikimedia.org, scoping via transitive closure of
        a domain root category (bounded depth + blocklist — category graphs
        are noisy), cross-checked against an appropriate curated article list
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
