/**
 * dsh-workflow-lite — 渲染期的兜底：一块界面在 render 里抛错，只让它自己变成一张崩溃卡。
 *
 * 为什么要这一层：宿主把插件的 tab 直接渲染进整页，**没有为插件包错误边界**。这个视图里任何一次
 * render 抛错都会顺到整棵 React 树，把整个 DSH 页面炸成白屏——可图和数据都在磁盘上好好的，只是界面没了。
 * 有了它，最坏也只是崩的那一块换成一张能重试的卡，顶栏和别的面板照常用。
 *
 * **本仓库其余界面都是函数组件，这里是唯一的类组件**：React 至今没有函数式的错误边界 API
 * （`getDerivedStateFromError` / `componentDidCatch` 只能在类上实现），不是没同步过来的历史遗留。
 *
 * 只管 **render 期间**抛出的错：事件回调、`async`、`setTimeout` 里抛的它接不到（React 的规矩）。
 * 那类路径本来就各自有失败降级（保存失败走顶栏的状态与冲突横幅，RPC 失败走 `useWorkflow` 的 `fail()`
 * 弹提示，实例存盘失败在 `useRun` 里 `flash`），所以这里只补界面这一层，不给每个回调套 try/catch。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/ErrorBoundary
 */

import { Component, type ErrorInfo, Fragment, type ReactNode } from 'react'
import type { T } from '../i18n.ts'
import css from './error.module.css'

export interface ErrorBoundaryProps {
  /** 只用作 console 里的定位前缀（崩的是哪一块），不显示给用户。 */
  label?: string
  /**
   * 崩溃卡占多大一块。
   * - `fill`（默认）：盖满调用方给它的定位盒——画布层、右栏、步骤库都是 `position: absolute` 的一格。
   * - `view`：整张视图那一层，崩溃卡自己当占位（和视图根一样撑满、参与外层 flex）。
   * - `bar`：顶栏那一格（`.top` 是浮在画布上的横向条），只出一根横条，不遮住下面的画布。
   */
  variant?: 'fill' | 'view' | 'bar'
  /** 崩溃卡的文案取词。边界是类组件，拿不到槽位 props，由外层递进来。 */
  t: T
  children: ReactNode
}

interface State {
  /** 崩过一次：是就显示崩溃卡。错误对象只进 console，不进这里，也不渲染给用户。 */
  failed: boolean
  /** 第几轮重试：点一次加一，同时当子树重挂用的 key。 */
  round: number
}

/** 崩溃卡要用到的三个键；词典那一层本身也出问题时的原文（与 i18n 的 `en` 同句）。 */
const FALLBACK = {
  'shell.crashed': 'The workflow view hit a problem',
  'shell.crashedHint':
    'Your graphs and data are safe on disk. Retry this view, or switch to another tab and back.',
  'shell.retry': 'Retry',
} as const

/**
 * 一块界面的崩溃边界。
 *
 * **`children` 变了不会自动清掉崩溃态**（所以这里没有 `getDerivedStateFromProps`）：不然抛错的那块
 * 只要稳定渲染出别的元素，下一次渲染就把卡换回去、再下一次又抛错，界面来回闪。只有点「重试」才清。
 *
 * **重试是换个 key 把这棵子树重挂一遍，不去「恢复」上一次的状态**：状态归外层持有，边界不该动别人的
 * 状态；重挂之后这一块自己读的钩子会重新拉一遍，最简单可靠。代价是这一块的本地界面状态（滚动位置、
 * 开合）回到初始样子。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { failed: false, round: 0 }
  }

  static getDerivedStateFromError(): Pick<State, 'failed'> {
    // 只记「崩了」这件事。轮数在点击处加，这里不碰，免得打断正在放的重挂。
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 原始堆栈只进 console 供排查；崩溃卡上不显示堆栈（对用户没用，也不该外露）。
    console.error(
      `[workflow-lite] ${this.props.label ?? 'view'} 渲染出错`,
      error,
      info.componentStack,
    )
  }

  private retry = (): void => {
    // key 一变，React 就把旧的整棵卸掉再挂新的：等于重新读取、重新布局。
    this.setState((previous) => ({ failed: false, round: previous.round + 1 }))
  }

  /** 取文案；词典那一层要是也坏了就退回内置原文——崩溃卡不能因为取文案再抛一次。 */
  private say(key: keyof typeof FALLBACK): string {
    try {
      return this.props.t(key)
    } catch {
      return FALLBACK[key]
    }
  }

  render(): ReactNode {
    const { failed, round } = this.state
    if (failed) {
      // 只用本模块的类名与兜底色：不复用可能正是崩溃源的组件，也不依赖别人的渲染时序。
      const variant = this.props.variant ?? 'fill'
      return (
        <div
          className={variant === 'view' ? css.view : variant === 'bar' ? css.bar : css.fill}
          role="alert"
          data-testid="wl-crashed"
        >
          {variant === 'bar' ? (
            <>
              <h2 className={css.barTitle}>{this.say('shell.crashed')}</h2>
              <p className={css.barHint}>{this.say('shell.crashedHint')}</p>
              <button type="button" className={css.barRetry} onClick={this.retry}>
                {this.say('shell.retry')}
              </button>
            </>
          ) : (
            <div className={css.card}>
              <h2 className={css.title}>{this.say('shell.crashed')}</h2>
              <p className={css.body}>{this.say('shell.crashedHint')}</p>
              <button type="button" className={css.retry} onClick={this.retry}>
                {this.say('shell.retry')}
              </button>
            </div>
          )}
        </div>
      )
    }
    // 带 key 的 Fragment：DOM 上不加任何盒子（各块面板的绝对定位照旧按所在的那一格算），
    // key 一变就等于把这棵子树整个重挂。
    return <Fragment key={round}>{this.props.children}</Fragment>
  }
}
