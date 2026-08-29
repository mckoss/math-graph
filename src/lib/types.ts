/**
 * Shared data model for the math concept graph.
 *
 * This is the contract between the DSL parser (src/lib/dsl/) and the
 * visualization (src/lib/viz/). The parser produces a ConceptGraph; the
 * visualization consumes one. Neither side depends on the other.
 */

/** Educational stage a concept is typically first encountered. */
export type Stage =
  | 'elementary'
  | 'middle'
  | 'high-school'
  | 'undergraduate';

export interface ConceptNode {
  /** Unique kebab-case identifier, e.g. "complex-numbers". */
  id: string;
  /** Human-readable display name, e.g. "Complex Numbers". */
  label: string;
  /**
   * Wikipedia article title (the part after /wiki/), e.g. "Complex_number".
   * Rendered as a link to https://en.wikipedia.org/wiki/<wikipedia>.
   */
  wikipedia?: string;
  /** One- or two-sentence plain-language description shown in the info panel. */
  description?: string;
  /**
   * id of the category node this concept belongs to, for the multilevel
   * (expand/collapse) view. Undefined for top-level nodes.
   */
  parent?: string;
  /** True when this node is a category that contains child nodes. */
  isCategory: boolean;
  /** Educational stage; used for color coding. */
  stage?: Stage;
}

/**
 * A dependency edge. Direction: `from` is a prerequisite of `to`
 * (the arrow points from the foundation toward the concept that builds on it).
 */
export interface ConceptEdge {
  from: string;
  to: string;
}

export interface ConceptGraph {
  nodes: ConceptNode[];
  edges: ConceptEdge[];
}

/** A parse error with 1-based line number in the DSL source. */
export interface ParseError {
  line: number;
  message: string;
}

export interface ParseResult {
  graph: ConceptGraph;
  errors: ParseError[];
}
