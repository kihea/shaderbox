import type { Project } from "../engine/types";

const KEY = "shaderbox.projects.v1";
const CURRENT_KEY = "shaderbox.current.v1";

export function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Project[];
  } catch {
    return [];
  }
}

export function saveProjects(projects: Project[]): void {
  localStorage.setItem(KEY, JSON.stringify(projects));
}

export function loadCurrentId(): string | null {
  return localStorage.getItem(CURRENT_KEY);
}

export function saveCurrentId(id: string): void {
  localStorage.setItem(CURRENT_KEY, id);
}

/** Download a single project as a .json file. */
export function exportProject(project: Project): void {
  const blob = new Blob([JSON.stringify(project, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safe = project.name.replace(/[^a-z0-9-_]+/gi, "_") || "shader";
  a.download = `${safe}.shaderbox.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Read a project from an uploaded file, validating the essential shape. */
export function importProjectFile(file: File): Promise<Project> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result));
        if (
          typeof obj !== "object" ||
          typeof obj.code !== "string" ||
          typeof obj.type !== "string"
        ) {
          reject(new Error("Not a valid ShaderBox project file."));
          return;
        }
        const now = Date.now();
        resolve({
          id: `${now.toString(36)}-import`,
          name: typeof obj.name === "string" ? obj.name : "Imported",
          type: obj.type,
          code: obj.code,
          uniforms: Array.isArray(obj.uniforms) ? obj.uniforms : [],
          vertexCount: typeof obj.vertexCount === "number" ? obj.vertexCount : 3,
          createdAt: now,
          updatedAt: now,
        });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsText(file);
  });
}
