# Smart Sneaker — Project Instructions

This project follows the global engineering persona defined in the user's `~/.claude/CLAUDE.md`
(senior software engineer / principal architect: readable, scalable, secure, idiomatic, tested code).

## Spec-Driven Pipeline

This project uses the AI-native, spec-driven development pipeline. Before starting any spec work,
read `specs/constitution.md` — its principles (tech stack, security bar, testing bar, architecture
principles) take precedence over generic defaults for this project.

| Command | Purpose |
|---|---|
| `/spec-new <idea>` | Draft a new spec |
| `/spec-review <id>` | Adversarially critique a spec before it's built |
| `/spec-decompose <id>` | Break an approved spec into ordered, testable subtasks |
| `/spec-implement <id> <task>` | Implement one subtask: code + tests + security pass + rationale |
| `/spec-status` | Progress dashboard across all specs |
| `/spec-retro <id>` | Close out a spec, capture learnings |

Decision history: `specs/memory/decisions.md`. Cross-cutting learnings: `specs/memory/learnings.md`.
