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
- The `cc-math` graph is independent of the existing Math graph and
  follows the Common Core source's own zones: Kindergarten, each of Grades 1-8,
  and High School. Its six high-school conceptual categories share the High
  School zone; it does not reuse the existing Math graph's maturity levels.
  Domains and clusters are recursively nested groups. Visible cluster and
  numbered-standard titles retain their references but use concise,
  content-centered noun phrases; the full official Common Core wording lives
  in sidebar descriptions, and lettered components remain in their parent
  standard descriptions. The source-oriented text outline retains the original
  Common Core headings while mirroring the same grade/domain/cluster/standard
  references and hierarchy. Only Kindergarten concepts may be dependency roots.
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
  concept relationships and are weighted by how many raw concept edges they
  represent.
- Dependencies are intentionally sparse and definitional: `a -> b` means
  understanding `b` genuinely depends on `a`. A useful example, visual model,
  solution technique, neighboring field, or conventional teaching order is
  not sufficient. Independent roots are preferable to invented connectivity.
  Linear chains remain concise in YAML (`a -> b -> c`) and expand into adjacent
  immediate dependencies.
- A dataset may keep dependencies as one plain list or divide them into
  `sourceSupported` and `inferred` lists while retaining the same concise path
  syntax. Source-supported edges use a distinct color; inferred and unannotated
  edges use the ordinary treatment. Historical-order mismatch remains an
  independent dashed-line signal and may coexist with either provenance.
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
  configured gap. The rule applies to raw detail edges and the aggregate edges
  produced for overview blocks, both after automatic layout and while a user
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
- Client-side layout prioritizes readability and a clear top-to-bottom
  maturity flow over filling the full width. Canonical model geometry is
  independent of the viewport; resizing changes only the camera projection and
  surrounding responsive UI. Nodes and labels must remain comfortably legible
  at the initial fit, ranks should form a narrower vertical composition, and
  empty maturity bands may be compacted while remaining visible.
- Automatic layout uses a bottom-up canonical dependency-rank algorithm with
  deterministic barycentric crossing reduction, then centers each rank without
  overlap. The explicit **Layout Now** control clears saved drag offsets and
  recomputes the compact layout for the complete hierarchy. Blocks animate from
  their current displayed positions to the new targets with a coordinated,
  visible approximately 900 ms cubic ease-in and ease-out transition for both
  nodes and camera; the control must never visibly clear and redraw the graph
  from a common origin.
- Within each maturity zone and group, dependency depth determines the earliest
  legal row: roots occupy row zero and each dependent occupies one row below
  its deepest immediate prerequisite. A block must appear in that earliest row
  unless an explicit deterministic canonical row capacity would overflow.
  Automatic layout must not introduce arbitrary extra rows or vertical gaps.
  Layout never wraps or repositions content in response to viewport width.
- Every concept and group is assigned one canonical, immediate-parent-relative
  position during initial construction and explicit **Layout Now**. Layout
  reserves the complete fully detailed envelope of every group at all times.
  The same fixed coordinates, group envelopes, maturity-zone envelopes, and
  relative transforms underlie every semantic-zoom representation.
- Whole-graph layout has exactly two entry points: initial graph construction
  and an explicit **Layout Now** request. Camera zoom, pan, Fit, canvas resize,
  and semantic-zoom representation changes must never invoke layout or mutate
  canonical geometry. Fit is the explicit way to request a whole-graph camera
  overview.
- The graph uses global semantic-zoom thresholds by hierarchy depth, derived
  once when the graph loads from its canonical group envelopes and initial
  viewport. Each level reveals before its largest overview group outgrows a
  comfortable share of the viewport, and successive thresholds remain ordered
  and distinct. The first threshold reveals direct children of top-level
  groups; each subsequent threshold reveals one deeper subgroup level
  everywhere in the graph. A group
  below its depth threshold uses its overview representation: its fixed fully
  detailed frame remains in place, descendants are hidden, and a large title
  is centered wholly inside the frame. Once its threshold is crossed, the
  group uses its detail representation: its name shrinks as needed to fit on a
  single reserved header line wholly inside the top of the same frame, followed
  immediately by its already-positioned children. Only a modest safety margin
  follows the last child row; no symmetric empty title area is reserved at the
  bottom. Crossing any threshold changes no model coordinate, group or zone
  envelope, zoom, or pan, and starts no automatic camera motion.
