import { describe, expect, it } from "vitest";
import { JstServices } from "../src/application/services.js";
import type { CommandResult, CommandRunner, ProjectAccess } from "../src/application/ports.js";
import { CommandError, ProjectError, ValidationError } from "../src/domain/contracts.js";

const SKILL_MD = `---
name: frontend-architecture
---

# Frontend architecture

## Efficient agent loop

1. Run \`npm run create:slice -- --help\` first.
2. Inspect the nearest complete slice, then implement.

## Model first

Identify domain state and invariants before JSX.

## SOLID check

Keep contracts narrower than implementations.

## Ownership

pages compose; entities own domain types.

## DI boundary

Inject effectful boundaries through narrow ports.

## Pattern choice

Prefer composition.

## Preserve the kernel

Keep the architecture kernel.

## Styling

Colocate Owner.tsx with Owner.module.css.

## Delivery check

Test risky transitions; run check once.

## Recipes

### http-entity

**Intent:** A typed HTTP boundary.

**Responsibility:**

- DTOs describe transport data only.

**Flow:**

- \`npm run create:slice -- entity <name> --repository --tests\`

**Checks:**

- \`npm run lint:architecture\`

### persistence-entity

**Intent:** Storage behind a consumer-owned port.

### stateful-feature

**Intent:** A Reatom store view model.

### route-composition

**Intent:** Compose slices into a thin route.

### optimistic-mutation

**Intent:** Optimistic update with rollback.
`;

const HELP = `Usage: create:slice <entity|feature|module|widget> <name> [options]

Options:
  --stateful    use a Reatom store
  --repository  add a repository port
  --tests       add tests
  --style <css|scss>
  --help        show help
`;

class FakeProject implements ProjectAccess {
  constructor(
    private readonly scripts: Record<string, string>,
    private readonly isDir = true,
    private readonly skillMarkdown: string = SKILL_MD,
  ) {}
  async readPackageJson(): Promise<unknown> {
    return { name: "fake-jst", scripts: this.scripts };
  }
  async isDirectory(): Promise<boolean> {
    return this.isDir;
  }
  async readTextFile(): Promise<string> {
    return this.skillMarkdown;
  }
}

class RecordingRunner implements CommandRunner {
  readonly calls: { command: string; args: string[]; options: { cwd: string; timeoutMs?: number } }[] = [];
  private responses: CommandResult[] = [];
  respond(...results: CommandResult[]) {
    this.responses.push(...results);
  }
  async run(command: string, args: string[], options: { cwd: string; timeoutMs?: number }): Promise<CommandResult> {
    this.calls.push({ command, args, options });
    return this.responses.shift() ?? { exitCode: 0, stdout: "", stderr: "", timedOut: false };
  }
}

const JST_SCRIPTS: Record<string, string> = {
  "create:slice": "node scripts/create-slice.mjs",
  "lint:fix": "eslint --fix",
  validate: "tsc",
  "lint:architecture": "jst-lint architecture",
  "check:release": "npm run check && npm run test:e2e",
};

function make(runner = new RecordingRunner(), project: ProjectAccess = new FakeProject(JST_SCRIPTS)) {
  return new JstServices(runner, project, "/work");
}

