/**
 * 主菜单背景：一片会呼吸的夜雾，鼠标是一束在雾里扫的手电。
 *
 * 为什么开局界面要自己画一层 canvas：玩家还没选地图，3D 世界这时根本没生成，
 * 纯色底会像占位图，放个剪影又等于提前把"镇子"剧透了 —— 于是只画大气，
 * 不出现任何可辨认的物体，把"有东西在"交给看不见的部分。
 *
 * 交互是这个界面的主体而不是装饰：
 * - 指针 = 手电，扫过的地方浮尘被照亮（粒子按到光心的距离提亮，不是单纯叠一个圆）
 * - 点击 = 一圈涟漪 + 惊动雾里的东西（低频、无音效，靠画面给反馈）
 * - 菜单本体吃指针视差，鼠标移动时标题与按钮有纵深位移
 * - 雾深处偶尔睁开的眼睛：被手电照到就熄灭，这一下是全页唯一的"事件"
 * 慢的东西（天色 90 秒、雾带 20 秒）让人放松，突然的亮暗让人放不下心，
 * 这就是"微恐"要的分寸。
 */
import { createPlankSwing } from './plankSwing'

/** RGB 三元组：按 night（0 黄昏 → 1 深夜）插值，比切两套 CSS 变量好控 */
type Rgb = readonly [number, number, number]

/** 与 index.html 的界面 token 同口径：这版设计稿是黑石与灰烬，画面里不出现暖色 */
const DUSK_SKY: readonly Rgb[] = [[13, 13, 14], [9, 9, 10], [6, 6, 7]]
const NIGHT_SKY: readonly Rgb[] = [[6, 6, 7], [4, 4, 5], [3, 3, 4]]
/** 天空渐变的三个落点：顶 / 中 / 地平线 */
const SKY_STOPS: readonly number[] = [0, 0.52, 1]
const DUSK_GLOW: Rgb = [176, 172, 162]
const NIGHT_GLOW: Rgb = [128, 128, 126]
const FOG_WARM: Rgb = [126, 124, 118]
const FOG_COLD: Rgb = [96, 100, 104]
const DUST: Rgb = [206, 200, 188]
const DUST_LIT: Rgb = [246, 242, 232]
const EMBER: Rgb = [198, 190, 176]
const FLASH: Rgb = [196, 210, 232]
const LAMP: Rgb = [238, 232, 220]
const EYE: Rgb = [196, 74, 48]

const MOTE_COUNT = 120
const EMBER_COUNT = 8
/** 天色一来回：一次呼吸要够长，玩家停留几十秒也察觉不到循环边界 */
const SKY_CYCLE_SEC = 92
const FLASH_GAP_SEC: readonly [number, number] = [13, 27]
const BLINK_GAP_SEC: readonly [number, number] = [17, 35]
const WATCH_GAP_SEC: readonly [number, number] = [7, 15]
/** 眼睛的生存时间与"被照到"的判定半径（相对画面短边） */
const WATCH_LIFE_SEC: readonly [number, number] = [3.2, 5.2]
const WATCH_CATCH_RATIO = 0.19
/** 手电半径（相对画面短边）与涟漪寿命 */
const LAMP_RATIO = 0.5
const RIPPLE_LIFE_SEC = 1.1
const RIPPLE_LIMIT = 5
/** 雾带压扁比例：径向渐变是圆的，用 transform 压成横向铺开的一条，边缘才不会露出色带 */
const FOG_FLATTEN = 0.26
/** 30fps 足够：菜单不该和游戏抢 GPU */
const FRAME_MIN_MS = 1000 / 30

interface Mote {
  /** 归一化坐标：窗口缩放时不用重建粒子 */
  x: number
  y: number
  r: number
  /** 每秒的归一化位移 */
  vx: number
  vy: number
  alpha: number
  phase: number
  /** 火星：更亮、往上飘、闪得更快 */
  hot: boolean
}

interface Ripple {
  x: number
  y: number
  /** 生命进度 0 → 1 */
  t: number
}

