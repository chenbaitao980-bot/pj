# Trellis 全局骨架（打包回落）

这个目录是 `dsh-skill-trellis` 插件内置的最小 `.trellis` 骨架。当工作区还没有 `.trellis/` 时，用它作为起点，**不要**停下来让用户自己跑 `trellis init`。

## 交给模型的步骤

1. 先确认 CLI 是否可用：`trellis --version`（冻结版内置 0.6.17，通常在 PATH 上）。
2. 若 CLI 可用，直接在工作区根执行 `trellis init --platform dsh`；交互提示默认接受。
3. 若 CLI 不可用，把本目录整体复制到 `<workspace>/.trellis/`，然后继续。
4. 建好后读 `.trellis/spec/index.md` 与 `.trellis/spec/*.md`，再按当前任务进入 `trellis-start` 流程。
5. 把这次初始化写进任务记录，后续会话直接复用，不重复初始化。

## 目录约定

```
.trellis/
  spec/
    index.md          规范索引：每个包/层一条，指向具体 spec 文件
    <package>.md      该包的可执行约定（命名、分层、测试、错误处理）
  tasks/
    <task-slug>/
      prd.md          需求与验收
      plan.md         实现计划与阶段
      notes.md        决策记录、踩坑、证据
  journal.md          跨会话进度流水
```

## 约束

- spec 是**可执行约定**，不是泛泛而谈的原则。每条都要能被检查（函数名、目录、命令、断言）。
- 首次 bootstrap 只写最小可用内容；不要凭空编造与项目无关的规范。
- 已有 `.trellis/` 时**永远不要覆盖**，只增量更新。
