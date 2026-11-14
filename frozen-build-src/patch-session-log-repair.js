#!/usr/bin/env node
/**
 * Frozen-build patch: a stored session log whose V4 lifecycle coordinates
 * drifted must not be reported as an unreadable session.
 *
 * Observed failure (0.2.11-rc.13, session-e740e37b…): a committed log carried
 * `step/start {turn:1, step:1}` a second time one millisecond after the first
 * `step/end {turn:1, step:1}`. Every reader then failed the whole session with
 * `SessionFormatError: step/start does not match the open turn and next step`
 * (`SessionPersistenceCorruptionError` → "历史加载失败").
 *
 * The same log also carried the injected system prompt as a `system/message`
 * after the surface already had content, which the V4 reader refuses
 * ("system/message requires a protected first surface head").
 *
 * The patch hooks `JsonlSessionPersistence.decodeStoredLog`: when the current
 * generation fails V4 relationship validation, it
 *   1. archives such unprotected `system/message` events as ignorable
 *      `plugin:` records (same seq, full payload retained, invisible to the
 *      model-visible surface),
 *   2. normalizes the turn/step coordinates of the decoded stream,
 * and then re-validates. Events are never dropped or reordered; only
 * coordinates and the type of an already-invalid system head change. The
 * artifact is replaced atomically after keeping a `*.corrupt-<stamp>.bak`
 * backup. When that still fails it keeps the longest valid prefix instead.
 * The repair only runs for the session's own write lease holder; a log owned
 * by another process is left alone and keeps the original error.
 *
 * Idempotent: the inserted pieces carry `/*dsh:session-log-repair*\/` and are
 * skipped when present.
 *
 * usage: node patch-session-log-repair.js <payloadRoot> [--dry]
 */

import fs from 'node:fs';
import path from 'node:path';

const MARK = '/*dsh:session-log-repair*/';
const argv = process.argv.slice(2);
const payloadRoot = argv.find((a) => !a.startsWith('--'));
const dry = argv.includes('--dry');

if (!payloadRoot) {
  console.error('usage: node patch-session-log-repair.js <payloadRoot> [--dry]');
  process.exit(2);
}

const file = path.join(
  payloadRoot,
  'resources', 'app', 'dsh', 'node_modules', '@deepseek-ai',
  'dsh-session-persistence-jsonl', 'lib', 'index.js',
);

if (!fs.existsSync(file)) {
  console.error(`MISSING  ${file}`);
  process.exit(1);
}

let source = fs.readFileSync(file, 'utf8');

if (source.includes(MARK)) {
  console.log('skip     session log repair (already applied)');
  process.exit(0);
}

/** Replace one unique anchor; refuse anything that is not exactly one hit. */
function replaceOnce(label, find, replace) {
  const hits = source.split(find).length - 1;
  if (hits !== 1) {
    console.error(`ANCHOR   ${label}: expected 1 hit, found ${hits}`);
    process.exit(1);
  }
  source = source.replace(find, () => replace);
}

/* 1. `rename` for the POSIX publish path of the repaired log. */
replaceOnce(
  'fs import',
  'truncate } from "node:fs/promises";',
  'truncate, rename } from "node:fs/promises";',
);

/* 2. Win32 replacement publish beside the create-only publish. */
replaceOnce(
  'win32 publish helper',
  `async function publishNewFileWin32(existing, replacement) {
	const api = await win32();
	if (api.moveFileExW(toNamespacedPath(existing), toNamespacedPath(replacement), MOVEFILE_WRITE_THROUGH) === 0) throw win32Error("MoveFileExW", api.getLastError(), existing, replacement);
}`,
  `async function publishNewFileWin32(existing, replacement) {
	const api = await win32();
	if (api.moveFileExW(toNamespacedPath(existing), toNamespacedPath(replacement), MOVEFILE_WRITE_THROUGH) === 0) throw win32Error("MoveFileExW", api.getLastError(), existing, replacement);
}
${MARK}
/** Publish \`existing\` over an already-present \`replacement\` (atomic replace). */
async function publishReplaceFileWin32(existing, replacement) {
	const api = await win32();
	if (api.moveFileExW(toNamespacedPath(existing), toNamespacedPath(replacement), MOVEFILE_WRITE_THROUGH | MOVEFILE_REPLACE_EXISTING) === 0) throw win32Error("MoveFileExW", api.getLastError(), existing, replacement);
}`,
);

