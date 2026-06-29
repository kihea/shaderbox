import { useEffect, useRef, useState } from "react";
import type { Pass, Project } from "../engine/types";
import { buildInputs } from "./inputsCatalog";
import { passLabel } from "./passLabel";

interface Props {
  project: Project;
  pass: Pass;
  onInsert: (token: string) => void;
}

export function InputsMenu({ project, pass, onInsert }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const groups = buildInputs(project, pass);
  const idx = project.passes.findIndex((p) => p.id === pass.id);

  return (
    <div className="inputs-menu" ref={ref}>
      <button className={open ? "active" : ""} onClick={() => setOpen((o) => !o)}>
        ƒ Inputs
      </button>
      {open && (
        <div className="inputs-pop">
          <div className="inputs-pop-head">
            Available in <strong>{passLabel(project.passes, idx)}</strong> · click to insert
          </div>
          {groups.map((g) => (
            <div className="inputs-group" key={g.label}>
              <div className="inputs-group-label">
                {g.label}
                {g.hint && <code className="inputs-hint">{g.hint}</code>}
              </div>
              {g.items.map((it) => (
                <button
                  className="inputs-item"
                  key={it.token}
                  onClick={() => onInsert(it.token)}
                  title={`Insert ${it.token}`}
                >
                  <code>{it.token}</code>
                  <span className="itype">{it.type}</span>
                  <span className="idesc">
                    {it.desc}
                    {it.note && <em className={"ibind" + (it.note === "unbound" ? " dim" : "")}> {it.note}</em>}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