interface Watcher {
  x: number
  y: number
  /** 两眼间距（像素） */
  gap: number
  life: number
  maxLife: number
  caught: boolean
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function css(color: Rgb, alpha = 1): string {
  const r = Math.round(color[0])
  const g = Math.round(color[1])
  const b = Math.round(color[2])
  return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')'
}

function rand(range: readonly [number, number]): number {
  return range[0] + Math.random() * (range[1] - range[0])
}

function buildMotes(): Mote[] {
  const motes: Mote[] = []
  for (let i = 0; i < MOTE_COUNT; i++) {
    motes.push({
      x: Math.random(),
      y: Math.random(),
      // 近处的粒子更大更亮，制造一点景深
      r: 0.6 + Math.random() * 1.6,
      vx: (0.004 + Math.random() * 0.012) * (Math.random() < 0.7 ? 1 : -1),
      vy: -0.002 - Math.random() * 0.008,
      alpha: 0.08 + Math.random() * 0.22,
      phase: Math.random() * Math.PI * 2,
      hot: false,
    })
  }
  for (let i = 0; i < EMBER_COUNT; i++) {
    motes.push({
      x: Math.random(),
      y: 0.45 + Math.random() * 0.55,
      r: 0.9 + Math.random() * 1.3,
      vx: (Math.random() - 0.5) * 0.02,
      vy: -0.012 - Math.random() * 0.03,
      alpha: 0.32 + Math.random() * 0.4,
      phase: Math.random() * Math.PI * 2,
      hot: true,
    })
  }
  return motes
}

/**
 * 挂上主菜单背景。只在菜单这一层用：其余界面是静态底，没必要再烧一层动画。
 */
export function mountMenuBackdrop(menu: HTMLElement): void {
  const canvas = menu.querySelector<HTMLCanvasElement>('#menu-backdrop')
  if (!canvas) throw new Error('缺少 #menu-backdrop 画布')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持 2D 画布，菜单背景无法绘制')

  let w = 1
  let h = 1
  const motes = buildMotes()
  const ripples: Ripple[] = []
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  let clock = SKY_CYCLE_SEC * 0.38
  let flash = 0
  let flashLeft = 0
  let nextFlash = rand(FLASH_GAP_SEC)
  let blink = 0
  let nextBlink = rand(BLINK_GAP_SEC)
  let watcher: Watcher | null = null
  let nextWatcher = rand(WATCH_GAP_SEC)
  // 木牌的钟摆：只在菜单里存在，指针划过得越快，甩得越狠
  const swing = reduced ? null : createPlankSwing(menu)
  // 手电用即时坐标（跟手），雾与光晕的漂移用平滑坐标（不跟手才像风）
  let px = -1
  let py = -1
  let aimX = 0.5
  let aimY = 0.5
  let aimXNow = 0.5
  let aimYNow = 0.5

  const paintSky = (night: number): void => {
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    for (let i = 0; i < DUSK_SKY.length; i++) {
      grad.addColorStop(SKY_STOPS[i], css(mix(DUSK_SKY[i], NIGHT_SKY[i], night)))
    }
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
  }

  /** 顶光落在标题后面的一小团光池：石板的受光面就是它给的（顶角那圈光由 CSS 补） */
  const paintGlow = (night: number): void => {
    const glow = mix(DUSK_GLOW, NIGHT_GLOW, night)
    const cx = w * (0.5 + (aimXNow - 0.5) * 0.08)
    const cy = h * (0.3 + (aimYNow - 0.5) * 0.04)
    const radius = Math.max(w, h) * 0.56
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
    grad.addColorStop(0, css(glow, 0.16 - night * 0.07))
    grad.addColorStop(0.46, css(glow, 0.06 - night * 0.02))
    grad.addColorStop(1, css(glow, 0))
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
  }

  /** 三层雾带：错开速度与高度，叠加后就成了一条慢慢翻身的雾 */
  const paintFog = (night: number): void => {
    const tone = mix(FOG_WARM, FOG_COLD, night)
    const radius = Math.max(w * 0.62, 1)
    for (let i = 0; i < 3; i++) {
      const drift = Math.sin(clock * (0.11 + i * 0.05) + i * 1.7 + aimXNow * 1.2)
      const sway = Math.cos(clock * (0.07 + i * 0.04) + i * 2.3 + aimYNow * 0.8)
      const y = h * (0.5 + i * 0.16) + drift * h * 0.04
      const cx = w * (0.5 + sway * 0.22)
      const peak = Math.max(0.015, 0.11 - i * 0.026)
      // 圆径向渐变压扁成横条：四个方向都是软边，不会在画面上留下一条"色带"
      ctx.save()
      ctx.translate(cx, y)
      ctx.scale(1, FOG_FLATTEN)
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius)
      grad.addColorStop(0, css(tone, peak))
      grad.addColorStop(0.55, css(tone, peak * 0.42))
      grad.addColorStop(1, css(tone, 0))
      ctx.fillStyle = grad
      ctx.fillRect(-radius, -radius, radius * 2, radius * 2)
      ctx.restore()
    }
  }

