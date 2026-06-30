/**
 * Stories that render real Modelica icons captured against a live OMC
 * via `pnpm --filter @dicode/diagram-svg capture-icons`.
 *
 * Each `*.icon.json` in `./fixtures/` carries
 * `{ className, iconLayers, coordinateSystem }`. The empty stub files
 * committed alongside this story keep the storybook build green even
 * before capture has run; an empty `iconLayers` array trips a placeholder
 * card that tells the human to run the capture script.
 */

import type { Meta, StoryObj } from "@storybook/html";
import {
  renderIconLayersToSvg,
  type IconLayer,
  type CoordinateSystem,
} from "../src/index.js";

import sinFixture from "./fixtures/sin.icon.json";
import gainFixture from "./fixtures/gain.icon.json";
import addFixture from "./fixtures/add.icon.json";
import constantFixture from "./fixtures/constant.icon.json";
import limpidFixture from "./fixtures/limpid.icon.json";
import inertiaFixture from "./fixtures/inertia.icon.json";
import springdamperFixture from "./fixtures/springdamper.icon.json";
import torqueFixture from "./fixtures/torque.icon.json";

interface IconFixture {
  className: string;
  iconLayers: IconLayer[];
  coordinateSystem?: CoordinateSystem | null;
}

const FIXTURES: Record<string, IconFixture> = {
  sin: sinFixture as IconFixture,
  gain: gainFixture as IconFixture,
  add: addFixture as IconFixture,
  constant: constantFixture as IconFixture,
  limpid: limpidFixture as IconFixture,
  inertia: inertiaFixture as IconFixture,
  springdamper: springdamperFixture as IconFixture,
  torque: torqueFixture as IconFixture,
};

function isPopulated(f: IconFixture): boolean {
  return f.iconLayers.some((l) => l.shapes.length > 0);
}

function placeholderCard(slug: string, className: string): HTMLElement {
  const root = document.createElement("div");
  root.style.cssText =
    "padding:24px;border:1px dashed #c0c0c0;border-radius:8px;font-family:system-ui,sans-serif;color:#666;max-width:360px;";
  root.innerHTML = `
    <strong style="display:block;margin-bottom:8px;color:#333;">Empty fixture: <code>${slug}</code></strong>
    Run <code>pnpm --filter @dicode/diagram-svg capture-icons</code>
    (requires OMC on PATH) to populate
    <code>stories/fixtures/${slug}.icon.json</code> for <code>${className}</code>,
    then commit the regenerated JSON.
  `;
  return root;
}

function renderCard(fixture: IconFixture, size: number): HTMLElement {
  const card = document.createElement("div");
  card.style.cssText =
    "display:inline-flex;flex-direction:column;align-items:center;padding:16px;border:1px solid #e5e5e5;border-radius:8px;font-family:system-ui,sans-serif;";
  const svgHost = document.createElement("div");
  svgHost.style.cssText = `width:${size}px;height:${size}px;`;
  const cs = fixture.coordinateSystem ?? undefined;
  svgHost.innerHTML = renderIconLayersToSvg(fixture.iconLayers, {
    coordinateSystem: cs,
    size,
  });
  const label = document.createElement("div");
  label.textContent = fixture.className;
  label.style.cssText = `font-size:12px;color:#444;margin-top:12px;max-width:${size}px;text-align:center;word-break:break-word;`;
  card.appendChild(svgHost);
  card.appendChild(label);
  return card;
}

function storyFor(slug: string, size = 160): StoryObj {
  return {
    render: () => {
      const f = FIXTURES[slug];
      if (!f) return placeholderCard(slug, "(unknown)");
      return isPopulated(f)
        ? renderCard(f, size)
        : placeholderCard(slug, f.className);
    },
  };
}

const meta: Meta = {
  title: "Real Modelica Icons",
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Icons rendered from real `getModelInstance` output, captured against OMC 1.26.7. Regenerate via `pnpm --filter @dicode/diagram-svg capture-icons`.",
      },
    },
  },
};
export default meta;

// --- Simple leaf blocks ---
export const Sin: StoryObj = {
  ...storyFor("sin"),
  parameters: { chromatic: { disableSnapshot: true } },
};
export const Gain: StoryObj = {
  ...storyFor("gain"),
  parameters: { chromatic: { disableSnapshot: true } },
};
export const Add: StoryObj = {
  ...storyFor("add"),
  parameters: { chromatic: { disableSnapshot: true } },
};
export const Constant: StoryObj = {
  ...storyFor("constant"),
  parameters: { chromatic: { disableSnapshot: true } },
};

// --- Pulled from PID_Controller's catalog ---
export const LimPID = storyFor("limpid", 200);
export const Inertia: StoryObj = {
  ...storyFor("inertia", 200),
  parameters: { chromatic: { disableSnapshot: true } },
};
export const SpringDamper: StoryObj = {
  ...storyFor("springdamper", 200),
  parameters: { chromatic: { disableSnapshot: true } },
};
export const Torque: StoryObj = {
  ...storyFor("torque", 200),
  parameters: { chromatic: { disableSnapshot: true } },
};

// --- Gallery: all real icons side-by-side ---
export const Gallery: StoryObj = {
  render: () => {
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "display:flex;flex-wrap:wrap;gap:16px;justify-content:center;padding:24px;background:#fafafa;border-radius:8px;";
    for (const [slug, fixture] of Object.entries(FIXTURES)) {
      wrap.appendChild(
        isPopulated(fixture)
          ? renderCard(fixture, 140)
          : placeholderCard(slug, fixture.className),
      );
    }
    return wrap;
  },
};
