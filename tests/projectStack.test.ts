import { describe, expect, it } from "vitest";
import { packageVersions, projectStack } from "../src/domain/projectStack.js";

describe("project stack summary", () => {
  it("sorts direct dependencies and keeps production dependencies before development tools", () => {
    const result = projectStack(
      { zustand: "^5.0.0", react: "^19.0.0" },
      { tailwindcss: "^4.0.0" },
    );

    expect(result).toEqual({
      packages: ["react", "tailwindcss", "zustand"],
      truncated: false,
    });
  });

  it("bounds large dependency lists", () => {
    const dependencies = Object.fromEntries(
      Array.from({ length: 65 }, (_, index) => [`library-${index}`, `^${index + 1}.0.0`]),
    );
    const result = projectStack(dependencies, { vite: "^8.0.0" });

    expect(result.packages).toHaveLength(60);
    expect(result.packages).not.toContain("vite");
    expect(result.truncated).toBe(true);
  });

  it("ignores non-string manifest values", () => {
    expect(packageVersions({ react: "^19.0.0", invalid: false, nested: { version: "1" } })).toEqual({
      react: "^19.0.0",
    });
  });
});
