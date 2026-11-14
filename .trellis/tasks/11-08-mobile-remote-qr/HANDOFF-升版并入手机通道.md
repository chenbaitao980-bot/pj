# HANDOFF · 把「手机通道」并入冻结版（0.2.6-rc.1）

> 来自会话：`11-08-mobile-remote-qr`（手机↔主机远程连接）
> 目标会话：`创建MCP对话颜色区分插件`（正在跑 0.2.5-rc.1 升版构建: PID 38180，7z PID 22392）
> 结论：**不要抢 0.2.5-rc.1 打包**。等它出包后，按下文合成 0.2.6-rc.1。

## 为什么 0.2.5-rc.1 里没有手机通道

实测（2026-11-08 13:48）：

- `D:\dsh-freeze-new\payload\dsh-home\profiles\desktop\package.json` 的 `dependencies` 与 `dsh.profile.bundles` **都没有 `dsh-mobile`**
- payload 内**不存在** `dsh-mobile` 目录（`Get-ChildItem -Recurse -Directory -Filter dsh-mobile` 为空）
- payload 根目录只有 `Install-MobilePlugin.ps1`（11-07 22:40），是"装完再手动跑"的一次性脚本
- `mobile/*.apk`、`mobile/*.tgz` 被 `.gitignore` 忽略 → 只在本地磁盘，不进仓库也不进安装包

## 本会话产出的资产（都要并进冻结版）

| 资产 | 位置 | 说明 |
|---|---|---|
| dsh-mobile 插件包 | `E:\claude\project4\pj\mobile\dsh-mobile-0.8.4.tgz`（28,203,006 B） | SHA256 `BF151441687C96EF37A3405DBF6D8BBDA20ECBC7240958FF453995D1F71BF749` |
| 官方 Android App | `E:\claude\project4\pj\mobile\dsh-mobile-android-v0.7.2.apk`（2,342,281 B） | SHA256 `22FFD92C9F245BD521724399CDB08B0A81D5BA542D177F2E4BF619936C9F7B14`；`android-v0.7.2` 是**唯一**能与 dsh-mobile 配对的客户端 |
| 第三方便携 APK（可选，保留） | `mobile\DSH-Remote-v2.5.1.apk` + `.sha256` | 协议不同（dex 内无 `mobile-access`/`dsh1.`/`instance=`），**不能**连 dsh-mobile 网关；仅作记录 |
| 安装脚本 | `frozen-build-src\Install-MobilePlugin.ps1` | 需同步进 payload 根目录 |

## 合成方式（推荐 A：真正离线可用）

### A. 内置进 profile（推荐，符合 FROZEN-BUILD.json 里 "新机器无需联网装插件" 的口径）

1. 在 payload 里落地插件与依赖：
   - 把 `dsh-mobile-0.8.4.tgz` 解开后放到
     `payload\dsh-home\plugins\dsh-mobile\`
   - 其运行期依赖（`qrcode` / `ws` / `selfsigned` / `zod` / `@noble/hashes` / `bonjour-service` / `eventsource-parser` / `web-push`）装进
     `payload\dsh-home\profiles\desktop\node_modules\`
     （参考本机现成的 `~\.dsh\profiles\desktop\node_modules\dsh-mobile`）
2. `payload\dsh-home\profiles\desktop\package.json` 两处都加：

```jsonc
"dependencies": {
  // …保持现有…
  "dsh-mobile": "file:../../plugins/dsh-mobile"
},
"dsh": { "profile": { "bundles": [
  // …保持现有…
  "dsh-mobile"
] } }
```

3. 同步 `payload\dsh-home\profiles\desktop\node_modules\.modules.yaml` / `.pnpm-workspace-state-v1.json`
   （install.ps1 已有重写逻辑，但新增包要先在打包机上 pnpm 装一次，避免运行时缺依赖）
4. 组件清单 `payload\FROZEN-BUILD.json` 的 `components` 增加一条：
   `"dshMobile": "0.8.4（LAN/Funnel/cpolar/cloudflared 通道 + 官方 App 0.7.2）"`

### B. 只随包登记（改动小，但装完要联网跑脚本）

- payload 根加 `mobile\` 目录：tgz + 官方 APK + `manifest.json`
- 保留 `Install-MobilePlugin.ps1`，在 README-冻结版.md 里写明"手机通道需 `-Apply` 安装"
- 缺点：新机器必须联网 + 有 pnpm store，违背离线承诺

## 必须同步的清单

- [ ] `mobile\manifest.json`：补官方 App 条目
      `{ role: "mobile-client", name: "dsh-mobile Android", tag: "android-v0.7.2",
         asset: "dsh-mobile-android-v0.7.2.apk", sizeBytes: 2342281, sha256: "22FFD92C…9F7B14",
         sourceUrl: "https://github.com/saya-ch/dsh-mobile/releases/download/android-v0.7.2/dsh-mobile-android-v0.7.2.apk" }`
- [ ] `mobile\manifest.json` 里 `DSH-Remote` 那条加注："协议不兼容 dsh-mobile 配对，仅作第三方客户端备选"
- [ ] `.gitignore`：`mobile/*.apk`、`mobile/*.tgz` 维持忽略；但若要随包，必须复制进 `payload\`，否则打包机换人就丢
- [ ] `README-冻结版.md` / `README-冻结版安装包.md`：补"手机访问"章节（下面这段可直接用）

## 升级到 0.2.6-rc.1 后必须回归的点（本机实测过的证据）

1. **装完 0.2.5/0.2.6 会静默丢掉手机通道**：`install.ps1:166` 是 `robocopy $homeTemplate $HomeDir /E`（无 `/PURGE`），会覆盖 `~\.dsh\profiles\desktop\package.json`，模板里没有 `dsh-mobile` → bundle 不加载。
   - 不会删 `node_modules\dsh-mobile`，也不会删 `~\.dsh\mobile-access\`（Tailscale 节点身份 `dsh-9f85eaa2a037`、配对设备、setup.json 都还在）
   - 旧配置自动备份到 `~\.dsh-frozen-backup-<stamp>`（含 package.json / cordis.patch.yml / credentials / prompt-inject.md）
2. **修法**：装完重跑 `Install-MobilePlugin.ps1 -Apply`，或让模板 profile 自带（方案 A）。
3. **永久地址不可打包**：`~\.dsh\mobile-access\` 属于机器身份（Tailscale tsnet 节点 + LAN 私有 CA），**不要**打进 payload，否则多台机器互相顶号。

## 已验证的端到端事实（可作验收基线）

- 固定地址：`https://dsh-9f85eaa2a037.tailbb8dfc.ts.net`（Tailscale Funnel，严格 TLS 校验通过，证书 CN 与域名一致）
- 网关：`GET /` → 401（未配对）；`POST /mobile-access/auth/pair` → 201 + 设备令牌；带 cookie `GET /` → 200
- 配对入口只有两个：`/mobile-access/auth/pair`（浏览器，43 位码）、`/mobile-access/auth/native-pair`（官方 App）
- `pairingTtlMs` 默认 120000（2 分钟），上限 600000；窗口关闭时 `/mobile-access/pair` 直接 404
- 局域网：`192.168.1.18:3443`，私有 CA `CN=DeepSeek Harness Mobile CA`，leaf SAN 仅 IP，官方 App 钉住该 CA
