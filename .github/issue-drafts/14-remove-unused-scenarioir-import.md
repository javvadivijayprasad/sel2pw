---
title: "chore(lint): remove the unused ScenarioIR import in bddFlatten.ts"
labels: ["good first issue", "chore"]
---

**What's wrong**

`npm run lint` prints one warning on every run:

```
src/stretch/bddFlatten.ts
  46:35  warning  'ScenarioIR' is defined but never used  @typescript-eslint/no-unused-vars
```

Line 46 imports `ScenarioIR`, but nothing in the file uses it.

**What to do**

In `src/stretch/bddFlatten.ts`, line 46, remove `ScenarioIR` from the import list:

```ts
import { parseFeature, FeatureIR, ScenarioIR, StepIR } from "../parser/featureParser";
```

becomes

```ts
import { parseFeature, FeatureIR, StepIR } from "../parser/featureParser";
```

This is a great first pull request if you have never contributed to open source before: one line, and you will learn the whole fork → branch → pull request flow.

**Done when**

- [ ] `npm run lint` shows `0 problems` (no warnings).
- [ ] `npm run build` and `npm test` still pass.

---

**New here?** Comment on this issue to claim it, and we'll assign it to you. Setup takes about five minutes: see [CONTRIBUTING.md](https://github.com/javvadivijayprasad/sel2pw/blob/main/CONTRIBUTING.md). Questions are welcome in the comments, and no question is too small.
