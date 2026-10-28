import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import type { AgentRun, Flow, Phase, PlannedTask } from "../types";
import type { Role } from "./styles";
import {
	bandRow,
	card,
	colors,
	css,
	fitText,
	font,
	headRow,
	list as listStyle,
	percent as percentStyle,
	sizes,
	stepRow,
	stepText,
	subtitle,
	svg,
	textWidth,
	titleColumn,
	titleRow,
	titleText,
	usageText,
	xml,
} from "./styles";

const flow = atom({ plugin: "agents", key: "flow" } as const, null);
const agents = atom({ plugin: "agents", key: "agents" } as const, []);
const panel = atom({ plugin: "agents", key: "panel" } as const, {
	autoOpenedFor: "",
});
const now = atom({ plugin: "agents", key: "now" } as const, 0);

const TOOL = "mcp__agents__progress";
const STEP_TOOL = "mcp__agents__step";
// Added to the end of each savvy worker's brief. Their system prompt words step
// reporting as a condition ("if the step tool appears among your tools") and they
// skip it even with the tool listed; the same request in the brief is followed.
const STEP_BRIEF = `

Progress reporting: before any other work, call \`${STEP_TOOL}\` with \`total\` (your plan in 3-8 steps) and \`done: 0\`; call it again with \`done\` and a few-word \`note\` as each step finishes. It only draws a progress bar.`;
const PANE = "savvy-agents";
const PHASES: readonly Phase[] = [
	"plan",
	"design",
	"delegate",
	"review",
	"close",
];
const TIERS: readonly string[] = [
	"fable",
	"heavy",
	"careful",
	"medium",
	"light",
];
// The tools' schemas are advice to the model, not a check: what a call may ask
// the band and the panel to draw is bounded here.
const MAX_TASKS = 200;
const MAX_AFTER = 20;
const MAX_TITLE = 120;

type ProgressInput = {
	title?: string;
	total?: number;
	done?: number;
	phase?: Phase;
	finished?: boolean;
	tasks?: { title?: string; tier?: string; after?: number[] }[];
};

const S = {
	pane: "Agents",
	empty: "No agents running.",
	opened: "Agents panel opened.",
	closed: "Agents panel closed.",
	done: "Done",
	plan: "Plan",
	design: "Design",
	tasks: "Tasks",
	review: "Review",
	busy: "running",
	tokens: "tokens",
	context: "Context",
	step: "Step",
	of: "of",
	running: "Running",
	failed: "Failed",
	role: {
		research: "Researcher",
		dev: "Developer",
		review: "Reviewer",
		plan: "Architect",
		test: "Tester",
		write: "Writer",
	} satisfies Record<Role, string>,
} as const;

// ---------------------------------------------------------------------------
// The flow: what the band above the prompt draws.

const blank = (): Flow => ({
	title: "savvy-flow",
	total: 0,
	done: 0,
	running: 0,
	phase: "plan",
	isFinished: false,
	tasks: [],
});

const clip = (s: string, max: number): string =>
	s.length > max ? s.slice(0, Math.max(1, max - 1)) + "…" : s;

const isNewFlow = (prev: Flow | null, input: ProgressInput): boolean =>
	!prev ||
	prev.isFinished ||
	(input.title !== undefined &&
		clip(input.title.trim(), MAX_TITLE) !== prev.title);

// Only a known tier is kept.
const tierName = (v: string): string => {
	const t = v
		.replace(/^savvy-/, "")
		.trim()
		.toLowerCase();
	return TIERS.includes(t) ? t : "";
};

const cleanTasks = (tasks: ProgressInput["tasks"]): PlannedTask[] | undefined =>
	tasks
		?.filter((t) => t.title?.trim())
		.slice(0, MAX_TASKS)
		.map((t) => ({
			title: (t.title ?? "").trim(),
			tier: tierName(t.tier ?? ""),
			after: (t.after ?? [])
				.filter((n) => Number.isInteger(n) && n > 0)
				.slice(0, MAX_AFTER),
		}));

const merge = (prev: Flow | null, input: ProgressInput): Flow => {
	// A new title means a new flow: never carry counters over from an earlier one.
	const base =
		isNewFlow(prev, input) || !prev ? blank() : { ...blank(), ...prev };
	const tasks = cleanTasks(input.tasks) ?? base.tasks;
	const total = Math.min(
		MAX_TASKS,
		Math.max(
			0,
			Math.round(input.total ?? (input.tasks ? tasks.length : base.total)),
		),
	);
	const done = Math.min(
		total || Infinity,
		Math.max(0, Math.round(input.done ?? base.done)),
	);
	const phase =
		input.phase && PHASES.includes(input.phase) ? input.phase : base.phase;
	return {
		...base,
		title: clip(input.title?.trim() || base.title, MAX_TITLE),
		total,
		done,
		phase: input.finished ? "close" : phase,
		isFinished: input.finished === true,
		tasks,
	};
};

const label = (f: Flow): string => {
	if (f.isFinished) return S.done;
	if (f.phase === "plan") return S.plan;
	if (f.phase === "design") return S.design;
	const count = f.total ? `${f.done}/${f.total}` : `${f.running} ${S.busy}`;
	return `${f.phase === "review" ? S.review : S.tasks} ${count}`;
};