  /** 手电落在雾里的光斑；叠加模式让它在暗底上"发光"而不是糊一块灰 */
  const paintLamp = (): void => {
    if (px < 0) return
    const radius = Math.min(w, h) * LAMP_RATIO
    ctx.globalCompositeOperation = 'lighter'
    const grad = ctx.createRadialGradient(px, py, 0, px, py, radius)
    grad.addColorStop(0, css(LAMP, 0.15))
    grad.addColorStop(0.3, css(LAMP, 0.075))
    grad.addColorStop(0.62, css(LAMP, 0.026))
    grad.addColorStop(1, css(LAMP, 0))
    ctx.fillStyle = grad
    ctx.fillRect(px - radius, py - radius, radius * 2, radius * 2)
    ctx.globalCompositeOperation = 'source-over'
  }

  const paintRipples = (): void => {
    const unit = Math.min(w, h)
    for (const ripple of ripples) {
      const grow = ripple.t
      const alpha = (1 - ripple.t) * 0.42
      ctx.strokeStyle = css(LAMP, alpha)
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.arc(ripple.x * w, ripple.y * h, unit * (0.015 + grow * 0.16), 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  const paintMotes = (dt: number, night: number): void => {
    const radius = Math.min(w, h) * LAMP_RATIO
    for (const mote of motes) {
      mote.x += mote.vx * dt
      mote.y += mote.vy * dt
      if (mote.x < -0.05) mote.x += 1.1
      if (mote.x > 1.05) mote.x -= 1.1
      if (mote.y < -0.05) mote.y += 1.1
      if (mote.y > 1.05) mote.y -= 1.1
      const mx = mote.x * w
      const my = mote.y * h
      // 被手电扫到的浮尘提亮：这是"手电"能成立的关键，只叠光斑会像一张贴纸
      let lit = 0
      if (px >= 0) {
        const dx = (mx - px) / radius
        const dy = (my - py) / radius
        lit = Math.max(0, 1 - (dx * dx + dy * dy))
        lit *= lit
      }
      const twinkle = 0.55 + 0.45 * Math.sin(clock * (mote.hot ? 3.1 : 1.3) + mote.phase)
      const base = mote.hot ? 1 : 0.86 - night * 0.24
      const alpha = mote.alpha * twinkle * base * (1 + lit * 3.4)
      if (alpha <= 0.001) continue
      const tint = mote.hot ? EMBER : mix(DUST, DUST_LIT, lit)
      ctx.fillStyle = css(tint, Math.min(1, alpha))
      ctx.beginPath()
      ctx.arc(mx, my, mote.r * (1 + lit * 1.5), 0, Math.PI * 2)
      ctx.fill()
    }
  }

  /** 眼睛很小：尺寸随画面短边走，1080p 下约 2px，凑近才发现 */
  const watchedEyeRadius = (): number => Math.max(1.6, Math.min(w, h) * 0.0035)

  const paintWatcher = (): void => {
    if (!watcher) return
    // 淡入 0.5 秒、淡出 0.8 秒；被抓到时立刻塌掉
    const fadeIn = Math.min(1, watcher.life / 0.5)
    const fadeOut = Math.min(1, (watcher.maxLife - watcher.life) / 0.8)
    const alpha = Math.max(0, Math.min(fadeIn, fadeOut)) * 0.85
    if (alpha <= 0.002) return
    const cx = watcher.x * w
    const cy = watcher.y * h
    const half = watcher.gap * 0.5
    // 幽光用径向渐变：硬边圆会在暗底上显出一个"红球"，而它应该只是雾里的一点暖
    const halo = Math.max(1, watcher.gap * 2.2)
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, halo)
    glow.addColorStop(0, css(EYE, alpha * 0.3))
    glow.addColorStop(0.45, css(EYE, alpha * 0.12))
    glow.addColorStop(1, css(EYE, 0))
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(cx, cy, halo, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = css(EYE, alpha)
    for (const dx of [-half, half]) {
      ctx.beginPath()
      ctx.arc(cx + dx, cy, watchedEyeRadius(), 0, Math.PI * 2)
      ctx.fill()
    }
  }

  const draw = (dt: number): void => {
    const night = 0.5 - 0.5 * Math.cos((clock / SKY_CYCLE_SEC) * Math.PI * 2)
    const follow = Math.min(1, dt * 2.4)
    aimXNow += (aimX - aimXNow) * follow
    aimYNow += (aimY - aimYNow) * follow
    paintSky(night)
    paintGlow(night)
    paintFog(night)
    paintRipples()
    paintMotes(dt, night)
    paintLamp()
    paintWatcher()
    if (flash > 0) {
      ctx.fillStyle = css(FLASH, flash * 0.24)
      ctx.fillRect(0, 0, w, h)
    }
    if (blink > 0) {
      ctx.fillStyle = 'rgba(0, 0, 0, ' + blink * 0.55 + ')'
      ctx.fillRect(0, 0, w, h)
    }
  }

  const resize = (): void => {
    // DPR 封顶 2：4K 屏上再往上加只是白烧像素
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    w = Math.max(1, window.innerWidth)
    h = Math.max(1, window.innerHeight)
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (reduced) draw(0)
  }

  const spawnWatcher = (): void => {
    // 只落在内容区的空白处：躲在标题或按钮后面等于白画
    const zone = Math.floor(Math.random() * 3)
    let x = 0.5
    let y = 0.4
    if (zone === 0) {
      x = 0.15 + Math.random() * 0.7
      y = 0.13 + Math.random() * 0.12
    } else if (zone === 1) {
      x = 0.15 + Math.random() * 0.7
      y = 0.72 + Math.random() * 0.13
    } else {
      x = Math.random() < 0.5 ? 0.06 + Math.random() * 0.2 : 0.74 + Math.random() * 0.2
      y = 0.3 + Math.random() * 0.4
    }
    watcher = {
      x,
      y,
      gap: 10 + Math.random() * 9,
      life: 0,
      maxLife: rand(WATCH_LIFE_SEC),
      caught: false,
    }
  }

  const updateWatcher = (dt: number): void => {
    if (!watcher) {
      nextWatcher -= dt
      if (nextWatcher <= 0) spawnWatcher()
      return
    }
    watcher.life += dt
    if (!watcher.caught && px >= 0) {
      const dx = watcher.x * w - px
      const dy = watcher.y * h - py
      const reach = Math.min(w, h) * WATCH_CATCH_RATIO
      if (dx * dx + dy * dy < reach * reach) {
        // 被照到：它眨眼就消失，画面同时暗一下 —— 不解释、不出声，留给人自己补
        watcher.caught = true
        blink = Math.max(blink, 0.55)
      }
    }
    if (watcher.caught) watcher.life += dt * 2.5
    if (watcher.life >= watcher.maxLife) {
      watcher = null
      nextWatcher = rand(WATCH_GAP_SEC)
    }
  }

  const updateRipples = (dt: number): void => {
    for (let i = ripples.length - 1; i >= 0; i--) {
      ripples[i].t += dt / RIPPLE_LIFE_SEC
      if (ripples[i].t >= 1) ripples.splice(i, 1)
    }
  }

  window.addEventListener('pointermove', (event: PointerEvent) => {
    const dx = px < 0 ? 0 : event.clientX - px
    swing?.kick(dx)
    px = event.clientX
    py = event.clientY
    aimX = px / Math.max(1, window.innerWidth)
    aimY = py / Math.max(1, window.innerHeight)
    // 菜单本体吃指针视差：不写在 rAF 里，鼠标一动就跟手
    if (!reduced) {
      menu.style.setProperty('--par-x', ((aimX - 0.5) * 2).toFixed(3))
      menu.style.setProperty('--par-y', ((aimY - 0.5) * 2).toFixed(3))
    }
    if (reduced) draw(0)
  })

  // 点空白处才惊动雾；点按钮是"要开始游戏了"，不该再奖励一次涟漪
  window.addEventListener('pointerdown', (event: PointerEvent) => {
    if (!menu.classList.contains('is-on')) return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('button')) return
    if (ripples.length >= RIPPLE_LIMIT) ripples.shift()
    ripples.push({ x: event.clientX / Math.max(1, window.innerWidth), y: event.clientY / Math.max(1, window.innerHeight), t: 0 })
    if (reduced) draw(0)
  })

  window.addEventListener('resize', resize)

  resize()
  // 减少动态效果：只留一张静帧，自动的闪电与眨眼都不播；指针与点击仍然有反馈
  if (reduced) {
    draw(0)
    return
  }

  let last = 0
  const frame = (now: number): void => {
    requestAnimationFrame(frame)
    // 菜单没显示时什么也不做：这时多半在游戏里，别抢渲染预算
    if (!menu.classList.contains('is-on')) {
      last = now
      return
    }
    if (now - last < FRAME_MIN_MS) return
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    clock += dt

    nextFlash -= dt
    if (nextFlash <= 0) {
      flash = 1
      // 四成的闪电会补一下弱的：真实闪电本来就不是单帧
      flashLeft = Math.random() < 0.4 ? 1 : 0
      nextFlash = rand(FLASH_GAP_SEC)
    } else if (flash > 0) {
      flash = Math.max(0, flash - dt * 2.6)
      if (flash === 0 && flashLeft > 0) {
        flashLeft -= 1
        flash = 0.65
      }
    }

    nextBlink -= dt
    if (nextBlink <= 0) {
      blink = 1
      nextBlink = rand(BLINK_GAP_SEC)
    } else if (blink > 0) {
      blink = Math.max(0, blink - dt * 5)
    }

    updateWatcher(dt)
    updateRipples(dt)
    swing?.update(dt, (aimX - 0.5) * 2)
    draw(dt)
  }
  requestAnimationFrame(frame)
}
