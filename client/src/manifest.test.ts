// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const manifestPath = fileURLToPath(new URL("../public/manifest.json", import.meta.url));

describe("manifest.json", () => {
  it("declares the fields required for PWA installability", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

    expect(manifest.name).toBe("One Night Ultimate Werewolf");
    expect(manifest.short_name).toBe("ONUW");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      expect(icon.src).toBeTruthy();
      expect(icon.sizes).toBeTruthy();
      expect(icon.type).toBeTruthy();
    }
  });
});