const ratio = (f: Flow): number =>
	f.isFinished ? 1 : f.total ? f.done / f.total : 0;

// Deterministic noise so the dither does not shimmer between redraws.
const noise = (x: number, y: number): number => {
	const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
	return s - Math.floor(s);
};

// The whole row is one SVG: the desktop wraps sibling elements onto new lines,
// so title, bar, percent and the crab live in one drawing; only the count and
// the dismiss are Buttons beside it.
const rowSvg = (f: Flow, W: number, isWorking: boolean): string => {
	const { bandH: H, bandBarH: BAR_H, crabW, cell, bandCrabScale } = sizes;
	// The title takes what it needs, up to 40% of the row; the bar takes the rest.
	const title = fitText(f.title, 13, Math.max(60, W * 0.4));
	const BAR_X = Math.round(16 + textWidth(title, 13) + 12);
	const BAR_W = Math.max(60, W - BAR_X - 46 - crabW);
	const color = f.isFinished ? colors.done : colors.accent;
	const y0 = (H - BAR_H) / 2;
	const fillW = Math.round(BAR_W * ratio(f));
	const runW = f.total
		? Math.round((BAR_W * Math.min(f.total, f.done + f.running)) / f.total)
		: 0;

	// Dithered fill: sparse at the start, dense toward the head.
	const dots: string[] = [];
	const cols = Math.floor(fillW / cell);
	const rows = Math.floor(BAR_H / cell);
	for (let c = 0; c < cols; c++) {
		const density = 0.35 + 0.6 * Math.pow(c / Math.max(1, cols), 1.2);
		for (let r = 0; r < rows; r++) {
			if (noise(c, r) < density)
				dots.push(
					`<rect class="t${Math.floor(noise(r, c) * 4)}" x="${c * cell + 1}" y="${r * cell + 1}" width="2" height="2"/>`,
				);
		}
	}
	// Handed to workers, not yet accepted: a faint second layer.
	const faint: string[] = [];
	for (let c = cols; c < Math.floor(runW / cell); c++) {
		for (let r = 0; r < rows; r++) {
			if (noise(c + 7, r + 3) < 0.2)
				faint.push(
					`<rect class="t${Math.floor(noise(r + 5, c) * 4)}" x="${c * cell + 1}" y="${r * cell + 1}" width="1.7" height="1.7"/>`,
				);
		}
	}

	const ticks: string[] = [];
	for (let i = 1; i < f.total; i++) {
		const x = Math.round((BAR_W * i) / f.total);
		if (x > fillW + 4)
			ticks.push(
				`<rect x="${x}" y="${BAR_H / 2 - 4}" width="1.5" height="8" rx="0.75"/>`,
			);
	}

	const text = label(f);
	const pillW = Math.round(18 + text.length * 6.6);
	const pillX = Math.max(0, Math.min(BAR_W - pillW, fillW - pillW));
	const pct = `${Math.round(ratio(f) * 100)}%`;

	return svg(
		W,
		H,
		`<defs><clipPath id="c"><rect x="0" y="0" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/></clipPath></defs>
<circle cx="5" cy="${H / 2}" r="4" fill="${color}"/>
<text class="t" x="16" y="${H / 2 + 4.5}" font-family="${font}" font-size="13" font-weight="500">${xml(title)}</text>
<g transform="translate(${BAR_X},${y0})">
<rect class="k" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/>
<g clip-path="url(#c)">
<g fill="${color}">${dots.join("")}</g>
<g fill="${color}" opacity="0.45">${faint.join("")}</g>
<g class="tk">${ticks.join("")}</g>
</g>
<rect x="${pillX}" width="${pillW}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${color}"/>
<text x="${pillX + pillW / 2}" y="${BAR_H / 2 + 4}" text-anchor="middle" font-family="${font}" font-size="11" font-weight="600" fill="${colors.white}">${xml(text)}</text>
</g>
<text class="m" x="${W - crabW - 6}" y="${H / 2 + 4.5}" text-anchor="end" font-family="${font}" font-size="12.5" font-variant-numeric="tabular-nums">${pct}</text>
${crab(W - crabW + 1, 0, "other", isWorking, bandCrabScale)}`,
		css.band(f.isFinished) + css.crab,
	);
};

const barText = (f: Flow, width: number): string => {
	const filled = Math.round(width * ratio(f));
	return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
};

// ---------------------------------------------------------------------------
// Agents: every subagent of the session, measured as it works.

const modelName = (id: string): string => {
	const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(
		id,
	);
	const [, family = "", major = "", minor] = m ?? [];
	if (!family) return id.replace(/^claude-/, "").replace(/\[.*\]$/, "") || "—";
	return `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? "." + minor : ""}`;
};

// "Opus 5.5 · low" for a run, or just the model when no effort was seen.
const runModel = (a: AgentRun): string =>
	a.effort ? `${modelName(a.model)} · ${a.effort}` : modelName(a.model);

// USD per million tokens: input, output, cache read, cache write. The first row that
// matches a model id wins, so a release sits above its family.
// The engine reports tokens, not money, so the panel's cost is an estimate. It reports
// one cache-write count with no split by lifetime; writes are priced at the 1-hour
// rate (2x input), which is what Claude Code writes on a subscription.
type Price = [
	input: number,
	output: number,
	cacheRead: number,
	cacheWrite: number,
];

