/**
 * 加载页的场景层：铁链、木牌、布条、灰烬、刻石各画各的，由 loadingBackdrop 每帧调一次。
 *
 * 为什么单拆一层：这一坨是纯绘制，不碰时间轴也不碰 DOM —— 改构图只动这里，
 * 改节奏（几秒呼吸、闪几下、怎么淡出）只动 loadingBackdrop。
 * 所有尺寸都从 Geo 派生，16:9 以外的比例只是多留些黑边。
 */
import { Rng } from '../sim/random'
import {
  ASH,
  BEAM_REACH,
  GLOW,
  INK,
  LAYOUT,
  METAL,
  RUST,
  TAU,
  beamProfile,
  css,
  mix,
  smoothstep,
} from './loadingArt'
import type { Artwork, Geo } from './loadingArt'

/** 木牌微晃 ±2°；布条与铁环更快、幅度更大、相位更晚 */
const PLANK_AMP_DEG = 2
const PROP_AMP_DEG = 3.4
const MOTE_COUNT = 150
/** 木牌下方两枚倒影：越远越淡越小，第二枚几乎只剩一块深色 */
const GHOSTS: readonly { gap: number; alpha: number; scale: number }[] = [
  { gap: 0.042, alpha: 0.045, scale: 0.6 },
  { gap: 0.116, alpha: 0.012, scale: 0.5 },
]

/** 灰烬只存归一化坐标：窗口缩放不用重建粒子 */
export interface Mote {
  x: number
  y: number
  r: number
  /** 每秒下落多少画面高 */
  vy: number
  /** 横向摇摆的频率与相位 */
  sway: number
  phase: number
  alpha: number
}

export function buildMotes(rng: Rng): Mote[] {
  const motes: Mote[] = []
  for (let i = 0; i < MOTE_COUNT; i += 1) {
    motes.push({
      // 大部分灰烬落在光柱附近，少数飘到暗处 —— 边缘有零星的才不像"只在光里的粒子"
      x: rng.chance(0.78) ? 0.5 + rng.range(-0.17, 0.17) : rng.range(0.04, 0.96),
      y: rng.range(0, 1),
      r: rng.range(0.5, 1.5),
      vy: rng.range(0.018, 0.062),
      sway: rng.range(0.15, 0.55),
      phase: rng.range(0, TAU),
      alpha: rng.range(0.16, 0.72),
    })
  }
  return motes
}

export function advanceMotes(motes: Mote[], dt: number): void {
  for (const mote of motes) {
    mote.y += mote.vy * dt
    if (mote.y <= 1.04) continue
    mote.y = -0.04
    mote.x = Math.random()
  }
}

/** 木牌 ±2°：两个不同频率叠在一起，才不会像节拍器 */
function swingAngle(clock: number): number {
  const wave = Math.sin(clock * 0.92) * 0.72 + Math.sin(clock * 2.31 + 1.1) * 0.28
  return (wave * PLANK_AMP_DEG * Math.PI) / 180
}

/** 布条与铁环：频率更快、相位更晚 —— 迟滞感就是这么来的 */
function lagAngle(clock: number, factor: number, lag: number): number {
  const t = clock - lag
  const wave = Math.sin(t * 2.35) * 0.8 + Math.sin(t * 5.1) * 0.2
  return (wave * PROP_AMP_DEG * factor * Math.PI) / 180
}

