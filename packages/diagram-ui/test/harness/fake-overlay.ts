import type { Color3 } from "@babylonjs/core";

import type { OverlayHandle } from "../../src/interaction/gesture-mode.js";

interface WireCall {
  from: { x: number; y: number };
  to: { x: number; y: number };
  color: Color3;
}

interface RectCall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A recording stand-in for `GestureOverlay` so mode tests can assert
 *  what was drawn without a Babylon scene. */
export interface RecordingOverlay extends OverlayHandle {
  wires: WireCall[];
  rects: RectCall[];
  wireHidden: number;
  rectHidden: number;
}

export function fakeOverlay(): RecordingOverlay {
  return {
    wires: [],
    rects: [],
    wireHidden: 0,
    rectHidden: 0,
    showWire(from, to, color) {
      this.wires.push({ from, to, color });
    },
    hideWire() {
      this.wireHidden += 1;
    },
    showRect(rect) {
      this.rects.push({ ...rect });
    },
    hideRect() {
      this.rectHidden += 1;
    },
  };
}
