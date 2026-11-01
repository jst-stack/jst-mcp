import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("npm executable", () => {
  it.skipIf(process.platform === "win32")("keeps the MCP binary executable", async () => {
    const mode = (await stat(resolve("dist/bin/jst-mcp.js"))).mode;
    expect(mode & 0o111).not.toBe(0);
  });
});
