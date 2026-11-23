# mend

mend applies an edit that an AI model wrote to a tree of text files: unified diffs, SEARCH/REPLACE blocks, V4A patches
and JSON text-editor edits, matched at three whitespace tiers and written all-or-nothing. `SPEC.md` is the contract.

    node main.ts [--format=NAME] [--check] [--strict] [PATCH]

- `main.ts`: the whole CLI (Node 22, standard library only). The tail hands a trial over to `runner.ts` when
  `MAKEFUN_ENV_URL` is set.
- `runner.ts`, `check.ts`: the kit's trial runner and local practice checker (`node check.ts <practice.json>`).
- `LICENSE`: MIT.
