/** Operational (non-policy) knowledge: gate-to-script mapping, selection metadata, and CLI-help parsing.
 * Architecture prose lives only in the project-local skills/frontend-architecture/SKILL.md. */

import { SLICE_KINDS } from "./contracts.js";
import type { GateName, RecipeName, TaskKind } from "./contracts.js";
import type { MarkdownSection } from "./markdown.js";

export const SKILL_RELATIVE_PATH = "skills/frontend-architecture/SKILL.md";

export const GENERATOR_COMMAND = "npm run create:slice -- <kind> <lowerCamelName> [options]";

const LOCAL_CHANGE = /\b(?:align|animation|button|card|colour|color|copy|css|element|font|gap|height|hover|layout|margin|padding|px|scss|size|spacing|style|text|transition|ui|width)\w*/iu;
const LOCAL_CHANGE_RU = /(?:анимац|высот|карточ|кнопк|отступ|размер|стил|текст|цвет|ширин|элемент)\p{L}*/iu;
const NEW_BOUNDARY = /\b(?:add|build|create|generate|implement|new|scaffold)\w*\b[\s\S]{0,50}\b(?:entity|feature|module|widget)\w*/iu;
const NEW_BOUNDARY_RU = /(?:добав|нов|реализ|созда)\p{L}*[\s\S]{0,50}(?:сущност|фич|модул|виджет)\p{L}*/iu;
const WORKFLOW_CHANGE = /\b(?:api|async|error|fetch|loading|mutation|optimistic|persist|repository|retry|rollback|state|storage)\w*/iu;
const WORKFLOW_CHANGE_RU = /(?:асинхрон|загрузк|запрос|мутац|ошибк|повтор|репозитор|состоян|сохран|хранилищ)\p{L}*/iu;
const DIRECT_CHANGE = /\b(?:config|documentation|docs|readme|rename|typo)\w*/iu;
const DIRECT_CHANGE_RU = /(?:документац|конфиг|опечатк|переимен)\p{L}*/iu;

export function classifyTask(brief: string): TaskKind {
  if (NEW_BOUNDARY.test(brief) || NEW_BOUNDARY_RU.test(brief)) return "new-boundary";
  if (WORKFLOW_CHANGE.test(brief) || WORKFLOW_CHANGE_RU.test(brief)) return "existing-workflow";
  if (DIRECT_CHANGE.test(brief) || DIRECT_CHANGE_RU.test(brief)) return "direct-change";
  if (LOCAL_CHANGE.test(brief) || LOCAL_CHANGE_RU.test(brief)) return "local-change";
  return "existing-workflow";
}

export function taskWorkflow(kind: TaskKind): { workflow: string[]; nextCommands: string[] } {
  if (kind === "direct-change") {
    return {
      workflow: [
        "Inspect the named file and only the directly affected references.",
        "Make the requested change without introducing product architecture.",
        "Run the narrowest relevant validation, then call jst_check with gate fast only if source behavior can change.",
      ],
      nextCommands: ["jst_check"],
    };
  }
  if (kind === "local-change") {
    return {
      workflow: [
        "Inspect the owning component and its colocated stylesheet only.",
        "Make the smallest local change; do not add a slice, DI, state, or an unrelated abstraction.",
        "Run the nearest focused test if behavior changed, then call jst_check with gate fast once.",
      ],
      nextCommands: ["jst_check"],
    };
  }
  if (kind === "new-boundary") {
    return {
      workflow: [
        "Inspect only the nearest complete slice or consumer needed for ownership and composition.",
        "Call jst_scaffold_slice before writing the new entity, feature, module, or widget.",
        "Implement the generated boundary, run its focused tests, then call jst_check with gate fast.",
      ],
      nextCommands: ["jst_scaffold_slice", "jst_check"],
    };
  }
  return {
    workflow: [
      "Inspect the existing owning slice, its public contract, and nearest consumer only.",
      "Preserve its responsibility boundaries; scaffold only if the change truly introduces a new boundary.",
      "Run focused tests for changed behavior, then call jst_check with gate fast once.",
    ],
    nextCommands: ["jst_check"],
  };
}

export interface GateDefinition {
  script: string;
  description: string;
  onPass: string;
  onFail: string;
}

