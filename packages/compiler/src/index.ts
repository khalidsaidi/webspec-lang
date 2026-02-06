import YAML from "yaml";
import picomatch from "picomatch";
import { sha256Hex, WebSpecSchema, StackManifestSchema } from "@webspec/shared";

export type CompileInput = {
  sourceText: string;
  registry: Record<string, any>; // stack manifests keyed by id
};

export type CompileOutput = {
  ok: boolean;
  diagnostics: Array<{ code: string; severity: "error" | "warn" | "info"; message: string; path?: string; hint?: string }>;
  plan?: any;
};

function diag(
  code: string,
  message: string,
  hint?: string,
  path?: string,
  severity: "error" | "warn" | "info" = "error"
) {
  return { code, severity, message, hint, path };
}

function render(str: string, vars: Record<string, unknown>): string {
  return str
    .replace(/\$\{([A-Za-z0-9_]+)\.\.\.\}/g, (_, k) => {
      const v = vars[k];
      if (Array.isArray(v)) return v.join(" ");
      return String(v ?? "");
    })
    .replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, k) => String(vars[k] ?? ""));
}

function ensureStepHasProofs(step: any, out: any[]) {
  const touches = step.ops?.length ? true : false;
  if (touches && (!step.checks || step.checks.length === 0)) {
    out.push(
      diag(
        "E400_STEP_NO_ENSURES",
        `Step "${step.id}" has actions but no ensures/checks.`,
        "Add at least one ensure (file.exists, file.contains, cmd.ok, route.exists, git.trackedOnly, doc.*)."
      )
    );
  }
}

function ensureStepHasClaims(step: any, out: any[]) {
  const touches = step.ops?.length ? true : false;
  if (touches && (!step.claims || step.claims.length === 0)) {
    out.push(
      diag(
        "E420_STEP_NO_CLAIMS",
        `Step "${step.id}" has actions but no claims.`,
        "Add claims referencing intent.invariants to keep the plan on track."
      )
    );
  }
}

function inferAllowedWrite(manifest: any) {
  const allowed = manifest.effectsPolicy?.allowedWriteGlobs ?? [];
  const denied = manifest.effectsPolicy?.deniedWriteGlobs ?? [];
  return { allowed, denied };
}

function effectCheckPath(pathStr: string, allowedStack: string[], allowedSpec: string[] | undefined, denied: string[], out: any[]) {
  const isDenied = denied.some((g) => picomatch.isMatch(pathStr, g));
  if (isDenied) {
    out.push(diag("E301_DENIED_PATH", `Write denied for path: ${pathStr}`, "Do not write .env files or denied globs."));
    return false;
  }
  const okStack = allowedStack.some((g) => picomatch.isMatch(pathStr, g));
  if (!okStack) {
    out.push(
      diag(
        "E300_WRITE_OUTSIDE",
        `Write outside allowed globs: ${pathStr}`,
        `Allowed globs: ${allowedStack.join(", ")}`
      )
    );
    return false;
  }
  if (allowedSpec) {
    const okSpec = allowedSpec.some((g) => picomatch.isMatch(pathStr, g));
    if (!okSpec) {
      out.push(
        diag(
          "E302_SCOPE_VIOLATION",
          `Write outside spec.writeScopes: ${pathStr}`,
          `Spec writeScopes: ${allowedSpec.join(", ")}`
        )
      );
      return false;
    }
  }
  return true;
}

function effectCheckCmd(cmd: string, allowPrefixes: string[], denySubs: string[], out: any[]) {
  const prefix = cmd.trim().split(/\s+/)[0] ?? "";
  if (!allowPrefixes.includes(prefix)) {
    out.push(
      diag("E310_CMD_NOT_ALLOWED", `Command prefix not allowed: ${prefix}`, `Allowed: ${allowPrefixes.join(", ")}`)
    );
    return false;
  }
  for (const bad of denySubs) {
    if (cmd.includes(bad)) {
      out.push(diag("E311_CMD_DENIED_SUBSTRING", `Command contains denied substring: "${bad}"`, "Edit the plan."));
      return false;
    }
  }
  return true;
}

