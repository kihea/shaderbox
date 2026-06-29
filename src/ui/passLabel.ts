import type { Pass } from "../engine/types";

/** Display label for a pass by position: last = "Image", others = "Buffer A/B…". */
export function passLabel(passes: Pass[], index: number): string {
  if (index === passes.length - 1) return "Image";
  return `Buffer ${String.fromCharCode(65 + index)}`;
}
