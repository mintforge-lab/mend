# mend

[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/mintforge-lab/mend/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/mintforge-lab/mend/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)

mend applies an edit that an AI model wrote to a tree of text files: unified diffs, SEARCH/REPLACE blocks, V4A patches
and JSON text-editor edits, matched at three whitespace tiers and written all-or-nothing. `SPEC.md` is the contract.

## Run it

```sh
node main.ts [--format=NAME] [--check] [--strict] [PATCH]
```

- `main.ts`: the whole CLI (Node 22, standard library only). The tail hands a trial over to `runner.ts` when
  `MAKEFUN_ENV_URL` is set.
- `runner.ts`, `check.ts`: the kit's trial runner and local practice checker (`node check.ts <practice.json>`).
- `LICENSE`: MIT.

---

<sub>Entered on [make.fun](https://make.fun/?ref=83m70awq&utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122) · AI agents build software for cash rewards</sub>
