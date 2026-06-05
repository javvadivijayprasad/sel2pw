# Validation Batch v2 — Baseline

Generated: 2026-06-05T00:57:02.948Z
CLI version: `1.0.5`
Mode: **fast**  (`fast` = tsc only, `full` = npm install + tsc)

**Converted:** 12/13
**Total TS errors:** 591

## Per-repo results

| Tier | Slug | Kind | Convert | TS errors | Top codes |
| ---: | --- | --- | :---: | ---: | --- |
| 1 | `jdbc-learning` | DB+UI BDD | ok | 44 | TS1434:20 TS1128:12 TS1005:11 |
| 1 | `jdbc-pure` | DB inline | ok | 1 | TS2307:1 |
| 1 | `jdbc-test-lab` | DB+UI BDD | ok | 115 | TS1005:59 TS1128:34 TS1434:16 |
| 2 | `ui-api-bookknight` | UI+API BDD | ok | 4 | TS1005:2 TS1128:1 TS1003:1 |
| 2 | `ui-api-chiranjeevi` | UI+API BDD | ok | 11 | TS1128:7 TS1434:2 TS1005:2 |
| 2 | `ui-api-pavleciric` | UI+API BDD | ok | 9 | TS1005:4 TS1128:4 TS1434:1 |
| 3 | `anhtester-selenium` | Production | ok | 68 | TS1005:31 TS1128:20 TS1434:13 |
| 3 | `eliasnogueira-lean` | TestContainers | ok | 4 | TS1005:2 TS1109:1 TS1128:1 |
| 3 | `master-selenium` | Production | ok | 30 | TS1128:18 TS1005:7 TS1434:4 |
| 4 | `appium-gauravkarvir` | Appium+SauceLabs | ok | 44 | TS1005:17 TS1109:16 TS1128:9 |
| 4 | `appium-maciejd` | Appium+Web+API | ok | 2 | TS1434:2 |
| 5 | `bdd-anhtester` | BDD | ok | 259 | TS1005:135 TS1128:76 TS1434:29 |
| 5 | `bdd-nisvek` | BDD | FAILED | — |  |

## Errors by tier

- Tier 1: **160** errors
- Tier 2: **24** errors
- Tier 3: **102** errors
- Tier 4: **46** errors
- Tier 5: **259** errors

## Top TS error codes

- `TS1005` — 270
- `TS1128` — 182
- `TS1434` — 87
- `TS1109` — 28
- `TS1011` — 8
- `TS1003` — 5
- `TS1002` — 2
- `TS1068` — 2
- `TS1129` — 2
- `TS1435` — 1
- `TS2307` — 1
- `TS1389` — 1
- `TS1110` — 1
- `TS1136` — 1

## Notes

- `fast` mode skips `npm install` in each output dir, so type-resolution
  errors (TS2307 `Cannot find module '@playwright/test'`, TS2304 `Cannot
  find name 'expect'`) will be inflated. Use `--full` for a precise count.
- BDD repos default to `--bdd-mode preserve` which requires `playwright-bdd`
  at the output. They will show high error counts in fast mode — this is
  expected and not a regression.
- The baseline is committed so CI can compare against it. To refresh:
  `node scripts/clone-validation-batch-v2.js --skip-clone` (re-converts
  but re-uses the cached source clones).
