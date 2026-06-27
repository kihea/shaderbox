import { useEffect, useRef } from "react";
import { WebGPUEngine } from "../engine/WebGPUEngine";
import type { Project, ShaderError } from "../engine/types";

interface Props {
  project: Project;
  paused: boolean;
  onErrors: (errors: ShaderError[]) => void;
  onFps: (fps: number) => void;
  onUnsupported: (msg: string) => void;
  /** Bumped by the parent to request a time reset. */
  resetSignal: number;
}

export function Preview({
  project,
  paused,
  onErrors,
  onFps,
  onUnsupported,
  resetSignal,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<WebGPUEngine | null>(null);
  const readyRef = useRef(false);

  // create engine once
  useEffect(() => {
    const canvas = canvasRef.current!;
    if (!WebGPUEngine.isSupported()) {
      onUnsupported(
        "WebGPU is not available in this browser. Try a recent Chrome, Edge, or Chrome-based browser with WebGPU enabled.",
      );
      return;
    }
    const engine = new WebGPUEngine(canvas, { onErrors, onFps });
    engineRef.current = engine;
    engine
      .init()
      .then(() => {
        readyRef.current = true;
        engine.setProject(project);
      })
      .catch((e) => onUnsupported(String(e?.message ?? e)));

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
      <canvas ref={canvasRef} />
    </div>
  );
}