describe("jst_start_task", () => {
  it("returns workflow, capabilities, next commands, and sections matched to the brief", async () => {
    const runner = new RecordingRunner();
    runner.respond({ exitCode: 0, stdout: HELP, stderr: "", timedOut: false });
    const result = await make(runner).startTask({ projectRoot: ".", brief: "create a new checkout feature with an optimistic mutation" });
    expect(result.project.name).toBe("fake-jst");
    expect(result.project.root).toBe("/work");
    expect(result.taskKind).toBe("new-boundary");
    expect(result.agentRules).toContainEqual(expect.stringContaining("do not reread"));
    expect(result.agentRules).toContainEqual(expect.stringContaining("current owner"));
    expect(result.workflow.length).toBeGreaterThan(0);
    expect(result.workflow).toContainEqual(expect.stringContaining("jst_scaffold_slice"));
    expect(result.workflow).toContainEqual(expect.stringContaining("jst_check with gate fast"));
    expect(result.capabilities?.kinds).toEqual(["entity", "feature", "module", "widget"]);
    expect(result.capabilities?.options).toContain("--stateful");
    expect(result.nextCommands).toEqual(["jst_scaffold_slice", "jst_check"]);
    expect(result.recipes.map((recipe) => recipe.recipe)).toContain("optimistic-mutation");
    expect(result.sections.some((section) => section.name === "Ownership")).toBe(true);
    expect(result.sections.some((section) => section.name === "Delivery check")).toBe(true);
    expect(runner.calls[0]!.args).toEqual(["run", "create:slice", "--", "--help"]);
  });

  it("keeps a local styling task concise and skips generator discovery", async () => {
    const runner = new RecordingRunner();
    const result = await make(runner).startTask({ projectRoot: ".", brief: "make the card 100 px wider" });
    expect(result.taskKind).toBe("local-change");
    expect(result.sections.map((section) => section.name)).toEqual(["Styling"]);
    expect(result.capabilities).toBeUndefined();
    expect(result.nextCommands).toEqual(["jst_check"]);
    expect(result.workflow).toContainEqual(expect.stringContaining("do not add a slice"));
    expect(runner.calls).toHaveLength(0);
  });

  it("returns ownership guidance for an existing workflow", async () => {
    const result = await make().startTask({ projectRoot: ".", brief: "fix checkout retry handling" });
    expect(result.taskKind).toBe("existing-workflow");
    expect(result.sections.map((section) => section.name)).toContain("Ownership");
  });

  it("returns no architecture prose for a direct documentation change", async () => {
    const result = await make().startTask({ projectRoot: ".", brief: "update README setup section" });
    expect(result.taskKind).toBe("direct-change");
    expect(result.sections).toEqual([]);
    expect(result.recipes).toEqual([]);
  });

  it("keeps common maintenance contracts within deterministic response budgets", async () => {
    const cases = [
      { brief: "update README setup section", maxChars: 1_500 },
      { brief: "make the card 100 px wider", maxChars: 3_000 },
      { brief: "fix checkout retry handling and loading state", maxChars: 7_000 },
      { brief: "create a new checkout feature with optimistic mutation", maxChars: 10_000 },
    ];
    for (const testCase of cases) {
      const runner = new RecordingRunner();
      runner.respond({ exitCode: 0, stdout: HELP, stderr: "", timedOut: false });
      const result = await make(runner).startTask({ projectRoot: ".", brief: testCase.brief });
      expect(JSON.stringify(result).length, testCase.brief).toBeLessThan(testCase.maxChars);
    }
  });

  it("rejects non-JST projects and non-directories", async () => {
    const notJst = new JstServices(new RecordingRunner(), new FakeProject({}), "/work");
    await expect(notJst.startTask({ projectRoot: ".", brief: "x" })).rejects.toThrow(ProjectError);
    const notDir = new JstServices(new RecordingRunner(), new FakeProject(JST_SCRIPTS, false), "/work");
    await expect(notDir.startTask({ projectRoot: "missing", brief: "x" })).rejects.toThrow(ProjectError);
  });
});

describe("jst_get_recipe", () => {
  it("returns the matching project-local recipe section", async () => {
    const result = await make().getRecipe(".", "http-entity");
    expect(result.recipe).toBe("http-entity");
    expect(result.body).toContain("**Intent:** A typed HTTP boundary.");
    expect(result.truncated).toBe(false);
  });

  it("throws when the skill has no Recipes section", async () => {
    const noRecipes = "## Efficient agent loop\n\n1. Run help.\n";
    const services = new JstServices(new RecordingRunner(), new FakeProject(JST_SCRIPTS, true, noRecipes), "/work");
    await expect(services.getRecipe(".", "http-entity")).rejects.toThrow(ProjectError);
  });

  it("throws when the recipe is absent from the skill", async () => {
    const onlyHttp = "## Recipes\n\n### http-entity\n\n**Intent:** typed HTTP boundary.\n";
    const services = new JstServices(new RecordingRunner(), new FakeProject(JST_SCRIPTS, true, onlyHttp), "/work");
    await expect(services.getRecipe(".", "stateful-feature")).rejects.toThrow(ProjectError);
  });
});

