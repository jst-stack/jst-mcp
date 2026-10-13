import { resolve } from "node:path";
import { CommandError, ProjectError } from "../domain/contracts.js";
import type {
  CheckResult, RecipeName, RecipeResult, ScaffoldSliceResult, SelectedSection, SliceKind, SliceOptions, StartTaskResult,
} from "../domain/contracts.js";
import { SLICE_KINDS, SLICE_LAYERS } from "../domain/contracts.js";
import { boundText, parseSections } from "../domain/markdown.js";
import type { MarkdownSection } from "../domain/markdown.js";
import { classifyTask, GATE_DEFINITIONS, GENERATOR_COMMAND, parseGeneratorHelp, selectRecipeNames, selectSections, SKILL_RELATIVE_PATH, taskWorkflow } from "../domain/operational.js";
import { checkInputSchema, parseInput, parseSliceOptions, recipeInputSchema, scaffoldInputSchema, startTaskInputSchema } from "../domain/schemas.js";
import type { CommandRunner, ProjectAccess } from "./ports.js";

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const RELEASE_TIMEOUT_MS = 15 * 60_000;
const SUMMARY_MAX_CHARS = 4_000;
const SECTION_MAX_CHARS = 1_400;
const SECTIONS_TOTAL_MAX_CHARS = 6_500;
const RECIPES_SECTION = "Recipes";
const AGENT_RULES = [
  "Treat this response and generated slice files as the JST contract; do not reread the architecture skill or inspect docs, generators, lint rules, framework internals, or dependency source.",
  "Inspect and edit only the current owner, its narrow public contract, nearest consumer, and directly related tests.",
  "Use jst_check for project gates; do not run its internal lint, typecheck, build, audit, full-unit, or full-E2E stages separately.",
] as const;

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function boundSummary(stdout: string, stderr: string): { summary: string; truncated: boolean } {
  const parts: string[] = [];
  if (stderr.trim()) parts.push(`stderr:\n${stderr.trim()}`);
  if (stdout.trim()) parts.push(`stdout:\n${stdout.trim()}`);
  const combined = parts.join("\n") || "(no output)";
  if (combined.length <= SUMMARY_MAX_CHARS) return { summary: combined, truncated: false };
  return {
    summary: `[output truncated, showing last ${SUMMARY_MAX_CHARS} chars]\n...${combined.slice(-SUMMARY_MAX_CHARS)}`,
    truncated: true,
  };
}

export class JstServices {
  constructor(
    private readonly runner: CommandRunner,
    private readonly project: ProjectAccess,
    private readonly cwd: string,
  ) {}

  private resolveRoot(projectRoot: string): string {
    return resolve(this.cwd, projectRoot);
  }

  private async resolveProjectRoot(projectRoot: string): Promise<string> {
    const root = this.resolveRoot(projectRoot);
    if (!(await this.project.isDirectory(root))) {
      throw new ProjectError(`Project root is not a directory: ${root}`);
    }
    return root;
  }

  private async requireJstProject(projectRoot: string): Promise<{ root: string; scripts: Record<string, string>; name: string }> {
    const root = await this.resolveProjectRoot(projectRoot);
    let pkg: unknown;
    try {
      pkg = await this.project.readPackageJson(root);
    }
    catch {
      throw new ProjectError(`package.json not found at ${root}`);
    }
    if (typeof pkg !== "object" || pkg === null) {
      throw new ProjectError(`Invalid package.json at ${root}`);
    }
    const record = pkg as Record<string, unknown>;
    const scripts = record.scripts;
    if (typeof scripts !== "object" || scripts === null) {
      throw new ProjectError(`No "scripts" section in ${root}/package.json`);
    }
    const scriptRecord = scripts as Record<string, string>;
    if (typeof scriptRecord["create:slice"] !== "string") {
      throw new ProjectError(`Not a JST project (${root}): missing "create:slice" script. Scaffold it with create-jst first.`);
    }
    const name = typeof record.name === "string" ? record.name : "jst-project";
    return { root, scripts: scriptRecord, name };
  }

