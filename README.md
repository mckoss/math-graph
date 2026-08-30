# Knowledge Graph

An interactive, domain-independent explorer showing how concepts depend on one
another. Select a topic, zoom through its directed knowledge graph, and expand
broad groups in place to inspect their internal concepts.

**Live site:** https://mckoss.com/math-graph/

Every arrow points from foundational knowledge to something that builds on it.
The repository currently bundles a substantial Math graph and a compact Physics
graph that exercises domain switching. Adding another YAML graph automatically
adds it to the topic selector without an application-code registry change.

The deployed route retains the repository's historical `/math-graph/` path;
that path is deployment identity, not an engine-level subject assumption.

## How it works

- **Knowledge graphs are data, not code.** Each independent graph is a commented
  YAML file under [`src/data/graphs/`](src/data/graphs). See
  [`docs/SCHEMA.md`](docs/SCHEMA.md) for the format. Add a file with unique
  metadata, levels, groups, concepts, and dependency chains; the application
  discovers it automatically.
- **The loader** ([`src/lib/knowledge-base/`](src/lib/knowledge-base)) uses a
  standard YAML library and turns each result into a plain `ConceptGraph`. The
  checked-in JSON Schema and unit checks validate its structure and semantic
  rules such as unique ids, valid edge references, and dependency cycles.
- **The visualization** ([`src/lib/viz/`](src/lib/viz)) renders the graph with
  [Cytoscape.js](https://js.cytoscape.org/) using a static, bottom-up canonical
  dependency-rank layout computed for the fully expanded hierarchy.
  Groups collapse to single nodes (with cross-group edges aggregated)
  and expand in place into their member concepts.

## Development

```sh
npm install
npm run dev        # local dev server
npm test           # knowledge-base validation tests (vitest)
npm run check      # svelte-check + tsc
npm run build      # static site → dist/
```

## Deployment

Pushes to `main` trigger the [Pages workflow](.github/workflows/deploy.yml),
which runs the tests, builds the static bundle with Vite, and deploys it to
GitHub Pages.

## Contributing a graph

Edit an existing file or add a new `.yaml` file under `src/data/graphs/`. The
schema and semantic unit checks catch malformed metadata, typos, dangling
references, cross-zone groups, and accidental dependency cycles before they
ship. Dataset ids also isolate browser-owned ratings and future layout state.
