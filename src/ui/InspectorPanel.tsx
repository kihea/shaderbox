import { useState } from "react";
import type {
  Channel,
  CustomUniform,
  ImageAsset,
  Pass,
  Project,
} from "../engine/types";
import { ChannelControls } from "./ChannelControls";
import { UniformControls } from "./UniformControls";
import { AssetManager } from "./AssetManager";

type Tab = "channels" | "uniforms" | "assets";

interface Props {
  project: Project;
  pass: Pass;
  onChannels: (channels: Channel[]) => void;
  onUniforms: (uniforms: CustomUniform[]) => void;
  onImages: (images: ImageAsset[]) => void;
}

export function InspectorPanel({ project, pass, onChannels, onUniforms, onImages }: Props) {
  const [tab, setTab] = useState<Tab>("channels");
  return (
    <div className="inspector">
      <div className="inspector-tabs">
        <button className={tab === "channels" ? "active" : ""} onClick={() => setTab("channels")}>
          Channels
        </button>
        <button className={tab === "uniforms" ? "active" : ""} onClick={() => setTab("uniforms")}>
          Uniforms{project.uniforms.length ? ` (${project.uniforms.length})` : ""}
        </button>
        <button className={tab === "assets" ? "active" : ""} onClick={() => setTab("assets")}>
          Assets{project.images.length ? ` (${project.images.length})` : ""}
        </button>
      </div>
      <div className="inspector-body">
        {tab === "channels" && (
          <ChannelControls
            project={project}
            pass={pass}
            backend={project.backend}
            onChange={onChannels}
          />
        )}
        {tab === "uniforms" && (
          <UniformControls
            uniforms={project.uniforms}
            backend={project.backend}
            onChange={onUniforms}
          />
        )}
        {tab === "assets" && <AssetManager images={project.images} onChange={onImages} />}
      </div>
    </div>
  );
}
