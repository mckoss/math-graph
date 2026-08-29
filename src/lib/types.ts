/**
 * Shared data model for a domain-independent knowledge graph.
 *
 * This is the contract between knowledge-base loading and the visualization.
 * The loader produces a ConceptGraph; the visualization consumes one.
 * Neither side depends on the other.
 */

/** A knowledge-base-defined learner maturity band. */
export interface MaturityLevel {
  id: string;
  label: string;
  order: number;
  color: string;
  tint: string;
  description?: string;
  /** Optional ready-to-render qualifier appended to the level label. */
  displaySuffix?: string;
  gradeRange?: { from: number; to: number };
}

export interface KnowledgeGraphMetadata {
  /** Stable kebab-case id used for domain selection and local state isolation. */
  id: string;
  /** Short human-readable subtitle, such as "Math" or "Physics". */
  topic: string;
  /** Marks the initially selected graph when several datasets are installed. */
  default?: boolean;
  description?: string;
}

export interface GraphNode {
  /** Unique kebab-case identifier within this dataset. */
  id: string;
  /** Human-readable display name. */
  label: string;
  /**
   * Wikipedia article title (the part after /wiki/), e.g. "Complex_number".
   * Rendered as a link to https://en.wikipedia.org/wiki/<wikipedia>.
   */
  wikipedia?: string;
  /** One- or two-sentence plain-language description shown in the info panel. */
  description?: string;
  /**
   * id of the group node this node belongs to, for the multilevel
   * (expand/collapse) view. Undefined for top-level nodes.
   */
  parent?: string;
  /** True when this node is a group that contains child nodes. */
  isGroup: boolean;
  /** Knowledge-base-defined maturity-level id (concepts only). */
  maturityLevel?: string;
  /** When the concept was first developed, and by whom (concepts only). */
  history?: ConceptHistory;
}

export interface Attribution {
  /** Person or culture associated with the recorded development. */
  name: string;
  /** Wikipedia article title for the person/culture, if one exists. */
  wikipedia?: string;
}

/**
 * When a concept was first developed. Signed historical years use negative
 * values for BCE and positive values for CE, with no year zero. Either bound
 * may be omitted when unknown; `circa` marks approximate dating.
 */
export interface ConceptHistory {
  from?: number;
  to?: number;
  circa?: boolean;
  /** Optional free-text nuance, e.g. "developed independently". */
  note?: string;
  attributions?: Attribution[];
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
  metadata: KnowledgeGraphMetadata;
  maturityLevels: MaturityLevel[];
  nodes: GraphNode[];
  edges: ConceptEdge[];
}
