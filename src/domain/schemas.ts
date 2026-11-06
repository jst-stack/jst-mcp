import { z } from "zod";
import { GATE_NAMES, RECIPE_NAMES, SLICE_KINDS, STYLE_VALUES, ValidationError } from "./contracts.js";
import type { SliceOptions } from "./contracts.js";

const NAME_PATTERN = /^[a-z][A-Za-z0-9]*$/u;

export const sliceNameSchema = z
  .string()
  .min(1, "name is required")
  .max(64, "name is too long")
  .regex(NAME_PATTERN, "name must be lowerCamelCase, e.g. accountSettings");

export const sliceKindSchema = z.enum(SLICE_KINDS);
export const recipeNameSchema = z.enum(RECIPE_NAMES);
export const gateNameSchema = z.enum(GATE_NAMES);
export const styleSchema = z.enum(STYLE_VALUES);

export const projectRootSchema = z
  .string()
  .min(1, "projectRoot is required")
  .max(4096, "projectRoot is too long")
  .refine((value) => !value.includes("\0"), "projectRoot must not contain null bytes");

export const briefSchema = z.string().min(1, "brief is required").max(4000, "brief is too long");

export const sectionNameSchema = z
  .string()
  .min(1, "section is required")
  .max(200, "section is too long");

export const sliceOptionsSchema = z
  .object({
    stateful: z.boolean().optional(),
    repository: z.boolean().optional(),
    service: z.boolean().optional(),
    persistence: z.boolean().optional(),
    ui: z.boolean().optional(),
    tests: z.boolean().optional(),
    msw: z.boolean().optional(),
    public: z.boolean().optional(),
    noInstall: z.boolean().optional(),
    style: styleSchema.optional(),
  })
  .strict();

export const startTaskInputSchema = z.object({ projectRoot: projectRootSchema, brief: briefSchema }).strict();
export const scaffoldInputSchema = z
  .object({
    projectRoot: projectRootSchema,
    kind: sliceKindSchema,
    name: sliceNameSchema,
    options: sliceOptionsSchema.optional(),
    dryRun: z.boolean().optional(),
  })
  .strict()
  .superRefine(({ kind, options }, context) => {
    if (!options) {
      return;
    }
    const entityOnly = ["repository", "service", "persistence", "msw"] as const;
    if (kind !== "entity") {
      for (const option of entityOnly) {
        if (options[option]) {
          context.addIssue({
            code: "custom",
            message: `${option} is available only for entity slices`,
            path: ["options", option],
          });
        }
      }
    }
    if (kind === "widget" && options.stateful) {
      context.addIssue({
        code: "custom",
        message: "stateful is available only for entity, feature, and module slices",
        path: ["options", "stateful"],
      });
    }
    if (options.msw && !options.repository) {
      context.addIssue({
        code: "custom",
        message: "msw requires repository",
        path: ["options", "msw"],
      });
    }
  });
export const recipeInputSchema = z.object({ projectRoot: projectRootSchema, recipe: recipeNameSchema }).strict();
export const sectionInputSchema = z
  .object({ projectRoot: projectRootSchema, section: sectionNameSchema })
  .strict();
export const checkInputSchema = z.object({ projectRoot: projectRootSchema, gate: gateNameSchema }).strict();

export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
      .join("; ");
    throw new ValidationError(message);
  }
  return result.data;
}

export function parseSliceOptions(value: unknown): SliceOptions {
  return parseInput(sliceOptionsSchema, value ?? {});
}
