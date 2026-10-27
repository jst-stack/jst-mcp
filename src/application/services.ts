import { resolve } from "node:path";
import { ProjectError } from "../domain/contracts.js";
import type {
  CheckResult,
  RecipeName,
  RecipeResult,
  ScaffoldSliceResult,
  SelectedSection,
  StartTaskResult,
} from "../domain/contracts.js";
import { SLICE_KINDS } from "../domain/contracts.js";
import { boundText, parseSections } from "../domain/markdown.js";
import type { MarkdownSection } from "../domain/markdown.js";
import {
  classifyTask,
  GENERATOR_COMMAND,
  parseGeneratorHelp,
  selectRecipeNames,
  selectSections,
  SKILL_RELATIVE_PATH,
  taskWorkflow,
} from "../domain/operational.js";
import {
  parseInput,
  recipeInputSchema,
  startTaskInputSchema,
} from "../domain/schemas.js";
import { checkProject } from "./check.js";
import type { JstProject } from "./check.js";
import type { CommandRunner, ProjectAccess } from "./ports.js";
import { npmCommand } from "./gate.js";
import { scaffoldSlice } from "./scaffoldSlice.js";

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const SECTION_MAX_CHARS = 1_400;
const SECTIONS_TOTAL_MAX_CHARS = 6_500;
const RECIPES_SECTION = "Recipes";
const AGENT_RULES = [
  [
    "Treat this response and generated slice files as the JST contract; do not reread the architecture skill",
    "or inspect docs, generators, lint rules, framework internals, or dependency source.",
  ].join(" "),
  "Inspect and edit only the current owner, its narrow public contract, nearest consumer, and directly related tests.",
  [
    "Use jst_check for project gates; do not run its internal lint, typecheck, build, audit, full-unit,",
    "or full-E2E stages separately.",
  ].join(" "),
  "The task is incomplete until jst_check returns ok: true for the required fast gate.",
] as const;

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

  private async requireJstProject(projectRoot: string): Promise<JstProject> {
    const root = await this.resolveProjectRoot(projectRoot);
    let pkg: unknown;
    try {
      pkg = await this.project.readPackageJson(root);
    } catch {
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
      throw new ProjectError(
        `Not a JST project (${root}): missing "create:slice" script. Scaffold it with create-jst first.`,
      );
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
    const capabilities =
      taskKind === "new-boundary"
        ? await this.readCapabilities(project.root)
        : undefined;
    const selected = this.boundSections(
      selectSections(sections, brief, taskKind),
    );
    const recipes = this.readRecipes(sections, selectRecipeNames(brief));
    return {
      project: { root: project.root, name: project.name },
      taskKind,
      agentRules: [...AGENT_RULES],
      workflow: task.workflow,
      capabilities,
      nextCommands: task.nextCommands,
      completionRequirement: {
        tool: "jst_check",
        gate: "fast",
        successField: "ok",
      },
      recipes,
      sections: selected,
    };
  }

  async getRecipe(
    projectRoot: string,
    recipe: RecipeName,
  ): Promise<RecipeResult> {
    const { projectRoot: root } = parseInput(recipeInputSchema, {
      projectRoot,
      recipe,
    });
    const resolved = await this.resolveProjectRoot(root);
    const sections = await this.readSkillSections(resolved);
    const recipesSection = sections.find(
      (section) => section.name === RECIPES_SECTION,
    );
    if (!recipesSection) {
      throw new ProjectError(
        `No "${RECIPES_SECTION}" section in ${resolve(resolved, SKILL_RELATIVE_PATH)}.`,
      );
    }
    const recipeSection = parseSections(recipesSection.body, 3).find(
      (section) => section.name === recipe,
    );
    if (!recipeSection) {
      throw new ProjectError(
        `Recipe "${recipe}" not found in the project-local architecture skill.`,
      );
    }
    const bounded = boundText(recipeSection.body, SECTION_MAX_CHARS);
    return { recipe, body: bounded.text, truncated: bounded.truncated };
  }

  private async readSkillSections(root: string): Promise<MarkdownSection[]> {
    const path = resolve(root, SKILL_RELATIVE_PATH);
    let markdown: string;
    try {
      markdown = await this.project.readTextFile(path);
    } catch {
      throw new ProjectError(
        `Architecture skill not found at ${path}; scaffold this project with create-jst first.`,
      );
    }
    return parseSections(markdown, 2);
  }

  private readRecipes(
    sections: MarkdownSection[],
    names: RecipeName[],
  ): RecipeResult[] {
    const recipes = sections.find(
      (section) => section.name === RECIPES_SECTION,
    );
    if (!recipes) {
      return [];
    }
    const byName = new Map(
      parseSections(recipes.body, 3).map((section) => [section.name, section]),
    );
    return names.flatMap((recipe) => {
      const section = byName.get(recipe);
      if (!section) {
        return [];
      }
      const bounded = boundText(section.body, SECTION_MAX_CHARS);
      return [{ recipe, body: bounded.text, truncated: bounded.truncated }];
    });
  }

  private async readCapabilities(root: string) {
    const help = await this.runner.run(
      npmCommand(),
      ["run", "create:slice", "--", "--help"],
      {
        cwd: root,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      },
    );
    const { kinds, options } =
      help.exitCode === 0
        ? parseGeneratorHelp(help.stdout)
        : { kinds: [...SLICE_KINDS], options: [] as string[] };
    return { kinds, options, command: GENERATOR_COMMAND };
  }

  private boundSections(sections: MarkdownSection[]): SelectedSection[] {
    const result: SelectedSection[] = [];
    let total = 0;
    for (const section of sections) {
      if (total >= SECTIONS_TOTAL_MAX_CHARS) {
        break;
      }
      const bounded = boundText(
        section.body,
        Math.min(SECTION_MAX_CHARS, SECTIONS_TOTAL_MAX_CHARS - total),
      );
      result.push({
        name: section.name,
        body: bounded.text,
        truncated: bounded.truncated,
      });
      total += bounded.text.length;
    }
    return result;
  }

  async scaffoldSlice(input: unknown): Promise<ScaffoldSliceResult> {
    return scaffoldSlice(this.runner, this.requireJstProject.bind(this), input);
  }

  async check(input: unknown): Promise<CheckResult> {
    return checkProject(this.runner, this.requireJstProject.bind(this), input);
  }
}
