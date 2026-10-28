# claude-mods

Claude Code mods by David Škulj, as one plugin marketplace (`dadolyner`).

| Plugin | What it adds |
|---|---|
| [`usage`](usage) | One row above the prompt: 5-hour and 7-day usage left with reset times, and the prompt cache (WARM/COLD). Costs no tokens. |
| [`agents`](agents) | A panel of running subagents, opening when Claude delegates: role crab, task, progress, current step, time · tokens · cost. Adds the `step` tool workers report progress with. |
| [`session-hub`](session-hub) | A tabbed session sidebar: overview, context, changes vs. the base branch, agents, tools & MCP, config & memory. Experimental. |

## Install

```bash
claude plugin marketplace add dadolyner/claude-mods
claude plugin install usage@dadolyner
claude plugin install agents@dadolyner
```

Restart Claude Code afterwards. Mods are an early-access Claude Code feature, so they draw only in sessions where it is on.

## Settings

`agents` → `autoOpen`: `savvy` (default), `any` (open whenever a subagent starts) or `always` (also at session start):

```bash
printf '{"autoOpen":"any"}' | claude plugin configure agents@dadolyner --values-stdin
```

## Licence

`usage` is based on [robonuggets/ribbon](https://github.com/robonuggets/ribbon) by Jay E, MIT-licensed; see `usage/LICENSE`.