/* 3. Repair analysis helpers, just before the log scanner. */
replaceOnce(
  'repair helpers',
  'var SessionLogScanner = class {',
  `${MARK}
const MOVEFILE_REPLACE_EXISTING = 1;
const REPAIR_STEP_COORDINATES = /* @__PURE__ */ new Set([
	"system/message",
	"developer/message",
	"assistant/attempt",
	"assistant/message",
	"tool/call",
	"tool/result"
]);
const REPAIR_RETRY_COORDINATES = /* @__PURE__ */ new Set(["llm/retry", "llm/retry-started"]);
const REPAIR_SURFACE_TYPES = /* @__PURE__ */ new Set([
	"system/message",
	"user/message",
	"developer/message",
	"assistant/message",
	"tool/result"
]);
const REPAIR_ARCHIVED_SYSTEM_TYPE = "plugin:dsh.session-log-repair/archived-system-message";
const REPAIR_ATTEMPTS = /* @__PURE__ */ new Set();
/** Stable, filesystem-safe suffix for a corrupt-log backup. */
function repairedLogStamp() {
	return (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
}
/** Decode every concatenated Zstandard frame into one plaintext buffer. */
async function decodeAllZstdFrames(buffer) {
	const { frames } = scanZstdFrames(buffer);
	if (frames.length === 0) throw new Error("empty or header-less Zstandard session log");
	const decoder = createZstdFrameDecoder();
	const parts = [];
	try {
		for (const plaintext of decoder.decode(buffer, frames)) parts.push(Buffer.from(plaintext));
	} finally {
		decoder.close();
	}
	return Buffer.concat(parts);
}
/**
* Archive a \`system/message\` that the V4 surface would reject: the reader only
* admits a system message as the protected first surface head. The payload is
* retained verbatim inside an ignorable plugin record, so the seq density, the
* stored bytes of the conversation, and every later reference stay intact while
* the surface becomes readable again.
*/
function archiveUnprotectedSystemMessages(events) {
	const surface = [];
	let protectedHead;
	let changed = false;
	const out = [];
	for (const source of events) {
		const type = source?.type;
		if (!REPAIR_SURFACE_TYPES.has(type)) {
			out.push(source);
			continue;
		}
		if (type === "system/message" && source.surfaceOp === "append" && surface.length > 0 && protectedHead === void 0) {
			out.push({
				type: REPAIR_ARCHIVED_SYSTEM_TYPE,
				seq: source.seq,
				time: source.time,
				ignorable: true,
				data: {
					originalType: type,
					original: source.data
				}
			});
			changed = true;
			continue;
		}
		if (source.surfaceOp === "append") {
			if (type === "system/message" && surface.length === 0) protectedHead = source.seq;
			surface.push(source.seq);
		} else if (source.surfaceOp !== null && typeof source.surfaceOp === "object") {
			const first = surface.indexOf(source.surfaceOp.startSeq);
			const last = surface.indexOf(source.surfaceOp.endSeq);
			if (first >= 0 && last >= first) {
				const removed = surface.slice(first, last + 1);
				if (protectedHead !== void 0 && removed.includes(protectedHead)) protectedHead = source.seq;
				surface.splice(first, removed.length, source.seq);
			}
		}
		out.push(source);
	}
	return changed ? out : events;
}
/** Clone one event with rewritten lifecycle coordinates. */
function repairRewrite(event, turnValue, stepValue) {	const data = {
		...event.data
	};
	if (turnValue !== void 0) data.turn = turnValue;
	if (stepValue !== void 0) data.step = stepValue;
	return {
		...event,
		data
	};
}
/**
* Replay the V4 lifecycle and rewrite drifted \`turn\`/\`step\` coordinates so the
* stored stream satisfies the relationship rules again. Events are neither
* dropped nor reordered. Returns \`undefined\` when the drift cannot be expressed
* as coordinates (for example a step/start while a step is still open).
*/
function normalizeRepairedCoordinates(events) {
	let turn = null;
	let step = null;
	let nextTurn = 1;
	let nextStep = 1;
	let changed = false;
	const out = [];
	for (const source of events) {
		let event = source;
		const type = event?.type;
		const data = event?.data;
		if (data === null || typeof data !== "object" || Array.isArray(data)) {
			out.push(event);
			continue;
		}
		switch (type) {
			case "turn/start":
				if (turn !== null) return void 0;
				if (data.turn !== nextTurn) {
					event = repairRewrite(event, nextTurn);
					changed = true;
				}
				turn = nextTurn;
				step = null;
				nextStep = 1;
				break;
			case "turn/end":
				if (turn === null || step !== null) return void 0;
				if (data.turn !== turn) {
					event = repairRewrite(event, turn);
					changed = true;
				}
				turn = null;
				nextTurn += 1;
				break;
			case "step/start":
				if (turn === null || step !== null) return void 0;
				if (data.turn !== turn || data.step !== nextStep) {
					event = repairRewrite(event, turn, nextStep);
					changed = true;
				}
				step = nextStep;
				break;
			case "step/end":
				if (turn === null || step === null) return void 0;
				if (data.turn !== turn || data.step !== step) {
					event = repairRewrite(event, turn, step);
					changed = true;
				}
				step = null;
				nextStep += 1;
				break;
			default:
				if (REPAIR_STEP_COORDINATES.has(type) && typeof data.turn === "number" && typeof data.step === "number") {
					if (turn === null || step === null) return void 0;
					if (data.turn !== turn || data.step !== step) {
						event = repairRewrite(event, turn, step);
						changed = true;
					}
				} else if (REPAIR_RETRY_COORDINATES.has(type)) {
					if (turn === null || typeof data.turn !== "number") return void 0;
					const expectedStep = step !== null ? step : nextStep - 1;
					if (data.turn !== turn || data.step !== expectedStep) {
						event = repairRewrite(event, turn, expectedStep);
						changed = true;
					}
				} else if ((type === "compaction/start" || type === "compaction/summary" || type === "compaction/end") && typeof data.turn === "number" && turn !== null && data.turn !== turn) {
					event = repairRewrite(event, turn);
					changed = true;
				}
				break;
		}
		out.push(event);
	}
	return changed ? out : events;
}
/** Validate one repaired candidate artifact through the installed V4 reader. */
function assertRepairableArtifact(header, inheritedEventCount, events) {
	assertReleasedV4Relationships({
		header,
		inheritedEventCount,
		events
	}, KNOWN_SESSION_EVENT_TYPES);
}
/** Longest prefix (at least the inherited cut) that passes relationship validation. */
function longestRepairablePrefix(header, inheritedEventCount, events) {
	let low = inheritedEventCount;
	let high = events.length;
	let best = -1;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		try {
			assertRepairableArtifact(header, inheritedEventCount, events.slice(0, middle));
			best = middle;
			low = middle + 1;
		} catch {
			high = middle - 1;
		}
	}
	return best;
}
/**
* Decode a raw current-format log without relationship admission, then build
* the best repairable event stream: coordinate-normalized events first, the
* longest valid prefix otherwise.
* @param plaintext - decompressed JSONL bytes (header line first).
* @returns the repaired stream, or \`undefined\` when nothing usable remains.
*/
async function buildRepairedStoredLog(plaintext) {
	const headerEnd = plaintext.indexOf(10);
	if (headerEnd < 0) return void 0;
	const { meta, restore } = parseHeaderRecord(plaintext.subarray(0, headerEnd + 1));
	for (const line of plaintext.subarray(headerEnd + 1).toString("utf8").split("\\n")) {
		if (line.length === 0) continue;
		let row;
		try {
			row = JSON.parse(line);
		} catch {
			break;
		}
		try {
			restore.decodeRow(row);
		} catch {
			break;
		}
	}
	const artifact = restore.finish();
	const inheritedEventCount = artifact.inheritedEventCount;
	const archived = archiveUnprotectedSystemMessages(artifact.events);
	const normalized = normalizeRepairedCoordinates(archived);
	if (normalized !== void 0) try {
		assertRepairableArtifact(artifact.header, inheritedEventCount, normalized);
		return {
			meta,
			events: normalized,
			inheritedEventCount,
			mode: archived === artifact.events ? "coordinates" : "coordinates+system-archive"
		};
	} catch {}
	const best = longestRepairablePrefix(artifact.header, inheritedEventCount, artifact.events);
	if (best < inheritedEventCount || best <= 0) return void 0;
	return {
		meta,
		events: artifact.events.slice(0, best),
		inheritedEventCount,
		mode: "prefix"
	};
}
/** Keep the unreadable bytes beside the log before any repair writes. */
async function writeRepairBackup(path, buffer) {
	const backup = \`\${path}.corrupt-\${repairedLogStamp()}.bak\`;
	const handle = await open(backup, "wx", 384);
	try {
		await handle.writeFile(buffer);
		await handle.sync();
	} finally {
		await handle.close();
	}
	return backup;
}
var SessionLogScanner = class {`,
);

