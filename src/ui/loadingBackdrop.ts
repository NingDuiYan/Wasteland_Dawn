/**
 * 加载页：一束从画面外打下来的聚光灯，光柱里挂着生锈铁链与风化木牌，
 * 旁边吊着布条、细绳与铁环，光里漂着灰烬，左下角地面上刻着「活下去」。
 *
 * 为什么进度不画进度条：设计稿要的是"灯慢慢亮起来"本身当反馈 ——
 * 0% 只看得到铁链轮廓，50% 木纹与锈迹浮出来，100% 全细节清晰。
 * 所以这一层只收一个 0..1 的亮度，画面里没有一个可以读秒的控件。
 *
 * 这个文件只管时间轴：进度怎么追、灯怎么呼吸、收尾怎么闪与淡出；
 * 画面里那些东西怎么画在 loadingRig，位图怎么烤在 loadingArt。
 * 动效全挂在同一个 rAF 里（30fps 上限，加载页不该和游戏抢 GPU）。
 * 系统开了"减少动态效果"时只保留亮度变化与淡出，摆动、呼吸、飘落全部停掉。
 */
import { Rng } from '../sim/random'
import { TAU, bakeArtwork, geometry } from './loadingArt'
import { advanceMotes, buildMotes, paintLoadingRig } from './loadingRig'
import type { Artwork, Geo } from './loadingArt'

export interface LoadingScene {
  /** 进度 0..1：灯就亮到这儿，木纹与锈迹随之浮现 */
  setProgress: (progress: number) => void
  /**
   * 至少等到 MIN_LOADING_SEC（从 reset 起算，只在下限意义上）→ 停在最亮 1 秒
   * → 接触不良闪一下 → 淡出；resolve 时画面已经全黑
   */
  complete: () => Promise<void>
  /** 回到最暗：下一次加载从头亮起来 */
  reset: () => void
  destroy: () => void
}

/** 加载页不和游戏抢 GPU */
const FRAME_MIN_MS = 1000 / 30
/** 呼吸周期：设计稿要求约 4 秒，像心跳而不是呼吸机 */
const BREATH_SEC = 4
/** 收尾：停在最亮 1 秒 → 闪 0.42 秒 → 淡出 0.5 秒 */
const HOLD_SEC = 1
const FLICKER_SEC = 0.42
const FADE_SEC = 0.5
/** 亮度追赶进度的时间常数：app.ts 只给三四档，要读成连续变亮 */
const EASE_RATE = 2.6
/** 收尾固定要花的时间：停 1 秒 + 闪 0.42 秒 + 淡出 0.5 秒 */
const FINISH_SEC = HOLD_SEC + FLICKER_SEC + FADE_SEC
/**
 * 加载页最短停留时间（含收尾）。**只当下限用**：灯始终跟着真实加载进度走，
 * 资源多慢灯就多慢，绝不被时间表拖住；只有资源比这更快时才留在这里等满。
 * 于是实际时长 = max(加载耗时, MIN_LOADING_SEC - FINISH_SEC) + FINISH_SEC，
 * 快机器正好 MIN_LOADING_SEC，慢机器就是加载耗时 + 收尾，一秒不多等。
 */
const MIN_LOADING_SEC = 5
/** 收尾最早能开始的时间点（分钟表里前面的部分留给真实进度） */
const MIN_BEFORE_FINISH_SEC = MIN_LOADING_SEC - FINISH_SEC

/** 灯泡接触不良的九次抽动：不规律才像故障，均匀闪会读成"加载中"的节拍 */
const FLICKER_KEYS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.09, 0.18],
  [0.17, 0.92],
  [0.29, 0.3],
  [0.4, 1],
  [0.55, 0.12],
  [0.68, 0.74],
  [0.82, 0.24],
  [1, 0.06],
]

function flickerAt(t: number): number {
  for (let i = 1; i < FLICKER_KEYS.length; i += 1) {
    const [t1, v1] = FLICKER_KEYS[i]
    if (t > t1) continue
    const [t0, v0] = FLICKER_KEYS[i - 1]
    return v0 + (v1 - v0) * ((t - t0) / (t1 - t0))
  }
  return 0
}

type Stage = 'idle' | 'hold' | 'flicker' | 'fade'

interface SceneState {
  geo: Geo
  art: Artwork
  dpr: number
  /** app.ts 给的进度 */
  target: number
  /** 画面上真在用的进度：追着 target 走，三档进度也能读成连续变亮 */
  shown: number
  clock: number
  /** 从 reset 起走过的秒数：灯的爬升按它走，与资源加载得多快无关 */
  elapsed: number
  /** 收尾时压黑的量 */
  black: number
  stage: Stage
  stageT: number
  rafId: number
  lastMs: number
  settle: (() => void) | null
}

