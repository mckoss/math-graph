# Knowledge-base schema

Knowledge Graph discovers every canonical dataset under
`src/data/graphs/*.yaml`. `loadKnowledgeBase()` in `src/lib/knowledge-base/`
reads each file with the standard YAML library and
mechanically normalizes it into the `ConceptGraph` used by the interface. The
unit suite checks the parsed value against the checked-in JSON Schema at
`src/data/knowledge-base.schema.json` and separately verifies semantic graph
invariants.

Each YAML document owns its topic metadata and content taxonomy as well as the content itself.
Maturity ids, labels, ordering, descriptions, and colors are data—not constants
in the TypeScript application. Groups may nest to any depth, but each group and
all of its children occupy exactly one maturity zone. Concepts remain a flat
collection that references group ids.

## Top level

The canonical document has metadata and four top-level lists:

```yaml
metadata:        # stable dataset identity and topic selector label
maturityLevels:  # ordered display metadata for horizontal maturity bands
groups:          # recursively nested organizational groups
concepts:        # flat concept records with group and maturity references
dependencies:    # prerequisite chains written with "->"
```

All cross-referenced ids within one dataset share the same kebab-case format
and namespace. A maturity
level, group, subgroup, or concept may not reuse another record's id.

## Dataset metadata

```yaml
metadata:
  id: physics
  topic: Physics
  default: false
  description: "A starter map of physical science."
```

| Key           | Required | Value |
| ------------- | -------- | ----- |
| `id`          | yes      | stable kebab-case dataset id used to namespace browser state |
| `topic`       | yes      | short subtitle and domain-selector label |
| `default`     | no       | whether this graph opens initially; at most one bundled graph may set it |
| `description` | no       | plain-language scope of the dataset |

Dataset ids must be unique across files. Files are auto-discovered; no source
registry needs to be edited when adding a domain.

## Maturity levels

Maturity levels control band order, labels, and colors in the visualization.
The Math example defines elementary through graduate levels; the Physics
example defines foundational through undergraduate levels. The loader and
visualization do not hard-code either set.

```yaml
maturityLevels:
  - id: elementary
    label: Elementary
    order: 1
    color: "#d9920f"
    tint: "#fbeccd"
    displaySuffix: "grades 1–8"
    gradeRange: { from: 1, to: 8 }
    description: "Foundational school mathematics"
```

| Key           | Required | Value |
| ------------- | -------- | ----- |
| `id`          | yes      | globally unique kebab-case id |
| `label`       | yes      | display label |
| `order`       | yes      | numeric top-to-bottom sort order; unique among maturity levels |
| `color`       | yes      | CSS color for strong accents |
| `tint`        | yes      | CSS color for light backgrounds |
| `gradeRange`  | no       | inclusive `{ from, to }` school-grade range |
| `description` | no       | plain-language range or explanation, such as grade coverage |
| `displaySuffix` | no     | ready-to-render qualifier appended after the level label |

Every configured level produces a horizontal band, even when no current
concept uses it.

## Groups

Groups organize related concepts and may contain recursive `groups` lists.
Concepts are not nested inside groups; each concept references its most
specific group by id. This keeps concept records easy to search and edit while
allowing the taxonomy to grow beyond a fixed depth.

```yaml
groups:
  - id: elementary-number-systems
    label: Elementary Number Systems
    maturityLevel: elementary
    wikipedia: Number_system
    description: "Successive enlargements of the idea of number."
    groups:
      - id: signed-number-systems
        label: Signed Number Systems
        maturityLevel: elementary
```

| Key           | Required | Value |
| ------------- | -------- | ----- |
| `id`          | yes      | globally unique kebab-case id |
| `label`       | yes      | display label |
| `maturityLevel` | yes    | id of the one maturity zone containing the entire group |
| `wikipedia`   | no       | English Wikipedia article title, after `/wiki/` |
| `description` | no       | one- or two-sentence plain-language description |
| `groups`      | no       | recursively nested subgroup records |

The loader flattens groups into graph nodes with parent links and rejects any
concept or nested group whose maturity level differs from its immediate parent.
Subjects that span levels use sibling groups, such as `elementary-algebra` and
`high-school-algebra`, instead of a cross-zone container.

## Concepts

Concepts form one flat list:

```yaml
concepts:
  - id: natural-numbers
    label: Natural Numbers
    group: elementary-number-systems
    maturityLevel: elementary
    wikipedia: Natural_number
    description: "The counting numbers 1, 2, 3, ..."
```

| Key            | Required | Value |
| -------------- | -------- | ----- |
| `id`            | yes      | globally unique kebab-case id |
| `label`         | yes      | display label |
| `group`         | yes      | id of an existing group or subgroup |
| `maturityLevel` | yes      | id of an existing maturity-level record |
| `wikipedia`     | no       | English Wikipedia article title, after `/wiki/` |
| `description`   | no       | one- or two-sentence plain-language description |
| `history`       | no       | development period or milestones; concepts only |

Unknown keys fail schema validation, so typos such as `wikipeda` or
`maturitylevel` are caught.

## Historical metadata (`history`)

A concept may carry a `history` block describing a period of development or a
set of important milestones. Dates and names provide context; they do not
necessarily identify a single inventor.

```yaml
- id: derivatives
  label: Derivatives
  group: high-school-calculus
  maturityLevel: high-school
  history:
    from: 1665
    to: 1687
    circa: true
    note: "Developed independently."
    attributions:
      - name: Isaac Newton
        wikipedia: Isaac_Newton
      - name: Gottfried Wilhelm Leibniz
        wikipedia: Gottfried_Wilhelm_Leibniz
```

| Key            | Required | Value |
| -------------- | -------- | ----- |
| `from`, `to`   | no       | signed integer years (`-300` means 300 BCE); `from <= to`; year zero is not used |
| `circa`        | no       | boolean marking approximate dating |
| `note`         | no       | free-text explanation of the recorded milestones |
| `attributions` | no       | associated people or cultures as `{ name, wikipedia? }` records |

Use `note` to distinguish discovery, notation, formalization, publication, and
generalization. Name cultures when an individual attribution would overstate
the evidence, and include multiple names for distinct contributions or
independent work. A date range without names is preferable to false precision;
accuracy takes priority over completeness.

## Dependencies

Every stored dependency connects concepts. `a -> b` means *a is a prerequisite
of b*: arrows flow from foundations toward concepts that build on them. Chains
expand into adjacent pairs.

```yaml
dependencies:
  - counting -> natural-numbers -> integers
  - natural-numbers -> prime-numbers
```

Group-to-group and group-to-concept dependencies are invalid. Links displayed
for collapsed groups are aggregates derived from underlying concept
dependencies, never stored simplifications. Cross-group concept dependencies
are expected. Backward maturity links should appear only when the knowledge
base explicitly justifies the exception.

## Validation

The JSON Schema enforces document shape, required fields, value types,
recursive group structure, allowed keys, and kebab-case reference syntax. The
unit suite enforces relationships that require a global view of the data:

- ids are globally unique across maturity levels, groups, subgroups, and
  concepts;
- maturity `order` values are unique;
- every concept's `group` and `maturityLevel` references exist;
- every group has one explicit maturity level, and every concept or subgroup
  matches its immediate group's level;
- dependency endpoints exist and are concepts, not groups;
- dependencies contain no self-links or duplicate expanded pairs;
- the concept dependency graph is acyclic;
- historical ranges use signed BCE years, omit year zero, and satisfy
  `from <= to`;
- backward maturity dependencies are absent unless deliberately documented.

Invalid source in any bundled graph blocks a passing test run and therefore cannot deploy through
the normal GitHub Pages workflow.
