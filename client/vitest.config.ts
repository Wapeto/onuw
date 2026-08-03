import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      // Node 22.4+ ships an experimental global `localStorage` accessor that
      // shadows jsdom's implementation unless disabled, breaking
      // `localStorage` access in tests. See onboardingStorage.test.ts.
      execArgv: ["--no-experimental-webstorage"],
    },
  }),
);