/** 把加载页挂到画布上；返回的句柄由 Screens 持有，尺寸变化自己处理 */
export function mountLoadingScene(canvas: HTMLCanvasElement): LoadingScene {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器不支持 2D 画布，加载页无法绘制')
  // 显式标注类型：TS 不会把"已排除 null"的收窄带进函数声明，闭包里用到的 ctx 必须自己带类型
  const ctx: CanvasRenderingContext2D = context
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const motes = buildMotes(new Rng(20261128))
  const initial = geometry(window.innerWidth || 1280, window.innerHeight || 720)
  const state: SceneState = {
    geo: initial,
    art: bakeArtwork(initial),
    dpr: 1,
    target: 0,
    shown: 0,
    elapsed: 0,
    clock: 0,
    black: 0,
    stage: 'idle',
    stageT: 0,
    rafId: 0,
    lastMs: 0,
    settle: null,
  }

  function paint(): void {
    // 灯只跟真实进度（setLoading 递进来的 0..1），不掺时间：资源一好灯就该亮到头，
    // 一分钟的等待是多留一会儿，不是把灯按秒数拉长
    const shown = state.shown
    const light = 0.1 + 0.9 * Math.pow(shown, 1.15)
    // 呼吸只改光，不改元素显形：否则木牌会跟着一起"喘"，像在呼吸而不是被风吹
    const breath = reduced
      ? 1
      : 1 + Math.sin((state.clock / BREATH_SEC) * TAU) * (0.05 + shown * 0.05)
    const flick = !reduced && state.stage === 'flicker' ? flickerAt(state.stageT / FLICKER_SEC) : 1
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0)
    paintLoadingRig(ctx, state.geo, state.art, motes, {
      shown,
      clock: state.clock,
      beam: light * breath * flick,
      black: state.black,
      flick,
    })
  }

  function resize(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(1, window.innerWidth)
    const h = Math.max(1, window.innerHeight)
    canvas.width = Math.round(w * ratio)
    canvas.height = Math.round(h * ratio)
    state.dpr = ratio
    state.geo = geometry(w, h)
    state.art = bakeArtwork(state.geo)
    paint()
  }

  function advance(dt: number): void {
    if (!reduced) {
      state.clock += dt
      advanceMotes(motes, dt)
    }
    state.elapsed += dt
    state.shown += (state.target - state.shown) * Math.min(1, dt * EASE_RATE)
    if (state.stage === 'idle') return
    // 资源早就绪、可是还没轮到最短停留走完：停在最亮等，收尾的秒表先不启动
    if (state.stage === 'hold' && state.elapsed < MIN_BEFORE_FINISH_SEC) return
    state.stageT += dt
    if (state.stage === 'hold') {
      if (state.stageT < HOLD_SEC) return
      state.stage = reduced ? 'fade' : 'flicker'
      state.stageT = 0
      return
    }
    if (state.stage === 'flicker') {
      if (state.stageT < FLICKER_SEC) return
      state.stage = 'fade'
      state.stageT = 0
      return
    }
    state.black = Math.min(1, state.stageT / FADE_SEC)
    if (state.stageT < FADE_SEC) return
    state.stage = 'idle'
    state.black = 1
    stop()
    finish()
  }

  function tick(ms: number): void {
    state.rafId = requestAnimationFrame(tick)
    if (state.lastMs === 0) state.lastMs = ms
    const elapsed = ms - state.lastMs
    if (elapsed < FRAME_MIN_MS) return
    state.lastMs = ms
    advance(Math.min(elapsed / 1000, 0.12))
    paint()
  }

  function start(): void {
    if (state.rafId !== 0) return
    state.lastMs = 0
    state.rafId = requestAnimationFrame(tick)
  }

  function stop(): void {
    if (state.rafId === 0) return
    cancelAnimationFrame(state.rafId)
    state.rafId = 0
  }

  /** 收尾结束：唤起等着切场景的那个 await */
  function finish(): void {
    const settle = state.settle
    state.settle = null
    settle?.()
  }

  window.addEventListener('resize', resize)
  resize()
  start()

  return {
    setProgress(progress: number): void {
      state.target = Math.max(0, Math.min(1, progress))
      if (state.stage !== 'idle') return
      start()
      if (!reduced) return
      state.shown = state.target
      paint()
    },

    complete(): Promise<void> {
      return new Promise<void>((resolve) => {
        state.settle = resolve
        state.stage = 'hold'
        state.stageT = 0
        state.black = 0
        start()
      })
    },

    reset(): void {
      stop()
      finish()
      state.stage = 'idle'
      state.stageT = 0
      state.black = 0
      state.target = 0
      state.shown = 0
      state.elapsed = 0
      state.lastMs = 0
      start()
    },

    destroy(): void {
      stop()
      window.removeEventListener('resize', resize)
      finish()
    },
  }
}
