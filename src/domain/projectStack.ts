import type { ProjectStack } from "./contracts.js";

const PROJECT_STACK_LIMIT = 60;

export function packageVersions(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function projectStack(
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>,
): ProjectStack {
  const packages = [...Object.keys(dependencies), ...Object.keys(devDependencies)]
    .filter((name, index, all) => all.indexOf(name) === index)
    .sort((left, right) => left.localeCompare(right));
  return {
    packages: packages.slice(0, PROJECT_STACK_LIMIT),
    truncated: packages.length > PROJECT_STACK_LIMIT,
  };
}
