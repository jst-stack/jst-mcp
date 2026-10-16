import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/domain/contracts.js";
import {
  gateNameSchema,
  parseInput,
  parseSliceOptions,
  projectRootSchema,
  recipeInputSchema,
  recipeNameSchema,
  scaffoldInputSchema,
  sliceKindSchema,
  sliceNameSchema,
  sliceOptionsSchema,
} from "../src/domain/schemas.js";

describe("input validation", () => {
  it("accepts lowerCamelCase slice names and rejects the rest", () => {
    expect(sliceNameSchema.safeParse("accountSettings").success).toBe(true);
    for (const bad of ["", "Account", "1account", "account-settings", "account_settings", "a; rm -rf /", "a b"]) {
      expect(sliceNameSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("restricts slice kinds, recipes, and gates to their enums", () => {
    expect(sliceKindSchema.safeParse("entity").success).toBe(true);
    expect(sliceKindSchema.safeParse("bogus").success).toBe(false);
    expect(recipeNameSchema.safeParse("http-entity").success).toBe(true);
    expect(recipeNameSchema.safeParse("nope").success).toBe(false);
    expect(gateNameSchema.safeParse("release").success).toBe(true);
    expect(gateNameSchema.safeParse("prod").success).toBe(false);
  });

  it("rejects unknown option keys and invalid styles", () => {
    expect(parseSliceOptions({ stateful: true, style: "scss" })).toEqual({ stateful: true, style: "scss" });
    expect(() => parseSliceOptions({ bogus: true })).toThrow(ValidationError);
    expect(() => parseSliceOptions({ style: "less" })).toThrow(ValidationError);
    expect(sliceOptionsSchema.safeParse({ style: "sass" }).success).toBe(false);
  });

  it("rejects dangerous projectRoot values fail-fast", () => {
    expect(projectRootSchema.safeParse("").success).toBe(false);
    expect(projectRootSchema.safeParse("/tmp/proj\0/x").success).toBe(false);
    expect(projectRootSchema.safeParse("/tmp/proj").success).toBe(true);
  });

  it("requires projectRoot for recipes", () => {
    expect(recipeInputSchema.safeParse({ recipe: "http-entity" }).success).toBe(false);
    expect(recipeInputSchema.safeParse({ projectRoot: "/p", recipe: "http-entity" }).success).toBe(true);
  });

  it("parses full tool inputs and reports a joined ValidationError message", () => {
    expect(parseInput(scaffoldInputSchema, { projectRoot: "/p", kind: "widget", name: "signup" })).toEqual({
      projectRoot: "/p",
      kind: "widget",
      name: "signup",
      options: undefined,
    });
    expect(() => parseInput(scaffoldInputSchema, { projectRoot: "/p", kind: "widget", name: "Bad-Name" })).toThrow(
      /lowerCamelCase/u,
    );
  });
});