function mapEnsureToCheck(ensure: any, diagnostics: any[]) {
  if (ensure.exists) return { kind: "file.exists", path: ensure.exists };
  if (ensure.contains) return { kind: "file.contains", path: ensure.contains.path, text: ensure.contains.text };
  if (ensure.routeExists) return { kind: "route.exists", route: ensure.routeExists };
  if (ensure.cmdOk) return { kind: "cmd.ok", cmd: ensure.cmdOk };
  if (ensure.trackedOnly)
    return { kind: "git.trackedOnly", glob: ensure.trackedOnly.glob, allow: ensure.trackedOnly.allow };
  if (ensure.docSection) return { kind: "doc.section", path: ensure.docSection.path, heading: ensure.docSection.heading };
  if (ensure.docContains) return { kind: "doc.contains", path: ensure.docContains.path, text: ensure.docContains.text };
  if (ensure.docContainsFuzzy)
    return {
      kind: "doc.contains_fuzzy",
      path: ensure.docContainsFuzzy.path,
      text: ensure.docContainsFuzzy.text,
      threshold: ensure.docContainsFuzzy.threshold ?? 0.8,
      gate: ensure.docContainsFuzzy.gate
    };
  if (ensure.artifactExists) return { kind: "artifact.exists", path: ensure.artifactExists.path };

  diagnostics.push(diag("E210_UNKNOWN_ENSURE", "Unknown ensure/check type.", "Use a supported ensure type."));
  return null;
}

function normalizeMacroVars(args: Record<string, unknown>, macroDef: any, diagnostics: any[]) {
  const vars: Record<string, unknown> = { ...args };
  if (!macroDef?.args) return vars;
  for (const [key, typ] of Object.entries(macroDef.args)) {
    if (!(key in args)) {
      diagnostics.push(diag("E201_MISSING_MACRO_ARG", `Missing macro arg: ${key}`, `Provide "${key}" in macro args.`));
      vars[key] = "";
      continue;
    }
    if (typ === "json") vars[key] = JSON.stringify(args[key]);
  }
  return vars;
}

function expandMacro(name: string, args: Record<string, unknown>, manifest: any, diagnostics: any[]) {
  const macro = manifest.macros?.[name];
  if (!macro) {
    diagnostics.push(diag("E200_UNKNOWN_MACRO", `Unknown macro: ${name}`, "Define it in the stack manifest."));
    return [];
  }
  const vars = normalizeMacroVars(args, macro, diagnostics);
  return macro.expandsTo
    .map((a: any) => {
      if (a.kind === "run") return { kind: "RUN", cmd: render(a.cmd, vars), cwd: a.cwd ? render(a.cwd, vars) : undefined };
      if (a.kind === "writeFile") return { kind: "WRITE_FILE", path: render(a.path, vars), content: render(a.content, vars) };
      if (a.kind === "appendFile") return { kind: "APPEND_FILE", path: render(a.path, vars), content: render(a.content, vars) };
      if (a.kind === "writeTemplate") {
        const renderedVars = a.vars
          ? Object.fromEntries(
              Object.entries(a.vars as Record<string, unknown>).map(([k, v]) => [k, render(String(v), vars)])
            )
          : undefined;
        return { kind: "WRITE_TEMPLATE", path: render(a.path, vars), template: a.template, vars: renderedVars };
      }
      return null;
    })
    .filter(Boolean);
}

function mapActionToOps(action: any, manifest: any, diagnostics: any[]) {
  if (action.run) return [{ kind: "RUN", cmd: action.run }];
  if (action.writeFile) {
    const wf = action.writeFile;
    if (wf.template) {
      return [{ kind: "WRITE_TEMPLATE", path: wf.path, template: wf.template, vars: wf.vars ?? {} }];
    }
    if (typeof wf.content !== "string") {
      diagnostics.push(diag("E220_WRITEFILE_NO_CONTENT", `writeFile missing content for path: ${wf.path}`, "Provide content."));
      return [];
    }
    return [{ kind: "WRITE_FILE", path: wf.path, content: wf.content }];
  }
  if (action.appendFile) return [{ kind: "APPEND_FILE", path: action.appendFile.path, content: action.appendFile.content }];
  if (action.writeTemplate)
    return [
      {
        kind: "WRITE_TEMPLATE",
        path: action.writeTemplate.path,
        template: action.writeTemplate.template,
        vars: action.writeTemplate.vars ?? {}
      }
    ];
  if (action.macro) return expandMacro(action.macro.name, action.macro.args ?? {}, manifest, diagnostics);

  diagnostics.push(diag("E211_UNKNOWN_ACTION", "Unknown action type.", "Use run/writeFile/appendFile/writeTemplate/macro."));
  return [];
}