/** 生锈铁链：竖环与横环交替，锈色按固定种子逐环变化，每帧重算也长得一样 */
function paintChain(ctx: CanvasRenderingContext2D, geo: Geo, length: number, shown: number): void {
  const rng = new Rng(7301)
  const step = geo.link * 1.12
  const half = geo.link * 0.5
  const vis = 0.3 + shown * 0.4
  ctx.save()
  // 连续的那根"链芯"：环是一个个套在这根线上的，没有它就只剩一串独立的椭圆
  ctx.strokeStyle = css(mix(METAL, INK, 0.45), vis * 0.9)
  ctx.lineWidth = Math.max(1, geo.link * 0.55)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(0, length)
  ctx.stroke()
  ctx.lineWidth = Math.max(1, geo.link * 0.32)
  for (let i = 0; i * step < length; i += 1) {
    const y = i * step + step * 0.5
    const upright = i % 2 === 0
    ctx.strokeStyle = css(mix(METAL, RUST, rng.range(0.08, 0.4)), vis)
    ctx.beginPath()
    ctx.ellipse(
      0,
      y,
      upright ? half * 0.86 : half * 1.24,
      upright ? half * 1.05 : half * 0.58,
      0,
      0,
      TAU,
    )
    ctx.stroke()
    if (!upright) continue
    // 受光面：上半圈一道暖光，锈迹才不会读成"棕色绳子"
    ctx.strokeStyle = css(mix(METAL, GLOW, 0.34), 0.03 + vis * 0.2)
    ctx.beginPath()
    ctx.ellipse(0, y, half * 0.86, half * 1.05, 0, Math.PI * 1.05, Math.PI * 1.95)
    ctx.stroke()
  }
  ctx.restore()
}

/** 主木牌：亮度越低越只剩轮廓（0.16 起跳，正好是设计稿里"几乎隐没"那一档） */
function paintPlank(
  ctx: CanvasRenderingContext2D,
  geo: Geo,
  art: Artwork,
  shown: number,
  angle: number,
): void {
  ctx.save()
  ctx.translate(geo.cx, geo.anchorY)
  ctx.rotate(angle)
  ctx.globalAlpha = Math.min(1, 0.16 + 0.84 * Math.pow(shown, 0.8))
  ctx.drawImage(art.plank, -geo.plankW * 0.5, geo.plankTop - geo.anchorY, geo.plankW, geo.plankH)
  ctx.restore()
}

/** 布条、细绳与铁环：比木牌晃得更快、相位更晚 */
function paintProps(ctx: CanvasRenderingContext2D, geo: Geo, shown: number, clock: number): void {
  const vis = smoothstep(0.24, 0.95, shown)
  if (vis <= 0.002) return
  const lag = lagAngle(clock, 1, 0.35)

  // 旧布条：斜挂在链子上，下缘是被撕烂的
  ctx.save()
  ctx.translate(geo.cx - geo.plankW * 0.7, geo.h * 0.158)
  ctx.rotate(lag * 1.5)
  ctx.fillStyle = css([64, 62, 58], 0.85 * vis)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(geo.plankW * 0.34, geo.h * 0.01)
  ctx.lineTo(geo.plankW * 0.26, geo.h * 0.052)
  ctx.lineTo(geo.plankW * 0.08, geo.h * 0.072)
  ctx.lineTo(-geo.plankW * 0.07, geo.h * 0.032)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  // 细绳：从链子上斜拉出去，末端垂着
  ctx.save()
  ctx.translate(geo.cx + geo.plankW * 0.2, geo.h * 0.09)
  ctx.rotate(lag * 1.2)
  ctx.strokeStyle = css(mix(METAL, RUST, 0.3), 0.22 * vis)
  ctx.lineWidth = Math.max(1, geo.link * 0.2)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.bezierCurveTo(
    geo.plankW * 0.7,
    geo.h * 0.05,
    geo.plankW * 1.3,
    geo.h * 0.11,
    geo.plankW * 1.05,
    geo.h * 0.17,
  )
  ctx.stroke()
  ctx.restore()

  // 生锈铁环：比布条还快一点，挂在绳子末端
  ctx.save()
  ctx.translate(geo.cx + geo.plankW * 1.02, geo.h * 0.255)
  ctx.rotate(lag * 2)
  ctx.strokeStyle = css(mix(METAL, RUST, 0.25), 0.24 * vis)
  ctx.lineWidth = Math.max(1, geo.link * 0.38)
  ctx.beginPath()
  ctx.ellipse(0, 0, geo.link * 1.5, geo.link * 1.9, 0, 0, TAU)
  ctx.stroke()
  ctx.restore()
}