const PRICES: [RegExp, Price][] = [
	[/(fable|mythos)-5-1/, [10, 50, 0.25, 20]],
	[/fable|mythos/, [10, 50, 1, 20]],
	[/opus-5-5/, [4, 20, 0.2, 8]],
	[/opus/, [5, 25, 0.5, 10]],
	[/sonnet-5-5/, [2, 10, 0.1, 4]],
	[/sonnet-5/, [2, 10, 0.2, 4]],
	[/sonnet/, [3, 15, 0.3, 6]],
	[/haiku-5-5/, [0.1, 0.5, 0.01, 0.2]],
	[/haiku/, [1, 5, 0.1, 2]],
];

// Haiku 5.5 is priced by prompt length: a request whose prompt (input, cache reads and
// cache writes together) is over 100,000 tokens pays these prices instead.
const HAIKU_LONG_PROMPT = 100_000;
const HAIKU_LONG: Price = [0.5, 2.5, 0.05, 1];

type Usage = {
	input_tokens: number;
	output_tokens: number;
	cache_read_input_tokens: number;
	cache_creation_input_tokens: number;
};

const priceOf = (model: string, prompt: number): Price => {
	const id = model.toLowerCase();
	if (prompt > HAIKU_LONG_PROMPT && /haiku-5-5/.test(id)) return HAIKU_LONG;
	return PRICES.find(([re]) => re.test(id))?.[1] ?? [4, 20, 0.2, 8];
};

// `isRequest` says the usage is one model request, which is what a prompt-length price
// is set by; a turn's sum is priced at the model's ordinary prices.
const costOf = (model: string, u: Usage, isRequest: boolean): number => {
	const prompt = isRequest
		? (u.input_tokens || 0) +
		(u.cache_read_input_tokens || 0) +
		(u.cache_creation_input_tokens || 0)
		: 0;
	const [i, o, r, w] = priceOf(model, prompt);
	return (
		((u.input_tokens || 0) * i +
			(u.output_tokens || 0) * o +
			(u.cache_read_input_tokens || 0) * r +
			(u.cache_creation_input_tokens || 0) * w) /
		1e6
	);
};

// Haiku 4.5 and the Claude 3 models have a 200K window; the rest, Haiku 5.5 included, 1M.
const windowOf = (model: string): number =>
	/haiku-4|claude-3/i.test(model) ? 200_000 : 1_000_000;

const norm = (s: string): string =>
	s
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

const fmtTokens = (n: number): string =>
	n >= 1e6
		? `${(n / 1e6).toFixed(1)}M`
		: n >= 1e3
			? `${Math.round(n / 1e3)}k`
			: `${Math.round(n)}`;

const fmtCost = (usd: number): string =>
	`$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`;

