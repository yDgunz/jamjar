# Agent-Driven Development Workflow

**Date:** 2026-03-23
**Status:** Approved

## Summary

A workflow where the user functions as CEO/CPO (setting direction, providing feedback) and Claude acts as CTO/engineering team (proposing work, implementing, creating PRs). The system uses GitHub Issues as the shared backlog, Claude Chat for strategic conversations, Claude Code for implementation, and QA branch deployments for live review. Production deploys are always gated on explicit user approval.

## Goals

- Let the user work from mobile or desktop, primarily providing direction and feedback
- Eliminate the "starting from scratch" problem when opening new Claude Code sessions
- Maintain a persistent, shared understanding of project state across sessions
- Keep infrastructure simple: Claude Chat, Claude Code, GitHub, existing VPS

## Workflow Lifecycle

### 1. Ideation (Claude Chat)

User and Claude discuss what to build next. Either party can initiate:
- User directs: "Let's add rate limiting to the login endpoint"
- Claude proposes: "Based on the roadmap, input validation is the next priority"

Conversations happen in Claude Chat, which works on both mobile and desktop. Note: Claude Chat does not have repo access or persistent memory across conversations, so the user provides context (e.g., pasting the roadmap, referencing issue numbers). Claude Code is where repo-aware work happens.

### 2. Issue Creation (Claude Code)

Once an idea is agreed upon, a Claude Code session creates a GitHub Issue using a standard template (see Issue Structure below). For larger features, a brainstorming/spec process happens first and the spec doc is linked in the issue.

### 3. Implementation (Claude Code)

A Claude Code session picks up an issue, either by explicit direction ("work on #14") or by checking open `backlog` issues and selecting the top priority (oldest `backlog` issue first, unless labels like `priority-high` indicate otherwise). Work happens on a feature branch named `feature/<short-description>`. Claude moves the issue label from `backlog` to `in-progress`.

### 4. PR + QA Deploy (GitHub)

When implementation is complete, a PR is created linking the issue. The QA branch deployment (already being set up separately) provides a live preview URL. Claude moves the issue label to `review`. For small changes, a chat summary may replace a full PR review.

### 5. Feedback Loop (GitHub or Claude Chat)

User reviews the QA deploy and/or PR from their phone. Feedback can be left as PR comments on GitHub or communicated via Claude Chat. Claude iterates in Claude Code until the user is satisfied.

### 6. Merge + Deploy Gate

User approves the PR (via GitHub review approval). Claude merges the PR and closes the issue. Production deploy requires separate explicit user approval — a comment, chat message, or manual trigger.

### Label Transition Ownership

| Transition | Owner |
|------------|-------|
| (new) → `backlog` | Claude (at issue creation) |
| `backlog` → `in-progress` | Claude (when starting work) |
| `in-progress` → `review` | Claude (when PR is created) |
| `review` → merged | User approves PR, Claude merges |

## Issue Structure

### Labels

**Status:**
- `backlog` — prioritized but not started
- `in-progress` — actively being worked on
- `review` — PR ready, waiting for feedback
**Type:**
- `feature`, `bug`, `chore`

**Priority (optional):**
- `priority-high` — takes precedence over default oldest-first ordering

**Size (optional):**
- `small` (< 1 hour), `medium` (1-4 hours), `large` (multi-session)

### Template

```
## What
One-sentence summary

## Why
Context/motivation

## Spec
- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2

## Notes
Constraints, related issues, design decisions
```

## Session Continuity

Each Claude Code session orients itself using this startup protocol:

### Session Startup Protocol

When a Claude Code session begins work (not just answering a quick question), it runs:

1. **Read project memory** (automatic) — the MEMORY.md index loads automatically with context on current focus, recent decisions, and project patterns
2. **Check GitHub state** — run `gh issue list --label in-progress` and `gh pr list` to see what's active
3. **Summarize status** — briefly tell the user what's in flight and ask what to work on (unless they've already said)

### Current Focus (Project Memory)

A `current-focus.md` memory file is maintained with:
- What's actively in progress (issue numbers and PR links)
- What the user last gave feedback on
- What's next in the priority queue

**Update protocol:** Claude Code updates this file at the end of any session where work state changed (issue picked up, PR created, feedback received). The format is:

```markdown
---
name: current-focus
description: Active work items, recent feedback, and next priorities
type: project
---

**In progress:** #14 rate limiting (PR #18, feature/rate-limiting)
**In review:** #12 input validation (PR #16, QA deploy live)
**Last feedback:** User asked for shorter timeout on #12
**Next up:** #15 health check improvements
```

### CLAUDE.md (automatic)

Technical context about the codebase. Already comprehensive and loads automatically.

This means a new Claude Code session can orient in seconds and the user never has to re-explain context.

## Interaction Patterns

| Activity | Where |
|----------|-------|
| Strategic direction, feedback, brainstorming | Claude Chat |
| Implementation, testing, PRs | Claude Code |
| Review, approval, async comments | GitHub |
| Live preview of UI changes | QA deploy URLs |
| Prod deploy approval | User (explicit) |

### Claude Chat to Claude Code Bridge

Claude Chat and Claude Code do not share context directly. Feedback given in Claude Chat reaches Claude Code via:
1. User summarizes when starting a Code session
2. User posts feedback on the GitHub issue/PR where Code will find it

GitHub Issues/PRs serve as the bridge between the two environments.

## What's NOT Included (Keep It Simple)

- No scheduled/polling agents — sessions are started manually
- No custom state files beyond existing project memory
- No new infrastructure — uses Claude Chat, Claude Code, GitHub, and existing VPS
- No automated prod deploys — always gated on user approval

These could be added later as natural evolutions (e.g., scheduled agents picking up backlog items automatically).

## Implementation

This is a conventions/process document. Implementation consists of:

1. **Create GitHub labels** — `backlog`, `in-progress`, `review`, `feature`, `bug`, `chore`, `small`, `medium`, `large`, `priority-high`
2. **Create issue template** — `.github/ISSUE_TEMPLATE/work-item.md` with the template from this spec
3. **Create `current-focus.md`** — initial project memory file
4. **Update CLAUDE.md** — add session startup protocol and reference to this workflow
