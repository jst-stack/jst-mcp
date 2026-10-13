/** Domain contracts for @jst-stack/mcp. No dependency on any other layer. */

export const SLICE_KINDS = ["entity", "feature", "module", "widget"] as const;
export type SliceKind = (typeof SLICE_KINDS)[number];

export const SLICE_LAYERS = {
  entity: "entities",
  feature: "features",
  module: "modules",
  widget: "widgets",
} as const satisfies Record<SliceKind, string>;

export const RECIPE_NAMES = [
  "http-entity",
  "persistence-entity",
  "stateful-feature",
  "route-composition",
  "optimistic-mutation",
] as const;
export type RecipeName = (typeof RECIPE_NAMES)[number];

export const GATE_NAMES = ["fix", "fast", "architecture", "release"] as const;
export type GateName = (typeof GATE_NAMES)[number];

export const STYLE_VALUES = ["css", "scss"] as const;
export type StyleValue = (typeof STYLE_VALUES)[number];

export const TASK_KINDS = ["direct-change", "local-change", "existing-workflow", "new-boundary"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export interface SliceOptions {
  stateful?: boolean;
  repository?: boolean;
  service?: boolean;
  persistence?: boolean;
  ui?: boolean;
  tests?: boolean;
  msw?: boolean;
  public?: boolean;
  noInstall?: boolean;
  style?: StyleValue;
}

export type JstErrorCode = "INVALID_INPUT" | "INVALID_PROJECT" | "COMMAND_FAILED";

export class JstError extends Error {
  readonly code: JstErrorCode;
  constructor(code: JstErrorCode, message: string) {
    super(message);
    this.name = "JstError";
    this.code = code;
  }
}

export class ValidationError extends JstError {
  constructor(message: string) {
    super("INVALID_INPUT", message);
    this.name = "ValidationError";
  }
}

export class ProjectError extends JstError {
  constructor(message: string) {
    super("INVALID_PROJECT", message);
    this.name = "ProjectError";
  }
}

export class CommandError extends JstError {
  constructor(message: string) {
    super("COMMAND_FAILED", message);
    this.name = "CommandError";
  }
}

export interface SelectedSection {
  name: string;
  body: string;
  truncated: boolean;
}

export interface GeneratorCapabilities {
  kinds: string[];
  command: string;
  options: string[];
}

export interface StartTaskResult {
  project: { root: string; name: string };
  taskKind: TaskKind;
  agentRules: string[];
  workflow: string[];
  capabilities?: GeneratorCapabilities;
  nextCommands: string[];
  recipes: RecipeResult[];
  sections: SelectedSection[];
}

export interface ScaffoldSliceResult {
  target: string;
  layer: string;
  kind: SliceKind;
  name: string;
  command: string;
  createdPaths: string[];
  dependencies: string[];
  devDependencies: string[];
  nextAction: string;
}

export interface RecipeResult {
  recipe: RecipeName;
  body: string;
  truncated: boolean;
}

export interface CheckResult {
  gate: GateName;
  script: string;
  command: string;
  exitCode: number | null;
  ok: boolean;
  timedOut: boolean;
  summary: string;
  truncated: boolean;
  nextAction: string;
}
