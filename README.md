# vibe-rogue — Clockwork Hollow

Design specifications for *Clockwork Hollow*, a short browser roguelike in colored ASCII.

You are Tick, a wind-up automaton — the first thing the clockmaker Aurelie Vance ever finished. She is
dead, the tower is winding down, and so are you. Climb eight floors to the Great Escapement, take the
Master Key, and decide what to do with it. Every turn costs spring. Death is permanent. A winning run
takes 30–45 minutes.

This repository contains **specifications only** — no code. The specs are written so that a builder can
implement the whole game without making a creative decision.

## Reading order

| Wave | Files | What |
|---|---|---|
| 1 — Vision | [`specs/00-overview.md`](specs/00-overview.md), [`specs/01-story.md`](specs/01-story.md) | Pitch, pillars, scope, pacing, conventions; world, characters, endings, tone, glossary |
| 2 — Systems | [`10`](specs/10-turns-and-combat.md) turns & combat · [`11`](specs/11-character-and-skills.md) character · [`12`](specs/12-items-and-inventory.md) items · [`13`](specs/13-world-and-generation.md) world & generation · [`14`](specs/14-enemies-and-ai.md) enemies & AI · [`15`](specs/15-ui-and-controls.md) UI & controls | Every rule and formula |
| 3 — Content | [`20`](specs/20-skills.md) skills · [`21`](specs/21-items-catalog.md) items · [`22`](specs/22-bestiary.md) bestiary · [`23`](specs/23-floors.md) floors · [`24`](specs/24-script.md) script | Every number and every string |
| 4 — Technical | [`30`](specs/30-technical.md) technical · [`31`](specs/31-balance.md) balance · [`32`](specs/32-acceptance-tests.md) acceptance tests | Stack, determinism, save format; the run model; the checklist |
| Build | [`40`](specs/40-implementation-plan.md) implementation plan | Thirteen milestones, each with a machine-checkable Definition of Done, written for autonomous agents |

Suggested order for a builder: `00 → 01 → 15 → 10 → 11 → 12 → 13 → 14 → 30`, then `20–24` as data,
then `31` and `32` to verify.

## Conventions

Rules carry IDs like `CMB-06`; tables are authoritative over prose; every entity name is matched
exactly. See `00-overview.md` § OVR-07.
