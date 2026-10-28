# agents

A Claude Code mod: a progress bar above the prompt and a live panel of subagents. Made for the [savvy-flow](../savvy-flow) skill, and useful with any subagents.

- **Progress bar**: the flow's title, phase, accepted tasks out of planned, and a button with the crew size that opens the panel. It appears once something reports progress (savvy-flow does) or a `savvy-*` worker starts.
- **Agents panel** (`/agents-info` toggles it; `/agents-info open` opens it or brings it forward without toggling): one card per running subagent with its role crab, task, status, role and model, a progress bar, and under it the step and current action with time · tokens · cost. Each role's crab animates its prop (the researcher turns a page, the developer's code blinks, the reviewer sweeps a magnifier); `prefers-reduced-motion` stops them.

## Tools it adds

- `mcp__agents__progress`: the orchestrator reports the plan, phase and accepted tasks. Only the main session can: a call from a subagent is ignored, so a worker cannot rename, finish or reset the flow.
- `mcp__agents__step`: a worker reports its own steps (`done`, `total`, `note`). A worker that does not report shows its context fill in grey instead. The tool is listed up front rather than behind ToolSearch, and each `savvy-*` worker gets one line at the end of its brief asking for these reports.

Cost is a rough estimate from token counts and a built-in per-model price table (`PRICES` in `hooks/register.tsx`, list prices as of 2026-10-10), not a bill. Cache writes are priced at the 1-hour rate, which is what Claude Code writes on a subscription; a session that writes 5-minute entries is overestimated there.

## Look and feel

Every colour, SVG style block, size and element preset lives in `hooks/styles.ts`; `hooks/register.tsx` only spreads them onto its elements.

## Settings

`autoOpen`: `savvy` (default), `any` or `always`. With `savvy` the panel opens by itself when a `savvy-*` worker starts or a plan is reported; with `any` it also opens whenever any subagent starts and the panel is closed, so it appears when Claude delegates; with `always` it also opens at the start of every session. `/agents-info` toggles it either way.

Install instructions are in the [repository README](../../README.md).
