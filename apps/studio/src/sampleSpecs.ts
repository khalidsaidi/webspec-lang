export const SAMPLE_OK = `lang: webspec/v0.2
target: react-vite-shadcn-tailwind4
project:
  name: demo-app

intent:
  summary: "Studio to compile WebSpec and show diagnostics + plan IR"
  invariants:
    - id: INV-01
      text: "Compiler refuses to output a plan on guardrail failure"
    - id: INV-02
      text: "Studio shows diagnostics and plan IR for any spec"

assumptions:
  - id: DEC-01
    text: "Vite is acceptable for the Studio"
    status: verified

decisions:
  - id: DEC-01
    question: "Which build tool should the Studio use?"
    answer: "Vite"
    rationale: "Fast dev server and simple static deploy"
    status: final
    confidence: 0.86

docs:
  requiredFiles:
    - README.md
  sections:
    - file: README.md
      heading: "WebSpec (v0.2)"
      mustContain:
        - "compile-time logic drift guardrails"
      mustContainFuzzy:
        - text: "runtime refuses to execute on failures"
          threshold: 0.8
          gate: false

effects:
  writeScopes:
    - apps/**
    - packages/**
    - README.md
    - .ai/**

steps:
  - id: init_workspace
    claims: [INV-01]
    decisions: [DEC-01]
    actions:
      - writeFile:
          path: .ai/README.md
          content: "# .ai\nAgent workspace.\n"
      - writeFile:
          path: .ai/.gitkeep
          content: ""
    ensures:
      - exists: .ai/README.md
      - trackedOnly:
          glob: .ai/**
          allow: [".ai/README.md", ".ai/.gitkeep"]

  - id: scaffold_web
    requires: [init_workspace]
    claims: [INV-02]
    decisions: [DEC-01]
    actions:
      - macro:
          name: stack.scaffold
          args:
            app: apps/web
    ensures:
      - exists: apps/web/package.json
`;

export const SAMPLE_BAD = `lang: webspec/v0.2
target: react-vite-shadcn-tailwind4
project:
  name: bad-example

intent:
  summary: "Example that fails on purpose"
  invariants:
    - id: INV-01
      text: "No orphan actions"

assumptions:
  - id: DEC-99
    text: "We know the build system"
    status: unverified

steps:
  - id: orphan_step
    actions:
      - run: "pnpm -v"
    ensures:
      - cmdOk: "pnpm -v"
`;
