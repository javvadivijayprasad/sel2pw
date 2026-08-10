---
name: Bug report
about: Report incorrect conversion output, a crash, or an error in the CLI/API
title: "[bug] "
labels: bug
assignees: ''
---

## Environment

- sel2pw version: (e.g. `2.0.3` — run `npx @vijaypjavvadi/sel2pw --version`)
- Node version: (run `node --version`)
- OS: (Windows / macOS / Linux + version)
- Source stack: (java-testng / java-bdd-cucumber / csharp-nunit / csharp-bdd-specflow)

## Minimal reproduction

The most useful bug reports include a **small, self-contained Java source file** that reproduces the issue. Ten lines is much better than a whole framework.

<details>
<summary>Input Java</summary>

```java
// paste the smallest Java source that reproduces the issue
```

</details>

## Expected TypeScript output

```typescript
// what you expected sel2pw to emit
```

## Actual TypeScript output

```typescript
// what sel2pw actually emitted
```

## CLI command run

```bash
npx @vijaypjavvadi/sel2pw convert . --out ./pw
```

## Additional context

- Full CLI output (paste as a code block)
- Relevant `CONVERSION_REVIEW.md` entries
- Anything from `conversion-result.json` that seemed off

## Would you like to submit a PR?

- [ ] Yes, I'm happy to work on a fix
- [ ] No, just reporting
