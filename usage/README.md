# usage

A Claude Code mod: one row above the prompt, in the same style as the [agents](../agents) cards: a USAGE tag, then the windows and the cache split by thin dividers:

- **how much usage is spent** in the 5-hour and 7-day windows, each with a thin bar that fills as you use it and when it resets; from 85% it turns red and says HIGH;
- **the prompt cache**: a WARM pill (Robo bobbing) for an hour after the last request with the minutes left, then COLD (Robo frozen) with the idle time.

It reads the engine's own figures, so it costs no tokens. The terminal gets the same in text, with dot bars.

The look (colours, sizes, element presets, the bar and pill drawings) lives in `hooks/styles.ts`; `hooks/register.tsx` holds the hooks and spreads those presets onto its elements.

Install: `claude plugin install usage@dadolyner` (marketplace `~/.claude/dev-mods/dadolyner`).

Based on [robonuggets/ribbon](https://github.com/robonuggets/ribbon) by Jay E (MIT, see `LICENSE`).
