# brainstorm: mobile 手机↔主机远程连接（扫码即连）

## Goal

让手机在**离开主机所在局域网**时也能连上这台 DSH（远程会话 / 同一实例、同一套插件），并把入口收敛成「扫一次二维码就完成配对与连接」。同时修掉当前局域网通道的 `HTTPS 证书校验失败`——它不是网络不通，而是证书信任链与客户端协议不匹配。

## What I already know（实测证据，非推测）

### 运行态

- 插件 `dsh-mobile@0.8.4` 已装进 profile：`C:\Users\Administrator\.dsh\profiles\desktop\package.json` 的 `dsh.profile.bundles` 含 `dsh-mobile`。
- 局域网已开：`~/.dsh/mobile-access/control.json` → `{"version":1,"enabled":true}`。
- 配置：`~/.dsh/mobile-access/setup.json`
  - `networkInterface = WLAN`，`listenPort = 3443`，`upstreamOrigin = http://127.0.0.1:51174`
  - `tls.mode = managed`（插件自签私有 CA）
- 网关真的在听：`192.168.1.18:3443`（`Test-NetConnection 192.168.1.18:3443 → True`），`127.0.0.1:3443 → False`（只绑 LAN 地址，正常）。
- 手机确实连到过：`netstat` 显示 `192.168.1.16:xxxxx → 192.168.1.18:3443` 多条 `TIME_WAIT`。**TCP 通了，握手被 App 拒。**

### 证书

| 项 | 值 |
|---|---|
| leaf Subject | `CN=DeepSeek Harness Mobile` |
| leaf SAN | `IP Address=192.168.1.18`（无 DNS 名） |
| leaf 有效期 | 到 2027-10-12 |
| CA Subject | `CN=DeepSeek Harness Mobile CA` |
| CA 有效期 | 到 2031-11-08 |
| 文件 | `~/.dsh/mobile-access/tls/{ca.pem,ca-key.pem,server-cert.pem,server-key.pem,dsh-mobile-ca.cer}` |

### 配对协议（从 `lib/index.mjs:9131-9148` 读出）

- 局域网二维码内容 = `https://<origin>/mobile-access/pair#instance=<CA指纹>&token=<一次性 token>`
- App 侧密钥形式 = `dsh1.<instanceId>.<token>`；`dsh2.` 前缀仅用于自签 FRP 远程 CA。
- 官方文档明确：「Android App **固定局域网私有 CA**」「配对二维码含短期配对信息，不含长期设备 Token 或 CA」。
- App 只把 `.ts.net`、cpolar、`.trycloudflare.com` 这类平台后缀当「远程」，**远程二维码必须先进 App 的「远程访问」入口再扫**，在「局域网」界面扫会被判 `无效二维码`。

### 客户端不匹配（关键）

- 官方伴生 App：`dsh-mobile` v0.7.2，`android-v0.7.2`，`dsh-mobile-android-v0.7.2.apk`（2.2 MB）/ `...-iroh.apk`（29.1 MB）。
- 实际装的：`mobile\DSH-Remote-v2.5.1.apk`（Hyna-hla/harness-remote，68 MB，Kotlin + okhttp + WebView）。
- 对 APK 内 11 个 dex 做字节扫描：`mobile-access/pair`、`dsh1.`、`dsh2.`、`instance=`、`caFingerprint` **命中 0 次**；`信任自签名`、`trustAll`、`X509TrustManager` 命中。→ 它是另一套协议，只会做「TLS 是否信任」的判断，**根本不解 dsh-mobile 的配对密钥**。所以「开信任自签名」最多让它过 TLS，配对/路由仍然过不去。

### 远程通道现状

- `remote/provider.json` = `cloudflared`（已选），`components\` 下**只有** `cpolar\3.3.18\cpolar.exe` → cloudflared 组件未安装。
- `remote/origin/control.json` → `enabled:false`。远程入口当前是关的。
- 出口连通性：`github:443 ✔`、`trycloudflare:443 ✔`、`cpolar:443 ✔`；无 `*_proxy` 环境变量（本机 `127.0.0.1:7897` 有本地代理在听）。

## 远程通道能力矩阵（插件 0.8.4 内置）

| 通道 | 前置 | 公网地址 | 扫码方式 | 主要代价 |
|---|---|---|---|---|
| cpolar | 已装 3.3.18，需 cpolar 账号 Authtoken | `*.cpolar.cn` 随机 | 远程二维码 | 免费 1 Mbps，地址重启可能变 |
| cloudflared 快速隧道 | 需装组件；**免账号** | `*.trycloudflare.com` 每次随机 | 远程二维码 | 不支持 SSE（完成提醒/在线撤销变轮询），重启换址 |
| cloudflared 命名隧道 | 组件 + Cloudflare 账号 + 自有域名 | 固定 `dsh.你的域名` | 远程二维码 | 需域名与 NS 在 CF |
| Tailscale Funnel | 内置组件 + Tailscale 登录 | 固定 `*.ts.net` | 远程二维码 | 国内常需代理，有限速 |
| iroh（实验） | 组件 + **完整版 App** | 无域名，P2P/NAT 中继 | iroh 专用二维码 | 实验特性，需 29.1 MB 完整版 App |
| 自建 FRP / 自有反代 | VPS + 域名/证书 | 自定 | 远程二维码 | 要维护服务端，自签入口需 `dsh2.` 固定 CA |

## 诊断结论（2026-11-08 12:35–12:45 实测，已闭环验证）

1. 用户选定 **cpolar**（`remote/provider.json` → `cpolar`，`remote/cpolar/control.json` → `enabled:true`）；`cpolar.exe` PID 32464 运行中，与 cpolar 边缘 `120.53.2.10:4443`、`47.242.81.181:4443` 两条 ESTABLISHED。
2. 公网入口：`https://24f17ab2.r31.cpolar.top` → `/` 返回 `401 {"error":"authentication_failed"}`；**严格 TLS 校验通过**（Python `ssl.create_default_context()` 不关校验也不报错）→ 证书链系统信任，远程通道本身是好的。
3. 手机报错分层：
   - 第一次 `HTTPS 证书校验失败` = 第三方 App 不认 LAN 私有 CA（见上文客户端不匹配）。
   - 第二次 `前置网关鉴权失败（401/403）` = 请求打到 `/` 且 `sessionCookie:false`（日志 `auth failure {... "path":"/" ...}`），即**未配对设备**。
