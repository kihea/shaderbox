import {
  BACKEND_TYPES,
  type Pass,
  type Project,
  type ShaderType,
} from "../engine/types";
import { passLabel } from "./passLabel";

interface Props {
  project: Project;
  activePassId: string;
  hasError: (passId: string) => boolean;
  onSelect: (passId: string) => void;
  onAddBuffer: () => void;
  onDeletePass: (passId: string) => void;
  onPatchActive: (patch: Partial<Pass>) => void;
}

export function PassBar({
  project,
  activePassId,
  hasError,
  onSelect,
  onAddBuffer,
  onDeletePass,
  onPatchActive,
}: Props) {
  const active = project.passes.find((p) => p.id === activePassId) ?? project.passes[0];
  const canDelete = project.passes.length > 1 && active.id !== project.passes[project.passes.length - 1].id;

  return (
    <div className="passbar">
      <div className="pass-tabs">
        {project.passes.map((p, i) => (
          <button
            key={p.id}
            className={"pass-tab" + (p.id === activePassId ? " active" : "")}
            onClick={() => onSelect(p.id)}
            title={p.type}
          >
            {passLabel(project.passes, i)}
            {hasError(p.id) && <span className="dot-err" />}
          </button>
        ))}
        <button className="pass-add" title="Add buffer pass" onClick={onAddBuffer}>
          +
        </button>
      </div>

      <div className="pass-controls">
        <div className="seg">
          {BACKEND_TYPES[project.backend].map((t) => (
            <button
              key={t}
              className={active.type === t ? "active" : ""}
              onClick={() => onPatchActive({ type: t as ShaderType })}
            >
              {t}
            </button>
          ))}
        </div>
        {active.type === "render" && (
          <label className="vcount">
            verts
            <input
              type="number"
              min={1}
              value={active.vertexCount}
              onChange={(e) =>
                onPatchActive({ vertexCount: Math.max(1, parseInt(e.target.value) || 1) })
              }
            />
          </label>
        )}
        {canDelete && (
          <button className="btn-sm danger" onClick={() => onDeletePass(active.id)}>
            delete pass
          </button>
        )}
      </div>
    </div>
  );
}
