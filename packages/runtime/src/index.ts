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

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string) {
  return normalizeText(text).split(" ").filter(Boolean);
}

function jaccard(aTokens: string[], bTokens: string[]) {
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  const inter = new Set([...aSet].filter((t) => bSet.has(t)));
  const union = new Set([...aSet, ...bSet]);
  if (union.size === 0) return 1;
  return inter.size / union.size;
}

function bigrams(text: string) {
  const s = normalizeText(text).replace(/\s+/g, " ");
  if (s.length < 2) return [s];
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i += 1) {
    out.push(s.slice(i, i + 2));
  }
  return out;
}

function diceCoefficient(a: string[], b: string[]) {
  const aCount = new Map<string, number>();
  for (const t of a) aCount.set(t, (aCount.get(t) ?? 0) + 1);
  let intersection = 0;
  for (const t of b) {
    const n = aCount.get(t) ?? 0;
    if (n > 0) {
      intersection += 1;
      aCount.set(t, n - 1);
    }
  }
  if (a.length + b.length === 0) return 1;
  return (2 * intersection) / (a.length + b.length);
}

function fuzzyScore(a: string, b: string) {
  if (a.includes(b) || b.includes(a)) return 1;
  const jt = jaccard(tokenize(a), tokenize(b));
  const dc = diceCoefficient(bigrams(a), bigrams(b));
  return Math.max(jt, dc);
}

async function checkDocSection(cwd: string, p: string, heading: string) {
  const content = await fs.readFile(path.join(cwd, p), "utf8");
  const target = heading.trim().toLowerCase();
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^#{1,6}\s+(.+)$/);
    if (m && m[1].trim().toLowerCase() === target) return;
  }
  throw new Error(`Expected "${p}" to include heading "${heading}"`);
}

async function checkDocContains(cwd: string, p: string, text: string) {
  return checkFileContains(cwd, p, text);
}

async function checkDocContainsFuzzy(cwd: string, p: string, text: string, threshold: number, gate = true) {
  const content = await fs.readFile(path.join(cwd, p), "utf8");
  const score = fuzzyScore(content, text);
  if (score < threshold) {
    const msg = `Fuzzy doc check failed for "${p}" (score ${score.toFixed(3)} < ${threshold}). Expected close to: "${text}"`;
    if (gate === false) {
      console.warn(`[webspec] WARN ${msg}`);
      return;
    }
    throw new Error(msg);
  }
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
      else if (check.kind === "doc.section") await checkDocSection(opts.cwd, check.path, check.heading);
      else if (check.kind === "doc.contains") await checkDocContains(opts.cwd, check.path, check.text);
      else if (check.kind === "doc.contains_fuzzy")
        await checkDocContainsFuzzy(opts.cwd, check.path, check.text, check.threshold, check.gate);
      else if (check.kind === "artifact.exists") await checkFileExists(opts.cwd, check.path);
      else throw new Error(`Unknown check kind: ${(check as any).kind}`);
    }
  }
}
