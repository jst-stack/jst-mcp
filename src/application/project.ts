import { isAbsolute, relative, resolve } from "node:path";
import { ProjectError } from "../domain/contracts.js";
import type { ProjectAccess } from "./ports.js";
import type { JstProject } from "./check.js";
import { SKILL_RELATIVE_PATH } from "../domain/operational.js";
import { packageVersions } from "../domain/projectStack.js";

export async function requireJstProject(
  project: ProjectAccess,
  cwd: string,
  projectRoot: string,
): Promise<JstProject> {
  const root = await resolveWorkspaceRoot(project, cwd, projectRoot);
  const record = await readManifest(project, root);
  const scripts = readScripts(root, record);
  await verifyMarkers(project, root);
  const packageManager =
    typeof record.packageManager === "string" && record.packageManager.startsWith("pnpm@")
      ? "pnpm"
      : "npm";
  return {
    root,
    scripts,
    name: typeof record.name === "string" ? record.name : "jst-project",
    packageManager,
    dependencies: packageVersions(record.dependencies),
    devDependencies: packageVersions(record.devDependencies),
  };
}

async function resolveWorkspaceRoot(
  project: ProjectAccess,
  cwd: string,
  projectRoot: string,
): Promise<string> {
  const candidate = resolve(cwd, projectRoot);
  if (!(await project.isDirectory(candidate))) {
    throw new ProjectError(`Project root is not a directory: ${candidate}`);
  }
  const [workspaceRoot, root] = await Promise.all([
    project.realPath(cwd),
    project.realPath(candidate),
  ]);
  const workspaceRelativePath = relative(workspaceRoot, root);
  if (
    workspaceRelativePath === ".." ||
    workspaceRelativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(workspaceRelativePath)
  ) {
    throw new ProjectError(`Project root must stay inside the MCP workspace: ${workspaceRoot}`);
  }
  return root;
}

async function readManifest(project: ProjectAccess, root: string): Promise<Record<string, unknown>> {
  let manifest: unknown;
  try {
    manifest = await project.readPackageJson(root);
  } catch {
    throw new ProjectError(`package.json not found at ${root}`);
  }
  if (typeof manifest !== "object" || manifest === null) {
    throw new ProjectError(`Invalid package.json at ${root}`);
  }
  return manifest as Record<string, unknown>;
}

function readScripts(root: string, record: Record<string, unknown>): Record<string, string> {
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
  return scriptRecord;
}

async function verifyMarkers(project: ProjectAccess, root: string): Promise<void> {
  for (const marker of ["jst.config.ts", SKILL_RELATIVE_PATH]) {
    try {
      await project.readTextFile(resolve(root, marker));
    } catch {
      throw new ProjectError(`Not a JST project (${root}): missing ${marker}.`);
    }
  }
}
