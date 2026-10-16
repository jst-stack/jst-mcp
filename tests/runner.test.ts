import { describe, expect, it } from "vitest";
import { SpawnCommandRunner } from "../src/infrastructure/adapters.js";

describe("SpawnCommandRunner", () => {
  it("runs a command with an argument array without shell splitting", async () => {
    const runner = new SpawnCommandRunner();
    const result = await runner.run(
      process.execPath,
      ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", "hello world", "two words"],
      { cwd: process.cwd() },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('["hello world","two words"]');
  });

  it("captures a non-zero exit code", async () => {
    const runner = new SpawnCommandRunner();
    const result = await runner.run(process.execPath, ["-e", "process.exit(3)"], { cwd: process.cwd() });
    expect(result.exitCode).toBe(3);
  });

  it("rejects when the command cannot be spawned", async () => {
    const runner = new SpawnCommandRunner();
    await expect(runner.run("definitely-not-a-real-command-xyz", [], { cwd: process.cwd() })).rejects.toThrow();
  });

  it("escalates SIGTERM to SIGKILL when the child ignores the graceful signal", async () => {
    const runner = new SpawnCommandRunner();
    const script = ["process.on('SIGTERM', () => {})", "setInterval(() => {}, 1000)"].join(";");
    const start = Date.now();
    const result = await runner.run(process.execPath, ["-e", script], { cwd: process.cwd(), timeoutMs: 150 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(Date.now() - start).toBeLessThan(5_000);
  });
});