export const GATE_DEFINITIONS: Record<GateName, GateDefinition> = {
  fix: {
    script: "lint:fix",
    description: "Mechanical ESLint and Stylelint repairs (imports, formatting, styles).",
    onPass: "Run focused tests, then lint:architecture before the next edit.",
    onFail: "Read the reported source and public rule docs; split files/functions instead of weakening config.",
  },
  fast: {
    script: "validate",
    description: "Fast gate: lint + typecheck + unit tests.",
    onPass: "Proceed to implementation or a fuller check.",
    onFail: "Repair the reported diagnostics; re-run only this gate until it passes.",
  },
  architecture: {
    script: "lint:architecture",
    description: "Layer-direction, effect-boundary, naming, and architecture-kernel checks.",
    onPass: "Proceed; a green check is necessary but not proof of correct ownership.",
    onFail: "Move the responsibility to the reported boundary; do not add inline disables.",
  },
  release: {
    script: "check:release",
    description: "Full delivery gate: check + production audit + end-to-end tests.",
    onPass: "Delivery is green; do not re-run a passing gate.",
    onFail: "Repair the first failing stage, then run check:release once more.",
  },
};

// Section selection metadata: keyword lists only, no architecture prose.
const SECTION_KEYWORDS: Record<string, string[]> = {
  "Model first": ["model", "entity", "domain", "dto", "type", "invariant", "mapping", "repository", "state", "stateful", "reatom", "store", "viewmodel", "use case", "модел", "сущност", "домен", "репозитор", "состоян"],
  "Ownership": ["page", "route", "feature", "module", "widget", "compose", "composition", "slice", "workflow", "страниц", "маршрут", "фич", "модул", "виджет", "срез"],
  "DI boundary": ["di", "http", "adapter", "service", "provider", "fetch", "storage", "inject", "clock", "analytics", "адаптер", "сервис", "хранилищ", "инъекц"],
  "Styling": ["style", "css", "scss", "sass", "component", "ui", "mantine", "classname", "стил", "компонент", "класс"],
  "Delivery check": ["test", "check", "lint", "delivery", "release", "e2e", "error", "loading", "optimistic", "mutation", "async", "playwright", "тест", "ошибк", "загрузк", "мутац", "асинхрон"],
};

const MAX_SECTIONS = 5;

function briefWords(brief: string): Set<string> {
  return new Set(brief.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
}

function matchesKeywords(words: Set<string>, keywords: string[]): boolean {
  return keywords.some((keyword) => [...words].some((word) =>
    word === keyword || word === `${keyword}s` || (keyword.length >= 4 && word.startsWith(keyword))));
}

/** Select the skill sections whose keywords match the brief, falling back to the core sections. */
export function selectSections(sections: MarkdownSection[], brief: string, taskKind = classifyTask(brief)): MarkdownSection[] {
  const words = briefWords(brief);
  const matched = sections.filter((section) => {
    const keywords = SECTION_KEYWORDS[section.name];
    return keywords !== undefined && matchesKeywords(words, keywords);
  });
  const defaults = taskKind === "local-change"
    ? ["Styling"]
    : taskKind === "direct-change"
      ? []
    : taskKind === "new-boundary"
      ? ["Model first", "Ownership", "DI boundary"]
      : ["Ownership"];
  const selected = sections.filter((section) => defaults.includes(section.name));
  return [...selected, ...matched.filter((section) => !defaults.includes(section.name))].slice(0, MAX_SECTIONS);
}

const RECIPE_KEYWORDS: Record<RecipeName, string[]> = {
  "http-entity": ["api", "dto", "endpoint", "fetch", "http", "jsonplaceholder", "remote", "repository", "запрос", "репозитор"],
  "persistence-entity": ["browser", "local", "persist", "persisted", "persistence", "storage", "браузер", "сохран", "хранилищ"],
  "stateful-feature": ["filter", "queue", "search", "state", "stateful", "workflow", "поиск", "состоян", "фильтр", "очеред"],
  "route-composition": ["page", "route", "ssr", "маршрут", "страниц"],
  "optimistic-mutation": ["mutation", "optimistic", "rollback", "мутац", "оптимист", "откат"],
};

export function selectRecipeNames(brief: string): RecipeName[] {
  const words = briefWords(brief);
  return (Object.entries(RECIPE_KEYWORDS) as [RecipeName, string[]][])
    .filter(([, keywords]) => matchesKeywords(words, keywords))
    .map(([name]) => name);
}

const FLAG_RE = /--[a-z][a-z-]*/gu;
const EXCLUDED_FLAGS = new Set(["--help", "--version"]);

/** Derive generator capabilities from the version-local `create:slice -- --help` output. */
export function parseGeneratorHelp(help: string): { kinds: string[]; options: string[] } {
  const options = [...new Set((help.match(FLAG_RE) ?? []).filter((flag) => !EXCLUDED_FLAGS.has(flag)))];
  const kinds = SLICE_KINDS.filter((kind) => new RegExp(`\\b${kind}\\b`, "u").test(help));
  return { kinds: kinds.length > 0 ? kinds : [...SLICE_KINDS], options };
}