/* 4. The repair method on the persistence backend, after decodeStoredLog. */
replaceOnce(
  'repair method',
  `		this.memoizeStoredLog(expectedId, stored);
		return stored;
	}
	/** Insert one parsed log into the bounded handoff cache. */`,
  `		this.memoizeStoredLog(expectedId, stored);
		return stored;
	}
	${MARK}
	/**
	* Repair one current-generation log that failed V4 relationship validation:
	* normalize coordinates (or keep the longest valid prefix), back up the raw
	* bytes, and atomically replace the artifact. Runs only under this session's
	* write lease; a log owned by another process keeps its original error.
	* @param path - the artifact path.
	* @param expectedId - the session identity the artifact carries.
	* @param buffer - the exact bytes that failed to decode.
	* @param revision - the stat revision of \`buffer\`.
	* @returns whether the artifact was replaced with a readable log.
	*/
	async repairStoredLog(path, expectedId, buffer, revision) {
		const attemptKey = \`\${path}\\u0000\${String(revision)}\`;
		if (REPAIR_ATTEMPTS.has(attemptKey)) return false;
		REPAIR_ATTEMPTS.add(attemptKey);
		if (REPAIR_ATTEMPTS.size > 128) for (const key of REPAIR_ATTEMPTS) {
			REPAIR_ATTEMPTS.delete(key);
			break;
		}
		let plaintext;
		try {
			plaintext = this.compression === "zstd" ? await decodeAllZstdFrames(buffer) : buffer;
		} catch (error) {
			this.ctx.logger.warn(\`\${this.name}: session "\${expectedId}" repair skipped: \${String(error)} (raw log: \${path})\`);
			return false;
		}
		let repaired;
		try {
			repaired = await buildRepairedStoredLog(plaintext);
		} catch (error) {
			this.ctx.logger.warn(\`\${this.name}: session "\${expectedId}" repair analysis failed: \${String(error)} (raw log: \${path})\`);
			return false;
		}
		if (repaired === void 0) {
			this.ctx.logger.warn(\`\${this.name}: session "\${expectedId}" repair found no readable stream (raw log: \${path})\`);
			return false;
		}
		let lease;
		if (!this.tracker.writers.has(expectedId)) try {
			lease = await SessionWriteLease.acquire(dirname(path), expectedId);
		} catch (error) {
			this.ctx.logger.warn(\`\${this.name}: session "\${expectedId}" repair deferred, the log is owned elsewhere: \${String(error)} (raw log: \${path})\`);
			return false;
		}
		try {
			const content = await this.encodeMaterialization(repaired.meta, repaired.inheritedEventCount, repaired.events);
			const backup = await writeRepairBackup(path, buffer);
			const staging = await this.writeSyncedTempFile(path, content);
			if (process.platform === "win32") await publishReplaceFileWin32(staging, path);
			else await rename(staging, path);
			this.coldLogMemo.delete(expectedId);
			this.ctx.logger.warn(\`\${this.name}: session "\${expectedId}" stored log repaired (\${repaired.mode}; \${repaired.events.length} events; backup: \${backup})\`);
			return true;
		} catch (error) {
			this.ctx.logger.warn(\`\${this.name}: session "\${expectedId}" repair write failed: \${String(error)} (raw log: \${path})\`);
			return false;
		} finally {
			if (lease !== void 0) try {
				await lease.release();
			} catch {}
		}
	}
	/** Insert one parsed log into the bounded handoff cache. */`,
);

