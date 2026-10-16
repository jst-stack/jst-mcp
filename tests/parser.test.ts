import { describe, expect, it } from "vitest";
import { boundText, parseNumberedList, parseSections } from "../src/domain/markdown.js";
import { classifyTask, parseGeneratorHelp, selectRecipeNames, selectSections } from "../src/domain/operational.js";

const SKILL_MD = `---
name: frontend-architecture
---

# Frontend architecture

## Efficient agent loop

1. Run \`npm run create:slice -- --help\` first.
2. Inspect the nearest complete slice, then implement.

## Model first

Identify domain state and invariants before JSX.

## Ownership

pages compose; entities own domain types.

## DI boundary

Inject effectful boundaries through narrow ports.

## Styling

Colocate component styles.

## Delivery check

Run focused tests before release.

## Recipes

### http-entity

**Intent:** A typed HTTP boundary.

### stateful-feature

**Intent:** A Reatom store view model.
`;

describe("parseSections", () => {
  it("extracts exact named sections and keeps deeper headings in the body", () => {
    const sections = parseSections(SKILL_MD, 2);
    const names = sections.map((section) => section.name);
    expect(names).toEqual([
      "Efficient agent loop",
      "Model first",
      "Ownership",
      "DI boundary",
      "Styling",
      "Delivery check",
      "Recipes",
    ]);
    expect(sections[0]!.body).toContain("Run `npm run create:slice -- --help` first.");
  });

  it("parses nested recipe sub-sections at level 3", () => {
    const recipes = parseSections(SKILL_MD, 2).find((section) => section.name === "Recipes");
    const sub = parseSections(recipes!.body, 3);
    expect(sub.map((section) => section.name)).toEqual(["http-entity", "stateful-feature"]);
    expect(sub[0]!.body).toContain("**Intent:** A typed HTTP boundary.");
  });
});

describe("parseNumberedList", () => {
  it("extracts ordered-list items", () => {
    const items = parseNumberedList("1. first\n2. second\n");
    expect(items).toEqual(["first", "second"]);
  });

  it("falls back to non-empty lines when no list exists", () => {
    expect(parseNumberedList("a\n\nb")).toEqual(["a", "b"]);
  });
});

describe("boundText", () => {
  it("bounds to the first max chars and marks truncation", () => {
    const bounded = boundText("abcdef", 4);
    expect(bounded.truncated).toBe(true);
    expect(bounded.text).toContain("abcd");
  });

  it("leaves short text untouched", () => {
    expect(boundText("abc", 4)).toEqual({ text: "abc", truncated: false });
  });
});

describe("selectSections", () => {
  const sections = parseSections(SKILL_MD, 2);

  it("selects sections whose keywords match the brief", () => {
    const selected = selectSections(sections, "add an optimistic mutation to the checkout feature");
    expect(selected.some((section) => section.name === "Ownership")).toBe(true);
  });

  it("returns only styling guidance for a local visual edit", () => {
    const selected = selectSections(sections, "polish the footer spacing");
    expect(selected.map((section) => section.name)).toEqual(["Styling"]);
  });
});

describe("classifyTask", () => {
  it.each([
    ["make the card 100 px wider", "local-change"],
    ["сделай карточку на 100 px больше", "local-change"],
    ["fix checkout retry handling", "existing-workflow"],
    ["fix the card loading state", "existing-workflow"],
    ["исправь состояние загрузки карточки", "existing-workflow"],
    ["create a new checkout feature", "new-boundary"],
    ["добавь новую фичу корзины", "new-boundary"],
    ["update README setup section", "direct-change"],
    ["исправь опечатку в документации", "direct-change"],
  ] as const)("routes %s as %s", (brief, expected) => {
    expect(classifyTask(brief)).toBe(expected);
  });
});

describe("parseGeneratorHelp", () => {
  const HELP = `Usage: create:slice <entity|feature|module|widget> <name> [options]

Options:
  --stateful    use a Reatom store
  --repository  add a repository port
  --style <css|scss>
  --help        show help
`;

  it("derives kinds and options from --help output", () => {
    const parsed = parseGeneratorHelp(HELP);
    expect(parsed.kinds).toEqual(["entity", "feature", "module", "widget"]);
    expect(parsed.options).toEqual(["--stateful", "--repository", "--style"]);
  });

  it("falls back to slice kinds and empty options on empty output", () => {
    const parsed = parseGeneratorHelp("");
    expect(parsed.kinds).toEqual(["entity", "feature", "module", "widget"]);
    expect(parsed.options).toEqual([]);
  });
});

describe("selectRecipeNames", () => {
  it("selects only recipes implied by the brief", () => {
    expect(selectRecipeNames("SSR page with HTTP data and optimistic local queue rollback")).toEqual([
      "http-entity",
      "persistence-entity",
      "stateful-feature",
      "route-composition",
      "optimistic-mutation",
    ]);
  });

  it("keeps an existing workflow focused on ownership and matched checks", () => {
    const sections = parseSections(SKILL_MD, 2);
    const selected = selectSections(sections, "build a queue with tests");
    expect(selected.map((section) => section.name)).toEqual(["Ownership", "Delivery check"]);
  });

  it("recognizes remote APIs named by provider", () => {
    expect(selectRecipeNames("Load JSONPlaceholder posts")).toContain("http-entity");
  });

  it("recognizes persisted browser state", () => {
    expect(selectRecipeNames("Queue membership survives reload through persisted browser state")).toContain(
      "persistence-entity",
    );
  });

  it("recognizes Russian workflow terms", () => {
    expect(selectRecipeNames("Сохраняй очередь в браузерном хранилище")).toEqual(
      expect.arrayContaining(["persistence-entity", "stateful-feature"]),
    );
  });
});
