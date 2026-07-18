/**
 * Stories for `<om-keymap-help>`.
 *
 * The host stays interactive (a fake "open" button) so the dialog's
 * backdrop / Escape / close-button behaviour is verifiable in Storybook —
 * matching `ParameterPanel.stories.ts`'s pattern for the same reason: a
 * form-associated `wa-button` inside `<wa-dialog>` can't render under
 * happy-dom, so this is the only place the open state is exercised.
 *
 * `groups` is built from the real `DIAGRAM_COMMANDS` + `DEFAULT_KEYMAP` via
 * `commandsToKeymapHelpGroups`, the same helper `<om-graphical-layout>` uses —
 * so the story stays truthful to what ships.
 */

import type { Meta, StoryObj } from "@storybook/web-components";
import { html, type TemplateResult } from "lit";

import "../src/keymap-help/keymap-help.component.js";
import type { OmKeymapHelp } from "../src/keymap-help/keymap-help.component.js";
import { commandsToKeymapHelpGroups } from "../src/keymap-help/keymap-help-items.js";
import { CommandRegistry } from "../src/commands/registry.js";
import {
  DEFAULT_KEYMAP,
  DIAGRAM_COMMANDS,
} from "../src/commands/diagram-commands.js";
import type { ContextKeys } from "../src/interaction/context-keys.js";

const registry = new CommandRegistry(DIAGRAM_COMMANDS);

interface StoryArgs {
  selectionCount: number;
}

function contextFor(selectionCount: number): ContextKeys {
  return {
    mode: "select",
    gesture: "idle",
    selectionKind: selectionCount > 0 ? "component" : "none",
    selectionCount,
    readonly: false,
    viewLayer: "diagram",
    hasClipboard: false,
    vertexTarget: false,
    polySelection: false,
  };
}

const meta: Meta<StoryArgs> = {
  title: "diagram-ui/KeymapHelp",
  parameters: { chromatic: { disableSnapshot: true } },
  render: ({ selectionCount }: StoryArgs): TemplateResult => {
    const groups = commandsToKeymapHelpGroups(
      registry,
      DEFAULT_KEYMAP,
      contextFor(selectionCount),
    );
    const openDialog = (): void => {
      const el = document.querySelector(
        "#story-keymap-help",
      ) as OmKeymapHelp | null;
      if (el) el.open = true;
    };
    return html`
      <button @click=${openDialog}>Open keyboard shortcuts (?)</button>
      <om-keymap-help
        id="story-keymap-help"
        .groups=${groups}
        @om-keymap-help-close=${() => console.log("[close]")}
      ></om-keymap-help>
    `;
  },
};

export default meta;

type Story = StoryObj<StoryArgs>;

/** A component is selected, so the selection-gated edit commands (rotate,
 *  flip, delete, …) show enabled alongside the always-on help command. */
export const WithSelection: Story = {
  args: { selectionCount: 1 },
};

/** Nothing selected — the edit commands still list their shortcut but render
 *  dimmed, since they're not runnable right now. */
export const NoSelection: Story = {
  args: { selectionCount: 0 },
};