describe("jst_scaffold_slice", () => {
  const dryRun = `> app@0.0.0 create:slice\n> node scripts/create-slice.mjs entity account --dry-run\n\n${JSON.stringify({
    dependencies: ["zod"],
    devDependencies: [],
    files: ["model/account.model.ts", "account.public.ts"],
  })}\n`;
  const realRun = "Created entity slice at src/entities/account.\nNext: compose @/entities/account/account.public from an owning page.\n";

  it("delegates to the generator with an argument array and returns created paths", async () => {
    const runner = new RecordingRunner();
    runner.respond({ exitCode: 0, stdout: dryRun, stderr: "", timedOut: false }, { exitCode: 0, stdout: realRun, stderr: "", timedOut: false });
    const services = make(runner);

    const result = await services.scaffoldSlice({
      projectRoot: ".",
      kind: "entity",
      name: "account",
      options: { repository: true, tests: true },
    });

    expect(result.target).toBe("src/entities/account");
    expect(result.createdPaths).toEqual(["src/entities/account/model/account.model.ts", "src/entities/account/account.public.ts"]);
    expect(result.dependencies).toEqual(["zod"]);
    expect(result.nextAction).toBe("compose @/entities/account/account.public from an owning page.");

    expect(runner.calls).toHaveLength(2);
    expect(runner.calls[0]!.args).toEqual(["run", "create:slice", "--", "entity", "account", "--repository", "--tests", "--dry-run"]);
    expect(runner.calls[1]!.args).toEqual(["run", "create:slice", "--", "entity", "account", "--repository", "--tests", "--yes"]);
    for (const call of runner.calls) {
      expect(call.command).toBe("npm");
      expect(call.args.every((arg) => !/\s/u.test(arg))).toBe(true);
      expect(call.options.cwd).toBe("/work");
    }
  });

  it("fails fast on invalid names before running anything", async () => {
    const runner = new RecordingRunner();
    await expect(make(runner).scaffoldSlice({ projectRoot: ".", kind: "entity", name: "account-settings" })).rejects.toThrow(ValidationError);
    expect(runner.calls).toHaveLength(0);
  });

  it("surfaces a failed dry-run as a command error", async () => {
    const runner = new RecordingRunner();
    runner.respond({ exitCode: 1, stdout: "", stderr: "Slice already exists", timedOut: false });
    await expect(make(runner).scaffoldSlice({ projectRoot: ".", kind: "widget", name: "signup" })).rejects.toThrow(CommandError);
  });
});

describe("jst_check", () => {
  it("maps gates to npm scripts and reports success", async () => {
    const runner = new RecordingRunner();
    runner.respond({ exitCode: 0, stdout: "all good", stderr: "", timedOut: false });
    const result = await make(runner).check({ projectRoot: ".", gate: "fix" });
    expect(result.ok).toBe(true);
    expect(result.script).toBe("lint:fix");
    expect(result.command).toBe("npm run lint:fix");
    expect(result.summary).toContain("all good");
    expect(runner.calls[0]!.args).toEqual(["run", "lint:fix"]);
  });

  it("reports failure and the prescribed next action", async () => {
    const runner = new RecordingRunner();
    runner.respond({ exitCode: 1, stdout: "", stderr: "boom", timedOut: false });
    const result = await make(runner).check({ projectRoot: ".", gate: "architecture" });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("boom");
    expect(result.nextAction).toContain("Move the responsibility");
  });

  it("bounds large diagnostic output", async () => {
    const runner = new RecordingRunner();
    runner.respond({ exitCode: 1, stdout: "y".repeat(10_000), stderr: "", timedOut: false });
    const result = await make(runner).check({ projectRoot: ".", gate: "fast" });
    expect(result.truncated).toBe(true);
    expect(result.summary.length).toBeLessThan(5_000);
  });

  it("keeps timeout recovery inside the JST gate workflow", async () => {
    const runner = new RecordingRunner();
    runner.respond({ exitCode: 1, stdout: "still running", stderr: "", timedOut: true });
    const result = await make(runner).check({ projectRoot: ".", gate: "release" });
    expect(result.nextAction).toContain("re-run this JST gate once");
    expect(result.nextAction).not.toContain("stage directly");
  });

  it("fails fast when the required npm script is missing", async () => {
    const missing = new JstServices(new RecordingRunner(), new FakeProject({ "create:slice": "x" }), "/work");
    await expect(missing.check({ projectRoot: ".", gate: "release" })).rejects.toThrow(ProjectError);
  });
});
