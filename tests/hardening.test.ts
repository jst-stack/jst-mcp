import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { JstServices } from "../src/application/services.js";
import type {
  CommandResult,
  CommandRunner,
  ProjectAccess,
} from "../src/application/ports.js";

const ROOT = resolve("/work");
const SCRIPTS = {
  "create:slice": "node scripts/create-slice.mjs",
  "lint:fix": "eslint --fix",
  "check:release": "npm run check",
  lint: "eslint . && npm run lint:architecture",
  validate: "npm run lint && npm run typecheck && npm run test:unit",
};

class FakeProject implements ProjectAccess {
  async readPackageJson(): Promise<unknown> {
    return { name: "fixture", scripts: SCRIPTS };
  }

  async isDirectory(): Promise<boolean> {
    return true;
  }

  async realPath(path: string): Promise<string> {
    return path;
  }

  async readTextFile(): Promise<string> {
    return "## Ownership\n\nKeep boundaries explicit.\n";
  }
}

class RecordingRunner implements CommandRunner {
  readonly calls: { command: string; args: string[] }[] = [];
  private readonly responses: CommandResult[];

  constructor(...responses: CommandResult[]) {
    this.responses = responses;
  }

  async run(command: string, args: string[]): Promise<CommandResult> {
    this.calls.push({ command, args });
    return this.responses.shift() ?? {
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
    };
  }
}

function result(stdout = "", exitCode = 0): CommandResult {
  return { exitCode, stdout, stderr: "", timedOut: false };
}

function services(runner = new RecordingRunner()): JstServices {
  return new JstServices(runner, new FakeProject(), ROOT);
}

describe("agent workflow hardening", () => {
  it("rejects project roots outside the MCP workspace", async () => {
    await expect(
      services().startTask({ projectRoot: "../other", brief: "x" }),
    ).rejects.toThrow(/inside the MCP workspace/u);
  });

  it("returns exact install commands when installation is deferred", async () => {
    const dryRun = JSON.stringify({
      dependencies: ["zod@4.6.7"],
      devDependencies: ["msw@3.0.3"],
      files: ["account.public.ts"],
    });
    const runner = new RecordingRunner(
      result(dryRun),
      result("Created entity slice.\nNext: compose the entity."),
    );

    const scaffold = await services(runner).scaffoldSlice({
      projectRoot: ".",
      kind: "entity",
      name: "account",
      options: { repository: true, noInstall: true },
    });

    expect(scaffold.installCommands).toEqual([
      "npm install zod@4.6.7",
      "npm install --save-dev msw@3.0.3",
    ]);
    expect(scaffold.nextAction).toContain("Install generated dependencies first");
    expect(scaffold.command).toContain("--repository --no-install");
  });

  it("runs complete lint for architecture checks", async () => {
    const runner = new RecordingRunner(result());
    const check = await services(runner).check({
      projectRoot: ".",
      gate: "architecture",
    });

    expect(check.script).toBe("lint");
    expect(runner.calls[0]?.args).toEqual(["run", "lint"]);
  });

  it("directs unresolved diagnostics to dependency and cache repair", async () => {
    const runner = new RecordingRunner(
      result("Unsafe call of a type that could not be resolved", 1),
    );
    const check = await services(runner).check({
      projectRoot: ".",
      gate: "fast",
    });

    expect(check.nextAction).toContain("exact versions returned by jst_scaffold_slice");
    expect(check.nextAction).toContain(".eslintcache");
  });
});