  async startTask(input: unknown): Promise<StartTaskResult> {
    const { projectRoot, brief } = parseInput(startTaskInputSchema, input);
    const project = await this.requireJstProject(projectRoot);
    const sections = await this.readSkillSections(project.root);
    const taskKind = classifyTask(brief);
    const task = taskWorkflow(taskKind);
    const capabilities = taskKind === "new-boundary" ? await this.readCapabilities(project.root) : undefined;
    const selected = this.boundSections(selectSections(sections, brief, taskKind));
    const recipes = this.readRecipes(sections, selectRecipeNames(brief));
    return {
      project: { root: project.root, name: project.name },
      taskKind,
      agentRules: [...AGENT_RULES],
      workflow: task.workflow,
      capabilities,
      nextCommands: task.nextCommands,
      recipes,
      sections: selected,
    };
  }

  async getRecipe(projectRoot: string, recipe: RecipeName): Promise<RecipeResult> {
    const { projectRoot: root } = parseInput(recipeInputSchema, { projectRoot, recipe });
    const resolved = await this.resolveProjectRoot(root);
    const sections = await this.readSkillSections(resolved);
    const recipesSection = sections.find((section) => section.name === RECIPES_SECTION);
    if (!recipesSection) {
      throw new ProjectError(`No "${RECIPES_SECTION}" section in ${resolve(resolved, SKILL_RELATIVE_PATH)}.`);
    }
    const recipeSection = parseSections(recipesSection.body, 3).find((section) => section.name === recipe);
    if (!recipeSection) {
      throw new ProjectError(`Recipe "${recipe}" not found in the project-local architecture skill.`);
    }
    const bounded = boundText(recipeSection.body, SECTION_MAX_CHARS);
    return { recipe, body: bounded.text, truncated: bounded.truncated };
  }

  private async readSkillSections(root: string): Promise<MarkdownSection[]> {
    const path = resolve(root, SKILL_RELATIVE_PATH);
    let markdown: string;
    try {
      markdown = await this.project.readTextFile(path);
    }
    catch {
      throw new ProjectError(`Architecture skill not found at ${path}; scaffold this project with create-jst first.`);
    }
    return parseSections(markdown, 2);
  }

  private readRecipes(sections: MarkdownSection[], names: RecipeName[]): RecipeResult[] {
    const recipes = sections.find((section) => section.name === RECIPES_SECTION);
    if (!recipes) return [];
    const byName = new Map(parseSections(recipes.body, 3).map((section) => [section.name, section]));
    return names.flatMap((recipe) => {
      const section = byName.get(recipe);
      if (!section) return [];
      const bounded = boundText(section.body, SECTION_MAX_CHARS);
      return [{ recipe, body: bounded.text, truncated: bounded.truncated }];
    });
  }

  private async readCapabilities(root: string) {
    const help = await this.runner.run(npmCommand(), ["run", "create:slice", "--", "--help"], { cwd: root, timeoutMs: DEFAULT_TIMEOUT_MS });
    const { kinds, options } = help.exitCode === 0
      ? parseGeneratorHelp(help.stdout)
      : { kinds: [...SLICE_KINDS], options: [] as string[] };
    return { kinds, options, command: GENERATOR_COMMAND };
  }

  private boundSections(sections: MarkdownSection[]): SelectedSection[] {
    const result: SelectedSection[] = [];
    let total = 0;
    for (const section of sections) {
      if (total >= SECTIONS_TOTAL_MAX_CHARS) break;
      const bounded = boundText(section.body, Math.min(SECTION_MAX_CHARS, SECTIONS_TOTAL_MAX_CHARS - total));
      result.push({ name: section.name, body: bounded.text, truncated: bounded.truncated });
      total += bounded.text.length;
    }
    return result;
  }

