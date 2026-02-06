import { z } from "zod";

export const WebSpecSchema = z.object({
  lang: z.literal("webspec/v0.1").default("webspec/v0.1"),
  target: z.string().min(1),
  project: z.object({
    name: z.string().min(1),
    repo: z.string().optional(),
    visibility: z.enum(["public", "private"]).optional()
  }),
  workspace: z
    .object({
      aiDir: z.string().min(1),
      keepTracked: z.array(z.string().min(1)).min(1)
    })
    .optional(),
  ui: z
    .object({
      shadcn: z.object({ components: z.array(z.string().min(1)).default([]) }).optional()
    })
    .optional(),
  routes: z.array(z.object({ path: z.string().min(1), page: z.string().min(1) })).optional(),
  quality: z.object({ gates: z.array(z.string().min(1)).default([]) }).optional(),
  steps: z
    .array(
      z.object({
        id: z.string().min(1),
        requires: z.array(z.string().min(1)).optional(),
        actions: z.array(z.any()),
        ensures: z.array(z.any())
      })
    )
    .optional()
});

export const StackMacroDefSchema = z.object({
  args: z.record(z.enum(["path", "string", "string[]", "json"])),
  expandsTo: z.array(
    z.union([
      z.object({ kind: z.literal("run"), cmd: z.string().min(1), cwd: z.string().optional() }),
      z.object({ kind: z.literal("writeFile"), path: z.string().min(1), content: z.string() }),
      z.object({ kind: z.literal("appendFile"), path: z.string().min(1), content: z.string() }),
      z.object({
        kind: z.literal("writeTemplate"),
        path: z.string().min(1),
        template: z.string().min(1),
        vars: z.record(z.string()).optional()
      })
    ])
  )
});

export const StackManifestSchema = z.object({
  id: z.string().min(1),
  presetVersion: z.number().int().positive(),
  displayName: z.string().optional(),
  detect: z
    .object({
      mustExist: z.array(z.string()).optional(),
      mustNotExist: z.array(z.string()).optional()
    })
    .optional(),
  effectsPolicy: z.object({
    allowedWriteGlobs: z.array(z.string().min(1)).min(1),
    deniedWriteGlobs: z.array(z.string().min(1)).optional()
  }),
  commands: z.object({
    allowPrefixes: z.array(z.string().min(1)).min(1),
    denySubstrings: z.array(z.string().min(1)).optional()
  }),
  semantics: z.any().optional(),
  macros: z.record(StackMacroDefSchema).optional()
});

export const PlanSchema = z.object({
  lang: z.literal("webspec/plan-v0.1"),
  target: z.string().min(1),
  presetVersion: z.number().int().positive(),
  specHash: z.string().min(1),
  steps: z.array(
    z.object({
      id: z.string().min(1),
      requires: z.array(z.string()).default([]),
      ops: z.array(z.any()),
      checks: z.array(z.any())
    })
  )
});
