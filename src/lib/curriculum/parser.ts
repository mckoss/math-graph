/**
 * Curriculum knowledge-base parser.
 *
 * The knowledge base is a YAML document (see docs/SCHEMA.md and
 * src/data/curriculum.yaml). This module turns YAML source into a
 * ConceptGraph, collecting ALL problems — YAML syntax errors and semantic
 * errors alike — as ParseErrors with 1-based line numbers. It never throws,
 * and always returns the valid portion of the graph.
 *
 * Implemented with the `yaml` package's document API (not toJS) so every
 * value keeps its source range, which a LineCounter maps to a line number.
 */

import { LineCounter, isMap, isScalar, isSeq, parseDocument } from 'yaml';

import type {
  ConceptEdge,
  ConceptGraph,
  ConceptNode,
  ParseError,
  ParseResult,
  Stage,
} from '../types';

const STAGE_VALUES = ['elementary', 'middle', 'high-school', 'undergraduate'] as const;
const STAGES: ReadonlySet<string> = new Set(STAGE_VALUES);

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const CONCEPT_KEYS = ['id', 'label', 'wikipedia', 'stage', 'description'] as const;
const CATEGORY_KEYS = [...CONCEPT_KEYS, 'concepts'] as const;

/** An edge occurrence with the source line of its chain, pre-validation. */
interface RawEdge {
  from: string;
  to: string;
  line: number;
}

