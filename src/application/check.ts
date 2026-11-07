import { ProjectError } from "../domain/contracts.js";
import type { CheckResult } from "../domain/contracts.js";
import { GATE_DEFINITIONS } from "../domain/operational.js";
import { checkInputSchema, parseInput } from "../domain/schemas.js";
import { boundSummary, gateNextAction, npmCommand } from "./gate.js";
import type { CommandRunner } from "./ports.js";

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const RELEASE_TIMEOUT_MS = 15 * 60_000;

export interface JstProject {
  root: string;
  scripts: Record<string, string>;
  name: string;
  packageManager: "npm" | "pnpm";
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

export type RequireJstProject = (projectRoot: string) => Promise<JstProject>;

export async function checkProject(
  runner: CommandRunner,
  requireProject: RequireJstProject,
  input: unknown,
): Promise<CheckResult> {
  const { projectRoot, gate } = parseInput(checkInputSchema, input);
  const project = await requireProject(projectRoot);
  const definition = GATE_DEFINITIONS[gate];
  if (typeof project.scripts[definition.script] !== "string") {
    throw new ProjectError(
      `JST project ${project.root} has no "${definition.script}" script for gate "${gate}".`,
    );
  }
  const timeoutMs =
    gate === "release" ? RELEASE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
  const result = await runner.run(npmCommand(), ["run", definition.script], {
    cwd: project.root,
    timeoutMs,
  });
  const ok = result.exitCode === 0;
  const bounded = boundSummary(result.stdout, result.stderr);
  const nextAction = dependencyRepairAction(bounded.summary, definition.onFail);
  return {
    gate,
    script: definition.script,
    command: `npm run ${definition.script}`,
    exitCode: result.exitCode,
    ok,
    timedOut: result.timedOut,
    summary: bounded.summary,
    truncated: bounded.truncated,
    nextAction: gateNextAction({
      timedOut: result.timedOut,
      ok,
      timeoutMs,
      onPass: definition.onPass,
      onFail: nextAction,
    }),
    completionReceipt: ok ? { gate, ok: true } : undefined,
  };
}

function dependencyRepairAction(summary: string, fallback: string): string {
  if (!/could not be resolved|error typed value|cannot find module/iu.test(summary)) {
    return fallback;
  }
  return [
    "Verify the generated dependencies are installed with the exact versions returned by jst_scaffold_slice.",
    "If typecheck passes but these diagnostics persist, remove the disposable .eslintcache and re-run only this gate.",
  ].join(" ");
}