function buildStepsFromSpec(spec: any, manifest: any, diagnostics: any[]) {
  const steps: any[] = [];
  for (const step of spec.steps ?? []) {
    const ops: any[] = [];
    for (const action of step.actions ?? []) {
      ops.push(...mapActionToOps(action, manifest, diagnostics));
    }
    const checks = (step.ensures ?? [])
      .map((e: any) => mapEnsureToCheck(e, diagnostics))
      .filter(Boolean);

    steps.push({
      id: step.id,
      requires: step.requires ?? [],
      ops,
      checks,
      claims: step.claims ?? [],
      decisions: step.decisions ?? []
    });
  }
  return steps;
}

function validateAssumptionsAndDecisions(spec: any, diagnostics: any[]) {
  const decisions = spec.decisions ?? [];
  const decisionMap = new Map<string, any>();
  for (const d of decisions) {
    if (decisionMap.has(d.id)) {
      diagnostics.push(diag("E413_DECISION_DUPLICATE", `Duplicate decision id: ${d.id}`, "Decision ids must be unique."));
    }
    decisionMap.set(d.id, d);
  }

  for (const a of spec.assumptions ?? []) {
    if (a.status !== "verified") {
      diagnostics.push(
        diag(
          "E410_UNVERIFIED_ASSUMPTION",
          `Assumption "${a.id}" is not verified: ${a.text}`,
          "Verify assumptions before compile."
        )
      );
    }
    const d = decisionMap.get(a.id);
    if (!d) {
      diagnostics.push(
        diag(
          "E411_ASSUMPTION_NO_DECISION",
          `Assumption "${a.id}" has no matching decision record.`,
          "Add a decision with the same id in decisions[]."
        )
      );
    } else if (d.status !== "final") {
      diagnostics.push(
        diag(
          "E412_ASSUMPTION_DECISION_NOT_FINAL",
          `Decision "${d.id}" for assumption is not final.`,
          "Mark decision status as final."
        )
      );
    }
  }

  return decisionMap;
}

function validateClaims(spec: any, steps: any[], userStepIds: Set<string>, diagnostics: any[]) {
  const invariants = spec.intent?.invariants ?? [];
  const invariantIds = new Set<string>(invariants.map((i: any) => String(i.id)));

  const userSteps = steps.filter((s) => userStepIds.has(s.id));
  const anyUserOps = userSteps.some((s) => (s.ops ?? []).length > 0);

  if (spec.lang === "webspec/v0.2" && anyUserOps && invariantIds.size === 0) {
    diagnostics.push(
      diag(
        "E424_MISSING_INVARIANTS",
        "v0.2 specs with actions must declare intent.invariants.",
        "Add intent.invariants and reference them from step claims."
      )
    );
    return;
  }

  const claimed = new Set<string>();
  for (const step of userSteps) {
    ensureStepHasClaims(step, diagnostics);
    for (const c of step.claims ?? []) {
      if (!invariantIds.has(c)) {
        diagnostics.push(
          diag(
            "E421_UNKNOWN_CLAIM",
            `Step "${step.id}" claims unknown invariant: ${c}`,
            "Claims must reference intent.invariants ids."
          )
        );
      } else {
        claimed.add(c);
      }
    }
  }

  for (const inv of invariantIds) {
    if (!claimed.has(inv)) {
      diagnostics.push(
        diag(
          "E422_UNCLAIMED_INVARIANT",
          `Invariant "${inv}" is not claimed by any step.`,
          "Add claims to steps to cover all invariants."
        )
      );
    }
  }
}

