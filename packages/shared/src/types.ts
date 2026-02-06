export type Severity = "error" | "warn" | "info";

export type Diagnostic = {
  code: string;
  severity: Severity;
  message: string;
  path?: string;
  hint?: string;
};

export type WebSpecTargetId = string;

export type WebSpecProject = {
  name: string;
  repo?: string; // "owner/name"
  visibility?: "public" | "private";
};

export type WebSpecWorkspace = {
  aiDir: string; // e.g., ".ai"
  keepTracked: string[]; // e.g., [".ai/README.md", ".ai/.gitkeep"]
};

export type WebSpecUI = {
  shadcn?: { components: string[] };
};

export type WebSpecRoute = { path: string; page: string };

export type WebSpecEnsure =
  | { exists: string }
  | { contains: { path: string; text: string } }
  | { routeExists: string }
  | { cmdOk: string }
  | { trackedOnly: { glob: string; allow: string[] } }
  | { docSection: { path: string; heading: string } }
  | { docContains: { path: string; text: string } }
  | { docContainsFuzzy: { path: string; text: string; threshold?: number; gate?: boolean } }
  | { artifactExists: { path: string } };

export type WebSpecAction =
  | { run: string }
  | { writeFile: { path: string; content?: string; template?: string; vars?: Record<string, string> } }
  | { appendFile: { path: string; content: string } }
  | { writeTemplate: { path: string; template: string; vars?: Record<string, string> } }
  | { macro: { name: string; args?: Record<string, unknown> } };

export type WebSpecStep = {
  id: string;
  requires?: string[];
  claims?: string[];
  decisions?: string[];
  actions: WebSpecAction[];
  ensures: WebSpecEnsure[];
};

export type WebSpecIntentInvariant = { id: string; text: string };
export type WebSpecIntentNonGoal = { id: string; text: string };
export type WebSpecIntent = {
  summary: string;
  invariants?: WebSpecIntentInvariant[];
  nonGoals?: WebSpecIntentNonGoal[];
};

export type WebSpecAssumption = { id: string; text: string; status: "verified" | "unverified" };

export type WebSpecDecision = {
  id: string;
  question: string;
  answer: string;
  rationale: string;
  status: "provisional" | "final";
  confidence: number; // 0..1
  evidence?: string[];
};

export type WebSpecDocsSection = {
  file: string;
  heading: string;
  mustContain?: string[];
  mustContainFuzzy?: Array<{ text: string; threshold?: number; gate?: boolean }>;
};

export type WebSpecDocs = {
  requiredFiles?: string[];
  sections?: WebSpecDocsSection[];
};

export type WebSpecEffects = {
  writeScopes?: string[];
  expansionPolicy?: "explicit" | "inherit";
};

export type WebSpecArtifacts = {
  required?: Array<{ path: string; role?: string; mustWrite?: boolean }>;
};

export type WebSpecV1 = {
  lang: "webspec/v0.1";
  target: WebSpecTargetId;
  project: WebSpecProject;
  workspace?: WebSpecWorkspace;
  ui?: WebSpecUI;
  routes?: WebSpecRoute[];
  steps?: WebSpecStep[];
  quality?: { gates: string[] };
};

export type WebSpecV2 = {
  lang: "webspec/v0.2";
  target: WebSpecTargetId;
  project: WebSpecProject;
  workspace?: WebSpecWorkspace;
  ui?: WebSpecUI;
  routes?: WebSpecRoute[];
  intent?: WebSpecIntent;
  docs?: WebSpecDocs;
  effects?: WebSpecEffects;
  artifacts?: WebSpecArtifacts;
  assumptions?: WebSpecAssumption[];
  decisions?: WebSpecDecision[];
  steps?: WebSpecStep[];
  quality?: { gates: string[] };
};

export type WebSpec = WebSpecV1 | WebSpecV2;

export type StackMacroArgType = "path" | "string" | "string[]" | "json";

export type StackMacroDef = {
  args: Record<string, StackMacroArgType>;
  expandsTo: Array<
    | { kind: "run"; cmd: string; cwd?: string }
    | { kind: "writeFile"; path: string; content: string }
    | { kind: "appendFile"; path: string; content: string }
    | { kind: "writeTemplate"; path: string; template: string; vars?: Record<string, string> }
  >;
};

export type StackManifest = {
  id: string;
  presetVersion: number;
  displayName?: string;
  detect?: { mustExist?: string[]; mustNotExist?: string[] };
  effectsPolicy: { allowedWriteGlobs: string[]; deniedWriteGlobs?: string[] };
  commands: { allowPrefixes: string[]; denySubstrings?: string[] };
  semantics?: { routing?: Record<string, unknown> };
  macros?: Record<string, StackMacroDef>;
};

export type PlanOp =
  | { kind: "RUN"; cmd: string; cwd?: string }
  | { kind: "WRITE_FILE"; path: string; content: string }
  | { kind: "APPEND_FILE"; path: string; content: string }
  | { kind: "WRITE_TEMPLATE"; path: string; template: string; vars?: Record<string, string> };

export type PlanCheck =
  | { kind: "file.exists"; path: string }
  | { kind: "file.contains"; path: string; text: string }
  | { kind: "route.exists"; route: string }
  | { kind: "cmd.ok"; cmd: string }
  | { kind: "git.trackedOnly"; glob: string; allow: string[] }
  | { kind: "doc.section"; path: string; heading: string }
  | { kind: "doc.contains"; path: string; text: string }
  | { kind: "doc.contains_fuzzy"; path: string; text: string; threshold: number; gate?: boolean }
  | { kind: "artifact.exists"; path: string };

export type PlanStep = {
  id: string;
  requires: string[];
  ops: PlanOp[];
  checks: PlanCheck[];
  claims?: string[];
  decisions?: string[];
};

export type Plan = {
  lang: "webspec/plan-v0.1";
  target: WebSpecTargetId;
  presetVersion: number;
  specHash: string;
  steps: PlanStep[];
};
