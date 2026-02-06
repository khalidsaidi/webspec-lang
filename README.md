# WebSpec (v0.1)

WebSpec is a web-development–scoped **agent language** that compiles a human-readable spec into a deterministic execution plan.
It is designed to reduce **logic drift** in LLM agents by enforcing:

- **Target stack presets** (compile backends) — no silent framework switching
- **Strict effect policies** — file globs + command allowlists
- **Proof obligations** — steps must include checkable `ensure` rules
- **Hard stop behavior** — if compile fails, no plan is produced; runtime refuses to execute

## Repo structure

- `packages/shared` — types + schemas
- `packages/compiler` — YAML compiler → Plan IR
- `packages/runtime` — executes Plan IR with strict guardrails
- `packages/cli` — `webspec compile` and `webspec run`
- `stacks/*` — supported stack presets (contracts + macros + templates)
- `apps/studio` — React (Vite) + shadcn + Tailwind showcase

## Quickstart

```bash
pnpm install
pnpm build
pnpm dev
```

## Examples

Compile a spec:

```bash
pnpm webspec compile examples/ok.webspec.yaml
```

Run a spec (executes in `.ai/tmp/run` by default):

```bash
pnpm webspec run examples/ok.webspec.yaml
```

Try a bad spec to see the compiler stop:

```bash
pnpm webspec compile examples/bad.webspec.yaml
```

## Studio

Launch the Studio:

```bash
pnpm -C apps/studio dev
```

The Studio compiles WebSpec in-browser and shows diagnostics + the generated plan IR.

## License

MIT
