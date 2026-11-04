---
title: "ci: add a CodeQL security-scanning workflow"
labels: ["infrastructure", "security", "good first issue"]
---

**Why**

The repo runs its checks in `.github/workflows/release.yml` but has no security scanning. GitHub's CodeQL is free for public repositories and finds common bugs and security problems in TypeScript.

**What to do**

Add `.github/workflows/codeql.yml`. GitHub has a ready-made template: open the repo's **Security** tab, choose **Code scanning → Set up → Advanced**, and you get a starter file you can copy.

The workflow should:

- run on `push` to `main`, on every `pull_request`, and once a week (`schedule`)
- scan the `javascript-typescript` language

**Done when**

- [ ] `.github/workflows/codeql.yml` exists and its run is green on your pull request.
- [ ] The README's "Development" section has one line saying that CodeQL runs on every PR.

Dependency scanning (Snyk or similar) can be a separate follow-up issue. Please keep this one to CodeQL only.

---

**New here?** Comment on this issue to claim it, and we'll assign it to you. Setup takes about five minutes: see [CONTRIBUTING.md](https://github.com/javvadivijayprasad/sel2pw/blob/main/CONTRIBUTING.md). Questions are welcome in the comments, and no question is too small.
