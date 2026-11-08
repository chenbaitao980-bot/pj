import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Cordis plugin identity. */
const name = "__PLUGIN_NAME__";

/** Skill registry this provider plugs into. */
const inject = ["skills"];

/** Provider name shown in skill diagnostics. */
const providerName = "__PROVIDER_NAME__";

/** Standard precedence rank for packaged skill providers. */
const RANK = 600;

/** Directories starting with "_" are resources, never skills. */
function isSkillDir(dir, entry) {
	if (entry.startsWith("_") || entry.startsWith(".")) return false;
	try {
		return statSync(join(dir, entry)).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Parse a SKILL.md: YAML frontmatter (name/description) + markdown body.
 * Supports plain, single-quoted, double-quoted and block-scalar descriptions.
 */
function parseSkill(raw, path) {
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw);
	if (match?.[1] === undefined) throw new Error(`${name}: ${path} has no YAML frontmatter`);
	const frontmatter = match[1];
	const lines = frontmatter.split(/\r?\n/u);
	let description = "";
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		const hit = /^description\s*:\s*(.*)$/u.exec(line);
		if (!hit) continue;
		let value = hit[1].trim();
		if (value === ">" || value === ">-" || value === "|" || value === "|-") {
			const block = [];
			for (let j = i + 1; j < lines.length; j += 1) {
				const next = lines[j];
				if (next.length === 0) {
					block.push("");
					continue;
				}
				if (!/^\s+/u.test(next)) break;
				block.push(next.trim());
			}
			description = block.join(value.startsWith("|") ? "\n" : " ").trim();
		} else {
			if ((value.startsWith('"') && value.endsWith('"') && value.length > 1) || (value.startsWith("'") && value.endsWith("'") && value.length > 1)) {
				value = value.slice(1, -1);
			}
			description = value.replace(/\\n/gu, "\n").trim();
		}
		break;
	}
	if (description.length === 0) throw new Error(`${name}: ${path} has no description`);
	return { description, content: raw.slice(match[0].length).trim() };
}

/**
 * Register every skill directory under assets/ as a bundled skill.
 * @param ctx - Context carrying the skill registry.
 * @param config - Optional `assetRoot` override (absolute directory).
 */
function apply(ctx, config = {}) {
	const assetRoot = config.assetRoot ?? fileURLToPath(new URL("../assets/", import.meta.url));
	const entries = readdirSync(assetRoot).filter((entry) => isSkillDir(assetRoot, entry));
	const candidates = entries.map((skillName) => {
		const directory = join(assetRoot, skillName);
		const path = join(directory, "SKILL.md");
		const { description } = parseSkill(readFileSync(path, "utf8"), path);
		return {
			name: skillName,
			description,
			invocation: { modelInvocable: true, userInvocable: true },
			provider: providerName,
			source: "bundled",
			rank: RANK,
			resourceBase: { kind: "directory", path: directory.split(sep).join("/") },
			locator: path
		};
	});
	const provider = {
		name: providerName,
		list: () => Promise.resolve(candidates),
		get(candidate) {
			const { rank: _rank, locator, ...summary } = candidate;
			const body = parseSkill(readFileSync(locator, "utf8"), locator).content;
			const extra = config.epilogue ?? "";
			return Promise.resolve({ ...summary, content: extra.length > 0 ? `${body}\n${extra}` : body });
		}
	};
	ctx.skills.registerProvider(() => provider);
}

export { apply, inject, name };
