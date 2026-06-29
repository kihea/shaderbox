import { useRef, useState } from "react";
import {
  BACKEND_LABEL,
  BACKEND_TYPES,
  type Project,
  type ShaderBackend,
  type ShaderType,
} from "../engine/types";
import { EXAMPLES } from "../engine/examples";

interface Props {
  projects: Project[];
  currentId: string;
  onSelect: (id: string) => void;
  onNew: (backend: ShaderBackend, type: ShaderType) => void;
  onLoadExample: (exampleId: string) => void;
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
  onLoadExample,
  onDuplicate,
  onDelete,
  onRename,
  onExport,
  onImport,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [backend, setBackend] = useState<ShaderBackend>("webgpu");
  const [examplesOpen, setExamplesOpen] = useState(false);
  const current = projects.find((p) => p.id === currentId);

  return (
    <aside className="sidebar">
      <div className="brand">
        Shader<span>Box</span>
      </div>

      <div className="new-block">
        <div className="seg backend-seg">
          {(["webgpu", "webgl2"] as ShaderBackend[]).map((b) => (
            <button
              key={b}
              className={backend === b ? "active" : ""}
              onClick={() => setBackend(b)}
              title={BACKEND_LABEL[b]}
            >
              {b === "webgpu" ? "WGSL" : "GLSL"}
            </button>
          ))}
        </div>
        <div className="new-buttons">
          {BACKEND_TYPES[backend].map((t) => (
            <button key={t} onClick={() => onNew(backend, t)}>
              + {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div className="examples-block">
          <button className="examples-toggle" onClick={() => setExamplesOpen((o) => !o)}>
            ★ Examples {examplesOpen ? "▴" : "▾"}
          </button>
          {examplesOpen && (
            <div className="examples-list">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.id}
                  className="example-item"
                  title={ex.description}
                  onClick={() => {
                    onLoadExample(ex.id);
                    setExamplesOpen(false);
                  }}
                >
                  <span className="ex-title">
                    {ex.title}
                    <span className={"ex-badge badge-" + ex.backend}>
                      {ex.backend === "webgpu" ? "WGSL" : "GLSL"}
                    </span>
                  </span>
                  <span className="ex-desc">{ex.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="project-list">
        {projects.length === 0 && <p className="hint">No saved shaders yet.</p>}
        {projects.map((p) => (
          <div
            key={p.id}
            className={"project-item" + (p.id === currentId ? " active" : "")}
            onClick={() => onSelect(p.id)}
          >
            <span
              className={"badge badge-" + p.backend}
              title={p.backend === "webgpu" ? "WGSL" : "GLSL"}
            >
              {p.backend === "webgpu" ? "W" : "G"}
            </span>
            <span className="pname">{p.name}</span>
            {p.passes.length > 1 && <span className="pcount">{p.passes.length}</span>}
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
