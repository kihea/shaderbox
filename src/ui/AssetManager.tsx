import { useRef } from "react";
import type { ImageAsset } from "../engine/types";

interface Props {
  images: ImageAsset[];
  onChange: (images: ImageAsset[]) => void;
}

let aid = 0;

function readImage(file: File): Promise<ImageAsset> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const el = new Image();
      el.onload = () =>
        resolve({
          id: `img-${Date.now().toString(36)}-${aid++}`,
          name: file.name.replace(/\.[^.]+$/, "").slice(0, 24) || "image",
          dataUrl,
          width: el.naturalWidth,
          height: el.naturalHeight,
        });
      el.onerror = () => reject(new Error("Could not decode image."));
      el.src = dataUrl;
    };
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

export function AssetManager({ images, onChange }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  async function add(files: FileList) {
    const added: ImageAsset[] = [];
    for (const f of Array.from(files)) {
      try {
        added.push(await readImage(f));
      } catch {
        /* skip unreadable file */
      }
    }
    if (added.length) onChange([...images, ...added]);
  }

  return (
    <div className="assets">
      <p className="hint">
        Images become channel inputs. Stored inside the project (data URLs), so
        keep them modest in size.
      </p>
      <button onClick={() => fileRef.current?.click()}>+ Upload image</button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) add(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="asset-grid">
        {images.map((img) => (
          <div className="asset" key={img.id}>
            <img src={img.dataUrl} alt={img.name} />
            <div className="asset-meta">
              <span title={img.name}>{img.name}</span>
              <span className="dim">
                {img.width}×{img.height}
              </span>
            </div>
            <button
              className="btn-sm danger"
              title="Remove"
              onClick={() => onChange(images.filter((x) => x.id !== img.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
