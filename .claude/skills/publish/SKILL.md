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

If the tag `v<version>` already exists, bump the version in both `.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json` before continuing.

## Step 2.5 — Update CHANGELOG.md

Read `CHANGELOG.md`. Add a new `## [<version>] — YYYY-MM-DD` section at the top (below `# Changelog` header) with entries for all changes since the previous release tag:

```bash
# Get commits since last tag to inform changelog entries
git log --oneline <prev-tag>..HEAD
```

Group entries under `### Added`, `### Fixed`, `### Changed`, `### Breaking` as appropriate. If the `[Unreleased]` section has content, move it into the new versioned section.

Commit the changelog update along with any version bump:
```bash
git add CHANGELOG.md .claude-plugin/marketplace.json .claude-plugin/plugin.json
git commit -m "chore: bump version to <version> + update CHANGELOG"
```

## Step 3 — Tag and push

```bash
git tag v<version>
git push origin master
git push origin v<version>
```

Confirm with the user before running Step 3 if any checklist item failed.
