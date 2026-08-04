/*
 * Guards the one CSS rule the whole app's usability rests on: the page must
 * stay scrollable on touch.
 *
 * The lobby regressed on exactly this. `overflow-x: hidden` on html and body
 * forces overflow-y to compute to `auto`, which makes both of them real
 * scroll containers. Body then sizes to its own content and so has nothing
 * left to scroll, and `overscroll-behavior-y: none` sitting on body told the
 * browser not to hand that touch on to the viewport either. Result: a roster
 * long enough to push "Lancer la partie" below the fold made the button
 * permanently unreachable — the host could not start the game.
 *
 * Both halves are load-bearing, so both are asserted here.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";

const stylesDir = dirname(fileURLToPath(import.meta.url));

function read(file: string): string {
  return readFileSync(join(stylesDir, file), "utf8");
}

/** Returns the declarations of the rule with exactly this selector list. */
function ruleBody(css: string, selector: string): string {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = stripped.match(new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`no rule found for selector "${selector}"`);
  return match[1];
}

describe("document scrolling", () => {
  const responsive = read("responsive.css");
  const base = read("base.css");

  it("clips horizontal bleed without turning html/body into scroll containers", () => {
    const rule = ruleBody(responsive, "html,\nbody");
    // `hidden` may stay as a fallback for engines without `clip` (Safari < 16),
    // but `clip` has to win — it is the one that leaves the scroll on the
    // viewport instead of moving it onto the body box.
    expect(rule).toContain("overflow-x: clip;");
    const hidden = rule.indexOf("overflow-x: hidden;");
    if (hidden !== -1) {
      expect(rule.indexOf("overflow-x: clip;")).toBeGreaterThan(hidden);
    }
  });

  it("puts overscroll-behavior on the root, never on body", () => {
    // Only the root element's overscroll-behavior propagates to the viewport.
    // On body it is either inert or — once body is a scroll container — a
    // trap that swallows touch scrolls.
    expect(ruleBody(base, "html")).toContain("overscroll-behavior-y: none;");
    expect(ruleBody(base, "body")).not.toContain("overscroll-behavior");
  });

  it("never sets a fixed height on the scrolling ancestors", () => {
    // min-height lets a long roster grow the document; height would clip it.
    for (const selector of ["body", "#root"]) {
      const rule = ruleBody(base, selector);
      expect(rule).toContain("min-height: 100svh;");
      expect(rule).not.toMatch(/(^|[\s;])height:/);
    }
    expect(ruleBody(read("layout.css"), ".screen")).not.toMatch(/(^|[\s;])height:/);
  });
});
