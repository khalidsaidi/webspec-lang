import { promises as fs } from "node:fs";
import path from "node:path";
import { StackManifestSchema } from "@webspec/shared";

export type Registry = Record<string, any>;

export async function loadRegistryFromStacksDir(stacksDir: string): Promise<Registry> {
  const entries = await fs.readdir(stacksDir, { withFileTypes: true });
  const registry: Registry = {};

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const manifestPath = path.join(stacksDir, e.name, "manifest.json");
    try {
      const raw = await fs.readFile(manifestPath, "utf8");
      const json = JSON.parse(raw);
      const manifest = StackManifestSchema.parse(json);
      registry[manifest.id] = { ...manifest, __stackRoot: path.join(stacksDir, e.name) };
    } catch {
      // ignore folders without valid manifest
    }
  }

  return registry;
}

export async function loadTemplate(stack: any, templateRelPath: string): Promise<string> {
  const root = stack.__stackRoot;
  const abs = path.join(root, "templates", templateRelPath);
  return fs.readFile(abs, "utf8");
}
