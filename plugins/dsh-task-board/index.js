/**
 * Host half of `@local/dsh-task-board`.
 *
 * The feature is browser-only: the client half owns the composer task dock.
 * This entry exists because a profile bundle resolves its Host module first.
 */
export const name = 'dsh-task-board'

export function apply() {}
