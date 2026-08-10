# Security Policy

## Supported Versions

sel2pw follows semver. Security fixes are backported to the latest patch of the current major version only. Older major versions are unsupported once a new major is released.

| Version | Supported          |
| ------- | ------------------ |
| 2.x     | :white_check_mark: |
| 1.x     | :x: (please upgrade to 2.x — the migration is documented in `CHANGELOG.md`) |
| < 1.0   | :x:                |

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

Instead, report the issue privately by one of these two channels:

1. **GitHub Security Advisory** (preferred): open a draft advisory at
   [https://github.com/javvadivijayprasad/sel2pw/security/advisories/new](https://github.com/javvadivijayprasad/sel2pw/security/advisories/new).
   This keeps the discussion private until a fix is ready and lets us coordinate a CVE if one is warranted.

2. **Email**: send the details to **jvijayprasad@gmail.com** with the subject
   line `[sel2pw security]`.

### What to include

- A clear description of the vulnerability
- Steps to reproduce (a minimal Java input file that triggers the issue is ideal)
- The sel2pw version, Node version, and OS you tested on
- Any suggested mitigation, if you have one

### What to expect

- **Acknowledgment within 72 hours** confirming we received the report
- **Initial assessment within 7 days** with a rough severity classification and expected timeline
- **Fix + release within 30 days** for confirmed issues at High severity or above
- Public disclosure and credit (if you'd like credit) after the fix ships

### Scope

Vulnerabilities we consider in-scope for the disclosure process:

- Arbitrary code execution in the sel2pw CLI when converting untrusted input files
- Path traversal / arbitrary file write outside the specified `--out` directory
- Sensitive information leakage (secrets, absolute paths that reveal usernames) in emitted output or telemetry
- Prototype pollution or dependency-chain vulnerabilities that affect sel2pw's runtime

**Out of scope:**

- Vulnerabilities in generated Playwright test code (that's a Playwright/user-code concern, not sel2pw)
- Issues in optional dependencies (`better-sqlite3`, `@yao-pkg/pkg`) unless they're triggered by sel2pw's default usage
- Denial of service via extremely large Java inputs (please open a normal issue for perf)

Thank you for helping keep sel2pw and its users safe.
