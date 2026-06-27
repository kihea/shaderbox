import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Editor } from "./ui/Editor";
import { Preview } from "./ui/Preview";
import { Sidebar } from "./ui/Sidebar";
import { UniformControls } from "./ui/UniformControls";
import { defaultCode, newProject } from "./engine/defaults";
import type { CustomUniform, Project, ShaderError, ShaderType } from "./engine/types";
import {
  exportProject,
  importProjectFile,
  loadCurrentId,
  loadProjects,
  saveCurrentId,
  saveProjects,
} from "./storage/store";

export default function App() {
  const [projects, setProjects] = useState<Project[]>(() => {
    const loaded = loadProjects();
    return loaded.length ? loaded : [seed()];
  });
  const [currentId, setCurrentId] = useState<string>(
    () => loadCurrentId() ?? "",
  );
  const [errors, setErrors] = useState<ShaderError[]>([]);
  const [fps, setFps] = useState(0);
  const [paused, setPaused] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [unsupported, setUnsupported] = useState<string | null>(null);

  // ensure a valid selection
  useEffect(() => {
    if (!projects.find((p) => p.id === currentId)) {
      setCurrentId(projects[0]?.id ?? "");
    }
  }, [projects, currentId]);

  const current = useMemo(
    () => projects.find((p) => p.id === currentId) ?? projects[0],
    [projects, currentId],
  );

  // persist (debounced)
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveProjects(projects), 300);
  }, [projects]);
  useEffect(() => {
    if (currentId) saveCurrentId(currentId);
  }, [currentId]);

  const patchCurrent = useCallback(
    (patch: Partial<Project>) => {
      setProjects((prev) =>
        prev.map((p) =>
          p.id === current?.id ? { ...p, ...patch, updatedAt: Date.now() } : p,
        ),
      );
    },
    [current?.id],
  );

  const onNew = (type: ShaderType) => {
    const p = newProject(type);
    p.name = `${type[0].toUpperCase()}${type.slice(1)} ${projects.length + 1}`;
    setProjects((prev) => [...prev, p]);
    setCurrentId(p.id);
  };

  const onDuplicate = () => {
    if (!current) return;
    const copy = { ...newProject(current.type), name: current.name + " copy" };
    copy.code = current.code;
    copy.uniforms = current.uniforms.map((u) => ({ ...u, value: [...u.value] }));
    copy.vertexCount = current.vertexCount;
    setProjects((prev) => [...prev, copy]);
    setCurrentId(copy.id);
  };

  const onDelete = (id: string) => {
    setProjects((prev) => {
      const next = prev.filter((p) => p.id !== id);
      return next.length ? next : [seed()];
    });
  };

  const onImport = async (file: File) => {
    try {
      const p = await importProjectFile(file);
      setProjects((prev) => [...prev, p]);
      setCurrentId(p.id);
    } catch (e) {
      alert(`Import failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  const changeType = (type: ShaderType) => {
    if (!current) return;
    // swap to the default for the new type only if code is still pristine
    const pristine = current.code.trim() === defaultCode(current.type).trim();
    patchCurrent({ type, code: pristine ? defaultCode(type) : current.code });
  };

  if (unsupported) {
    return (
      <div className="unsupported">
        <h1>ShaderBox</h1>
        <p>{unsupported}</p>
      </div>
    );
  }

  if (!current) return null;

  const errorList = errors.filter((e) => e.type === "error");
  const warnList = errors.filter((e) => e.type === "warning");

  return (
    <div className="app">
      <Sidebar
        projects={projects}
        currentId={current.id}
        onSelect={setCurrentId}
        onNew={onNew}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        onRename={(name) => patchCurrent({ name })}
        onExport={() => exportProject(current)}
        onImport={onImport}
      />

      <main className="main">
        <div className="topbar">
          <div className="seg">
            {(["fragment", "compute", "render"] as ShaderType[]).map((t) => (
              <button
                key={t}
                className={current.type === t ? "active" : ""}
                onClick={() => changeType(t)}
              >
                {t}
              </button>
            ))}
          </div>

          {current.type === "render" && (
            <label className="vcount">
              vertices
              <input
                type="number"
                min={1}
                value={current.vertexCount}
                onChange={(e) =>
                  patchCurrent({ vertexCount: Math.max(1, parseInt(e.target.value) || 1) })
                }
              />
            </label>
          )}

          <div className="spacer" />
          <button onClick={() => setPaused((p) => !p)}>
            {paused ? "▶ Play" : "❚❚ Pause"}
          </button>
          <button onClick={() => setResetSignal((s) => s + 1)}>↺ Reset</button>
          <span className="fps">{fps ? `${fps.toFixed(0)} fps` : ""}</span>
        </div>

        <div className="workspace">
          <div className="left">
            <Editor
              code={current.code}
              errors={errors}
              onChange={(code) => patchCurrent({ code })}
            />
            <div className={"status" + (errorList.length ? " has-error" : "")}>
              {errorList.length === 0 && warnList.length === 0 && (
                <span className="ok">✓ compiled</span>
              )}
              {errorList.map((e, i) => (
                <div key={i} className="err">
                  {e.line ? `L${e.line}: ` : ""}
                  {e.message}
                </div>
              ))}
              {warnList.map((e, i) => (
                <div key={i} className="warn">
                  {e.line ? `L${e.line}: ` : ""}
                  {e.message}
                </div>
              ))}
            </div>
          </div>

          <div className="right">
            <Preview
              project={current}
              paused={paused}
              onErrors={setErrors}
              onFps={setFps}
              onUnsupported={setUnsupported}
              resetSignal={resetSignal}
            />
            <UniformControls
              uniforms={current.uniforms}
              onChange={(uniforms: CustomUniform[]) => patchCurrent({ uniforms })}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

function seed(): Project {
  const p = newProject("fragment");
  p.name = "Welcome";
  return p;
}