function validateStepDecisions(steps: any[], userStepIds: Set<string>, decisionMap: Map<string, any>, diagnostics: any[]) {
  for (const step of steps) {
    if (!userStepIds.has(step.id)) continue;
    for (const d of step.decisions ?? []) {
      const decision = decisionMap.get(d);
      if (!decision) {
        diagnostics.push(
          diag(
            "E425_STEP_DECISION_MISSING",
            `Step "${step.id}" references missing decision: ${d}`,
            "Add the decision to decisions[]."
          )
        );
      } else if (decision.status !== "final") {
        diagnostics.push(
          diag(
            "E426_STEP_DECISION_NOT_FINAL",
            `Step "${step.id}" references a non-final decision: ${d}`,
            "Finalize the decision before compiling."
          )
        );
      }
    }
  }
}

function appendDocsAndArtifactsChecks(spec: any, steps: any[]) {
  const checks: any[] = [];

  const docs = spec.docs ?? {};
  for (const f of docs.requiredFiles ?? []) {
    checks.push({ kind: "file.exists", path: f });
  }
  for (const section of docs.sections ?? []) {
    checks.push({ kind: "doc.section", path: section.file, heading: section.heading });
    for (const text of section.mustContain ?? []) {
      checks.push({ kind: "doc.contains", path: section.file, text });
    }
    for (const fuzzy of section.mustContainFuzzy ?? []) {
      checks.push({
        kind: "doc.contains_fuzzy",
        path: section.file,
        text: fuzzy.text,
        threshold: fuzzy.threshold ?? 0.8,
        gate: fuzzy.gate
      });
    }
  }

  for (const a of spec.artifacts?.required ?? []) {
    checks.push({ kind: "artifact.exists", path: a.path });
  }

  if (checks.length === 0) return;

  const lastId = steps[steps.length - 1]?.id;
  steps.push({
    id: "verify_docs_artifacts",
    requires: lastId ? [lastId] : [],
    ops: [],
    checks
  });
}

function validateArtifactsWritten(spec: any, steps: any[], diagnostics: any[]) {
  const required = spec.artifacts?.required ?? [];
  const mustWrite = required.filter((r: any) => r.mustWrite);
  if (mustWrite.length === 0) return;

  const written = new Set<string>();
  for (const s of steps) {
    for (const op of s.ops ?? []) {
      if (op.kind === "WRITE_FILE" || op.kind === "APPEND_FILE" || op.kind === "WRITE_TEMPLATE") {
        written.add(op.path);
      }
    }
  }

  for (const a of mustWrite) {
    if (!written.has(a.path)) {
      diagnostics.push(
        diag(
          "E460_ARTIFACT_NOT_WRITTEN",
          `Required artifact not written by plan: ${a.path}`,
          "Add an action that writes this artifact or remove mustWrite."
        )
      );
    }
  }
}

/**
 * Compile a YAML WebSpec into a deterministic Plan IR.
 * Guardrails focus on LOGIC drift: unknown target/macros, missing proofs, illegal effects, orphan actions.
 */
