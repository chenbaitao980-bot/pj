# dsh-plugin-scope

按**工作区**开关插件（trellis / gitnexus / codegraph），补上插件页只支持「全局启用/停用」的缺口。

## 命令

```
/pluginscope                                      查看本工作区配置
/pluginscope status                               同上
/pluginscope trellis off                          本工作区关掉 trellis（不注入、不自动 init）
/pluginscope trellis on                           本工作区打开
/pluginscope gitnexus autoinit-off                仍注入用法约束，但不后台建索引
/pluginscope codegraph on
/pluginscope all off                              写 "*": {"enabled": false}
/pluginscope reset                                清空工作区配置，回到 profile 全局
```

写入位置：`<工作区>/.dsh/plugins.json`（JSON，无 BOM，原子写）。

## 优先级

1. `<工作区>/.dsh/plugins.json`（本插件写的）
2. profile 的 `workspaces:` 路径前缀映射
3. profile 全局 `config.enabled` / `config.autoInit`

`config.enabled: false` 仍是总开关——插件根本不注册监听；工作区配置只能在总开关之内做更细的开关。

## 生效时机

下一次进入该工作区的会话开始时生效（已注入过的会话按注入时的状态）。

## 为什么不是 UI 开关（当前版本）

官方插件页的红框处没有贡献插槽，可用的只有 `plugins.tab` / `plugins.item` / `plugins.detail.actions`；
写入侧官方 `workspaceFiles` Remote 是只读的，要自己产出 `TYPERT_REMOTE` 生成物才能加可写 Remote。
在补上客户端面板之前，这个命令是唯一的工作区级开关入口，语义与文件格式都已定稿，面板接上后复用同一份数据。
