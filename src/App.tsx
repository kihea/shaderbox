import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Editor } from "./ui/Editor";
import { Preview } from "./ui/Preview";
import { Sidebar } from "./ui/Sidebar";
import { PassBar } from "./ui/PassBar";
import { InspectorPanel } from "./ui/InspectorPanel";
import { bufferLabel, defaultCode, newPass, newProject } from "./engine/defaults";
import type {
  Channel,
  CustomUniform,
  ImageAsset,
  Pass,
  Project,
  ShaderBackend,
  ShaderError,
  ShaderType,
} from "./engine/types";
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
  const [currentId, setCurrentId] = useState<string>(() => loadCurrentId() ?? "");
  const [activePassId, setActivePassId] = useState<string>("");
  const [errors, setErrors] = useState<ShaderError[]>([]);
  const [fps, setFps] = useState(0);
  const [paused, setPaused] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);

  useEffect(() => {
    if (!projects.find((p) => p.id === currentId)) setCurrentId(projects[0]?.id ?? "");
  }, [projects, currentId]);

  const current = useMemo(
    () => projects.find((p) => p.id === currentId) ?? projects[0],
    [projects, currentId],
  );

  // keep an active pass selected (default to the Image/last pass)
  useEffect(() => {
    if (!current) return;
    if (!current.passes.find((p) => p.id === activePassId)) {
      setActivePassId(current.passes[current.passes.length - 1].id);
    }
  }, [current, activePassId]);

  const activePass = useMemo(
    () => current?.passes.find((p) => p.id === activePassId) ?? current?.passes[0],
    [current, activePassId],
  );

  // persist (debounced)
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveProjects(projects), 400);
  }, [projects]);
  useEffect(() => {
    if (currentId) saveCurrentId(currentId);
  }, [currentId]);

  const patchCurrent = useCallback(
    (patch: Partial<Project>) => {
      setProjects((prev) =>
        prev.map((p) => (p.id === current?.id ? { ...p, ...patch, updatedAt: Date.now() } : p)),
      );
    },
    [current?.id],
  );

  const patchPass = useCallback(
    (passId: string, patch: Partial<Pass>) => {
      setProjects((prev) =>
        prev.map((p) =>
          p.id === current?.id
            ? {
                ...p,
                updatedAt: Date.now(),
                passes: p.passes.map((pass) => (pass.id === passId ? { ...pass, ...patch } : pass)),
              }
            : p,
        ),
      );
    },
    [current?.id],
  );

  const patchActive = useCallback(
    (patch: Partial<Pass>) => {
      if (activePass) patchPass(activePass.id, patch);
    },
    [activePass, patchPass],
  );

  const changeActiveType = (type: ShaderType) => {
    if (!current || !activePass) return;
    const pristine = activePass.code.trim() === defaultCode(current.backend, activePass.type).trim();
    patchActive({ type, code: pristine ? defaultCode(current.backend, type) : activePass.code });
  };

  const addBuffer = () => {
    if (!current) return;
    const idx = current.passes.length - 1; // insert before Image
    const p = newPass(current.backend, "fragment", `Buffer ${bufferLabel(idx)}`);
    const passes = [...current.passes];
    passes.splice(idx, 0, p);
    patchCurrent({ passes });
    setActivePassId(p.id);
  };

  const deletePass = (passId: string) => {
    if (!current || current.passes.length <= 1) return;
    const passes = current.passes
      .filter((p) => p.id !== passId)
      // unbind channels that referenced the removed pass
      .map((p) => ({
        ...p,
        channels: p.channels.map((c) =>
          c.source === "pass" && c.passId === passId ? ({ source: "none" } as Channel) : c,
        ),
      }));
    patchCurrent({ passes });
    if (activePassId === passId) setActivePassId(passes[passes.length - 1].id);
  };

  const onNew = (backend: ShaderBackend, type: ShaderType) => {
    const p = newProject(backend, type);
    p.name = `${type[0].toUpperCase()}${type.slice(1)} ${projects.length + 1}`;
    setProjects((prev) => [...prev, p]);
    setCurrentId(p.id);
    setActivePassId(p.passes[0].id);
  };

  const onDuplicate = () => {
    if (!current) return;
    const copy = newProject(current.backend);
    copy.name = current.name + " copy";
    copy.uniforms = current.uniforms.map((u) => ({ ...u, value: [...u.value] }));
    copy.images = current.images.map((i) => ({ ...i }));
    copy.passes = current.passes.map((p) => ({
      ...p,
      id: `${p.id}-${copy.id}`,
      channels: p.channels.map((c) => ({ ...c })),
    }));
    // remap intra-project pass references in channels to the copied ids
    const idMap = new Map(current.passes.map((p, i) => [p.id, copy.passes[i].id]));
    copy.passes = copy.passes.map((p) => ({
      ...p,
      channels: p.channels.map((c) =>
        c.source === "pass" && c.passId ? { ...c, passId: idMap.get(c.passId) ?? c.passId } : c,
      ),
    }));
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

  if (!current || !activePass) return null;

  const passErrors = errors.filter((e) => e.passId === activePass.id || e.passId === undefined);
  const errorList = passErrors.filter((e) => e.type === "error");
  const warnList = passErrors.filter((e) => e.type === "warning");
  const hasError = (passId: string) => errors.some((e) => e.passId === passId && e.type === "error");

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
          <span className="backend-tag" title="Sandbox backend">
            {current.backend === "webgpu" ? "WGSL" : "GLSL"}
          </span>
          <div className="spacer" />
          <button onClick={() => setPaused((p) => !p)}>{paused ? "▶ Play" : "❚❚ Pause"}</button>
          <button onClick={() => setResetSignal((s) => s + 1)}>↺ Reset</button>
          <span className="fps">{fps ? `${fps.toFixed(0)} fps` : ""}</span>
        </div>

        <div className="workspace">
          <div className="left">
            <PassBar
              project={current}
              activePassId={activePass.id}
              hasError={hasError}
              onSelect={setActivePassId}
              onAddBuffer={addBuffer}
              onDeletePass={deletePass}
              onPatchActive={(patch) =>
                "type" in patch ? changeActiveType(patch.type as ShaderType) : patchActive(patch)
              }
            />
            <Editor
              key={activePass.id}
              code={activePass.code}
              backend={current.backend}
              errors={passErrors}
              onChange={(code) => patchActive({ code })}
            />
            <div className={"status" + (errorList.length ? " has-error" : "")}>
              {errorList.length === 0 && warnList.length === 0 && <span className="ok">✓ compiled</span>}
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
              key={current.backend}
              project={current}
              paused={paused}
              onErrors={setErrors}
              onFps={setFps}
              resetSignal={resetSignal}
            />
            <InspectorPanel
              project={current}
              pass={activePass}
              onChannels={(channels: Channel[]) => patchActive({ channels })}
              onUniforms={(uniforms: CustomUniform[]) => patchCurrent({ uniforms })}
              onImages={(images: ImageAsset[]) => patchCurrent({ images })}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

function seed(): Project {
  const p = newProject("webgpu", "fragment");
  p.name = "Welcome";
  return p;
}
