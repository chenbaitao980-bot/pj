// dsh-codex-cua — cordis adapter.
//
// Mounts mcp/server.mjs through the in-box @deepseek-ai/dsh-mcp-client bridge.
// Tool names surface to the model as mcp__<serverName>__<tool>, e.g. mcp__cua__list_windows.
import { fileURLToPath } from 'node:url';

export const name = 'codex-cua';
export const inject = ['tools'];

export function bridgeConfig(config = {}) {
  const serverPath = fileURLToPath(new URL('../mcp/server.mjs', import.meta.url));
  const env = { ELECTRON_RUN_AS_NODE: '1' };
  if (config.codexCli) env.CUA_CODEX_CLI = String(config.codexCli);
  if (config.approval) env.CUA_APPROVAL = String(config.approval);
  if (config.requestTimeoutMs) env.CUA_REQUEST_TIMEOUT_MS = String(config.requestTimeoutMs);
  if (config.maxTextChars) env.CUA_MAX_TEXT_CHARS = String(config.maxTextChars);
  return {
    serverName: config.serverName || 'cua',
    transport: 'stdio',
    command: process.execPath,
    args: [serverPath],
    env,
    cwd: '',
    toolCallTimeoutMs: Number(config.toolCallTimeoutMs) || 120000,
    failOnStartupError: config.failOnStartupError === true,
  };
}

export async function apply(ctx, config = {}) {
  const bridge = await import('@deepseek-ai/dsh-mcp-client');
  const connection = ctx.plugin(bridge, bridgeConfig(config));
  await connection;
}
