---
name: trellis-before-dev
description: "Discovers and injects project-specific coding guidelines from .trellis/spec/ before implementation begins. Reads spec indexes, pre-development checklists, and shared thinking guides for the target package. Use when starting a new coding task, before writing any code, switching to a different package, or needing to refresh project conventions and standards."
---

Read the relevant development guidelines before starting your task.

Execute these steps:

1. **Discover packages and their spec layers**:
   ```bash
   python ./.trellis/scripts/get_context.py --mode packages
   ```

2. **Identify which specs apply** to your task based on:
   - Which package you're modifying (e.g., `cli/`, `docs-site/`)
   - What type of work (backend, frontend, unit-test, docs, etc.)

3. **Read the spec index** for each relevant module:
   ```bash
   cat .trellis/spec/<package>/<layer>/index.md
   ```
   Follow the **"Pre-Development Checklist"** section in the index.

4. **Read the specific guideline files** listed in the Pre-Development Checklist that are relevant to your task. The index is NOT the goal — it points you to the actual guideline files (e.g., `error-handling.md`, `conventions.md`, `mock-strategies.md`). Read those files to understand the coding standards and patterns.

5. **Always read shared guides**:
   ```bash
   cat .trellis/spec/guides/index.md
   ```

6. Understand the coding standards and patterns you need to follow, then proceed with your development plan.

This step is **mandatory** before writing any code.

---

## Packaged pack · auto-bootstrap（无需 trellis init）

这个技能由 `dsh-skill-trellis` 插件全局提供，不依赖项目里预先存在的 `.trellis/`。进入任何工作区时：

1. 先看 `<workspace>/.trellis/` 是否存在。
2. **不存在**时不要停下来让用户手动 `trellis init`，自己按顺序做：
   - `trellis --version` 确认 CLI（冻结版内置 0.6.17）；
   - 可用则在工作区根执行 `trellis init --platform dsh`；
   - 不可用则把插件内置骨架 `<assetRoot>/../_scaffold/` 复制成 `<workspace>/.trellis/`；
   - 读 `.trellis/spec/index.md` 后继续本技能流程。
3. **已存在**时只增量更新，绝不覆盖。