#!/usr/bin/env node
/**
 * sync-claude-skills-to-dsh.mjs  (v2 — 原样整体镜像)
 *
 * 把 ~/.claude/skills 整体 1:1 复制到 DeepSeek Harness 用户技能根 (~/.dsh/skills)：
 *   - 目录名保持 Claude 原样（RUN / gbk / Hacking-Cheatsheets / forceRemember / .system ...）；
 *   - .system、嵌套技能包、散文件全部照抄，junction 解引用成实体内容；
 *   - 不做任何改名、不重排、不合并。
 *
 * 只补两类“DSH 看不见”的补齐（不改原目录、不复制正文）：
 *   1) .system 里的 5 个技能：user-dsh root 会跳过 .system 子目录，故在根目录建同名 junction 指过去；
 *   2) 嵌套布局 <pack>/<skill>/SKILL.md：DSH 只认一层，故建 <skill>-skill junction 指过去。
 * 另外仅当 DSH 会整条丢弃时，就地最小修 frontmatter：
 *   缺 name/description、name 非 kebab、YAML 解析失败（描述含未加引号的 ": "）。
 *
 * 用法:
 *   node scripts/sync-claude-skills-to-dsh.mjs [--dry-run] [--json]
 *        [--include-plugins] [--project=<dir>] [--verify-only]
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const HARNESS_CHECKOUT = process.env.DSH_CHECKOUT || "E:/claude/project4/pj/deepseek-harness";
const requireFromHarness = createRequire(path.join(HARNESS_CHECKOUT, "package.json"));
const YAML = requireFromHarness("yaml");

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const JSON_OUT = argv.includes("--json");
const INCLUDE_PLUGINS = argv.includes("--include-plugins");
const VERIFY_ONLY = argv.includes("--verify-only");
const PROJECT_ROOT =
  (argv.find((a) => a.startsWith("--project=")) || "").slice("--project=".length) || process.cwd();

const HOME = os.homedir();
const DSH_HOME = process.env.DSH_HOME || path.join(HOME, ".dsh");
const TARGET_ROOT = path.join(DSH_HOME, "skills");
const MANIFEST = path.join(TARGET_ROOT, ".claude-sync.json");
const CLAUDE_SKILLS = path.join(HOME, ".claude", "skills");

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LEGACY_KEYS = ["disableModelInvocation", "modelInvocable", "userInvocable"];

// ------------------------------------------------------------------ helpers

const exists = (p) => fs.existsSync(p);
const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const clamp = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

function kebab(raw) {
  return String(raw)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function splitFrontmatterStrict(text) {
  const clean = text.replace(/^\uFEFF/, "");
  const nl = clean.indexOf("\n");
  if (nl < 0) return undefined;
  if (clean.slice(0, nl).replace(/\r$/, "") !== "---") return undefined;
  const start = nl + 1;
  let lineStart = start;
  while (lineStart <= clean.length) {
    const next = clean.indexOf("\n", lineStart);
    const lineEnd = next < 0 ? clean.length : next;
    if (clean.slice(lineStart, lineEnd).replace(/\r$/, "") === "---") {
      return { raw: clean.slice(start, lineStart), body: clean.slice(next < 0 ? clean.length : next + 1) };
    }
    if (next < 0) break;
    lineStart = next + 1;
  }
  return undefined;
}

function splitFrontmatterLoose(text) {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!clean.startsWith("---")) return undefined;
  const end = clean.indexOf("\n---", 3);
  if (end < 0) return undefined;
  const bodyStart = clean.indexOf("\n", end + 1);
  return { raw: clean.slice(clean.indexOf("\n") + 1, end + 1), body: clean.slice(bodyStart < 0 ? clean.length : bodyStart + 1) };
}

function parseFm(raw) {
  try {
    const parsed = YAML.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { data: parsed };
    return { error: new Error("frontmatter is not a mapping") };
  } catch (error) {
    return { error };
  }
}

/** 修复“未加引号的长描述里含 ": "”这类 YAML 断掉的情况。 */
function repairFrontmatter(raw) {
  const lines = String(raw).replace(/\r\n/g, "\n").split("\n");
  const obj = {};
  let i = 0;
  const coerce = (input) => {
    const t = input.trim();
    if (/^true$/i.test(t)) return true;
    if (/^false$/i.test(t)) return false;
    if (/^-?\d+(?:\.\d+)?$/.test(t)) return Number(t);
    const quoted = /^(["'])([\s\S]*)\1$/.exec(t);
    return quoted ? quoted[2] : t;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const match = /^([A-Za-z0-9_.-]+):[ \t]*(.*)$/.exec(line);
    if (!match) {
      i += 1;
      continue;
    }
    const [, key, inline] = match;
    if (inline.trim() === "") {
      const block = [];
      i += 1;
      while (i < lines.length && (/^[ \t]+\S/.test(lines[i]) || lines[i].trim() === "")) {
        block.push(lines[i]);
        i += 1;
      }
      let parsedBlock;
      try {
        parsedBlock = YAML.parse(block.join("\n"));
      } catch {
        parsedBlock = undefined;
      }
      if (parsedBlock && typeof parsedBlock === "object" && !Array.isArray(parsedBlock)) obj[key] = parsedBlock;
      continue;
    }
    let value = inline;
    i += 1;
    while (i < lines.length && /^[ \t]+\S/.test(lines[i]) && !/^[ \t]*[-*]\s/.test(lines[i])) {
      value += ` ${lines[i].trim()}`;
      i += 1;
    }
    obj[key] = coerce(value);
  }
  return Object.keys(obj).length > 0 ? obj : undefined;
}

function deriveDescription(body, fallbackName) {
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("```")) break;
    const stripped = t
      .replace(/^#{1,6}\s*/, "")
      .replace(/^[-*>+]\s*/, "")
      .replace(/[*_`]/g, "")
      .trim();
    if (stripped.length >= 8) return clamp(stripped, 512);
  }
  return `Claude skill ${fallbackName}（导入时按正文补的描述）`;
}

function readSkill(fileDir) {
  const file = path.join(fileDir, "SKILL.md");
  if (!exists(file)) return undefined;
  const text = fs.readFileSync(file, "utf8");
  const strict = splitFrontmatterStrict(text);
  const loose = strict || splitFrontmatterLoose(text);
  let data;
  let error;
  if (loose) {
    const parsed = parseFm(loose.raw);
    data = parsed.data;
    error = parsed.error;
    if (!data) data = repairFrontmatter(loose.raw);
  } else {
    error = new Error("missing frontmatter");
  }
  return { file, text, strict, loose, data, error };
}

// ------------------------------------------------------------------ mirror

function mirrorClaudeSkills(parentDir, report) {
  for (const dirent of fs.readdirSync(parentDir, { withFileTypes: true })) {
    const src = path.join(parentDir, dirent.name);
    const dst = path.join(TARGET_ROOT, dirent.name);
    if (!DRY) {
      fs.rmSync(dst, { recursive: true, force: true });
      fs.cpSync(src, dst, { recursive: true, force: true, dereference: true, errorOnExist: false });
    }
    report.mirrored.push({ name: dirent.name, from: src, to: dst, kind: dirent.isDirectory() ? "dir" : "file" });
  }
}

// ------------------------------------------------------------------ DSH compatibility shims

function ensureJunction(linkPath, targetPath, report, reason) {
  const existing = (() => {
    try {
      return fs.lstatSync(linkPath);
    } catch {
      return undefined;
    }
  })();
  if (existing) {
    const target = existing.isSymbolicLink() ? fs.readlinkSync(linkPath) : undefined;
    if (target && path.resolve(target) === path.resolve(targetPath)) return "unchanged";
    if (!DRY) fs.rmSync(linkPath, { recursive: true, force: true });
  }
  if (!DRY) fs.symlinkSync(path.resolve(targetPath), linkPath, "junction");
  report.shims.push({ link: linkPath, target: targetPath, reason });
  return "created";
}

function applyShims(report) {
  // 1) .system 里的技能：user-dsh root 会跳过 .system，用同名 junction 提到根
  const systemDir = path.join(TARGET_ROOT, ".system");
  if (isDir(systemDir)) {
    for (const dirent of fs.readdirSync(systemDir, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const inner = path.join(systemDir, dirent.name);
      if (!exists(path.join(inner, "SKILL.md"))) continue;
      ensureJunction(path.join(TARGET_ROOT, dirent.name), inner, report, "system-root");
    }
  }
  // 2) 嵌套包 <pack>/<skill>/SKILL.md：DSH 只发现一层，建 <skill>-skill junction
  for (const dirent of fs.readdirSync(TARGET_ROOT, { withFileTypes: true })) {
    if (!dirent.isDirectory() || dirent.name === ".system") continue;
    const pack = path.join(TARGET_ROOT, dirent.name);
    if (exists(path.join(pack, "SKILL.md"))) continue;
    for (const sub of fs.readdirSync(pack, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      const inner = path.join(pack, sub.name);
      if (!exists(path.join(inner, "SKILL.md"))) continue;
      ensureJunction(path.join(TARGET_ROOT, `${sub.name}-skill`), inner, report, "nested-pack");
    }
  }
}

// ------------------------------------------------------------------ 最小 frontmatter 修复（仅当 DSH 会整条丢弃）

function repairSkillFile(skillDir, report) {
  const skill = readSkill(skillDir);
  if (!skill) return;
  const name = path.basename(skillDir);
  const fmName = typeof skill.data?.name === "string" ? skill.data.name.trim() : "";
  const desc = typeof skill.data?.description === "string" ? skill.data.description.trim() : "";
  const legacy = skill.data ? LEGACY_KEYS.filter((k) => Object.hasOwn(skill.data, k)) : [];
  const needs = [];
  if (!skill.loose) needs.push("add-frontmatter");
  else if (skill.error && !fmName) needs.push("yaml-broken");
  else if (skill.error) needs.push("requote-description");
  if (!SKILL_NAME.test(fmName)) needs.push("name");
  if (!desc) needs.push("description");
  if (legacy.length) needs.push(`legacy:${legacy.join(",")}`);
  if (needs.length === 0) return;

  const body = skill.loose ? skill.loose.body : skill.text;
  const targetName = SKILL_NAME.test(fmName) ? fmName : kebab(name);
  const data = skill.data ? { ...skill.data } : {};
  delete data.name;
  delete data.description;
  for (const key of LEGACY_KEYS) delete data[key];
  if (skill.data?.disableModelInvocation === true || skill.data?.modelInvocable === false) data["disable-model-invocation"] = true;
  if (skill.data?.userInvocable === false) data["user-invocable"] = false;

  const ordered = { name: targetName, description: desc || deriveDescription(body, targetName) };
  for (const key of Object.keys(data)) {
    if (key === "disable-model-invocation" || key === "user-invocable") continue;
    ordered[key] = data[key];
  }
  if (data["disable-model-invocation"] !== undefined) ordered["disable-model-invocation"] = data["disable-model-invocation"];
  if (data["user-invocable"] !== undefined) ordered["user-invocable"] = data["user-invocable"];

  const next = `---\n${YAML.stringify(ordered, { lineWidth: 0 }).trimEnd()}\n---\n${body.replace(/^\r?\n+/, "")}`;
  if (!DRY) fs.writeFileSync(path.join(skillDir, "SKILL.md"), next, "utf8");
  report.repaired.push({ dir: name, actions: needs, name: targetName });
}

// ------------------------------------------------------------------ 目录内所有 SKILL.md 检查点

function skillDirsUnder(root) {
  const found = [];
  const pushIfSkill = (dir) => {
    if (exists(path.join(dir, "SKILL.md"))) found.push(dir);
  };
  for (const dirent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const full = path.join(root, dirent.name);
    if (dirent.name === ".system") {
      for (const sub of fs.readdirSync(full, { withFileTypes: true })) {
        if (sub.isDirectory()) pushIfSkill(path.join(full, sub.name));
      }
      continue;
    }
    if (exists(path.join(full, "SKILL.md"))) pushIfSkill(full);
    else
      for (const sub of fs.readdirSync(full, { withFileTypes: true })) {
        if (sub.isDirectory()) pushIfSkill(path.join(full, sub.name));
      }
  }
  return found;
}

// ------------------------------------------------------------------ verify（复刻 provider 的一层发现规则）

function discoverCatalog(root) {
  const rows = [];
  for (const dirent of fs.readdirSync(root, { withFileTypes: true })) {
    if (dirent.name === ".system") continue;
    const full = path.join(root, dirent.name);
    let dir;
    if (isDir(full)) dir = full;
    else if (dirent.name.endsWith(".md")) {
      dir = undefined;
    } else continue;
    if (dir === undefined) continue;
    if (!exists(path.join(dir, "SKILL.md"))) {
      rows.push({ ok: false, mount: dirent.name, reason: "pack/no SKILL.md（非技能）" });
      continue;
    }
    const skill = readSkill(dir);
    const fmName = typeof skill?.data?.name === "string" ? skill.data.name : "";
    const desc = typeof skill?.data?.description === "string" ? skill.data.description : "";
    const legacy = skill?.data ? LEGACY_KEYS.filter((k) => Object.hasOwn(skill.data, k)) : [];
    if (!skill) rows.push({ ok: false, mount: dirent.name, reason: "unreadable" });
    else if (!skill.strict) rows.push({ ok: false, mount: dirent.name, reason: "缺少 --- frontmatter" });
    else if (skill.error && !fmName) rows.push({ ok: false, mount: dirent.name, reason: `YAML 解析失败: ${String(skill.error.message || skill.error)}` });
    else if (!SKILL_NAME.test(fmName)) rows.push({ ok: false, mount: dirent.name, reason: `非法 name "${fmName}"` });
    else if (!desc) rows.push({ ok: false, mount: dirent.name, reason: "缺 description" });
    else if (legacy.length) rows.push({ ok: false, mount: dirent.name, reason: `旧键 ${legacy.join(",")}` });
    else rows.push({ ok: true, mount: dirent.name, name: fmName, description: desc });
  }
  return rows;
}

// ------------------------------------------------------------------ main

function main() {
  const report = { mirrored: [], shims: [], repaired: [], extras: [], targetRoot: TARGET_ROOT };

  if (VERIFY_ONLY) {
    const rows = discoverCatalog(TARGET_ROOT);
    const ok = rows.filter((r) => r.ok);
    const bad = rows.filter((r) => !r.ok);
    console.log(`${TARGET_ROOT}: ${ok.length} 个可用，${bad.length} 个非技能/被丢弃`);
    for (const row of rows) {
      if (row.ok) console.log(`  OK   ${row.name.padEnd(34)} dir=${row.mount}`);
      else console.log(`  --   ${row.mount.padEnd(34)} ${row.reason}`);
    }
    return;
  }

  if (!isDir(CLAUDE_SKILLS)) throw new Error(`missing ${CLAUDE_SKILLS}`);
  if (!DRY) {
    fs.mkdirSync(TARGET_ROOT, { recursive: true });
    for (const dirent of fs.readdirSync(TARGET_ROOT)) {
      if (dirent === ".claude-sync.json") continue;
      fs.rmSync(path.join(TARGET_ROOT, dirent), { recursive: true, force: true });
    }
  }

  mirrorClaudeSkills(CLAUDE_SKILLS, report);

  // 项目级 Claude 技能（本仓库 .claude/skills/*）
  const projectSkills = path.join(PROJECT_ROOT, ".claude", "skills");
  if (isDir(projectSkills)) {
    for (const dirent of fs.readdirSync(projectSkills, { withFileTypes: true })) {
      const src = path.join(projectSkills, dirent.name);
      if (!dirent.isDirectory() || !exists(path.join(src, "SKILL.md"))) continue;
      const dst = path.join(TARGET_ROOT, dirent.name);
      if (exists(dst)) continue;
      if (!DRY) fs.cpSync(src, dst, { recursive: true, force: true, dereference: true });
      report.extras.push({ name: dirent.name, from: src });
    }
  }

  if (INCLUDE_PLUGINS) {
    const base = path.join(HOME, ".claude", "plugins");
    const walk = (dir, depth) => {
      if (depth > 6 || !isDir(dir)) return;
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const full = path.join(dir, d.name);
        if (d.name === "skills") {
          for (const sub of fs.readdirSync(full, { withFileTypes: true })) {
            if (!sub.isDirectory()) continue;
            const inner = path.join(full, sub.name);
            if (!exists(path.join(inner, "SKILL.md"))) continue;
            const plugin = path.basename(path.dirname(path.dirname(full)));
            const link = path.join(TARGET_ROOT, `${kebab(plugin)}-${sub.name}`);
            if (exists(link)) continue;
            ensureJunction(link, inner, report, "plugin");
            report.extras.push({ name: `${kebab(plugin)}-${sub.name}`, from: inner });
          }
          continue;
        }
        walk(full, depth + 1);
      }
    };
    walk(base, 0);
  }

  if (!DRY) {
    applyShims(report);
    for (const dir of skillDirsUnder(TARGET_ROOT)) repairSkillFile(dir, report);
  }

  const rows = DRY ? [] : discoverCatalog(TARGET_ROOT);
  const ok = rows.filter((r) => r.ok);
  const nonSkill = rows.filter((r) => !r.ok);

  if (!DRY) {
    fs.writeFileSync(
      MANIFEST,
      JSON.stringify(
        {
          syncedAt: new Date().toISOString(),
          mode: "raw-mirror",
          source: CLAUDE_SKILLS,
          targetRoot: TARGET_ROOT,
          mirrored: report.mirrored.length,
          shims: report.shims,
          repaired: report.repaired,
          extras: report.extras,
          catalog: ok.map((r) => ({ name: r.name, dir: r.mount })),
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ ...report, catalog: rows }, null, 2));
    return;
  }

  console.log(`源            : ${CLAUDE_SKILLS}`);
  console.log(`目标          : ${TARGET_ROOT}`);
  console.log(`镜像条目      : ${report.mirrored.length}（原样，含 .system 与散文件）`);
  console.log(`junction 补齐 : ${report.shims.length}（.system → 根、嵌套包 → <name>-skill）`);
  console.log(`frontmatter 修: ${report.repaired.length}（仅修 DSH 会整条丢弃的）`);
  console.log(`额外导入      : ${report.extras.length}`);
  console.log(`DSH 可用技能  : ${ok.length}   非技能/不可用目录: ${nonSkill.length}`);
  if (report.shims.length) {
    console.log("\n-- junction --");
    for (const s of report.shims) console.log(`  ${path.basename(s.link)} -> ${s.target}  [${s.reason}]`);
  }
  if (report.repaired.length) {
    console.log("\n-- frontmatter 最小修复 --");
    for (const r of report.repaired) console.log(`  ${r.dir}: ${r.actions.join(", ")} (name=${r.name})`);
  }
  const nonSkillRows = nonSkill.filter((r) => r.reason !== "pack/no SKILL.md（非技能）");
  if (nonSkillRows.length) {
    console.log("\n-- 仍不可用 --");
    for (const r of nonSkillRows) console.log(`  ${r.mount}: ${r.reason}`);
  }
  console.log("\n-- 可用技能 --");
  console.log(ok.map((r) => r.name).sort().join(", "));
}

main();
