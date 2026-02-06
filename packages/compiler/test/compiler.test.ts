import { describe, it, expect } from "vitest";
import { compileWebSpec } from "../src";

describe("webspec compiler", () => {
  it("fails on unknown target", () => {
    const res = compileWebSpec({
      sourceText: `
lang: webspec/v0.1
target: no-such-target
project: { name: demo }
workspace: { aiDir: ".ai", keepTracked: [".ai/README.md", ".ai/.gitkeep"] }
`,
      registry: {}
    });
    expect(res.ok).toBe(false);
    expect(res.diagnostics[0].code).toBe("E100_UNKNOWN_TARGET");
  });
});