/** 倒影：木牌下方两枚，越远越淡越小 —— 地面只是一层几乎看不出来的湿石板 */
function paintGhosts(ctx: CanvasRenderingContext2D, geo: Geo, art: Artwork, shown: number): void {
  const vis = smoothstep(0.3, 1, shown)
  if (vis <= 0.002) return
  const bottom = geo.plankTop + geo.plankH
  for (const ghost of GHOSTS) {
    const w = geo.plankW * ghost.scale
    const h = geo.plankH * ghost.scale
    ctx.save()
    ctx.translate(geo.cx, bottom + geo.h * ghost.gap)
    // 翻转之后这支笔朝上，所以画在 -h 上才是往地面里投下去的影子
    ctx.scale(1, -1)
    ctx.globalAlpha = ghost.alpha * vis
    ctx.drawImage(art.plankSoft, -w * 0.5, -h, w, h)
    ctx.restore()
  }
}

/** 地表：只有一片比黑亮一点点的雾面，最亮处正好在灯底下 */
function paintGround(ctx: CanvasRenderingContext2D, geo: Geo, shown: number): void {
  const level = 0.4 + shown * 0.6
  // 用椭圆径向渐变而不是纵向线性：线性渐变在起始那一行一定会留一条横线，
  // 而参考图的地面根本没有边 —— 只有灯脚下一摊慢慢散开的湿光
  ctx.save()
  ctx.translate(0, geo.h * 0.68)
  ctx.scale(1, 0.55)
  const grad = ctx.createRadialGradient(geo.w * 0.5, 0, 0, geo.w * 0.5, 0, geo.w * 0.58)
  grad.addColorStop(0, css([34, 31, 28], 0.34 * level))
  grad.addColorStop(0.45, css([30, 27, 24], 0.22 * level))
  grad.addColorStop(1, css([18, 16, 15], 0))
  ctx.fillStyle = grad
  ctx.fillRect(-geo.w, -geo.h * 2, geo.w * 3, geo.h * 4)
  ctx.restore()
}

/** 刻石：完全静止，全程埋在左下角的阴影里 —— 全场唯一不动的东西 */
function paintStone(ctx: CanvasRenderingContext2D, geo: Geo, art: Artwork, shown: number): void {
  const vis = smoothstep(0.42, 1, shown)
  if (vis <= 0.002) return
  const w = geo.w * LAYOUT.stoneWidth
  const h = geo.h * LAYOUT.stoneHeight
  ctx.save()
  ctx.globalAlpha = 0.3 + vis * 0.5
  ctx.translate(geo.w * LAYOUT.stoneX, geo.h * LAYOUT.stoneY)
  ctx.rotate(-0.09)
  ctx.drawImage(art.stone, -w * 0.5, -h * 0.5, w, h)
  ctx.restore()
}

/** 某点在光柱里的受光比例：横向按锥宽衰减，竖向直接读光柱剖面 */
function beamAt(geo: Geo, x: number, y: number): number {
  const t = y / (geo.h * BEAM_REACH)
  if (t < 0 || t >= 1) return 0
  const half = geo.w * (0.052 + 0.1 * Math.pow(t, 0.85))
  const offset = Math.abs(x - geo.cx) / Math.max(1, half)
  if (offset >= 1) return 0
  return beamProfile(t) * (1 - offset * offset)
}

/** 灰烬：只在光里显形，靠近光心更亮更大 —— 整页唯一会闪的东西 */
function paintDust(
  ctx: CanvasRenderingContext2D,
  geo: Geo,
  motes: readonly Mote[],
  beam: number,
  clock: number,
): void {
  if (beam <= 0.02) return
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (const mote of motes) {
    const x = mote.x * geo.w + Math.sin(clock * mote.sway + mote.phase) * geo.w * 0.008
    const y = mote.y * geo.h
    const hit = beamAt(geo, x, y)
    // 光外一粒都不画：灰烬只是"被灯照出来"的，不是雪
    const alpha = mote.alpha * hit * 1.4 * Math.min(1, beam)
    if (alpha <= 0.004) continue
    ctx.fillStyle = css(mix(ASH, GLOW, hit * 0.7), Math.min(1, alpha))
    ctx.beginPath()
    ctx.arc(x, y, mote.r * (1 + hit * 0.55), 0, TAU)
    ctx.fill()
  }
  ctx.restore()
}

