/*
 * Local-only project persistence.
 *
 * The current project (code + conversation) is stored in browser
 * localStorage under a single key. No database, no auth, no sync.
 * This is purely client-side; data never leaves the browser.
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

export interface StoredProject {
  id: string;
  updatedAt: number;
  files: ProjectFile[];
  conversation: ConversationMessage[];
}

const DEFAULT_FILES: ProjectFile[] = [
  { name: "index.html", content: "" },
  { name: "style.css", content: "" },
  { name: "script.js", content: "" },
];

export function createEmptyProject(): StoredProject {
  return {
    id: crypto.randomUUID(),
    updatedAt: Date.now(),
    files: DEFAULT_FILES.map((f) => ({ ...f })),
    conversation: [],
  };
}

export function loadProject(): StoredProject | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredProject;
    if (!parsed || !parsed.files || !Array.isArray(parsed.files)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveProject(project: StoredProject): void {
  if (typeof window === "undefined") return;
  try {
    const toSave: StoredProject = {
      ...project,
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
