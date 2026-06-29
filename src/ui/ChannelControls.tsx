import {
  NUM_CHANNELS,
  type Channel,
  type Pass,
  type Project,
} from "../engine/types";
import { passLabel } from "./passLabel";

interface Props {
  project: Project;
  pass: Pass;
  backend: Project["backend"];
  onChange: (channels: Channel[]) => void;
}

function encode(c: Channel): string {
  if (c.source === "pass" && c.passId) return `pass:${c.passId}`;
  if (c.source === "image" && c.imageId) return `image:${c.imageId}`;
  return "none";
}

function decode(value: string): Channel {
  if (value.startsWith("pass:")) return { source: "pass", passId: value.slice(5) };
  if (value.startsWith("image:")) return { source: "image", imageId: value.slice(6) };
  return { source: "none" };
}

export function ChannelControls({ project, pass, backend, onChange }: Props) {
  // buffer passes (everything except the final screen/Image pass) can feed a channel
  const bufferPasses = project.passes.slice(0, -1);

  function set(i: number, value: string) {
    const next = pass.channels.map((c, j) => (j === i ? decode(value) : c));
    onChange(next);
  }

  const sample =
    backend === "webgpu"
      ? "textureSample(iChannel0, iSampler, in.uv)"
      : "texture(iChannel0, uv)";

  return (
    <div className="channels">
      <p className="hint">
        Bind inputs, then read them in the shader, e.g. <code>{sample}</code>.
      </p>
      {Array.from({ length: NUM_CHANNELS }, (_, i) => {
        const c = pass.channels[i] ?? { source: "none" };
        return (
          <div className="channel-row" key={i}>
            <code>iChannel{i}</code>
            <select value={encode(c)} onChange={(e) => set(i, e.target.value)}>
              <option value="none">— none —</option>
              {bufferPasses.length > 0 && (
                <optgroup label="Buffers">
                  {bufferPasses.map((bp, idx) => (
                    <option key={bp.id} value={`pass:${bp.id}`}>
                      {passLabel(project.passes, idx)}
                      {bp.id === pass.id ? " (self)" : ""}
                    </option>
                  ))}
                </optgroup>
              )}
              {project.images.length > 0 && (
                <optgroup label="Images">
                  {project.images.map((img) => (
                    <option key={img.id} value={`image:${img.id}`}>
                      {img.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        );
      })}
      {bufferPasses.length === 0 && project.images.length === 0 && (
        <p className="hint dim">
          Add a buffer pass (+) or upload an image in Assets to have something to bind.
        </p>
      )}
    </div>
  );
}
