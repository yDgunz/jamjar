# Agent-Driven Development Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up GitHub Issues as a shared backlog with labels, templates, project memory, and CLAUDE.md updates so that Claude Code sessions can orient themselves and work autonomously.

**Architecture:** No code changes. This is infrastructure setup: GitHub labels via `gh` CLI, an issue template file, a project memory file, and a CLAUDE.md update.

**Tech Stack:** GitHub CLI (`gh`), Markdown

**Spec:** `docs/superpowers/specs/2026-03-23-agent-driven-development-design.md`

---

### Task 1: Create GitHub Labels

**Files:** None (GitHub API only)

Create the workflow labels. Some overlap with defaults — `bug` already exists, `enhancement` can be kept alongside `feature`.

- [ ] **Step 1: Create status labels**

```bash
gh label create "backlog" --color "0E8A16" --description "Prioritized but not started"
gh label create "in-progress" --color "FBCA04" --description "Actively being worked on"
gh label create "review" --color "1D76DB" --description "PR ready, waiting for feedback"
```

- [ ] **Step 2: Create type labels**

```bash
gh label create "feature" --color "a2eeef" --description "New feature"
gh label create "chore" --color "C5DEF5" --description "Infrastructure, refactoring, docs"
```

Note: `bug` already exists with color `#d73a4a`. No need to recreate.

- [ ] **Step 3: Create priority and size labels**

```bash
gh label create "priority-high" --color "B60205" --description "Takes precedence over default ordering"
gh label create "small" --color "EDEDED" --description "Less than 1 hour of work"
gh label create "medium" --color "D4C5F9" --description "1-4 hours of work"
gh label create "large" --color "F9D0C4" --description "Multi-session work"
```

- [ ] **Step 4: Verify labels**

```bash
gh label list
```

Expected: All new labels appear alongside existing defaults.

- [ ] **Step 5: Commit** (nothing to commit — labels are on GitHub, not in repo)

---

### Task 2: Create Issue Template

**Files:**
- Create: `.github/ISSUE_TEMPLATE/work-item.md`

- [ ] **Step 1: Create template directory**

```bash
mkdir -p .github/ISSUE_TEMPLATE
```

- [ ] **Step 2: Create the issue template**

Create `.github/ISSUE_TEMPLATE/work-item.md`:

```markdown
---
name: Work Item
about: Standard work item for the agent-driven workflow
labels: backlog
---

## What
<!-- One-sentence summary -->

## Why
<!-- Context/motivation -->

## Spec
- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2

## Notes
<!-- Constraints, related issues, design decisions -->
```

- [ ] **Step 3: Verify template renders**

```bash
cat .github/ISSUE_TEMPLATE/work-item.md
```

Expected: Template with frontmatter setting `backlog` as default label.

- [ ] **Step 4: Commit**

```bash
git add .github/ISSUE_TEMPLATE/work-item.md
git commit -m "chore: add GitHub issue template for agent-driven workflow"
```

---

### Task 3: Create Current Focus Memory File

**Files:**
- Create: `/Users/eric/.claude/projects/-Users-eric-code-jam-session-processor/memory/current-focus.md`
- Modify: `/Users/eric/.claude/projects/-Users-eric-code-jam-session-processor/memory/MEMORY.md`

- [ ] **Step 1: Create the current-focus memory file**

Create `memory/current-focus.md`:

```markdown
---
name: current-focus
description: Active work items, recent feedback, and next priorities
type: project
---

**In progress:** None
**In review:** None
**Last feedback:** None
**Next up:** See roadmap (docs/roadmap.md) and GitHub issues
```

- [ ] **Step 2: Add pointer to MEMORY.md**

Add under the "Recent Sessions" section in MEMORY.md:

```markdown
## Current Focus
- See `memory/current-focus.md` for active work items, recent feedback, and next priorities
```

- [ ] **Step 3: Verify memory loads**

Read MEMORY.md and confirm the current-focus entry appears.

---

### Task 4: Update CLAUDE.md with Session Startup Protocol

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add workflow section to CLAUDE.md**

Add the following after the "Development Process" section:

```markdown
## Agent-Driven Workflow

This project uses an agent-driven development workflow where GitHub Issues serve as the shared backlog. See `docs/superpowers/specs/2026-03-23-agent-driven-development-design.md` for the full spec.

### Session Startup Protocol

When beginning a work session (not just answering a quick question):

1. **Read project memory** (automatic) — MEMORY.md loads with current focus, decisions, and patterns
2. **Check GitHub state** — run `gh issue list --label in-progress` and `gh pr list` to see what's active
3. **Summarize status** — briefly tell the user what's in flight and ask what to work on (unless they've already said)

### Session End Protocol

At the end of any session where work state changed:

1. **Update `current-focus.md`** in project memory with current issue/PR state
2. **Update labels** on GitHub issues to reflect current status

### Issue Workflow

- Issues are created with the `backlog` label using the work-item template
- Label transitions: `backlog` → `in-progress` → `review` → merged
- Claude owns all label transitions; user gates merges via PR approval
- Priority: oldest `backlog` issue first, unless `priority-high` label is present
- Feature branches: `feature/<short-description>`
- Production deploys require explicit user approval
```

- [ ] **Step 2: Verify CLAUDE.md is valid**

Read CLAUDE.md and confirm the new section integrates cleanly with existing content.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add agent-driven workflow protocol to CLAUDE.md"
```
