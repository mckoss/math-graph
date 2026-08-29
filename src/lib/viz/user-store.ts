/**
 * Client-side persistence for the study guide: user node-position tweaks,
 * bookmarks, and the expanded-categories set, in one versioned localStorage
 * key. The app must render perfectly with no stored state at all, so every
 * storage access is wrapped in try/catch.
 *
 * Resilience rule: entries whose node id is not in the current graph are
 * IGNORED at application time but NEVER deleted from the store — ids are
 * stable and nodes may return in a future deploy. Consumers filter when
 * applying; the store only ever merges per-id writes.
 *
 * Positions are stored as OFFSETS from the computed layout position (not
 * absolute coordinates) so they survive re-layouts, resizes, orientation
 * flips, and graph changes.
 */

export const STORAGE_KEY = 'math-graph:user:v1';

export type Bookmark = 'to-learn' | 'have-learned';

export interface Offset {
  dx: number;
  dy: number;
}

export interface UserState {
  positionOffsets: Record<string, Offset>;
  bookmarks: Record<string, Bookmark>;
  expanded: string[];
  /** "Stratify by level" mode; defaults to on. */
  stratify: boolean;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function emptyUserState(): UserState {
  return { positionOffsets: {}, bookmarks: {}, expanded: [], stratify: true };
}

/** Clamp an offset's magnitude (model units); direction is preserved. */
export function clampOffset(off: Offset, maxMagnitude: number): Offset {
  const dx = Number.isFinite(off.dx) ? off.dx : 0;
  const dy = Number.isFinite(off.dy) ? off.dy : 0;
  const mag = Math.hypot(dx, dy);
  if (mag <= maxMagnitude || mag === 0) return { dx, dy };
  const s = maxMagnitude / mag;
  return { dx: dx * s, dy: dy * s };
}

/** Coerce arbitrary parsed JSON into a valid UserState, dropping bad entries. */
export function sanitizeUserState(raw: unknown): UserState {
  const out = emptyUserState();
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;

  const offsets = r.positionOffsets;
  if (typeof offsets === 'object' && offsets !== null) {
    for (const [id, v] of Object.entries(offsets)) {
      if (
        typeof v === 'object' &&
        v !== null &&
        Number.isFinite((v as Offset).dx) &&
        Number.isFinite((v as Offset).dy)
      ) {
        out.positionOffsets[id] = { dx: (v as Offset).dx, dy: (v as Offset).dy };
      }
    }
  }

  const bookmarks = r.bookmarks;
  if (typeof bookmarks === 'object' && bookmarks !== null) {
    for (const [id, v] of Object.entries(bookmarks)) {
      if (v === 'to-learn' || v === 'have-learned') out.bookmarks[id] = v;
    }
  }

  if (Array.isArray(r.expanded)) {
    out.expanded = r.expanded.filter((id): id is string => typeof id === 'string');
  }

  if (typeof r.stratify === 'boolean') out.stratify = r.stratify;

  return out;
}

function defaultStorage(): StorageLike | null {
  try {
    // The accessor itself can throw (e.g. storage disabled).
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadUserState(storage: StorageLike | null): UserState {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (raw === null || raw === undefined) return emptyUserState();
    return sanitizeUserState(JSON.parse(raw));
  } catch {
    return emptyUserState();
  }
}

export function saveUserState(state: UserState, storage: StorageLike | null): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full/blocked: the app keeps working, persistence is best-effort.
  }
}

/**
 * The live store: holds current UserState, merges per-id writes (preserving
 * entries for unknown ids), and debounces persistence.
 */
export class UserStore {
  readonly state: UserState;
  private readonly storage: StorageLike | null;
  private readonly debounceMs: number;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(storage: StorageLike | null = defaultStorage(), debounceMs = 400) {
    this.storage = storage;
    this.debounceMs = debounceMs;
    this.state = loadUserState(storage);
  }

  private schedule(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      saveUserState(this.state, this.storage);
    }, this.debounceMs);
  }

  /** Write any pending changes immediately (e.g. on beforeunload). */
  flush(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    saveUserState(this.state, this.storage);
  }

  /** Set (or with null, remove) the drag offset for one node. */
  setOffset(id: string, off: Offset | null): void {
    if (off === null) delete this.state.positionOffsets[id];
    else this.state.positionOffsets[id] = off;
    this.schedule();
  }

  /** "Reset layout": drop every position offset; bookmarks stay untouched. */
  clearOffsets(): void {
    this.state.positionOffsets = {};
    this.schedule();
  }

  /** Set (or with null, clear) the bookmark for one node. */
  setBookmark(id: string, bookmark: Bookmark | null): void {
    if (bookmark === null) delete this.state.bookmarks[id];
    else this.state.bookmarks[id] = bookmark;
    this.schedule();
  }

  /** Persist the "Stratify by level" toggle. */
  setStratify(on: boolean): void {
    this.state.stratify = on;
    this.schedule();
  }

  /**
   * Persist the expanded set. `knownIds` are the ids this app instance
   * manages; stored ids outside it (from other graph versions) are kept.
   */
  setExpanded(expanded: Iterable<string>, knownIds: ReadonlySet<string>): void {
    const kept = this.state.expanded.filter((id) => !knownIds.has(id));
    this.state.expanded = [...expanded, ...kept];
    this.schedule();
  }
}
