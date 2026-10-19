/*
 * Local-only project persistence.
 *
 * The current project (code + conversation) is stored in browser
 * localStorage under a single key. No database, no auth, no sync.
 * This is purely client-side; data never leaves the browser.
 *
 * Milestone 2: a project now carries two copies of the code — the editor's
 * working drafts (`files`) and the version the preview actually renders
 * (`applied`). `applied` is optional so projects saved before this change
 * still load: their single copy is treated as already applied, which matches
 * the live-preview behaviour they were saved under.
 *
 * Everything read back from storage is validated field by field. A missing,
 * malformed, or outdated value degrades to a default instead of throwing —
 * the worst case is a fresh starter project, never a crashed route.
 */

const STORAGE_KEY = "gsap_studio_project_v1";

export interface ProjectFile {
  name: string;
  content: string;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

/** The three editable files, keyed the way the UI refers to them. */
export interface ProjectFiles {
  html: string;
  css: string;
  javascript: string;
}

export interface StoredProject {
  id: string;
  updatedAt: number;
  /** Editor drafts — what the code panel shows and the user edits. */
  files: ProjectFile[];
  /** The version rendered in the preview. Absent in pre-Milestone-2 data. */
  applied?: ProjectFile[];
  conversation: ConversationMessage[];
}

const FILE_ROUTES: ReadonlyArray<{ name: string; key: keyof ProjectFiles }> = [
  { name: "index.html", key: "html" },
  { name: "style.css", key: "css" },
  { name: "script.js", key: "javascript" },
];

export const EMPTY_FILES: ProjectFiles = { html: "", css: "", javascript: "" };

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Older engines: a time + randomness id is enough for a local-only project.
  return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function toFileList(files: ProjectFiles): ProjectFile[] {
  return FILE_ROUTES.map(({ name, key }) => ({
    name,
    content: files[key] ?? "",
  }));
}

/** Map a stored file list onto the editable bundle, ignoring unknown entries. */
export function fromFileList(input: unknown): ProjectFiles | null {
  if (!Array.isArray(input)) return null;
  const files: ProjectFiles = { ...EMPTY_FILES };
  let found = false;
  for (const entry of input) {
    if (!entry || typeof entry !== "object") continue;
    const { name, content } = entry as { name?: unknown; content?: unknown };
    if (typeof name !== "string" || typeof content !== "string") continue;
    const route = FILE_ROUTES.find((r) => r.name === name);
    if (!route) continue;
    files[route.key] = content;
    found = true;
  }
  return found ? files : null;
}

function normalizeFileList(input: unknown): ProjectFile[] {
  const byName = new Map<string, string>();
  if (Array.isArray(input)) {
    for (const entry of input) {
      if (!entry || typeof entry !== "object") continue;
      const { name, content } = entry as { name?: unknown; content?: unknown };
      if (typeof name !== "string" || typeof content !== "string") continue;
      if (!FILE_ROUTES.some((r) => r.name === name)) continue;
      byName.set(name, content);
    }
  }
  return FILE_ROUTES.map(({ name }) => ({ name, content: byName.get(name) ?? "" }));
}

function normalizeConversation(input: unknown): ConversationMessage[] {
  if (!Array.isArray(input)) return [];
  const out: ConversationMessage[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object") continue;
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    out.push({ role, content });
  }
  return out;
}

function normalizeProject(value: unknown): StoredProject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  // Without a recognisable file list the blob is not a studio project.
  if (!Array.isArray(record.files)) return null;

  const applied = Array.isArray(record.applied)
    ? normalizeFileList(record.applied)
    : undefined;

  return {
    id:
      typeof record.id === "string" && record.id.length > 0
        ? record.id
        : newId(),
    updatedAt:
      typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : Date.now(),
    files: normalizeFileList(record.files),
    ...(applied ? { applied } : {}),
    conversation: normalizeConversation(record.conversation),
  };
}

export function createEmptyProject(): StoredProject {
  return {
    id: newId(),
    updatedAt: Date.now(),
    files: toFileList(EMPTY_FILES),
    applied: toFileList(EMPTY_FILES),
    conversation: [],
  };
}

export function loadProject(): StoredProject | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage disabled or blocked (private mode, policy): start fresh.
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt JSON — treat the project as lost rather than crashing the route.
    return null;
  }
  return normalizeProject(parsed);
}

export function saveProject(project: StoredProject): void {
  if (typeof window === "undefined") return;
  try {
    const toSave: StoredProject = {
      ...project,
      files: normalizeFileList(project.files),
      ...(project.applied ? { applied: normalizeFileList(project.applied) } : {}),
      conversation: normalizeConversation(project.conversation),
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {
    // localStorage may be full or disabled; fail silently.
  }
}

export function clearProject(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Fail silently.
  }
}

export function getDefaultProject(): StoredProject {
  return createEmptyProject();
}
