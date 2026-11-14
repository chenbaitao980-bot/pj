/**
 * Host half of `@local/dsh-plugin-slash`.
 *
 * The feature is browser-only: the client half registers a `/` trigger source
 * that lists enabled plugins. The Host entry exists because a profile bundle
 * resolves its Host module first; it registers nothing.
 */
export const name = 'dsh-plugin-slash'

export function apply() {}
