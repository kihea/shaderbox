import { useState } from "react";
import type { CustomUniform, UniformType } from "../engine/types";
import { componentCount } from "../engine/uniforms";

interface Props {
  uniforms: CustomUniform[];
  onChange: (uniforms: CustomUniform[]) => void;
}

const TYPES: UniformType[] = ["float", "vec2", "vec3", "vec4", "color"];
const COMP_LABELS = ["x", "y", "z", "w"];

function rgbToHex(v: number[]): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round((n ?? 0) * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(v[0])}${c(v[1])}${c(v[2])}`;
}

function hexToRgb(hex: string): number[] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function sanitizeName(name: string): string {
  let s = name.replace(/[^a-zA-Z0-9_]/g, "_");
  if (/^[0-9]/.test(s)) s = "_" + s;
  return s || "u";
}

export function UniformControls({ uniforms, onChange }: Props) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<UniformType>("float");

  function update(i: number, patch: Partial<CustomUniform>) {
    const next = uniforms.map((u, j) => (j === i ? { ...u, ...patch } : u));
    onChange(next);
  }

  function setComponent(i: number, comp: number, value: number) {
    const u = uniforms[i];
    const value2 = [...u.value];
    value2[comp] = value;
    update(i, { value: value2 });
  }

  function remove(i: number) {
    onChange(uniforms.filter((_, j) => j !== i));
  }

  function add() {
    const name = sanitizeName(newName);
    if (uniforms.some((u) => u.name === name)) {
      setNewName("");
      return;
    }
    const comps = componentCount(newType);
    const def: CustomUniform = {
      name,
      type: newType,
      value:
        newType === "color"
          ? [1, 0.4, 0.1]
          : new Array(comps).fill(newType === "float" ? 0.5 : 0),
      min: 0,
      max: 1,
      step: 0.01,
    };
    onChange([...uniforms, def]);
    setNewName("");
    setAdding(false);
  }

  return (
    <div className="uniforms">
      <div className="panel-head">
        <span>Uniforms</span>
        <button className="btn-sm" onClick={() => setAdding((a) => !a)}>
          {adding ? "×" : "+ add"}
        </button>
      </div>

      {adding && (
        <div className="uniform-add">
          <input
            autoFocus
            placeholder="name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as UniformType)}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button className="btn-sm" onClick={add}>
            ok
          </button>
        </div>
      )}

      {uniforms.length === 0 && !adding && (
        <p className="hint">
          No custom uniforms. Add one and use it in WGSL as <code>u.name</code>.
        </p>
      )}

      {uniforms.map((u, i) => (
        <div className="uniform-row" key={u.name}>
          <div className="uniform-row-head">
            <code title={`u.${u.name} : ${u.type}`}>u.{u.name}</code>
            <span className="utype">{u.type}</span>
            <button className="btn-sm danger" onClick={() => remove(i)}>
              ×
            </button>
          </div>

          {u.type === "color" ? (
            <input
              type="color"
              value={rgbToHex(u.value)}
              onChange={(e) => update(i, { value: hexToRgb(e.target.value) })}
            />
          ) : (
            <div className="sliders">
              {u.value.map((c, comp) => (
                <div className="slider-row" key={comp}>
                  <label>{COMP_LABELS[comp]}</label>
                  <input
                    type="range"
                    min={u.min}
                    max={u.max}
                    step={u.step}
                    value={c}
                    onChange={(e) =>
                      setComponent(i, comp, parseFloat(e.target.value))
                    }
                  />
                  <input
                    className="num"
                    type="number"
                    step={u.step}
                    value={c}
                    onChange={(e) =>
                      setComponent(i, comp, parseFloat(e.target.value) || 0)
                    }
                  />
                </div>
              ))}
              <div className="range-edit">
                <label>min</label>
                <input
                  type="number"
                  value={u.min}
                  onChange={(e) => update(i, { min: parseFloat(e.target.value) || 0 })}
                />
                <label>max</label>
                <input
                  type="number"
                  value={u.max}
                  onChange={(e) => update(i, { max: parseFloat(e.target.value) || 1 })}
                />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