/** 8s, 1m 5s, 1h 2m. */
const fmtSecs = (ms: number): string => {
	const s = Math.max(0, Math.round(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	return `${Math.floor(m / 60)}h ${m % 60}m`;
};

const elapsed = (a: AgentRun, at: number): number =>
	(a.endedAt ?? Math.max(at, a.startedAt)) - a.startedAt;

/** The flow's planned tasks that no run has started yet. */
const plannedOf = (f: Flow | null, list: AgentRun[]): PlannedTask[] => {
	if (!f || f.isFinished) return [];
	const started = new Set(list.map((a) => norm(a.description)));
	return (f.tasks ?? []).filter((t) => !started.has(norm(t.title)));
};

// The keyword nearest the start of the description wins ("Plan a cleanup of ai-docs" plans,
// "Research the timetable docs" researches); on a tie the earlier rule does ("spec review" reviews).
const ROLE_RULES: [RegExp, Role][] = [
	[/review|audit|verif|critique/i, "review"],
	[/\btests?\b|testing|\bqa\b/i, "test"],
	[/\bdocs?\b|document|write-?up|summar|readme|report/i, "write"],
	[/\bplan|design|architect/i, "plan"],
	[
		/research|investigat|explor|search|find|look ?up|count|list|analy|read/i,
		"research",
	],
];

// The role subagents in ~/.claude/agents, and the built-ins, by name; a plugin prefix is ignored.
const ROLE_BY_TYPE: Record<string, Role> = {
	researcher: "research",
	developer: "dev",
	reviewer: "review",
	architect: "plan",
	tester: "test",
	writer: "write",
	explore: "research",
	plan: "plan",
};

const earliestRole = (s: string): Role | undefined =>
	ROLE_RULES.map(([re, role], order) => ({ at: s.search(re), order, role }))
		.filter((m) => m.at >= 0)
		.sort((x, y) => x.at - y.at || x.order - y.order)[0]?.role;

const roleOf = (a: AgentRun): Role =>
	ROLE_BY_TYPE[a.type.replace(/^[^:]*:/, "").toLowerCase()] ??
	earliestRole(a.description) ??
	earliestRole(a.type) ??
	"dev";

// The task's own progress when the worker reports steps.
const progressOf = (a: AgentRun): number | null =>
	a.stepTotal ? Math.min(1, (a.stepDone ?? 0) / a.stepTotal) : null;

const ctxOf = (a: AgentRun): number =>
	a.contextMax
		? Math.min(100, Math.round((a.contextTokens / a.contextMax) * 100))
		: 0;

// Reported steps as a percent, else the context fill.
const progressText = (a: AgentRun): string => {
	const p = progressOf(a);
	return p === null ? `${ctxOf(a)}%` : `${Math.round(p * 100)}%`;
};

/** Under the bar, on the left: the step and what the agent is doing now. */
const stepLine = (a: AgentRun): string => {
	const step = a.stepTotal
		? `${S.step} ${Math.min(a.stepTotal, a.stepDone ?? 0)} ${S.of} ${a.stepTotal}`
		: `${S.context} ${ctxOf(a)}%`;
	return a.stepNote ? `${step} · ${a.stepNote}` : step;
};

/** Under the bar, on the right: time · tokens · cost. */
const usageLine = (a: AgentRun, at: number): string =>
	`${fmtSecs(elapsed(a, at))} · ${fmtTokens(a.tokens)} ${S.tokens} · ${fmtCost(a.costUsd)}`;

// ---------------------------------------------------------------------------
// Pixel Clawd from DockCrab (Clawdy): a 24×18 crab on a 30×28 grid, one costume per role.
// The body keeps the brand clay; the role's colour lives in the costume's accent.

// `cls` puts a pixel in a named group: `bd` (the default) is the body and its
// costume, `la`/`lb` the leg pairs, anything else a prop with its own motion.
type Fill = (
	x: number,
	y: number,
	w: number,
	h: number,
	c: string,
	cls?: string,
) => void;

const stamp = (
	f: Fill,
	x: number,
	y: number,
	rows: string[],
	map: Record<string, string>,
	cls?: string,
): void =>
	rows.forEach((row, dy) =>
		[...row].forEach(
			(ch, dx) => map[ch] && f(x + dx, y + dy, 1, 1, map[ch] ?? "", cls),
		),
	);

// `armCls` lets a raised claw travel with the prop it holds.
const crabBody = (f: Fill, armFront = 0, armCls?: string): void => {
	const { clay, ink } = colors;
	f(7, 10, 16, 12, clay);
	f(3, 14, 4, 4, clay);
	f(23, 14 + armFront, 4, 4, clay, armCls);
	f(9, 12, 2, 2, ink);
	f(19, 12, 2, 2, ink);
	f(7, 22, 2, 4, clay, "la");
	f(17, 22, 2, 4, clay, "la");
	f(11, 22, 2, 4, clay, "lb");
	f(21, 22, 2, 4, clay, "lb");
};

const P = colors.prop;

const COSTUMES: Record<Role | "other", (f: Fill, t: string) => void> = {
	// Researcher: round glasses over an open book; the page turns.
	research: (f, t) => {
		crabBody(f);
		stamp(
			f,
			8,
			11,
			["kkkk......kkkk", "k..kkkkkkkk..k", "k..k......k..k", "kkkk......kkkk"],
			{ k: P.frame },
		);
		stamp(
			f,
			8,
			16,
			[
				".wwwwwbwwwww.",
				"wllllwbwlllww",
				"wwwwwwbwwwwww",
				"wlllllbwllllw",
				"wwwwwwbwwwwww",
				"ccccccccccccc",
			],
			{ w: colors.paper, l: colors.line, b: P.wood, c: t },
		);
		f(15, 17, 5, 3, P.page, "pg");
	},
	// Developer: at a laptop; the code lines and the cursor blink.
	dev: (f, t) => {
		crabBody(f);
		f(8, 14, 14, 6, P.frame);
		f(9, 15, 12, 4, P.screen);
		f(10, 16, 5, 1, P.codeGreen, "cd");
		f(16, 16, 3, 1, t, "cd2");
		f(11, 17, 6, 1, P.codeBlue, "cd2");
		f(18, 17, 1, 1, P.white, "cur");
		f(6, 20, 18, 1, P.keys);
		f(6, 21, 18, 1, P.base);
	},
	// Reviewer: the magnifier sweeps and glints.
	review: (f, t) => {
		crabBody(f, -4, "it");
		f(7, 9, 16, 1, t);
		stamp(
			f,
			23,
			1,
			[".kkk.", "k...k", "k...k", "k...k", ".kkk."],
			{ k: P.frame },
			"it",
		);
		f(24, 2, 3, 3, P.glass, "it");
		f(25, 6, 1, 4, P.wood, "it");
		f(24, 2, 1, 1, P.white, "gl");
	},
	// Architect: hard hat and a blueprint; the pencil draws.
	plan: (f, t) => {
		crabBody(f, -4, "it");
		stamp(
			f,
			6,
			4,
			[
				".....yyyyyyyy.....",
				"...yyyyyhhyyyyy...",
				"..yyyyyyhhyyyyyy..",
				"..yyyyyyhhyyyyyy..",
				".yyyyyyyhhyyyyyyy.",
				"dddddddddddddddddd",
			],
			{ y: P.hat, h: P.hatLight, d: P.hatDark },
		);
		f(13, 5, 4, 2, t);
		stamp(
			f,
			8,
			16,
			[
				"bbbbbbbbbbbbb",
				"bwbbbwbbbbwbb",
				"bwwwwwbbbbwbb",
				"bbbbbwwwwwwbb",
				"bbbbbbbbbbbbb",
			],
			{ b: P.blueprint, w: P.blueprintLine },
		);
		f(24, 3, 1, 1, P.eraser, "it");
		f(24, 4, 1, 5, P.hat, "it");
		f(24, 9, 1, 1, colors.ink, "it");
	},
	// Tester: a flask held up; bubbles rise from it.
	test: (f, t) => {
		crabBody(f, -4);
		f(7, 9, 16, 1, t);
		stamp(f, 23, 4, [".kk.", ".kk.", "kggk", "gggg", "gggg", ".gg."], {
			k: P.flask,
			g: P.liquid,
		});
		f(24, 2, 1, 1, P.liquid, "bub");
		f(25, 1, 1, 1, P.liquid, "bub2");
	},
	// Writer: a page and a quill; the quill writes.
	write: (f, t) => {
		crabBody(f, -4, "it");
		f(9, 15, 12, 7, colors.paper);
		f(10, 16, 10, 1, t);
		f(10, 18, 9, 1, colors.line);
		f(10, 20, 6, 1, colors.line);
		f(26, 1, 1, 2, colors.paper, "it");
		f(25, 2, 2, 4, colors.paper, "it");
		f(24, 5, 2, 3, P.quill, "it");
		f(24, 8, 1, 2, colors.ink, "it");
	},
	// The band's crab: no costume.
	other: (f) => crabBody(f),
};

// Body and props nest inside `bd` so a prop rides the bob and adds its own motion;
// legs stay outside it and step on their own.
const crab = (
	x: number,
	y: number,
	costume: Role | "other",
	isWalking: boolean,
	scale: number,
): string => {
	const groups = new Map<string, string[]>([["bd", []]]);
	const f: Fill = (cx, cy, w, h, c, cls = "bd") => {
		if (!groups.has(cls)) groups.set(cls, []);
		groups
			.get(cls)
			?.push(
				`<rect x="${cx}" y="${cy}" width="${w}" height="${h}" fill="${c}"/>`,
			);
	};
	COSTUMES[costume](
		f,
		costume === "other" ? colors.clay : colors.role[costume],
	);
	const group = (cls: string) =>
		`<g class="${cls}">${(groups.get(cls) ?? []).join("")}</g>`;
	const props = [...groups.keys()].filter(
		(k) => k !== "bd" && k !== "la" && k !== "lb",
	);
	const body = `<g class="bd">${(groups.get("bd") ?? []).join("")}${props.map(group).join("")}</g>`;
	return `<g transform="translate(${x},${y}) scale(${scale})" shape-rendering="crispEdges"><g class="c-${costume}${isWalking ? " run" : ""}">${body}${group("la")}${group("lb")}</g></g>`;
};

// ---------------------------------------------------------------------------
// The agent card's drawings: an icon tile, a status pill and a thin bar.

/** The role's crab in a rounded tile, walking while the agent works. */
const iconSvg = (a: AgentRun): string =>
	svg(
		sizes.icon,
		sizes.icon,
		`<rect class="tile" width="${sizes.icon}" height="${sizes.icon}" rx="10"/>${crab(5, 7, roleOf(a), a.status === "running", 1)}`,
		css.card + css.crab,
	);

/** "Running" (or the run's end) as a small tinted pill. */
const pillSvg = (
	word: string,
	color: string,
): { source: string; w: number } => {
	const w = Math.round(textWidth(word, 11) + 16);
	const h = sizes.pillH;
	return {
		w,
		source: svg(
			w,
			h,
			`<rect width="${w}" height="${h}" rx="9" fill="${color}" fill-opacity=".16"/><text x="${w / 2}" y="12.5" text-anchor="middle" font-family="${font}" font-size="11" font-weight="600" fill="${color}">${xml(word)}</text>`,
		),
	};
};

/** A thin bar: the task's progress in the role's colour, or the context in grey when no steps come in. */
const barSvg = (W: number, a: AgentRun): string => {
	const progress = progressOf(a);
	const h = sizes.lineH;
	const fill = Math.round(W * Math.min(1, progress ?? ctxOf(a) / 100));
	return svg(
		W,
		h,
		`<rect class="track" width="${W}" height="${h}" rx="3"/><rect width="${fill}" height="${h}" rx="3"${progress === null ? ' class="dim"' : ` fill="${colors.role[roleOf(a)]}"`}/>`,
		css.card,
	);
};

// --- terminal drawing: the same rows in text.

const ctxBar = (pct: number, width: number): string => {
	const filled = Math.round((width * pct) / 100);
	return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
};

const ROLE_GLYPH: Record<Role, string> = {
	research: "📖",
	dev: "💻",
	review: "🔍",
	plan: "📐",
	test: "🧪",
	write: "✍",
};

// ---------------------------------------------------------------------------

// Opens the agents pane, or closes it when it is up; true when it ends up open.
async function togglePane($: EngineInterface): Promise<boolean> {
	const isOpen = (await $.ui.panes()).some((p) => p.id === PANE);
	if (isOpen) {
		await $.ui.close({ id: PANE });
		return false;
	}
	const at = await $.clock.now();
	await update($, now, () => at);
	await $.ui.open({ id: PANE, title: S.pane });
	return true;
}

async function autoOpen($: EngineInterface, key: string): Promise<void> {
	const p = await read($, panel);
	if (p.autoOpenedFor === key) return;
	await update($, panel, (prev) => ({ ...prev, autoOpenedFor: key }));
	void $.ui.open({ id: PANE, title: S.pane });
}

export const register: Register = (on, options) => {
	on("session.start", async ($, e, next) => {
		const started = await next(e);
		await $.tool.register({
			name: "progress",
			description:
				"Report /savvy-flow progress to the progress bar above the prompt and the agents panel. " +
				'Call it after presenting the plan (title, total, tasks, phase "delegate"), each time a task is accepted (done), ' +
				"when switching phase or re-planning (tasks), and once at the end with finished: true. Fields left out keep their previous value. " +
				"For the main session only: a call from a subagent is ignored (workers report with `step`).",
			inputSchema: {
				type: "object",
				properties: {
					title: {
						type: "string",
						description: "Short name of the overall task, a few words.",
					},
					total: {
						type: "integer",
						minimum: 0,
						description: "Number of planned worker tasks.",
					},
					done: {
						type: "integer",
						minimum: 0,
						description: "Number of tasks accepted after review.",
					},
					phase: { type: "string", enum: [...PHASES] },
					finished: {
						type: "boolean",
						description: "True once the flow is closed.",
					},
					tasks: {
						type: "array",
						description:
							"The planned worker tasks in order, numbered from 1. Each title must equal the Agent tool `description` the task will be delegated with, so the panel can match runs to tasks.",
						items: {
							type: "object",
							properties: {
								title: {
									type: "string",
									description:
										"A few words; reused verbatim as the Agent description.",
								},
								tier: { type: "string", enum: [...TIERS] },
								after: {
									type: "array",
									items: { type: "integer" },
									description: "Numbers of the tasks this one waits for.",
								},
							},
							required: ["title", "tier"],
						},
					},
				},
			},
		});
		await $.tool.register({
			name: "step",
			description:
				"For savvy-flow workers: report progress on your own task to the agents panel. " +
				"Right after reading the brief, call it with `total` (your plan in 3-8 steps) and `done: 0`; " +
				"call it again as each step finishes. Cheap and silent: it only draws a bar.",
			inputSchema: {
				type: "object",
				properties: {
					done: {
						type: "integer",
						minimum: 0,
						description: "Steps finished so far.",
					},
					total: {
						type: "integer",
						minimum: 1,
						description: "Steps planned; may change if the plan changes.",
					},
					note: {
						type: "string",
						description: "The step in progress, a few words.",
					},
				},
				required: ["done"],
			},
			// In every agent's tool list, not behind ToolSearch: workers do not go looking for it.
			isDeferred: false,
		});
		await $.command.register({
			name: "agents-info",
			description:
				"Show or hide the panel of running subagents: role, model and progress, with tokens, cost and time on expand",
		});

		// Ticks the running agents' clocks; quiet when nothing runs.
		$.clock.every(1000, () => {
			void (async () => {
				const list = await read($, agents);
				if (!list.some((a) => a.status === "running")) return;
				const at = await $.clock.now();
				await update($, now, () => at);
			})();
		});
		// `always`: the panel is up from the start of every session, as a sidebar.
		if (options.autoOpen === "always")
			void $.ui.open({ id: PANE, title: S.pane });
		return started;
	});

	on("command.run", { command: "agents-info" }, async ($, e) => {
		// `/agents-info open` opens the panel, or brings it forward from behind another tab, without toggling it.
		if ((e.args ?? "").trim() === "open") {
			const at = await $.clock.now();
			await update($, now, () => at);
			await $.ui.open({ id: PANE, title: S.pane });
			return { text: S.opened };
		}
		const isOpen = await togglePane($);
		return { text: isOpen ? S.opened : S.closed };
	});

	on("tool.call", { tool: TOOL }, async ($, e) => {
		// The flow is the main session's: a call from a worker's loop carries its agentId
		// and changes nothing, or any subagent could rename, finish or reset the flow.
		if (e.agentId)
			return { result: "ignored: only the main session reports the flow" };
		const input = e as unknown as ProgressInput;
		const prev = await read($, flow);
		if (isNewFlow(prev, input) && input.title !== undefined) {
			// A new flow starts with a clean list; agents still running stay.
			await update($, agents, (list) =>
				list.filter((a) => a.status === "running"),
			);
		}
		const next = await update($, flow, (p) => merge(p, input));
		if (next && input.tasks?.length) await autoOpen($, next.title);
		return { result: `ok: ${label(next ?? blank())}` };
	});

	// A worker's own progress: the call runs in the worker's loop, so agentId names it.
	on("tool.call", { tool: STEP_TOOL }, async ($, e) => {
		const input = e as unknown as {
			done?: number;
			total?: number;
			note?: string;
		};
		const agentId = e.agentId;
		if (!agentId) return { result: "ignored: only subagents report steps" };
		let matched = false;
		await update($, agents, (list) =>
			list.map((a) => {
				if (a.agentId !== agentId) return a;
				matched = true;
				const total = Math.max(0, Math.round(input.total ?? a.stepTotal ?? 0));
				const done = Math.max(0, Math.round(input.done ?? a.stepDone ?? 0));
				return {
					...a,
					stepTotal: total,
					stepDone: total ? Math.min(total, done) : done,
					stepNote: input.note?.trim() || undefined,
				};
			}),
		);
		return {
			result: matched ? "ok" : `ignored: no panel row for agent ${agentId}`,
		};
	});

	// Safety net: worker launches move the faint layer even if the orchestrator forgets to report.
	on("tool.call", { tool: "Agent" }, async ($, e, next) => {
		const type = String(e.subagent_type ?? "");
		if (!type.startsWith("savvy-")) return next(e);

		await update($, flow, (prev) => {
			const base = prev && !prev.isFinished ? { ...blank(), ...prev } : blank();
			return {
				...base,
				running: base.running + 1,
				phase: base.phase === "plan" ? "delegate" : base.phase,
			};
		});
		try {
			return await next(e);
		} finally {
			await update($, flow, (prev) =>
				prev ? { ...prev, running: Math.max(0, prev.running - 1) } : prev,
			);
		}
	});

	on("agent.spawn", async ($, e, next) => {
		const isUnbriefed =
			e.subagentType.startsWith("savvy-") && !e.prompt.includes(STEP_TOOL);
		const started = await next(
			isUnbriefed ? { ...e, prompt: e.prompt + STEP_BRIEF } : e,
		);
		if (started.deny !== undefined) return started;

		const at = await $.clock.now();
		await update($, agents, (list) => {
			const run: AgentRun = {
				id: started.agentId ?? e.tool_use_id,
				agentId: started.agentId,
				type: e.subagentType,
				description: e.description,
				model: started.model,
				status: "running",
				startedAt: at,
				contextTokens: 0,
				contextMax: windowOf(started.model),
				tokens: 0,
				costUsd: 0,
				steps: 0,
			};
			return [...list.filter((a) => a.id !== run.id), run].slice(-200);
		});
		await update($, now, () => at);
		if (e.subagentType.startsWith("savvy-")) {
			const f = await read($, flow);
			await autoOpen($, f && !f.isFinished ? f.title : "savvy-flow");
		} else if (options.autoOpen === "any" || options.autoOpen === "always") {
			// Every delegation brings the panel back up, unless it is already open.
			const isOpen = (await $.ui.panes()).some((p) => p.id === PANE);
			if (!isOpen) void $.ui.open({ id: PANE, title: S.pane });
		}
		return started;
	});

	// Each model request of a subagent: live context, tokens and cost.
	on("turn.step", async function* ($, e, next) {
		const result = yield* next(e);
		const agentId = e.agentId;
		const usage = result.usage;
		if (!agentId || !usage) return result;

		const model = usage.model || e.model;
		const tokens =
			(usage.input_tokens || 0) +
			(usage.output_tokens || 0) +
			(usage.cache_read_input_tokens || 0) +
			(usage.cache_creation_input_tokens || 0);
		await update($, agents, (list) =>
			list.map(
				(a): AgentRun =>
					a.agentId !== agentId
						? a
						: {
							...a,
							model,
							effort: typeof e.effort === "string" ? e.effort : a.effort,
							status: "running",
							endedAt: undefined,
							contextTokens: tokens,
							contextMax: windowOf(model),
							tokens: a.tokens + tokens,
							costUsd: a.costUsd + costOf(model, usage, true),
							steps: a.steps + 1,
						},
			),
		);
		return result;
	});

	on("turn.complete", async ($, e, next) => {
		const agentId = e.agentId;
		if (agentId) {
			const at = await $.clock.now();
			await update($, agents, (list) =>
				list.map((a): AgentRun => {
					if (a.agentId !== agentId) return a;
					// A run whose steps went unseen still gets the turn's own sum.
					const fallback = a.steps === 0 && e.usage;
					return {
						...a,
						status: e.reason === "answer" ? "done" : "failed",
						endedAt: at,
						...(fallback && e.usage
							? {
								model: e.usage.model || a.model,
								tokens:
									e.usage.input_tokens +
									e.usage.output_tokens +
									e.usage.cache_read_input_tokens +
									e.usage.cache_creation_input_tokens,
								costUsd: costOf(e.usage.model || a.model, e.usage, false),
							}
							: {}),
					};
				}),
			);
			await update($, now, () => at);
		}
		return next(e);
	});

	on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
		const ui = $.ui.resolve(e);
		const { Box, Text } = ui;
		const list = await read($, agents);
		const at = Math.max(await read($, now), ...list.map((a) => a.startedAt), 0);
		const running = list.filter((a) => a.status === "running").reverse();
		const empty = <Text dimColor>{S.empty}</Text>;

		if (e.surface === "desktop" && "Svg" in ui) {
			const { Svg } = ui;
			const W = Math.max(
				240,
				Math.min(900, (e.props.bodyColumns || 40) * 8 - 8),
			);
			// Inside the card: its padding (one small step a side) and edge.
			const inner = W - 24;
			return (
				<Box {...listStyle}>
					{running.length === 0 && empty}
					{running.map((a) => {
						const role = roleOf(a);
						const color = colors.role[role];
						const word =
							a.status === "running"
								? S.running
								: a.status === "done"
									? S.done
									: S.failed;
						const pill = pillSvg(
							word,
							a.status === "failed" ? colors.failed : color,
						);
						return (
							<Box key={a.id} {...card}>
								<Box {...headRow}>
									<Svg
										source={iconSvg(a)}
										alt={S.role[role]}
										width={sizes.icon}
										height={sizes.icon}
									/>
									<Box {...titleColumn}>
										<Box {...titleRow}>
											<Text {...titleText}>{a.description || a.type}</Text>
											<Svg
												source={pill.source}
												alt={word}
												width={pill.w}
												height={sizes.pillH}
											/>
										</Box>
										<Text {...subtitle}>
											{S.role[role]} · {runModel(a)}
										</Text>
									</Box>
									<Text {...percentStyle} color={color}>
										{progressText(a)}
									</Text>
								</Box>
								<Svg
									source={barSvg(inner, a)}
									alt={progressText(a)}
									width={inner}
									height={sizes.lineH}
								/>
								<Box {...stepRow}>
									<Text {...stepText}>{stepLine(a)}</Text>
									<Text {...usageText}>{usageLine(a, at)}</Text>
								</Box>
							</Box>
						);
					})}
				</Box>
			);
		}

		// Terminal: the same content in text rows.
		const cols = Math.max(24, e.props.bodyColumns || 40);
		const barW = Math.max(6, Math.min(20, cols - 34));
		return (
			<Box flexDirection="column">
				{running.length === 0 && empty}
				{running.map((a) => {
					const role = roleOf(a);
					const color = colors.role[role];
					const progress = progressOf(a);
					return (
						<Box key={a.id} flexDirection="column" marginBottom={1}>
							<Box flexDirection="row" gap={1}>
								<Text>{ROLE_GLYPH[role]}</Text>
								<Text bold wrap="truncate-end">
									{a.description || a.type}
								</Text>
							</Box>
							<Text wrap="truncate-end">
								{"   "}
								<Text color={color}>{S.role[role]}</Text>
								<Text dimColor> · {runModel(a)}</Text>
							</Text>
							<Text wrap="truncate-end">
								{"   "}
								{progress === null ? (
									<Text dimColor>{ctxBar(ctxOf(a), barW)}</Text>
								) : (
									<Text color={color}>{ctxBar(progress * 100, barW)}</Text>
								)}
								<Text dimColor> {progressText(a)}</Text>
							</Text>
							<Text dimColor wrap="truncate-end">
								{"   "}
								{stepLine(a)} · {usageLine(a, at)}
							</Text>
						</Box>
					);
				})}
			</Box>
		);
	});

	on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
		const f = await read($, flow);
		if (f === null || e.props.hasSurvey) return next(e);
		// Draw this row with the other mods' bands beneath it. Claude Code's own placeholder ({ type: 'engine' }) is
		// never nested: the desktop drops a band that nests it.
		const drawn = await Promise.resolve(next(e)).catch(() => null);
		const below =
			drawn &&
				typeof drawn === "object" &&
				(drawn as { type?: string }).type !== "engine"
				? drawn
				: null;

		const ui = $.ui.resolve(e);
		const { Box, Text, Button } = ui;
		const list = await read($, agents);
		const crew = list.length + plannedOf(f, list).length;
		const isWorking = list.some((a) => a.status === "running");
		const crewButton = (
			<Button
				key="savvy-agents"
				label={`×${crew}`}
				plain
				onPress={() => void togglePane($)}
			/>
		);
		const pct = `${Math.round(ratio(f) * 100)}%`;
		const dismiss = (
			<Button
				key="savvy-dismiss"
				label="✕"
				plain
				role="dismiss"
				onPress={() => update($, flow, () => null)}
			/>
		);

		// The terminal's element table is completed with an `Svg` that draws nothing: test the surface too.
		if (e.surface !== "terminal" && "Svg" in ui) {
			const { Svg } = ui;
			// About 8 CSS px per reported column; the rest is the count, the dismiss
			// and their gaps. No floor above the slot: a row wider than it would wrap.
			const width = Math.max(
				180,
				Math.min(1600, (e.props.bodyColumns || 100) * 8 - 96),
			);
			return (
				<Box flexDirection="column">
					<Box {...bandRow}>
						<Svg
							source={rowSvg(f, width, isWorking)}
							alt={`${f.title}: ${label(f)}, ${pct}`}
							width={width}
							height={sizes.bandH}
						/>
						{crewButton}
						{dismiss}
					</Box>
					{below}
				</Box>
			);
		}

		const cols = e.props.bodyColumns;
		const titleW = Math.max(
			8,
			Math.min(30, f.title.length + 2, Math.floor(cols / 3)),
		);
		const width = Math.max(6, Math.min(40, cols - titleW - 32));
		const color = f.isFinished ? colors.done : colors.accent;
		return (
			<Box flexDirection="column">
				<Box flexDirection="row" gap={2}>
					<Box width={titleW} flexShrink={0}>
						<Text color={color}>● </Text>
						<Text wrap="truncate-end">{f.title}</Text>
					</Box>
					<Text color={color}>{barText(f, width)}</Text>
					<Text bold>{label(f)}</Text>
					<Text dimColor>{pct}</Text>
					<Text color={colors.clay}>▣</Text>
					{crewButton}
					{dismiss}
				</Box>
				{below}
			</Box>
		);
	});
};