export function compileWebSpec(input: CompileInput): CompileOutput {
  const diagnostics: any[] = [];
  let spec: any;

  try {
    const parsed = YAML.parse(input.sourceText);
    spec = WebSpecSchema.parse(parsed);
  } catch (e: any) {
    return {
      ok: false,
      diagnostics: [diag("E001_PARSE", `Spec parse/validate failed: ${e?.message ?? String(e)}`)]
    };
  }

  // Load and validate stack manifest
  const manifestRaw = input.registry[spec.target];
  if (!manifestRaw) {
    return {
      ok: false,
      diagnostics: [diag("E100_UNKNOWN_TARGET", `Unknown target: ${spec.target}`, "Choose a supported target from the registry.")]
    };
  }
  let manifest: any;
  try {
    manifest = StackManifestSchema.parse(manifestRaw);
  } catch (e: any) {
    return { ok: false, diagnostics: [diag("E101_BAD_MANIFEST", `Invalid stack manifest: ${e?.message ?? e}`)] };
  }

  const { allowed: allowedStack, denied } = inferAllowedWrite(manifest);
  const allowPrefixes = manifest.commands?.allowPrefixes ?? ["pnpm", "git", "node"];
  const denySubs = manifest.commands?.denySubstrings ?? [];

  const specAllowed = spec.effects?.writeScopes;
  if (spec.effects?.expansionPolicy === "explicit" && (!specAllowed || specAllowed.length === 0)) {
    diagnostics.push(
      diag(
        "E320_EFFECTS_SCOPE_REQUIRED",
        "effects.expansionPolicy is explicit but no writeScopes provided.",
        "Provide effects.writeScopes or change expansionPolicy."
      )
    );
  }

  const decisionMap = validateAssumptionsAndDecisions(spec, diagnostics);

  // Build steps
  const steps: any[] = [];
  const aiDir = spec.workspace?.aiDir ?? ".ai";
  const keep = spec.workspace?.keepTracked ?? [`${aiDir}/README.md`, `${aiDir}/.gitkeep`];

  const hasCustomSteps = spec.steps && spec.steps.length > 0;

  if (hasCustomSteps) {
    steps.push(...buildStepsFromSpec(spec, manifest, diagnostics));
  } else if (spec.lang === "webspec/v0.2") {
    diagnostics.push(
      diag(
        "E902_STEPS_REQUIRED",
        "v0.2 specs require explicit steps.",
        "Add steps with actions/ensures/claims to keep the agent on track."
      )
    );
  } else {
    // v0.1 synthesized program
    steps.push({
      id: "init_ai",
      requires: [],
      ops: [
        { kind: "WRITE_FILE", path: `${aiDir}/README.md`, content: "# .ai\\nAgent workspace.\\n" },
        { kind: "WRITE_FILE", path: `${aiDir}/.gitkeep`, content: "" },
        {
          kind: "APPEND_FILE",
          path: ".gitignore",
          content: `${aiDir}/*\\n!${aiDir}/README.md\\n!${aiDir}/.gitkeep\\n`
        }
      ],
      checks: [
        { kind: "file.exists", path: `${aiDir}/README.md` },
        { kind: "git.trackedOnly", glob: `${aiDir}/**`, allow: keep }
      ]
    });

    const scaffoldMacro = manifest.macros?.["stack.scaffold"];
    if (!scaffoldMacro) {
      diagnostics.push(
        diag("E102_MISSING_MACRO", `Target "${manifest.id}" missing macro "stack.scaffold"`, "Add it to stacks/*/manifest.json.")
      );
    } else {
      const vars = { app: "apps/web" };
      const expanded = scaffoldMacro.expandsTo
        .map((a: any) => {
          if (a.kind === "run") return { kind: "RUN", cmd: render(a.cmd, vars), cwd: a.cwd ? render(a.cwd, vars) : undefined };
          if (a.kind === "writeFile") return { kind: "WRITE_FILE", path: render(a.path, vars), content: render(a.content, vars) };
          if (a.kind === "appendFile") return { kind: "APPEND_FILE", path: render(a.path, vars), content: render(a.content, vars) };
          if (a.kind === "writeTemplate")
            return { kind: "WRITE_TEMPLATE", path: render(a.path, vars), template: a.template, vars: a.vars ?? {} };
          return null;
        })
        .filter(Boolean);

      steps.push({
        id: "scaffold_web",
        requires: ["init_ai"],
        ops: expanded,
        checks: [{ kind: "file.exists", path: "apps/web/package.json" }]
      });
    }

    const uiComps = spec.ui?.shadcn?.components ?? [];
    const tw = manifest.macros?.["stack.tailwind_v4_vite"];
    const init = manifest.macros?.["stack.shadcn_init"];
    const add = manifest.macros?.["stack.shadcn_add"];
    const vars = { app: "apps/web", components: uiComps };

    const ops: any[] = [];
    if (tw)
      ops.push(
        ...tw.expandsTo
          .map((a: any) =>
            a.kind === "run"
              ? { kind: "RUN", cmd: render(a.cmd, vars) }
              : a.kind === "writeFile"
                ? { kind: "WRITE_FILE", path: render(a.path, vars), content: a.content }
                : null
          )
          .filter(Boolean)
      );
    if (init) ops.push(...init.expandsTo.map((a: any) => ({ kind: "RUN", cmd: render(a.cmd, vars) })));
    if (add && uiComps.length) ops.push(...add.expandsTo.map((a: any) => ({ kind: "RUN", cmd: render(a.cmd, vars) })));

    if (ops.length) {
      steps.push({
        id: "setup_ui",
        requires: ["scaffold_web"],
        ops,
        checks: [{ kind: "cmd.ok", cmd: "pnpm -C apps/web --version" }]
      });
    }

    if (spec.routes && spec.routes.length) {
      const setRoutes = manifest.macros?.["stack.set_routes"];
      if (setRoutes) {
        const v = { app: "apps/web", routes: JSON.stringify(spec.routes) };
        const expanded = setRoutes.expandsTo
          .map((a: any) => {
            if (a.kind === "writeTemplate") {
              return {
                kind: "WRITE_TEMPLATE",
                path: render(a.path, { app: v.app }),
                template: a.template,
                vars: { ROUTES_JSON: v.routes }
              };
            }
            if (a.kind === "run") return { kind: "RUN", cmd: render(a.cmd, v) };
            return null;
          })
          .filter(Boolean);

        steps.push({
          id: "set_routes",
          requires: ops.length ? ["setup_ui"] : ["scaffold_web"],
          ops: expanded,
          checks: spec.routes.map((r: { path: string }) => ({ kind: "route.exists", route: r.path }))
        });
      } else if (manifest.macros?.["stack.add_route"]) {
        const addRoute = manifest.macros["stack.add_route"];
        const addOps: any[] = [];
        for (const r of spec.routes) {
          const dir = r.path === "/" ? "" : r.path;
          for (const a of addRoute.expandsTo) {
            if (a.kind === "writeTemplate") {
              addOps.push({
                kind: "WRITE_TEMPLATE",
                path: render(a.path, { app: "apps/web", ROUTE_DIR: dir }),
                template: a.template,
                vars: { PAGE: r.page }
              });
            }
          }
        }
        steps.push({
          id: "add_routes",
          requires: ops.length ? ["setup_ui"] : ["scaffold_web"],
          ops: addOps,
          checks: spec.routes.map((r: { path: string }) => ({ kind: "route.exists", route: r.path }))
        });
      } else {
        diagnostics.push(
          diag(
            "E102_MISSING_MACRO",
            `Target "${manifest.id}" has no routing macro (stack.set_routes or stack.add_route).`,
            "Add a routing macro to the stack manifest."
          )
        );
      }
    }

    const gates = spec.quality?.gates ?? [];
    if (gates.length) {
      steps.push({
        id: "quality_gate",
        requires: [steps[steps.length - 1]?.id ?? "scaffold_web"],
        ops: gates.map((c: string) => ({ kind: "RUN", cmd: c })),
        checks: gates.map((c: string) => ({ kind: "cmd.ok", cmd: c }))
      });
    }
  }

  if (hasCustomSteps) {
    const userStepIds = new Set<string>((spec.steps ?? []).map((s: any) => String(s.id)));
    validateClaims(spec, steps, userStepIds, diagnostics);
    validateStepDecisions(steps, userStepIds, decisionMap, diagnostics);
  }

  appendDocsAndArtifactsChecks(spec, steps);
  validateArtifactsWritten(spec, steps, diagnostics);

  // Static effect checks + proof obligations
  for (const s of steps) {
    for (const op of s.ops ?? []) {
      if (op.kind === "WRITE_FILE" || op.kind === "APPEND_FILE" || op.kind === "WRITE_TEMPLATE") {
        effectCheckPath(op.path, allowedStack, specAllowed, denied, diagnostics);
      }
      if (op.kind === "RUN") {
        effectCheckCmd(op.cmd, allowPrefixes, denySubs, diagnostics);
      }
    }
    ensureStepHasProofs(s, diagnostics);
  }

  const ok = diagnostics.filter((d) => d.severity === "error").length === 0;
  if (!ok) return { ok: false, diagnostics };

  const plan = {
    lang: "webspec/plan-v0.1",
    target: manifest.id,
    presetVersion: manifest.presetVersion,
    specHash: sha256Hex(input.sourceText),
    steps
  };

  return { ok: true, diagnostics, plan };
}