/* 5. Allow the one repair retry on decodeStoredLog. */
replaceOnce(
  'decode signature',
  'async decodeStoredLog(path, expectedId, buffer, revision, signal) {',
  'async decodeStoredLog(path, expectedId, buffer, revision, signal, allowRepair = true) {',
);

/* 6. Attempt the repair before reporting corruption. */
replaceOnce(
  'decode repair hook',
  `			if (error instanceof SessionFormatUnsupportedError) throw new SessionFormatUnsupportedError(\`\${error.message} (raw log: \${path})\`, {
				kind: "jsonl",
				path
			});
			throw new SessionPersistenceCorruptionError(\`session "\${expectedId}": stored log is corrupt: \${String(error)} (raw log: \${path})\`, { cause: error });`,
  `			if (error instanceof SessionFormatUnsupportedError) throw new SessionFormatUnsupportedError(\`\${error.message} (raw log: \${path})\`, {
				kind: "jsonl",
				path
			});
			${MARK}
			if (allowRepair && error instanceof SessionFormatError) try {
				if (await this.repairStoredLog(path, expectedId, buffer, revision)) {
					const current = await readStableJsonlFile(path, signal);
					signal?.throwIfAborted();
					return await this.decodeStoredLog(path, expectedId, current.bytes, fileRevision(current.identity), signal, false);
				}
			} catch (repairError) {
				this.ctx.logger.warn(\`\${this.name}: session "\${expectedId}" repair failed: \${String(repairError)} (raw log: \${path})\`);
			}
			throw new SessionPersistenceCorruptionError(\`session "\${expectedId}": stored log is corrupt: \${String(error)} (raw log: \${path})\`, { cause: error });`,
);

if (dry) {
  console.log('would patch', file);
  process.exit(0);
}

fs.writeFileSync(file, source, 'utf8');
console.log('patched  session log repair');
