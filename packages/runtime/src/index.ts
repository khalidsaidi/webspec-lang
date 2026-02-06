import { promises as fs } from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { execa } from "execa";
import { PlanSchema, StackManifestSchema } from "@webspec/shared";
import { loadTemplate } from "@webspec/registry";

type RunOpts = {
  cwd: string;
  registry: Record<string, any>;
};

function ensureDir(p: string) {
  return fs.mkdir(path.dirname(p), { recursive: true });
}

function isAllowedPath(p: string, allowed: string[], denied: string[]) {
  if (denied.some((g) => picomatch.isMatch(p, g))) return false;
  return allowed.some((g) => picomatch.isMatch(p, g));
}

async function checkFileExists(cwd: string, p: string) {
  await fs.access(path.join(cwd, p));
}

async function checkFileContains(cwd: string, p: string, text: string) {
  const content = await fs.readFile(path.join(cwd, p), "utf8");
  if (!content.includes(text)) throw new Error(`Expected "${p}" to contain "${text}"`);
}

async function checkCmdOk(cwd: string, cmd: string) {
  const [bin, ...args] = cmd.split(/\s+/);
  const res = await execa(bin, args, { cwd, stdio: "inherit" });
  if (res.exitCode !== 0) throw new Error(`Command failed: ${cmd}`);
}

async function checkGitTrackedOnly(cwd: string, glob: string, allow: string[]) {
  // Requires git repo. If not a git repo, fail (logic-drift guardrail).
  const res = await execa("git", ["rev-parse", "--is-inside-work-tree"], { cwd, stdio: "pipe" });
  if (res.exitCode !== 0) throw new Error("Not a git repo; cannot enforce git.trackedOnly");
  const listed = await execa("git", ["ls-files", "--", glob.replace("/**", "")], { cwd, stdio: "pipe" });
  const files = listed.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const normalized = files.sort();
  const allowed = allow.slice().sort();
  const same = JSON.stringify(normalized) === JSON.stringify(allowed);
  if (!same) {
    throw new Error(
      `git.trackedOnly failed for ${glob}. Found: ${JSON.stringify(normalized)} expected: ${JSON.stringify(allowed)}`
    );
  }
}

function normalizeNextRouteToFile(route: string) {
  // "/" => "apps/web/app/page.tsx"
  if (route === "/") return "apps/web/app/page.tsx";
  return `apps/web/app${route}/page.tsx`;
}

async function checkRouteExists(cwd: string, manifest: any, route: string) {
  const kind = manifest.semantics?.routing?.kind;
  if (kind === "nextjs_app_router") {
    const p = normalizeNextRouteToFile(route);
    return checkFileExists(cwd, p);
  }
  if (kind === "vite_react_router") {
    // For v0: ensure the generated routes file exists AND contains the route path string
    const routesFile = manifest.semantics?.routing?.routesFile ?? "apps/web/src/routes.generated.tsx";
    await checkFileExists(cwd, routesFile);
    return checkFileContains(cwd, routesFile, `"${route}"`);
  }
  throw new Error(`route.exists not supported for this target: ${manifest.id}`);
}

export async function runPlan(planJson: unknown, opts: RunOpts): Promise<void> {
  const plan = PlanSchema.parse(planJson);
  const stackRaw = opts.registry[plan.target];
  if (!stackRaw) throw new Error(`Unknown target in runtime registry: ${plan.target}`);
  const stack = StackManifestSchema.parse(stackRaw);
  const allowed = stack.effectsPolicy.allowedWriteGlobs ?? [];
  const denied = stack.effectsPolicy.deniedWriteGlobs ?? [];
  const allowPrefixes = stack.commands.allowPrefixes ?? ["pnpm", "git", "node"];
  const denySubs = stack.commands.denySubstrings ?? [];

  // Execute steps in provided order (compiler already topologically sorts in v0)
  for (const step of plan.steps) {
    process.stdout.write(`\n==> STEP ${step.id}\n`);
    // ops
    for (const op of step.ops) {
      if (op.kind === "WRITE_FILE") {
        if (!isAllowedPath(op.path, allowed, denied)) throw new Error(`Write outside allowed globs: ${op.path}`);
        const abs = path.join(opts.cwd, op.path);
        await ensureDir(abs);
        await fs.writeFile(abs, op.content, "utf8");
      } else if (op.kind === "APPEND_FILE") {
        if (!isAllowedPath(op.path, allowed, denied)) throw new Error(`Write outside allowed globs: ${op.path}`);
        const abs = path.join(opts.cwd, op.path);
        await ensureDir(abs);
        await fs.appendFile(abs, op.content, "utf8");
      } else if (op.kind === "WRITE_TEMPLATE") {
        if (!isAllowedPath(op.path, allowed, denied)) throw new Error(`Write outside allowed globs: ${op.path}`);
        const abs = path.join(opts.cwd, op.path);
        await ensureDir(abs);
        const templateText = await loadTemplate(stackRaw, op.template);
        const vars = op.vars ?? {};
        const rendered = templateText.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, k) => String(vars[k] ?? ""));
        await fs.writeFile(abs, rendered, "utf8");
      } else if (op.kind === "RUN") {
        const cmd = op.cmd;
        const prefix = cmd.trim().split(/\s+/)[0] ?? "";
        if (!allowPrefixes.includes(prefix)) throw new Error(`Command not allowed: ${prefix}`);
        for (const bad of denySubs) if (cmd.includes(bad)) throw new Error(`Command denied substring "${bad}": ${cmd}`);
        await checkCmdOk(opts.cwd, cmd);
      } else {
        throw new Error(`Unknown op kind: ${(op as any).kind}`);
      }
    }

    // checks
    for (const check of step.checks ?? []) {
      if (check.kind === "file.exists") await checkFileExists(opts.cwd, check.path);
      else if (check.kind === "file.contains") await checkFileContains(opts.cwd, check.path, check.text);
      else if (check.kind === "cmd.ok") await checkCmdOk(opts.cwd, check.cmd);
      else if (check.kind === "git.trackedOnly") await checkGitTrackedOnly(opts.cwd, check.glob, check.allow);
      else if (check.kind === "route.exists") await checkRouteExists(opts.cwd, stack, check.route);
      else throw new Error(`Unknown check kind: ${(check as any).kind}`);
    }
  }
}
