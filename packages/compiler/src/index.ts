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

function diag(code: string, message: string, hint?: string, path?: string) {
  return { code, severity: "error" as const, message, hint, path };
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
        "Add at least one ensure (file.exists, file.contains, cmd.ok, route.exists, git.trackedOnly)."
      )
    );
  }
}

function inferAllowedWrite(manifest: any) {
  const allowed = manifest.effectsPolicy?.allowedWriteGlobs ?? [];
  const denied = manifest.effectsPolicy?.deniedWriteGlobs ?? [];
  return { allowed, denied };
}

function effectCheckPath(pathStr: string, allowed: string[], denied: string[], out: any[]) {
  const isDenied = denied.some((g) => picomatch.isMatch(pathStr, g));
  if (isDenied) {
    out.push(diag("E301_DENIED_PATH", `Write denied for path: ${pathStr}`, "Do not write .env files or denied globs."));
    return false;
  }
  const ok = allowed.some((g) => picomatch.isMatch(pathStr, g));
  if (!ok) {
    out.push(
      diag(
        "E300_WRITE_OUTSIDE",
        `Write outside allowed globs: ${pathStr}`,
        `Allowed globs: ${allowed.join(", ")}`
      )
    );
    return false;
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

/**
 * Compile a YAML WebSpec into a deterministic Plan IR.
 * Guardrails focus on LOGIC drift: unknown target/macros, missing proofs, illegal effects.
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

  const { allowed, denied } = inferAllowedWrite(manifest);
  const allowPrefixes = manifest.commands?.allowPrefixes ?? ["pnpm", "git", "node"];
  const denySubs = manifest.commands?.denySubstrings ?? [];

  // Build steps: if spec.steps exists, use it; else synthesize default program
  const steps: any[] = [];
  const aiDir = spec.workspace?.aiDir ?? ".ai";
  const keep = spec.workspace?.keepTracked ?? [`${aiDir}/README.md`, `${aiDir}/.gitkeep`];

  const synthesized = !spec.steps || spec.steps.length === 0;

  if (synthesized) {
    // Step: init_ai
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

    // Step: scaffold (if macro exists)
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

    // Step: setup_ui (optional)
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

    // Step: routes (compile declared routes into one macro if available)
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
        // Next.js style: add per-route pages via macro; simplistic mapping in runtime
        const addRoute = manifest.macros["stack.add_route"];
        const addOps: any[] = [];
        for (const r of spec.routes) {
          const dir = r.path === "/" ? "" : r.path;
          const vars2 = { app: "apps/web", page: r.page, path: r.path, ROUTE_DIR: dir };
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

    // Quality gate
    const gates = spec.quality?.gates ?? [];
    if (gates.length) {
      steps.push({
        id: "quality_gate",
        requires: [steps[steps.length - 1]?.id ?? "scaffold_web"],
        ops: gates.map((c: string) => ({ kind: "RUN", cmd: c })),
        checks: gates.map((c: string) => ({ kind: "cmd.ok", cmd: c }))
      });
    }
  } else {
    diagnostics.push(
      diag(
        "E900_CUSTOM_STEPS_UNSUPPORTED",
        "Custom steps not implemented in this minimal v0.1 compiler.",
        "Use synthesized mode for v0.1."
      )
    );
  }

  // Static effect checks + proof obligations
  for (const s of steps) {
    for (const op of s.ops ?? []) {
      if (op.kind === "WRITE_FILE" || op.kind === "APPEND_FILE" || op.kind === "WRITE_TEMPLATE") {
        effectCheckPath(op.path, allowed, denied, diagnostics);
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
