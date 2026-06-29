import {
  emptyChannels,
  NUM_CHANNELS,
  type Channel,
  type Pass,
  type Project,
} from "../engine/types";

const KEY = "shaderbox.projects.v2";
const CURRENT_KEY = "shaderbox.current.v2";

let idc = 0;
function uid(tag: string): string {
  return `${Date.now().toString(36)}-${(idc++).toString(36)}-${tag}`;
}

function normalizeChannels(input: unknown): Channel[] {
  const arr = Array.isArray(input) ? input : [];
  return Array.from({ length: NUM_CHANNELS }, (_, i) => {
    const c = arr[i] as Channel | undefined;
    if (c && (c.source === "pass" || c.source === "image" || c.source === "none")) return c;
    return { source: "none" } as Channel;
  });
}

/** Accept both the current passes shape and the legacy {type, code} shape. */
export function normalizeProject(obj: any): Project {
  const now = Date.now();
  const backend = obj?.backend === "webgl2" ? "webgl2" : "webgpu";
  let passes: Pass[];
  if (Array.isArray(obj?.passes) && obj.passes.length) {
    passes = obj.passes.map((p: any, i: number) => ({
      id: typeof p.id === "string" ? p.id : uid("pass"),
      name: typeof p.name === "string" ? p.name : i === obj.passes.length - 1 ? "Image" : `Buffer ${i}`,
      type: p.type === "compute" || p.type === "render" ? p.type : "fragment",
      code: typeof p.code === "string" ? p.code : "",
      channels: normalizeChannels(p.channels),
      vertexCount: typeof p.vertexCount === "number" ? p.vertexCount : 3,
    }));
  } else {
    // legacy single-shader project
    passes = [
      {
        id: uid("pass"),
        name: "Image",
        type: obj?.type === "compute" || obj?.type === "render" ? obj.type : "fragment",
        code: typeof obj?.code === "string" ? obj.code : "",
        channels: emptyChannels(),
        vertexCount: typeof obj?.vertexCount === "number" ? obj.vertexCount : 3,
      },
    ];
  }
  return {
    id: typeof obj?.id === "string" ? obj.id : uid("proj"),
    name: typeof obj?.name === "string" ? obj.name : "Untitled",
    backend,
    passes,
    uniforms: Array.isArray(obj?.uniforms) ? obj.uniforms : [],
    images: Array.isArray(obj?.images) ? obj.images : [],
    createdAt: typeof obj?.createdAt === "number" ? obj.createdAt : now,
    updatedAt: now,
  };
}

export function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem("shaderbox.projects.v1");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeProject);
  } catch {
    return [];
  }
}

export function saveProjects(projects: Project[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(projects));
  } catch {
    // localStorage quota (large embedded images) — fail silently
  }
}

export function loadCurrentId(): string | null {
  return localStorage.getItem(CURRENT_KEY);
}

export function saveCurrentId(id: string): void {
  localStorage.setItem(CURRENT_KEY, id);
}

export function exportProject(project: Project): void {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safe = project.name.replace(/[^a-z0-9-_]+/gi, "_") || "shader";
  a.download = `${safe}.shaderbox.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importProjectFile(file: File): Promise<Project> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result));
        if (typeof obj !== "object" || obj === null) {
          reject(new Error("Not a valid ShaderBox project file."));
          return;
        }
        const p = normalizeProject(obj);
        p.id = uid("proj"); // fresh id so imports never collide
        resolve(p);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsText(file);
  });
}