- There is no expansion state, no expand/collapse control, no bulk expansion
  command, and no double-click expansion behavior. Semantic representation is
  derived only from the current global camera zoom and is not persisted as user
  state. Nested groups retain their hierarchy in both representations rather
  than promoting descendants to top-level graph nodes.
- Overview renders aggregate dependency edges between the painted overview
  blocks that represent the raw concept endpoints; edge weight records how
  many concept dependencies each aggregate represents. Detail renders the raw
  concept-to-concept dependency edges and suppresses the corresponding overview
  aggregates. The edge projection changes paint only and cannot feed back into
  layout, geometry, or prerequisite validation.
- Dependency lines are visual context, not interactive objects. They cannot be
  selected or capture pointer events; selection and the detail panel belong to
  concept and group blocks only.
- Canonical layout recursively lays out every group bottom-up, then lays out the
  resulting root units and derives maturity-band envelopes from the full-detail
  compound extents. A group lays out only its direct child units, contracting
  dependencies between deeper descendants to edges between corresponding
  siblings at their lowest common ancestor. Once complete, that group is a
  rigid measured block in its immediate parent's layout; cross-group edges
  never reach back in to reposition its children.
- Maturity zones follow the same compositional rule: each zone independently
  lays out its assigned root units in zone-local coordinates, ignoring
  cross-zone edges for placement, and the graph root stacks the completed zone
  rectangles in maturity order. Cross-zone dependencies are still rendered and
  validated. The canonical transform chain is root → zone → group → subgroup →
  concept.
- Every group recursively applies the same compact top-to-bottom
  dependency-rank layout used at the graph root, except that its children need
  no maturity-band partition because the whole group belongs to one band.
  Direct concepts and subgroup compounds are rigid units; deterministic
  canonical capacity may wrap wide ranks, barycentric ordering reduces
  crossings, full boxes cannot overlap, and each scope is centerline-compacted
  relative to its unchanged parent center.
- A group frame is draggable as one rigid unit in either semantic
  representation. The drag changes only that group's immediate-parent
  translation; every descendant-local coordinate remains unchanged and every
  descendant world center receives the same translation. The containing group
  or maturity-zone full-detail envelope may grow to include the translated
  subtree.
- Semantic zoom never locks interaction. Users may pan, zoom, select, or drag
  while either representation is painted. Focus is never a viewport lock;
  zoom limits remain derived from the complete canonical graph.
- Viewport and container resizing is presentation-only: resize the Cytoscape
  canvas, redraw projected maturity bands, and update responsive UI metadata
  without changing any canonical node, group, or band coordinate.
- A node remains assigned to its data-defined maturity zone, but vertical drag
  is not clamped at the current zone edge. Block positions are maintained in a
  coordinate system relative to their zone. Each zone's graph-space height is
  derived from the fully detailed canonical envelope of all member blocks plus
  padding; ordered zone origins are obtained by stacking those heights.
  Dragging updates the local block coordinate, recomputes minimum contiguous
  zone extents, and shifts neighboring zone origins with their members while
  preserving the dragged block under the pointer. Empty zones retain a visible
  minimum height.
- Full canonical block rectangles, including the configured gap, must not
  overlap after automatic layout, direct dragging, spring-following motion, or
  either semantic representation. Crossing the semantic threshold never moves
  an existing neighbor or changes relative geometry.
- A normal painted block click selects that block and opens its information
  sidebar; the redundant per-node `?` affordance is not displayed. Once a block
  is selected, its sidebar persists through background clicks and semantic-zoom
  transitions until the user explicitly closes it, selects another block, or
  changes domains. Selection emphasizes only the chosen block; unrelated
  blocks and dependency edges retain their normal opacity.
