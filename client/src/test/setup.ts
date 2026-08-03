import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
  cleanup();
  // Some test files (e.g. manifest.test.ts) opt into the plain "node"
  // environment via `// @vitest-environment node`, where no jsdom-backed
  // `localStorage` exists — guard so this global hook doesn't blow those up.
  if (typeof localStorage !== "undefined") {
    localStorage.clear();
  }
});