4. 网关的配对入口（`lib/index.mjs:7254-7276`）：`POST /mobile-access/auth/pair`（浏览器，43 位 token）、`POST /mobile-access/auth/native-pair`（官方 App）。**第三方 App 走的是 `/` 直连，没有这两条端点**。
5. `pair` 页在配对窗口关闭时返回 404（`:7227` `if (!pairingStatus().open) throw 404`）——这也是「扫了还报错」的一个诱因：二维码过期后页面本身就是 404。
6. 配对窗口 TTL 约 3–5 分钟（`expiresAt` 实测）。
7. **E2E 验证已通过**：`POST /api/mobile-access/remote/pairing/open` → 201 拿到 token → `POST https://24f17ab2.r31.cpolar.top/mobile-access/auth/pair` → `201 {"paired":true,"deviceId":...}` + 6 个 cookie（`dsh_ma_session`/`dsh_ma_csrf`/`__Host-*`/`dsh_ma_device`）→ 用该 cookie `GET /` → **200 + 真实 DSH 外壳 HTML**。测试设备已 `devices/revoke` 撤销，`deviceCount` 已回到 0。
8. cloudflared 组件安装**失败**：日志 `04:28:26 install started` → `04:33:26 install failed: AbortError`（`index.mjs:13909` 超时），`components/` 下只有 cpolar → cloudflared 快速/命名隧道当前不可用。
9. 官方伴生 App 已下载落到 `mobile/dsh-mobile-android-v0.7.2.apk`（2,342,281 B，sha256 `22FFD92C9F245BD521724399CDB08B0A81D5BA542D177F2E4BF619936C9F7B14`）。

## Open Questions（Blocking / Preference）

- **Q1（Preference）**：远程通道选哪条？（cpolar / cloudflared 快速隧道 / Tailscale Funnel / iroh / 自建）

## Requirements（evolving）

- R1 局域网通道恢复可用（证书信任链闭合，不再报 `HTTPS 证书校验失败`）。
- R2 手机在非同一局域网下可连接同一台 DSH 实例（会话、工作区、插件一致）。
- R3 连接建立路径为「扫一次二维码」即可完成，不要求手机上手工输地址/端口/密钥。
- R4 远程入口证书必须是系统信任的（不能用「跳过校验」换连通）。

## Acceptance Criteria（evolving）

- [ ] 手机在蜂窝网络（关 Wi-Fi）下扫远程二维码，App 进入会话列表并可与桌面同一会话对话。
- [ ] 冷启动 DSH 后远程通道自动/一键恢复，App 用已存凭据自动重连（无需重复扫码，固定地址通道）。
- [ ] 局域网通道恢复：手机连同一 Wi-Fi 扫码后能打开会话，无证书告警。
- [ ] 电脑端「移动访问 → 设备」里能看到该手机的两条授权并可撤销。

## Definition of Done

- 通道配置持久化在 `~/.dsh/mobile-access/`，重启 DSH 后仍生效。
- 不引入开机自启 / 系统服务 / PATH 改动（与插件既有约定一致）。
- 记录一份「扫码→连通」的可复现步骤到 `.trellis/workspace`。

## Expected Results（预期结果清单，Step 7.5 硬门禁，待补实测数字）

- [ ] 局域网：`curl -k https://192.168.1.18:3443/mobile-access/pair` 返回配对页（当前待测）；手机扫码后 `dsh-mobile.log` 出现配对成功事件。
- [ ] 远程：`curl -I https://<公网地址>` 返回 200 且证书链可被系统校验（`SSL verify: OK`）。
- [ ] 延迟：远程首屏可交互 < 8 s（cpolar 免费 / 快速隧道按实测记录基线）。

## Out of Scope（explicit）

- 不改 dsh-mobile 插件源码（除非确认必须）。
- 不做公网暴露 DSH 本体端口（必须走插件网关 + 设备配对）。
- 不做自建 FRP/Caddy 的 VPS 侧部署（除非 Q1 选它）。

## Technical Notes

- 关键代码位置：`~/.dsh/profiles/desktop/node_modules/dsh-mobile/lib/index.mjs`
  - `:9131-9148` 配对二维码与 `dsh1./dsh2.` 密钥构造
  - `:1115` `tls.mode must be provided or disabled`（说明 `disabled` 是合法取值）
  - `:13674` cloudflared 组件下载；`:18825` 托管 Caddy
  - `:19847` `ANDROID_RELEASE_DESCRIPTOR_URL`，`:19962` APK 下载 URL 模板
- 文档：`docs/CLOUDFLARE_TUNNEL.md`、`docs/CPOLAR_SUBDOMAIN.md`、`docs/TRUSTED_NETWORKS.md`、`docs/CONNECTION_DIAGNOSTICS.md`、`docs/IROH.md`、`docs/SELF_HOSTED_ORIGIN.md`
- 本机网络：WLAN `192.168.1.18/24`，手机 `192.168.1.16`；另有 `以太网 192.168.190.210/24`、`以太网 2 192.168.56.1/24`（VirtualBox host-only）。