- Hierarchy typography is fixed in canonical space. Detail titles and child
  labels use their established hierarchy-relative sizes; overview substitutes
  the fixed large centered group-title treatment. The camera then scales the
  selected paint representation uniformly without remeasuring its frame.
- Color has one semantic meaning: maturity level. Every group, concept, legend
  item, and zone uses the level color and tint defined by that graph's YAML;
  no rotating or arbitrary subject-family palette is applied. Groups are
  distinguished by typography, border, and container treatment instead.
- The information sidebar always lists the selected block's immediate
  prerequisites under **Depends on** and its immediate dependents as
  navigable controls, including an
  explicit empty state. For groups, these are derived external neighbors of
  descendant concept edges and mapped to the currently painted blocks, so a
  group remains an exploration entry point in either semantic representation.
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
  Child rearrangements are retained by node id across semantic-zoom transitions
  and refresh. Group children save `{dx, dy}` relative only to their immediate
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
- Semantic representation is derived from camera zoom and is not persisted.
  After **Layout Now**, refreshing the page must reproduce the same model
  positions, maturity-band and group geometry, zoom, camera framing, and
  consequently the same overview-or-detail paint without a perceptible jump.
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
   parent-local coordinates, zone-aware dragging, and fixed fully detailed
   canonical group envelopes. Published as v0.2.3 with user
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
- [x] Interactive graph: Cytoscape rendering with canonical bottom-up layout,
      zoom/pan, and prerequisite→dependent top-to-bottom flow
- [x] Multilevel hierarchy with semantic-zoom overview aggregation and raw-edge
      detail representation
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
- [ ] Simplify YAML authoring with hierarchical node representation: make each
      maturity zone a nesting level that contains its groups and nodes, and
      allow groups to contain child groups and concepts directly. Descendants
      inherit both zone and group location so those fields do not have to be
      repeated on every node. Preserve stable ids, flat dependency references,
      schema validation, and mechanical normalization to the runtime graph
      model.
- [x] Data principle settled: the knowledge base records concept-level
      dependencies only; group-to-group links are subjective
      simplifications, derived by the visualization's aggregation (the
      semantic checks reject dependencies that reference group ids)
- [x] Removed non-universal backward dependencies that conflicted with the
      maturity progression
- [x] Playwright smoke coverage for title, graph rendering, maturity bands,
      controls, and hierarchy representation
- [ ] Richer node attributes (e.g. importance/centrality, typical course name)

## v0.3 — Navigation & engagement

- [ ] Search / jump-to-concept box with autocomplete
- [ ] "Learning path" view: select a target concept, highlight the full
      prerequisite subtree in topological order
- [ ] URL state (deep links to a selected node and camera location)
- [ ] Refine semantic-zoom paint transitions without changing geometry or camera
- [ ] Re-evaluate the Cytoscape dependency. The application now owns canonical
      layout, hierarchy transforms, semantic-depth projection, drag constraints,
      and persistence; Cytoscape mainly supplies canvas rendering, edge paths,
      hit testing, and camera gestures. Compare that remaining value with a
      purpose-built renderer that supports fixed asymmetric group headers and
      fully controlled title animation without compound-node workarounds.
- [ ] Local `to-learn` / `have-learned` bookmarks for an interactive study guide
- [x] Persist user rearrangements locally by node id, retaining positions across
      knowledge-base additions and safely ignoring removed nodes

## v0.4 — Depth

- [ ] Second-level subgraphs where warranted (e.g. Calculus → limits,
      derivatives, integrals as their own nested groups)
- [ ] Per-node "aha" blurbs: why the concept matters, not just what it is
- [ ] Optional maturity filtering (show only through high school, etc.)
- [ ] Tune spring dragging after visual review: nearby nodes follow with
      distance-decayed coupling and settle smoothly after release

## v0.5 — Polish

- [ ] Mobile / touch support (pinch zoom, tap targets, responsive panel)
- [ ] Accessibility pass (keyboard navigation, ARIA, reduced motion)
- [ ] Performance check with the full hierarchy in detail representation
      (layout time, FPS)
- [ ] Tune responsive camera framing independently for landscape and portrait
      viewports, including dynamic zoom bounds, without changing model layout
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
