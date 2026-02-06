#!/usr/bin/env node
import { Command } from "commander";
import { promises as fs } from "node:fs";
import path from "node:path";
import { compileWebSpec } from "@webspec/compiler";
import { loadRegistryFromStacksDir } from "@webspec/registry";
import { runPlan } from "@webspec/runtime";

const program = new Command();
program.name("webspec").description("WebSpec CLI: compile + run web-dev agent plans").version("0.1.0");

function repoRootFromHere() {
  // naive: assumes CLI run from repo root or subdir. Use CWD as root.
  return process.cwd();
}

program
  .command("compile")
  .argument("<specFile>", "Path to a .yaml WebSpec")
  .option("--stacks <dir>", "Stacks directory", "stacks")
  .option("--out <dir>", "Output dir under .ai", ".ai/build")
  .action(async (specFile, opts) => {
    const root = repoRootFromHere();
    const specPath = path.resolve(root, specFile);
    const specText = await fs.readFile(specPath, "utf8");
    const stacksDir = path.resolve(root, opts.stacks);
    const registry = await loadRegistryFromStacksDir(stacksDir);

    const res = compileWebSpec({ sourceText: specText, registry });
    const outDir = path.resolve(root, opts.out, path.basename(specFile).replace(/\W+/g, "_"));
    await fs.mkdir(outDir, { recursive: true });

    await fs.writeFile(path.join(outDir, "diagnostics.json"), JSON.stringify(res.diagnostics, null, 2), "utf8");
    if (!res.ok || !res.plan) {
      console.error("Compile failed:");
      for (const d of res.diagnostics) console.error(`${d.code}: ${d.message}`);
      process.exit(1);
    }

    await fs.writeFile(path.join(outDir, "plan.json"), JSON.stringify(res.plan, null, 2), "utf8");
    console.log(`Compile OK. Wrote: ${path.relative(root, path.join(outDir, "plan.json"))}`);
  });

program
  .command("run")
  .argument("<specFile>", "Path to a .yaml WebSpec")
  .option("--stacks <dir>", "Stacks directory", "stacks")
  .option("--out <dir>", "Output dir under .ai", ".ai/build")
  .option("--workdir <dir>", "Directory where plan executes", ".ai/tmp/run")
  .action(async (specFile, opts) => {
    const root = repoRootFromHere();
    const specPath = path.resolve(root, specFile);
    const specText = await fs.readFile(specPath, "utf8");
    const stacksDir = path.resolve(root, opts.stacks);
    const registry = await loadRegistryFromStacksDir(stacksDir);

    const res = compileWebSpec({ sourceText: specText, registry });
    if (!res.ok || !res.plan) {
      console.error("Compile failed:");
      for (const d of res.diagnostics) console.error(`${d.code}: ${d.message}`);
      process.exit(1);
    }

    const outDir = path.resolve(root, opts.out, path.basename(specFile).replace(/\W+/g, "_"));
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, "plan.json"), JSON.stringify(res.plan, null, 2), "utf8");

    const workdir = path.resolve(root, opts.workdir);
    await fs.mkdir(workdir, { recursive: true });

    // If workdir isn't a git repo, initialize (so git-tracked guardrail can run)
    try {
      await fs.access(path.join(workdir, ".git"));
    } catch {
      // init git repo
      const { execa } = await import("execa");
      await execa("git", ["init", "-b", "main"], { cwd: workdir, stdio: "inherit" });
    }

    console.log(`Running plan in: ${workdir}`);
    await runPlan(res.plan, { cwd: workdir, registry });
    console.log("Run complete.");
  });

program.parseAsync();