/**
 * 灯照亮的"房间余辉"：参考图里光锥两侧 y 0.2~0.5 那一片 15~25 的亮度不是锥的边，
 * 是灯把空气整体提亮了一层 —— 没有它，锥看起来就是贴在黑纸上的一个亮条。
 */
function paintAmbient(ctx: CanvasRenderingContext2D, geo: Geo, beam: number): void {
  const radius = geo.w * 0.24
  const grow = ctx.createRadialGradient(0, 0, 0, 0, 0, radius)
  grow.addColorStop(0, css([38, 35, 31], 0.42))
  grow.addColorStop(0.55, css([34, 31, 28], 0.22))
  grow.addColorStop(1, css([30, 27, 24], 0))
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = Math.min(1, beam)
  ctx.translate(geo.cx, geo.h * 0.42)
  // 竖直方向压成椭圆：铺满整圆的余辉在 16:9 上会变成一条横带
  ctx.scale(1, (geo.h * 0.36) / radius)
  ctx.fillStyle = grow
  ctx.fillRect(-radius, -radius, radius * 2, radius * 2)
  ctx.restore()
}

/** 挂着的这一串：铁链从画面外垂到木牌，木牌与它的小物件各摆各的 */
function paintAssembly(
  ctx: CanvasRenderingContext2D,
  geo: Geo,
  art: Artwork,
  shown: number,
  clock: number,
  flick: number,
): void {
  const angle = swingAngle(clock)
  // 闪灯时连同悬挂物一起暗下去：它们是"被灯照出来的"，不是自发光
  const lit = 0.06 + 0.94 * flick
  ctx.save()
  ctx.translate(geo.cx, geo.anchorY)
  ctx.rotate(angle)
  // 链尾要扎进木牌上那个孔里，短了会看出"链子悬在牌子上方"
  paintChain(ctx, geo, geo.plankTop - geo.anchorY + geo.plankH * 0.11, shown * lit)
  ctx.restore()
  paintPlank(ctx, geo, art, shown * lit, angle)
  paintProps(ctx, geo, shown * lit, clock)
}

export interface RigFrame {
  /** 进度：决定各元素从黑暗里浮出来的时间窗 */
  shown: number
  clock: number
  /** 灯的实际亮度（含呼吸与故障闪烁），只影响光与灰烬 */
  beam: number
  /** 收尾时压黑的量 0..1 */
  black: number
  /**
   * 灯当前的闪动系数 1|0..1：只在收尾"接触不良"那 0.42 秒里小于 1。
   * 挂着的这一串也吃它 —— 灯灭了牌还亮着，读起来就成了"牌自己在发光"。
   */
  flick: number
}

/** 一帧：虚空 → 地表 → 光柱 → 倒影 → 悬挂物 → 刻石 → 灰烬 → 收尾压黑 */
export function paintLoadingRig(
  ctx: CanvasRenderingContext2D,
  geo: Geo,
  art: Artwork,
  motes: readonly Mote[],
  frame: RigFrame,
): void {
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.fillStyle = css(INK)
  ctx.fillRect(0, 0, geo.w, geo.h)

  // 虚空底噪：纯黑会像关机，几团极淡的云就够了
  ctx.globalAlpha = 0.42 + frame.beam * 0.34
  ctx.drawImage(art.mottle, 0, 0, geo.w, geo.h)
  ctx.globalAlpha = 1

  paintGround(ctx, geo, frame.shown)
  paintAmbient(ctx, geo, frame.beam)
  // 光只加不减：光柱用 lighter 压在暗面上才对
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = Math.min(1, frame.beam)
  ctx.drawImage(art.beam, 0, 0, geo.w, geo.h)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'

  paintGhosts(ctx, geo, art, frame.shown)
  paintAssembly(ctx, geo, art, frame.shown, frame.clock, frame.flick)
  paintStone(ctx, geo, art, frame.shown)
  paintDust(ctx, geo, motes, frame.beam, frame.clock)

  if (frame.black <= 0) return
  ctx.fillStyle = css(INK, Math.min(1, frame.black))
  ctx.fillRect(0, 0, geo.w, geo.h)
}
