# Math Graph — The Shape of Mathematics

An interactive visualization of how mathematical concepts depend on each other:
a zoomable, explorable directed graph running from counting and the natural
numbers up through the standard high-school curriculum and the first years of
undergraduate mathematics.

**Live site:** https://mckoss.com/math-graph/

Every arrow points from a foundational concept to one that builds on it — you
can't really understand the target of an arrow until you understand its source.
Broad categories (Algebra, Calculus, Linear Algebra, …) can be expanded in
place to reveal their own internal network of concepts, and every node links to
its Wikipedia article.

Inspired by thinking about how mathematical understanding is built up layer by
layer — one concept at a time, each resting on those beneath it.

## How it works

- **The curriculum is data, not code.** The entire graph is described in one
  commented YAML file: [`src/data/curriculum.yaml`](src/data/curriculum.yaml).
  See [`docs/SCHEMA.md`](docs/SCHEMA.md) for the schema. Adding a concept or a
  dependency (written as readable chains like
  `counting -> natural-numbers -> integers`) is a one-line edit — no
  JavaScript required.
- **The parser** ([`src/lib/curriculum/`](src/lib/curriculum)) turns the YAML
  into a plain `ConceptGraph` data structure and validates it: duplicate ids,
  dangling edge references, misspelled attributes, and dependency cycles are
  all reported with line numbers.
- **The visualization** ([`src/lib/viz/`](src/lib/viz)) renders the graph with
  [Cytoscape.js](https://js.cytoscape.org/) using a dagre layered layout.
  Categories collapse to single nodes (with cross-category edges aggregated)
  and expand in place into their member concepts.

## Development

```sh
npm install
npm run dev        # local dev server
npm test           # parser tests (vitest)
npm run check      # svelte-check + tsc
npm run build      # static site → dist/
```

## Deployment

Pushes to `main` trigger the [Pages workflow](.github/workflows/deploy.yml),
which runs the tests, builds the static bundle with Vite, and deploys it to
GitHub Pages.

## Contributing concepts

Edit `src/data/curriculum.yaml`. The parser tests assert the file is
error-free, so `npm test` will catch typos, dangling references, and
accidental dependency cycles before they ship.