  async scaffoldSlice(input: unknown): Promise<ScaffoldSliceResult> {
    const { projectRoot, kind, name, options } = parseInput(scaffoldInputSchema, input);
    const project = await this.requireJstProject(projectRoot);
    const opts: SliceOptions = parseSliceOptions(options ?? {});
    const layer = SLICE_LAYERS[kind];
    const baseArgs = this.buildScaffoldArgs(kind, name, opts);

    const dryRun = await this.runner.run(npmCommand(), [...baseArgs, "--dry-run"], { cwd: project.root, timeoutMs: DEFAULT_TIMEOUT_MS });
    if (dryRun.exitCode !== 0) {
      throw new CommandError(`create:slice --dry-run failed: ${boundSummary(dryRun.stdout, dryRun.stderr).summary}`);
    }
    const plan = this.parseDryRunPlan(dryRun.stdout, layer, name);

    const run = await this.runner.run(npmCommand(), [...baseArgs, "--yes"], { cwd: project.root, timeoutMs: DEFAULT_TIMEOUT_MS });
    if (run.exitCode !== 0) {
      throw new CommandError(`create:slice failed: ${boundSummary(run.stdout, run.stderr).summary}`);
    }
    const nextAction = this.extractNextAction(run.stdout) ?? this.defaultNextAction(layer, name);

    return {
      target: `src/${layer}/${name}`,
      layer,
      kind,
      name,
      command: `npm run create:slice -- ${kind} ${name}`,
      createdPaths: plan.createdPaths,
      dependencies: plan.dependencies,
      devDependencies: plan.devDependencies,
      nextAction,
    };
  }

  async check(input: unknown): Promise<CheckResult> {
    const { projectRoot, gate } = parseInput(checkInputSchema, input);
    const project = await this.requireJstProject(projectRoot);
    const definition = GATE_DEFINITIONS[gate];
    if (typeof project.scripts[definition.script] !== "string") {
      throw new ProjectError(`JST project ${project.root} has no "${definition.script}" script for gate "${gate}".`);
    }
    const timeoutMs = gate === "release" ? RELEASE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
    const result = await this.runner.run(npmCommand(), ["run", definition.script], { cwd: project.root, timeoutMs });
    const ok = result.exitCode === 0;
    const bounded = boundSummary(result.stdout, result.stderr);
    return {
      gate,
      script: definition.script,
      command: `npm run ${definition.script}`,
      exitCode: result.exitCode,
      ok,
      timedOut: result.timedOut,
      summary: bounded.summary,
      truncated: bounded.truncated,
      nextAction: result.timedOut
        ? `The gate timed out after ${Math.round(timeoutMs / 1000)}s; inspect the bounded output, repair any actionable diagnostic, then re-run this JST gate once.`
        : ok
          ? definition.onPass
          : definition.onFail,
    };
  }

  private buildScaffoldArgs(kind: SliceKind, name: string, opts: SliceOptions): string[] {
    const args = ["run", "create:slice", "--", kind, name];
    if (opts.stateful) args.push("--stateful");
    if (opts.repository) args.push("--repository");
    if (opts.service) args.push("--service");
    if (opts.persistence) args.push("--persistence");
    if (opts.ui) args.push("--ui");
    if (opts.tests) args.push("--tests");
    if (opts.msw) args.push("--msw");
    if (opts.public) args.push("--public");
    if (opts.noInstall) args.push("--no-install");
    if (opts.style) args.push("--style", opts.style);
    return args;
  }

  private parseDryRunPlan(stdout: string, layer: string, name: string): { createdPaths: string[]; dependencies: string[]; devDependencies: string[] } {
    let parsed: unknown;
    try {
      const start = stdout.indexOf("{");
      const end = stdout.lastIndexOf("}");
      if (start < 0 || end < start) throw new SyntaxError("No JSON object in output");
      parsed = JSON.parse(stdout.slice(start, end + 1));
    }
    catch {
      throw new CommandError("create:slice --dry-run did not return valid JSON.");
    }
    const record = parsed as Record<string, unknown>;
    const files = Array.isArray(record.files) ? record.files.filter((file): file is string => typeof file === "string") : [];
    const dependencies = Array.isArray(record.dependencies) ? record.dependencies.filter((dep): dep is string => typeof dep === "string") : [];
    const devDependencies = Array.isArray(record.devDependencies) ? record.devDependencies.filter((dep): dep is string => typeof dep === "string") : [];
    return {
      createdPaths: files.map((file) => `src/${layer}/${name}/${file}`),
      dependencies,
      devDependencies,
    };
  }

  private extractNextAction(stdout: string): string | undefined {
    for (const line of stdout.split(/\r?\n/u)) {
      if (line.startsWith("Next:")) return line.slice("Next:".length).trim();
    }
    return undefined;
  }

  private defaultNextAction(layer: string, name: string): string {
    return `Compose @/${layer}/${name}/${name}.public from an owning page or higher layer.`;
  }
}
