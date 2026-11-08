---
name: trellis-frontend
description: "前端运行时调试循环 — 注入console.log → 启动dev server → 读控制台输出 → 分析根因 → 修复 → 验证 → 循环直到效果符合要求。被 trellis-code/trellis-test 桥接调用，也支持 /trellis-frontend 独立触发。"
trigger: /trellis-frontend
---

# trellis-frontend — 前端运行时调试循环

## 核心理念

lint/type/test 过了不代表 Bug 真的修好了。前端代码必须在**浏览器里真正跑一遍**，通过运行时日志验证修复是否生效。

本技能让 AI 自己完成：注入 console.log → 启动 dev server → 触发代码路径 → 读控制台输出 → 分析根因 → 修复 → 再验证，循环直到效果符合要求。

## 强制规则

1. **最多 5 轮调试循环**，超过即终止并输出剩余问题
2. **每轮开始前必须清理上一轮的调试日志**，不叠加
3. **最终必须移除所有调试日志**，不留脏代码
4. **每轮结束后必须判断是否达到预期效果**，达到则提前退出
5. **所有 dev server 用完必须关掉**（`preview_stop`），不残留

## 入口

### 被桥接调用（来自 trellis-code / trellis-test）

从调用者上下文/产物获取信息：

| 来源 | 说明 |
|------|------|
| `git diff` | 对比当前变更，理解改了哪些文件、什么逻辑 |
| 对话上下文 | 知道本次要验证的目标是什么 |
| `$CODE_DIR/.change_goal` | 如果 trellis-code 桥接，读取变更目标 |

### 独立调用（`/trellis-frontend`）

从用户输入获取要验证的目标 + 变更文件清单。

---

## 调试循环（每轮）

```
┌─ Step 1: 分析变更 + 确定验证策略
│   Step 2: 注入调试日志
│   Step 3: preview_start 启动 dev server
│   Step 4: 触发代码路径（导航/点击/提交）
│   Step 5: preview_console_logs 读控制台输出
│   Step 6: 分析判断
│   ├─ ✅ 符合要求 → 进入 Step 8 清理
│   ├─ ❌ 有问题 → Step 7 修复 → 回到 Step 2
│   └─ ❓ 不确定 → 补充日志 → 回到 Step 3
│   Step 7: 修复代码
│   Step 8: 清理调试日志
└─ Step 9: 停止 dev server + 输出结果
```

---

### Step 1: 分析变更 + 确定验证策略

```bash
# 看改了什么
git diff
# 看变更目标（有 trellis-code 上下文时）
cat $CODE_DIR/.change_goal 2>/dev/null || echo "（无 trellis-code 上下文）"
```

确定验证方式（选一种或多种）：

| 方式 | 适用场景 | 做法 |
|------|---------|------|
| 页面无报错 | 通用兜底 | 启动页面后检查 `preview_console_logs` 有无 error |
| 特定操作验证 | 交互类 Bug | `preview_eval` 执行点击/提交/导航，检查结果 |
| 值验证 | 数据/计算类修改 | `preview_eval` 读取变量/函数返回值 |
| 视觉验证 | 样式/渲染类修改 | `preview_screenshot` 截图确认 |

---

### Step 2: 注入调试日志

在修改的关键路径插入结构化 console.log：

```typescript
// 函数入口：确认被调用
console.log('[debug] handleSubmit called, values:', values);

// 条件分支：看清走了哪条路
console.log('[debug] validation branch:', isValid ? 'valid' : 'invalid');

// API/异步：确认结果
console.log('[debug] API response:', data);

// 错误：保留原始 error 信息
console.error('[debug] catch error:', error.message);
```

要求：
- 每条日志加 `[debug]` 前缀，方便后续 grep 清理
- 输出关键变量值，不输出整个大对象（避免控制台被刷爆）
- 只在**修改涉及的函数/路径**插入，不全局加

---

### Step 3: 启动 dev server

```bash
preview_start(name="dev")
```

如果 server 已启动，先 `preview_stop` 再重新启动。

等待 dev server 就绪（`preview_logs` 检查无报错）。

---

### Step 4: 触发代码路径

根据 Step 1 确定的策略执行：

**方式 A — 页面加载检查：**
```bash
preview_snapshot
# 确认页面正常渲染，无白屏
```

**方式 B — 特定操作触发：**
```bash
preview_eval(expression="window.location.href = '/target-page'")
# 等待页面加载
preview_eval(expression="document.querySelector('.submit-btn').click()")
```

**方式 C — 值读取：**
```bash
preview_eval(expression="window.__INITIAL_STATE__")
# 或
preview_eval(expression="document.getElementById('result').textContent")
```

---

### Step 5: 读取控制台输出

```bash
preview_console_logs(level="all")
```

重点关注：
1. 自定义 `[debug]` 日志是否有预期值
2. 有无 `console.error` / 异常堆栈
3. 有无网络请求失败（结合 `preview_network`）

---

### Step 6: 分析判断

对照变更目标判断：

```
✅ 效果符合要求：
  - 预期行为出现（点击后正确响应、数据正确渲染等）
  - 无新增 console.error
  - 无未捕获异常
  → 进入 Step 8 清理

❌ 有问题：
  - 有 console.error / 异常
  - 页面白屏 / 不响应
  - 行为不符合预期
  → 进入 Step 7 修复

❓ 不确定：
  - 日志不足，无法定位
  → 补充调试日志，回到 Step 3
```

---

### Step 7: 修复代码

1. **清理本轮调试日志**（grep 删除含 `[debug]` 的行）
2. **基于日志分析根因**：
   - 控制台错误指向哪个文件/行？
   - 变量值是否符合预期？不符合的话差在哪？
   - 走了错误的分支？为什么走错？
3. **修复问题**（调逻辑、改条件、加判空等）
4. `round++`，回到 Step 2

---

### Step 8: 清理调试日志

```bash
# 确认无残留调试日志
grep -rn "console\.log.*\[debug\]" --include="*.{js,jsx,ts,tsx,vue}" . 2>/dev/null
grep -rn "console\.error.*\[debug\]" --include="*.{js,jsx,ts,tsx,vue}" . 2>/dev/null
```

如有残留 → 删除。清理干净才允许退出。

---

### Step 9: 停止 dev server + 输出结果

```bash
preview_stop(serverId="dev")
```

输出结果：

```
## trellis-frontend 运行时验证结果

### 验证目标
<从上下文读取>

### 调试循环
总轮次: N
达到效果: ✅/❌

### 问题汇总
<如有残留问题，逐条列出>

### 处理的动作
- 注入调试日志: <文件:行>
- 修复: <文件:行>
- 最终清理: ✅/❌
```

---

## 失败处理

| 场景 | 处理 |
|------|------|
| dev server 启动失败 | 尝试 2 次，仍失败则终止并报告 |
| 超过 5 轮调试循环 | 终止，输出当前症状和未解决的问题 |
| 控制台无任何输出 | 确认触发路径是否正确，补充更多日志 |
| preview_console_logs 不可用 | 降级到 preview_eval 检查页面状态 |
| 浏览器工具全部不可用 | 输出「运行时验证跳过（浏览器工具不可用）」 |

---

## 被桥接时的行为约定

本技能被 trellis-code / trellis-test 桥接时：

1. **不替代原有流程** — 仅做运行时验证，验证结果不影响已通过的质量门禁
2. **所有修改在技能内部完成** — 包括注入日志、修复代码、清理日志
3. **返回后** — 调用者继续原有流程（报告生成、产物清理等）
4. **验证结果记入调用者的变更报告**

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