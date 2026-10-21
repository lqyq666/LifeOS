# Promptfoo evaluation harness

This is the A-layer diagnosis/gate. It scores **existing replies**; it does not
call the LifeOS server or generate new product replies.

## Source and license

- Tool: promptfoo 0.124.1
- License: MIT
- Repository: https://github.com/promptfoo/promptfoo
- Node requirement: >=22.22.0
- Use: local CLI via `npx -y promptfoo@0.124.1`; not added to the application
  lockfile. The vendor license is retained at the upstream repository.

## Files

- `providers/precomputed.mjs` — returns `vars.output` (existing reply).
- `providers/precomputed-block.mjs` — returns `vars.block` (memory context).
- `asserts/defect-gate.mjs` — deterministic known-defect gate.
- `asserts/gate-self-check.mjs` — CI meta-assertion: the gate must agree with
  the synthetic fixture's expected label.
- `asserts/memory-rubric.txt` — positive memory-consistency criterion.
- `fixtures/ci-tests.yaml` — synthetic, non-personal fixtures (no model calls).
- `ci.config.yaml` — CI gate, 31 local JavaScript assertions.
- `defect.config.yaml` — local four-set defect evaluation.
- `memory.config.yaml` — local multi-turn memory rubric (requires
  `DASHSCOPE_API_KEY`; uses `alibaba:qwen3.8-max`).
- `build-dataset.mjs` — builds local test files from `.local` reply dumps.

Generated datasets and results stay under `.local/promptfoo/` and are not
committed. The CI gate only uses `fixtures/ci-tests.yaml`.

## Local commands

From `evals/promptfoo`:

```sh
npx promptfoo eval -c ci.config.yaml --no-cache --no-progress-bar --no-table
npx promptfoo eval -c defect.config.yaml --no-cache --no-progress-bar --no-table
```

The memory run is manual and paid; it requires the DashScope key:

```sh
npx promptfoo eval -c memory.config.yaml --no-cache --no-progress-bar --no-table -j 6
```

## CI

`.github/workflows/eval.yml` runs the deterministic gate self-check on pull
requests and manual dispatch. It needs no secrets and makes no model calls.
The local root test suite (`npm test`) and backend isolated tests remain
separate gates.
