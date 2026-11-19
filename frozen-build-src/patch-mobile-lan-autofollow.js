'use strict';
// dsh-mobile 网卡自动跟随补丁（冻结版安装时自动应用，逐补丁幂等）
// 修复 1：setup.json 里写死的 networkInterface 断开时，dsh-mobile 每 2s 抛
//   "saved LAN interface <名称> is not connected" 刷屏，最终拖崩 host（退出码 0xE0000008）。
//   改法：saved 网卡不在网时自动回退到 OS 默认路由当前在网网卡（preferredLanInterfaceNames）。
// 修复 2：中文 Windows 下 preferredLanInterfaceNames 的 PowerShell 输出默认 GBK/OEM，
//   而 execFileText 用 utf8 读 -> 网卡名乱码、按名匹配失败。在命令数组前插 UTF8 前缀。
// 用法：node patch-mobile-lan-autofollow.js "<...>/node_modules/dsh-mobile/lib/index.mjs"
const fs = require('node:fs');
const cp = require('node:child_process');

const arg = process.argv[2];
const targets = arg
  ? [arg]
  : [
      'C:\\Users\\Administrator\\.dsh\\plugins\\dsh-mobile\\lib\\index.mjs',
      'C:\\Users\\Administrator\\.dsh\\profiles\\desktop\\node_modules\\dsh-mobile\\lib\\index.mjs',
    ];

const PATCHES = [
  {
    name: 'add-selectFollowingLanNetwork-helper',
    marker: 'async function selectFollowingLanNetwork(',
    old: '\treturn message.includes("is not connected") || message.includes("no active private LAN address was found") || message.includes("more than one LAN address is active") || message.includes("has more than one private IPv4 address") || message.includes("is not an active private LAN address");\n}',
    new: '\treturn message.includes("is not connected") || message.includes("no active private LAN address was found") || message.includes("more than one LAN address is active") || message.includes("has more than one private IPv4 address") || message.includes("is not an active private LAN address");\n}\n/** Pick the saved LAN when it is up; otherwise follow the OS default-route LAN. */\nasync function selectFollowingLanNetwork(requestedInterface, table, preferredInterfaces) {\n\ttry {\n\t\treturn selectLanNetwork(void 0, requestedInterface, table);\n\t} catch (error) {\n\t\tif (!isNetworkSelectionError(error)) throw error;\n\t\treturn selectLanNetwork(void 0, void 0, table, preferredInterfaces ?? await preferredLanInterfaceNames());\n\t}\n}',
  },
  {
    name: 'materializeManagedSetup-accept-selectedNetwork',
    marker: 'async function materializeManagedSetup(setup, table, selectedNetwork)',
    old: 'async function materializeManagedSetup(setup, table) {\n\tconst network = selectLanNetwork(void 0, setup.networkInterface, table);',
    new: 'async function materializeManagedSetup(setup, table, selectedNetwork) {\n\tconst network = selectedNetwork ?? selectLanNetwork(void 0, setup.networkInterface, table);',
  },
  {
    name: 'runtime-use-following-selection',
    marker: 'await selectFollowingLanNetwork(setup.networkInterface)',
    old: '\t\t\tconst network = selectLanNetwork(void 0, setup.networkInterface);',
    new: '\t\t\tconst network = await selectFollowingLanNetwork(setup.networkInterface);',
  },
  {
    name: 'runtime-pass-selected-network-to-materialize',
    marker: 'materializeManagedSetup(setup, void 0, network)',
    old: '\t\t\t\t\t...await materializeManagedSetup(setup)',
    new: '\t\t\t\t\t...await materializeManagedSetup(setup, void 0, network)',
  },
  {
    name: 'utf8-output-for-preferred-lan-names',
    marker: '$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    old: '\t\t\t\t"$routes = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix \'0.0.0.0/0\' -ErrorAction Stop",',
    new: '\t\t\t\t"$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8",\n\t\t\t\t"$routes = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix \'0.0.0.0/0\' -ErrorAction Stop",',
  },
];

let failed = false;
for (const file of targets) {
  if (!fs.existsSync(file)) { console.log('SKIP (missing): ' + file); continue; }
  let src = fs.readFileSync(file, 'utf8');
  let changed = false;
  for (const p of PATCHES) {
    if (src.includes(p.marker)) { console.log('  SKIP ' + p.name + ' (already applied): ' + file); continue; }
    const count = src.split(p.old).length - 1;
    if (count !== 1) {
      console.error('FAIL ' + file + ' :: ' + p.name + ' :: expected 1 match, got ' + count);
      failed = true;
      break;
    }
    src = src.replace(p.old, p.new);
    changed = true;
    console.log('  APPLY ' + p.name + ': ' + file);
  }
  if (failed) break;
  if (changed) {
    fs.writeFileSync(file, src, 'utf8');
    console.log('WROTE: ' + file);
  }
  try {
    cp.execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log('  node --check OK: ' + file);
  } catch (e) {
    console.error('  node --check FAILED: ' + file + ' :: ' + (e.stderr ? e.stderr.toString() : e.message));
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
