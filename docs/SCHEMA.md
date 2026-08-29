# Curriculum knowledge-base schema

The math concept graph is described by a single YAML file,
`src/data/curriculum.yaml`, parsed by `parseCurriculum()` in
`src/lib/curriculum/parser.ts` into the `ConceptGraph` defined in
`src/lib/types.ts`. YAML was chosen for its comments, git-diff-friendly
line orientation, and attribute extensibility (a new node attribute is a
parser change only, never a syntax change).

## Top level

Three optional top-level keys, all lists:

```yaml
categories:   # category nodes, each containing its concepts
concepts:     # optional: top-level concepts that belong to no category
edges:        # dependency edges, written as "->" chain strings
```

## Categories and concepts

A **category** becomes a node with `isCategory: true`; each concept in its
`concepts` list gets `parent` set to the category's id. Nesting is one level
only — a concept may not contain `concepts` (the parser rejects it).

```yaml
categories:
  - id: number-systems             # required, kebab-case, globally unique
    label: "Number Systems"        # required, display name
    wikipedia: Number_system       # optional, en.wikipedia.org article title
    description: "Successive enlargements of the idea of number."  # optional
    concepts:
      - id: natural-numbers
        label: "Natural Numbers"
        wikipedia: Natural_number
        stage: elementary          # optional: elementary | middle |
                                   #   high-school | undergraduate
        description: "The counting numbers 1, 2, 3, ..."
```

Field reference (same keys for categories and concepts, except `concepts`,
which only categories may have):

| Key           | Required | Value                                                     |
| ------------- | -------- | --------------------------------------------------------- |
| `id`          | yes      | kebab-case string (`[a-z0-9]+(-[a-z0-9]+)*`), unique across the whole file |
| `label`       | yes      | display name string                                        |
| `wikipedia`   | no       | English Wikipedia article title, the part after `/wiki/` (e.g. `Complex_number`) |
| `stage`       | no       | one of `elementary`, `middle`, `high-school`, `undergraduate` |
| `description` | no       | one- or two-sentence plain-language string                 |
| `concepts`    | no       | (categories only) list of concept entries                  |

Unknown keys are reported as errors (so typos like `wikpedia:` get caught),
but the rest of the node is still used.

## Edges

Each edge entry is a **string** containing one or more `->` arrows.
`a -> b` means *a is a prerequisite of b* — the arrow points from the
foundation toward the concept that builds on it. Chains expand into pairs:
`a -> b -> c` is `a -> b` plus `b -> c`.

```yaml
edges:
  # "a -> b -> c" means a is prerequisite of b, b of c
  - natural-numbers -> integers -> rational-numbers
  - counting -> natural-numbers
  - algebra -> calculus       # category ids may appear in edges too
```

Edges may reference concepts across categories, and category ids themselves
(used for field-level dependencies, since the visualization initially shows
only categories). Exact duplicate edges are silently ignored.

## Validation

`parseCurriculum(source)` never throws. It returns
`{ graph, errors }` where every error carries a 1-based source line number,
and the valid portion of the graph is always returned:

- **YAML syntax errors** — each reported with its line; the semantic pass
  still runs on whatever parsed.
- **Structural errors** — non-mapping node entries, non-list sections,
  wrong value types, missing `id`/`label` (a node missing only its `label`
  is kept, with the id as its label).
- **Unknown keys** — on nodes and at the top level.
- **Bad ids** — non-kebab-case ids, duplicate ids (first definition wins).
- **Bad stages** — anything outside the four-value enum.
- **Bad edges** — non-string entries, missing `->`, malformed ids,
  references to unknown ids, self-dependencies.
- **Cycles** — the dependency graph must be a DAG; each cycle is reported
  as `dependency cycle: a -> b -> a` with the line of the edge that closes
  it.

## Example with an error

```yaml
concepts:
  - id: counting
    label: Counting
    stage: kindergarden      # error (line 4): unknown stage "kindergarden"
edges:
  - counting -> subitizing   # error (line 6): unknown id "subitizing"
```

Both errors are reported; the `counting` node (without a stage) is still in
the returned graph.
