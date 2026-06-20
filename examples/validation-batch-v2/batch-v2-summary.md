# Validation Batch v2 — Baseline

Generated: 2026-06-20T15:09:05.847Z
CLI version: `1.0.10`
Mode: **fast**  (`fast` = tsc only, `full` = npm install + tsc)

**Converted:** 12/13
**Total TS errors:** 326

## Per-repo results

| Tier | Slug | Kind | Convert | TS errors | Top codes |
| ---: | --- | --- | :---: | ---: | --- |
| 1 | `jdbc-learning` | DB+UI BDD | ok | 2 | TS1011:1 TS1005:1 |
| 1 | `jdbc-pure` | DB inline | ok | 1 | TS2307:1 |
| 1 | `jdbc-test-lab` | DB+UI BDD | ok | 86 | TS1005:48 TS1128:21 TS1434:11 |
| 2 | `ui-api-bookknight` | UI+API BDD | ok | 2 | TS1005:1 TS1003:1 |
| 2 | `ui-api-chiranjeevi` | UI+API BDD | ok | 41 | TS2304:17 TS2307:10 TS7031:6 |
| 2 | `ui-api-pavleciric` | UI+API BDD | ok | 48 | TS2307:15 TS7022:10 TS2448:10 |
| 3 | `anhtester-selenium` | Production | ok | 23 | TS1005:13 TS1128:7 TS1068:1 |
| 3 | `eliasnogueira-lean` | TestContainers | ok | 12 | TS2307:8 TS7031:3 TS7006:1 |
| 3 | `master-selenium` | Production | ok | 26 | TS1128:18 TS1005:7 TS1109:1 |
| 4 | `appium-gauravkarvir` | Appium+SauceLabs | ok | 25 | TS1109:16 TS1005:7 TS1011:2 |
| 4 | `appium-maciejd` | Appium+Web+API | ok | 22 | TS2304:9 TS2307:6 TS7031:5 |
| 5 | `bdd-anhtester` | BDD | ok | 38 | TS1005:23 TS1109:8 TS1003:2 |
| 5 | `bdd-nisvek` | BDD | FAILED | — |  |

## Errors by tier

- Tier 1: **89** errors
- Tier 2: **91** errors
- Tier 3: **61** errors
- Tier 4: **47** errors
- Tier 5: **38** errors

## Top TS error codes

- `TS1005` — 100
- `TS1128` — 48
- `TS2307` — 40
- `TS2304` — 31
- `TS1109` — 27
- `TS7031` — 19
- `TS1434` — 12
- `TS7022` — 10
- `TS2448` — 10
- `TS2339` — 7
- `TS1011` — 4
- `TS1003` — 4
- `TS1002` — 2
- `TS2554` — 2
- `TS2552` — 2

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
