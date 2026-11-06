import { resolve } from "node:path";
import { ProjectError } from "../domain/contracts.js";
import type { SectionResult } from "../domain/contracts.js";
import { parseSections } from "../domain/markdown.js";
import { SKILL_RELATIVE_PATH } from "../domain/operational.js";
import { parseInput, sectionInputSchema } from "../domain/schemas.js";
import type { RequireJstProject } from "./check.js";
import type { ProjectAccess } from "./ports.js";

export async function getSectionBody(
  project: ProjectAccess,
  requireProject: RequireJstProject,
  input: unknown,
): Promise<SectionResult> {
  const { projectRoot, section } = parseInput(sectionInputSchema, input);
  const resolved = await requireProject(projectRoot);
  const path = resolve(resolved.root, SKILL_RELATIVE_PATH);
  const markdown = await readSkill(project, path);
  const sections = parseSections(markdown, 2);
  const found = sections.find((candidate) => candidate.name === section);
  if (found) {
    return { section, body: found.body };
  }
  const available = sections.map((candidate) => candidate.name).join(", ");
  throw new ProjectError(
    `Section "${section}" not found. Available sections: ${available}.`,
  );
}

async function readSkill(project: ProjectAccess, path: string): Promise<string> {
  try {
    return await project.readTextFile(path);
  } catch {
    throw new ProjectError(
      `Architecture skill not found at ${path}; scaffold this project with create-jst first.`,
    );
  }
}
