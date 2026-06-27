import { useRef } from "react";
import type { Project, ShaderType } from "../engine/types";

interface Props {
  projects: Project[];
  currentId: string;
  onSelect: (id: string) => void;
  onNew: (type: ShaderType) => void;
  onDuplicate: () => void;
  onDelete: (id: string) => void;
  onRename: (name: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
}

export function Sidebar({
  projects,
  currentId,
  onSelect,
  onNew,
  onDuplicate,
  onDelete,
  onRename,
  onExport,
  onImport,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const current = projects.find((p) => p.id === currentId);

  return (
    <aside className="sidebar">
      <div className="brand">
        Shader<span>Box</span>
      </div>

      <div className="new-buttons">
        <button onClick={() => onNew("fragment")}>+ Fragment</button>
        <button onClick={() => onNew("compute")}>+ Compute</button>
        <button onClick={() => onNew("render")}>+ Render</button>
      </div>

      <div className="project-list">
        {projects.length === 0 && <p className="hint">No saved shaders yet.</p>}
        {projects.map((p) => (
          <div
            key={p.id}
            className={"project-item" + (p.id === currentId ? " active" : "")}
            onClick={() => onSelect(p.id)}
          >
            <span className={"badge badge-" + p.type}>{p.type[0].toUpperCase()}</span>
            <span className="pname">{p.name}</span>
            <button
              className="btn-sm danger"
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(p.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {current && (
        <div className="current-actions">
          <input
            className="rename"
            value={current.name}
            onChange={(e) => onRename(e.target.value)}
          />
          <div className="row">
            <button onClick={onDuplicate}>Duplicate</button>
            <button onClick={onExport}>Export</button>
          </div>
          <button onClick={() => fileRef.current?.click()}>Import .json</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = "";
            }}
          />
        </div>
      )}
    </aside>
  );
}
