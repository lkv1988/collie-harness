---
name: publish
description: Publish a new release of the collie-harness plugin. Runs the full release checklist (plugin validate, unit tests, internal reference scan, entry-point audit), then creates a git tag and pushes master + tag to origin. Use when the user says "publish", "release", or "打tag发布".
---

# Publish collie-harness

## Step 1 — Release checklist (run all in parallel)

```bash
# 1. Plugin validation
claude plugin validate ~/git/collie-harness

# 2. Unit tests
node --test tests/*.test.js

# 3. Internal reference scan (must return empty)
grep -rn '<USER>\|"kevin"' .claude-plugin/ README.md LICENSE

# 4. Entry-point audit
grep -n '/collie-harness' README.md CLAUDE.md | head -50
ls commands/ skills/*/SKILL.md agents/*.md
```

All must pass before proceeding:
- `plugin validate` → "✔ Validation passed"
- tests → 0 fail
- internal ref scan → empty output
- every `commands/*.md` / `skills/*/SKILL.md` / `agents/*.md` has a matching user-facing name in README/CLAUDE.md

## Step 2 — Read version

```bash
grep '"version"' .claude-plugin/marketplace.json | head -1
```

## Step 3 — Tag and push

```bash
git tag v<version>
git push origin master
git push origin v<version>
```

Confirm with the user before running Step 3 if any checklist item failed.
