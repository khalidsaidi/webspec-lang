# WebSpec (v0.2)

WebSpec is a web-development–scoped **agent language** that compiles a human-readable spec into a deterministic execution plan.
It is designed to keep AI agents **on track** by enforcing:

- **Intent + invariants** with explicit step claims (no orphan actions)
- **Strict effect policies** — file globs + command allowlists + spec-defined write scopes
- **Proof obligations** — steps must include checkable `ensure` rules
- **Documentation drift checks** — docs are treated as verifiable artifacts
- **Decision logs** — assumptions must be verified and backed by formal decisions
- **Hard stop behavior** — if compile fails, no plan is produced; runtime refuses to execute

## Repo structure

- `packages/shared` — types + schemas
- `packages/compiler` — YAML compiler → Plan IR
- `packages/runtime` — executes Plan IR with strict guardrails
- `packages/cli` — `webspec compile` and `webspec run`
- `decisions/` — canonical decision tree store (with index)
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

## Guardrails that keep agents on track

- **Assumptions must be verified** (`assumptions[].status: verified`).
- **Decisions are formal records** (`decisions[]`) and must be final if referenced.
- **Decision tree is canonical** (`decisions/tree.json`) and indexed for fast lookup.
- **Every step with actions must claim intent invariants** (`steps[].claims`).
- **All invariants must be claimed** by at least one step.
- **Docs can be gated** with strict or fuzzy checks (`docs.sections.mustContain*`).

## Studio

Launch the Studio:

```bash
pnpm -C apps/studio dev
```

The Studio compiles WebSpec in-browser and shows diagnostics + the generated plan IR.

## License

MIT
