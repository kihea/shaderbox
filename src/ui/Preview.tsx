import { useEffect, useRef, useState } from "react";
import { WebGPUEngine } from "../engine/WebGPUEngine";
import { WebGL2Engine } from "../engine/WebGL2Engine";
import type { IEngine, Project, ShaderError } from "../engine/types";

interface Props {
  project: Project;
  paused: boolean;
  onErrors: (errors: ShaderError[]) => void;
  onFps: (fps: number) => void;
  /** Bumped by the parent to request a time reset. */
  resetSignal: number;
}

export function Preview({ project, paused, onErrors, onFps, resetSignal }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<IEngine | null>(null);
  const readyRef = useRef(false);
  const [unsupported, setUnsupported] = useState<string | null>(null);
  const backend = project.backend;

  // create the engine for this backend once (parent remounts on backend change)
  useEffect(() => {
    const canvas = canvasRef.current!;
    if (backend === "webgpu" && !WebGPUEngine.isSupported()) {
      setUnsupported(
        "WebGPU isn't available in this browser. Use a recent Chrome/Edge/Chromium with WebGPU enabled — or make a WebGL2 (GLSL) sandbox instead.",
      );
      return;
    }
    if (backend === "webgl2" && !WebGL2Engine.isSupported()) {
      setUnsupported("WebGL2 isn't available in this browser.");
      return;
    }
    const engine: IEngine =
      backend === "webgpu"
        ? new WebGPUEngine(canvas, { onErrors, onFps })
        : new WebGL2Engine(canvas, { onErrors, onFps });
    engineRef.current = engine;
    engine
      .init()
      .then(() => {
        readyRef.current = true;
        engine.setProject(project);
      })
      .catch((e) => setUnsupported(String(e?.message ?? e)));

    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(canvas);

    return () => {
      ro.disconnect();
      engine.dispose();
      engineRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // push project changes (code, type, uniform values) to the engine
  useEffect(() => {
    if (readyRef.current) engineRef.current?.setProject(project);
  }, [project]);

  useEffect(() => {
    engineRef.current?.setPaused(paused);
  }, [paused]);

  useEffect(() => {
    if (resetSignal > 0) engineRef.current?.resetTime();
  }, [resetSignal]);

  return (
    <div className="preview">
      <canvas ref={canvasRef} style={unsupported ? { display: "none" } : undefined} />
      {unsupported && <div className="preview-msg">{unsupported}</div>}
    </div>
  );
}
