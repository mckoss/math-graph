# Math Graph

An interactive mathematics knowledge explorer showing how concepts depend on
each other: a zoomable directed graph running from counting and the natural
numbers through high-school and early undergraduate mathematics.

**Live site:** https://mckoss.com/math-graph/

Every arrow points from a foundational concept to one that builds on it — you
can't really understand the target of an arrow until you understand its source.
Broad groups (Algebra, Calculus, Linear Algebra, …) can be expanded in
place to reveal their own internal network of concepts, and every node links to
its Wikipedia article.

Inspired by thinking about how mathematical understanding is built up layer by
layer — one concept at a time, each resting on those beneath it.

## How it works

- **The knowledge base is data, not code.** The entire graph is described in
  one commented YAML file:
  [`src/data/knowledge-base.yaml`](src/data/knowledge-base.yaml). See
  [`docs/SCHEMA.md`](docs/SCHEMA.md) for the format. Adding a concept or a
  dependency, written as a readable chain like
  `counting -> natural-numbers -> integers`, is a one-line edit — no
  JavaScript required.
- **The loader** ([`src/lib/knowledge-base/`](src/lib/knowledge-base)) uses a
  standard YAML library and turns the result into a plain `ConceptGraph`. The
  checked-in JSON Schema and unit checks validate its structure and semantic
  rules such as unique ids, valid edge references, and dependency cycles.
- **The visualization** ([`src/lib/viz/`](src/lib/viz)) renders the graph with
  [Cytoscape.js](https://js.cytoscape.org/) using a dagre layered layout.
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

## Contributing concepts

Edit `src/data/knowledge-base.yaml`. The schema and semantic unit checks catch
typos, dangling references, and accidental dependency cycles before they ship.
