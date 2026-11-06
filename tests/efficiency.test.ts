import { describe, expect, it } from "vitest";
import { JstServices } from "../src/application/services.js";
import type {
  CommandResult,
  CommandRunner,
  ProjectAccess,
} from "../src/application/ports.js";
import { ProjectError } from "../src/domain/contracts.js";

const LONG_BODY = Array.from(
  { length: 400 },
  (_, index) => `Rule ${index}: keep the ownership boundary narrow.`,
).join("\n");

const SKILL_MD = [
  "# Frontend architecture",
  "",
  "## Ownership",
  "",
  LONG_BODY,
  "",
  "## Recipes",
  "",
  "### http-entity",
  "",
  LONG_BODY,
  "",
].join("\n");

const SCRIPTS = {
  "create:slice": "node scripts/create-slice.mjs",
  "lint:fix": "eslint --fix",
  validate: "tsc",
  "lint:architecture": "jst-lint architecture",
  lint: "eslint . && npm run lint:architecture",
  "check:release": "npm run check && npm run test:e2e",
};

class FakeProject implements ProjectAccess {
  async readPackageJson(): Promise<unknown> {
    return { name: "fake-jst", scripts: SCRIPTS };
  }
  async isDirectory(): Promise<boolean> {
    return true;
  }
  async realPath(path: string): Promise<string> {
    return path;
  }
  async readTextFile(): Promise<string> {
    return SKILL_MD;
  }
}

class RecordingRunner implements CommandRunner {
  readonly calls: {
    command: string;
    args: string[];
    options: { cwd: string; timeoutMs?: number };
  }[] = [];
  private readonly responses: CommandResult[] = [];
  respond(...results: CommandResult[]): void {
    this.responses.push(...results);
  }
  async run(
    command: string,
    args: string[],
    options: { cwd: string; timeoutMs?: number },
  ): Promise<CommandResult> {
    this.calls.push({ command, args, options });
    return (
      this.responses.shift() ?? {
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
      }
    );
  }
}

function make(runner = new RecordingRunner()): JstServices {
  return new JstServices(runner, new FakeProject(), "/work");
}

const DRY_RUN = `> create:slice\n\n${JSON.stringify({
  dependencies: ["zod"],
  devDependencies: [],
  files: ["account.model.ts"],
})}\n`;
const REAL_RUN =
  "Created entity slice at src/entities/account.\nNext: compose @/entities/account/account.public from a page.\n";

describe("jst_get_section", () => {
  it("returns the complete, untruncated section body", async () => {
    const result = await make().getSection(".", "Ownership");
    expect(result.section).toBe("Ownership");
    expect(result.body).toContain(LONG_BODY);
    expect(result.body.length).toBeGreaterThan(1_400);
    expect(result.body).not.toContain("truncated");
  });

  it("reports the available sections when the requested one is missing", async () => {
    const call = () => make().getSection(".", "Missing");
    await expect(call()).rejects.toThrow(ProjectError);
    await expect(call()).rejects.toThrow(/Ownership/u);
  });
});

describe("jst_get_recipe full text", () => {
  it("returns recipes beyond the preview budget without truncation", async () => {
    const result = await make().getRecipe(".", "http-entity");
    expect(result.body).toContain(LONG_BODY);
    expect(result.truncated).toBe(false);
  });
});

describe("jst_scaffold_slice dryRun", () => {
  it("plans without creating files", async () => {
    const runner = new RecordingRunner();
    runner.respond({ exitCode: 0, stdout: DRY_RUN, stderr: "", timedOut: false });
    const result = await make(runner).scaffoldSlice({
      projectRoot: ".",
      kind: "entity",
      name: "account",
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    expect(result.createdPaths).toEqual(["src/entities/account/account.model.ts"]);
    expect(result.dependencies).toEqual(["zod"]);
    expect(result.installCommands).toHaveLength(1);
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]!.args).toContain("--dry-run");
    expect(runner.calls[0]!.args).not.toContain("--yes");
  });
});

describe("jst_scaffold_slice install resilience", () => {
  it("still creates the slice with --no-install when dependency install fails", async () => {
    const runner = new RecordingRunner();
    runner.respond(
      { exitCode: 0, stdout: DRY_RUN, stderr: "", timedOut: false },
      {
        exitCode: 1,
        stdout: "",
        stderr: "npm error code EOVERRIDE\nOverride for zod conflicts",
        timedOut: false,
      },
      { exitCode: 0, stdout: REAL_RUN, stderr: "", timedOut: false },
    );
    const result = await make(runner).scaffoldSlice({
      projectRoot: ".",
      kind: "entity",
      name: "account",
      options: { repository: true },
    });
    expect(result.installFailed).toBe(true);
    expect(result.createdPaths).toEqual(["src/entities/account/account.model.ts"]);
    expect(result.installCommands.length).toBeGreaterThan(0);
    expect(result.nextAction).toMatch(/install/iu);
    expect(runner.calls).toHaveLength(3);
    expect(runner.calls[2]!.args).toContain("--no-install");
  });
});