export function parseCurriculum(source: string): ParseResult {
  const errors: ParseError[] = [];
  const lineCounter = new LineCounter();
  const doc = parseDocument(source, { lineCounter });

  const lineOfOffset = (offset: number): number => lineCounter.linePos(offset).line;
  const lineOf = (node: unknown): number => {
    const range = (node as { range?: [number, number, number] } | null)?.range;
    return range ? lineOfOffset(range[0]) : 1;
  };

  for (const err of doc.errors) {
    errors.push({
      line: err.linePos?.[0].line ?? lineOfOffset(err.pos[0]),
      message: `YAML syntax error: ${err.message.split('\n')[0]}`,
    });
  }

  const nodes: ConceptNode[] = [];
  const byId = new Map<string, ConceptNode>();
  const rawEdges: RawEdge[] = [];

  /** True for a missing or explicitly-null value (e.g. an empty section). */
  const isNullish = (value: unknown): boolean =>
    value == null || (isScalar(value) && value.value == null);

  const scalarString = (value: unknown): string | undefined =>
    isScalar(value) && typeof value.value === 'string' ? value.value : undefined;

  /** Parse one concept or category mapping. Returns its id when defined. */
  const parseEntry = (entry: unknown, isCategory: boolean, parent?: string): void => {
    const kind = isCategory ? 'category' : 'concept';
    if (!isMap(entry)) {
      errors.push({
        line: lineOf(entry),
        message: `each ${kind} must be a mapping with at least "id" and "label"`,
      });
      return;
    }

    const allowed: readonly string[] = isCategory ? CATEGORY_KEYS : CONCEPT_KEYS;
    const values = new Map<string, unknown>();
    let conceptsValue: unknown;

    for (const pair of entry.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : undefined;
      if (key === undefined || !allowed.includes(key)) {
        errors.push({
          line: lineOf(pair.key),
          message: `unknown key "${key ?? '?'}" in ${kind} (expected ${allowed.join(', ')})`,
        });
        continue;
      }
      // Duplicate keys within one mapping are already YAML syntax errors.
      if (key === 'concepts') conceptsValue = pair.value;
      else values.set(key, pair.value);
    }

    // id (required, kebab-case)
    let id: string | undefined;
    const idValue = values.get('id');
    if (idValue === undefined) {
      errors.push({ line: lineOf(entry), message: `${kind} is missing required key "id"` });
    } else {
      id = scalarString(idValue);
      if (id === undefined) {
        errors.push({ line: lineOf(idValue), message: `"id" must be a string` });
      } else if (!ID_RE.test(id)) {
        errors.push({
          line: lineOf(idValue),
          message: `id "${id}" is not kebab-case (lowercase letters/digits separated by hyphens)`,
        });
        id = undefined;
      } else if (byId.has(id)) {
        errors.push({ line: lineOf(idValue), message: `duplicate id "${id}"` });
        // Keep the first definition, but still parse child concepts below.
        const dupId = id;
        id = undefined;
        if (isCategory) parseConceptList(conceptsValue, dupId);
      }
    }

    // label (required; fall back to the id so the node stays usable)
    let label: string | undefined;
    const labelValue = values.get('label');
    if (labelValue === undefined) {
      errors.push({
        line: lineOf(entry),
        message: `${kind}${id ? ` "${id}"` : ''} is missing required key "label"`,
      });
    } else {
      label = scalarString(labelValue);
      if (label === undefined) {
        errors.push({ line: lineOf(labelValue), message: `"label" must be a string` });
      }
    }

    if (id !== undefined) {
      const node: ConceptNode = { id, label: label ?? id, isCategory };
      if (parent !== undefined) node.parent = parent;

      for (const key of ['wikipedia', 'description'] as const) {
        const value = values.get(key);
        if (value === undefined) continue;
        const str = scalarString(value);
        if (str === undefined) {
          errors.push({ line: lineOf(value), message: `"${key}" must be a string` });
        } else if (key === 'wikipedia') node.wikipedia = str;
        else node.description = str;
      }

      const stageValue = values.get('stage');
      if (stageValue !== undefined) {
        const stage = scalarString(stageValue);
        if (stage === undefined || !STAGES.has(stage)) {
          errors.push({
            line: lineOf(stageValue),
            message:
              `unknown stage ${stage === undefined ? '' : `"${stage}" `}on "${id}" ` +
              `(expected ${STAGE_VALUES.join(' | ')})`,
          });
        } else {
          node.stage = stage as Stage;
        }
      }

      byId.set(id, node);
      nodes.push(node);
    }

    if (isCategory && id !== undefined) parseConceptList(conceptsValue, id);
  };

  const parseConceptList = (value: unknown, parent?: string): void => {
    if (value === undefined || isNullish(value)) return;
    if (!isSeq(value)) {
      errors.push({ line: lineOf(value), message: `"concepts" must be a list` });
      return;
    }
    for (const item of value.items) parseEntry(item, false, parent);
  };

  const parseEdgeItem = (item: unknown): void => {
    const line = lineOf(item);
    const text = scalarString(item);
    if (text === undefined) {
      errors.push({ line, message: `each edge must be a string like "a -> b"` });
      return;
    }
    const parts = text.split('->').map((s) => s.trim());
    if (parts.length < 2) {
      errors.push({ line, message: `edge "${text}" must contain "->"` });
      return;
    }
    let ok = true;
    for (const part of parts) {
      if (!ID_RE.test(part)) {
        errors.push({
          line,
          message: `invalid id "${part}" in edge "${text}"`,
        });
        ok = false;
      }
    }
    if (!ok) return;
    for (let i = 0; i + 1 < parts.length; i++) {
      rawEdges.push({ from: parts[i], to: parts[i + 1], line });
    }
  };

  // ---- Walk the document ---------------------------------------------------

  const root = doc.contents;
  if (root != null && !isNullish(root)) {
    if (!isMap(root)) {
      errors.push({
        line: lineOf(root),
        message: 'top level must be a mapping with keys "categories", "concepts", and/or "edges"',
      });
    } else {
      for (const pair of root.items) {
        const key = isScalar(pair.key) ? String(pair.key.value) : undefined;
        const value = pair.value;
        if (key === 'categories') {
          if (isNullish(value)) continue;
          if (!isSeq(value)) {
            errors.push({ line: lineOf(value), message: `"categories" must be a list` });
            continue;
          }
          for (const item of value.items) parseEntry(item, true);
        } else if (key === 'concepts') {
          parseConceptList(value);
        } else if (key === 'edges') {
          if (isNullish(value)) continue;
          if (!isSeq(value)) {
            errors.push({ line: lineOf(value), message: `"edges" must be a list` });
            continue;
          }
          for (const item of value.items) parseEdgeItem(item);
        } else {
          errors.push({
            line: lineOf(pair.key),
            message: `unknown top-level key "${key ?? '?'}" (expected categories, concepts, edges)`,
          });
        }
      }
    }
  }

  // ---- Resolve edges -------------------------------------------------------

  const edges: ConceptEdge[] = [];
  const edgeLines = new Map<string, number>(); // "from to" -> line
  for (const e of rawEdges) {
    let ok = true;
    for (const id of [e.from, e.to]) {
      if (!byId.has(id)) {
        errors.push({ line: e.line, message: `edge references unknown id "${id}"` });
        ok = false;
      }
    }
    if (ok && e.from === e.to) {
      errors.push({ line: e.line, message: `"${e.from}" cannot depend on itself` });
      ok = false;
    }
    if (!ok) continue;
    const key = `${e.from} ${e.to}`;
    if (edgeLines.has(key)) continue; // silently ignore exact duplicates
    edgeLines.set(key, e.line);
    edges.push({ from: e.from, to: e.to });
  }

  detectCycles(edges, edgeLines, errors);

  errors.sort((a, b) => a.line - b.line);
  return { graph: { nodes, edges }, errors };
}

/**
 * Report dependency cycles. Runs a DFS over the (already validated) edges;
 * each back edge closes a cycle, reported once with the line number of the
 * edge that closes it.
 */
function detectCycles(
  edges: ConceptEdge[],
  edgeLines: Map<string, number>,
  errors: ParseError[]
): void {
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    let out = adjacency.get(e.from);
    if (!out) adjacency.set(e.from, (out = []));
    out.push(e.to);
  }

  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const state = new Map<string, number>();
  const stack: string[] = [];

  const visit = (id: string): void => {
    state.set(id, GRAY);
    stack.push(id);
    for (const next of adjacency.get(id) ?? []) {
      const s = state.get(next) ?? WHITE;
      if (s === WHITE) {
        visit(next);
      } else if (s === GRAY) {
        // Back edge id -> next closes a cycle: next ... id -> next.
        const cycle = stack.slice(stack.indexOf(next)).concat(next);
        const line = edgeLines.get(`${id} ${next}`) ?? 1;
        errors.push({ line, message: `dependency cycle: ${cycle.join(' -> ')}` });
      }
    }
    stack.pop();
    state.set(id, BLACK);
  };

  for (const id of adjacency.keys()) {
    if ((state.get(id) ?? WHITE) === WHITE) visit(id);
  }
}
