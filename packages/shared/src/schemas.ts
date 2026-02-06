import { z } from "zod";

const ProjectSchema = z.object({
  name: z.string().min(1),
  repo: z.string().optional(),
  visibility: z.enum(["public", "private"]).optional()
});

const WorkspaceSchema = z.object({
  aiDir: z.string().min(1),
  keepTracked: z.array(z.string().min(1)).min(1)
});

const UISchema = z.object({
  shadcn: z.object({ components: z.array(z.string().min(1)).default([]) }).optional()
});

const StepSchema = z.object({
  id: z.string().min(1),
  requires: z.array(z.string().min(1)).optional(),
  claims: z.array(z.string().min(1)).optional(),
  decisions: z.array(z.string().min(1)).optional(),
  actions: z.array(z.any()),
  ensures: z.array(z.any())
});

const IntentSchema = z.object({
  summary: z.string().min(1),
  invariants: z.array(z.object({ id: z.string().min(1), text: z.string().min(1) })).optional(),
  nonGoals: z.array(z.object({ id: z.string().min(1), text: z.string().min(1) })).optional()
});

const DocsSchema = z.object({
  requiredFiles: z.array(z.string().min(1)).optional(),
  sections: z
    .array(
      z.object({
        file: z.string().min(1),
        heading: z.string().min(1),
        mustContain: z.array(z.string().min(1)).optional(),
        mustContainFuzzy: z
          .array(z.object({ text: z.string().min(1), threshold: z.number().min(0).max(1).optional(), gate: z.boolean().optional() }))
          .optional()
      })
    )
    .optional()
});

const EffectsSchema = z.object({
  writeScopes: z.array(z.string().min(1)).optional(),
  expansionPolicy: z.enum(["explicit", "inherit"]).optional()
});

const ArtifactsSchema = z.object({
  required: z
    .array(
      z.object({
        path: z.string().min(1),
        role: z.string().optional(),
        mustWrite: z.boolean().optional()
      })
    )
    .optional()
});

const AssumptionsSchema = z.array(
  z.object({
    id: z.string().min(1),
    text: z.string().min(1),
    status: z.enum(["verified", "unverified"])
  })
);

const DecisionsSchema = z.array(
  z.object({
    id: z.string().min(1),
    question: z.string().min(1),
    answer: z.string().min(1),
    rationale: z.string().min(1),
    status: z.enum(["provisional", "final"]),
    confidence: z.number().min(0).max(1),
    evidence: z.array(z.string().min(1)).optional()
  })
);

const V1Schema = z.object({
  lang: z.literal("webspec/v0.1").default("webspec/v0.1"),
  target: z.string().min(1),
  project: ProjectSchema,
  workspace: WorkspaceSchema.optional(),
  ui: UISchema.optional(),
  routes: z.array(z.object({ path: z.string().min(1), page: z.string().min(1) })).optional(),
  quality: z.object({ gates: z.array(z.string().min(1)).default([]) }).optional(),
  steps: z.array(StepSchema).optional()
});

const V2Schema = z.object({
  lang: z.literal("webspec/v0.2"),
  target: z.string().min(1),
  project: ProjectSchema,
  workspace: WorkspaceSchema.optional(),
  ui: UISchema.optional(),
  routes: z.array(z.object({ path: z.string().min(1), page: z.string().min(1) })).optional(),
  intent: IntentSchema.optional(),
  docs: DocsSchema.optional(),
  effects: EffectsSchema.optional(),
  artifacts: ArtifactsSchema.optional(),
  assumptions: AssumptionsSchema.optional(),
  decisions: DecisionsSchema.optional(),
  quality: z.object({ gates: z.array(z.string().min(1)).default([]) }).optional(),
  steps: z.array(StepSchema).optional()
});

export const WebSpecSchema = z.discriminatedUnion("lang", [V1Schema, V2Schema]);

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
