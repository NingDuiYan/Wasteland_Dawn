/**
 * 主题指针：把系统箭头换成一块风化的铁箭头，悬停可点物时指甲边缘亮起余烬。
 *
 * 为什么用 canvas 现画而不是图片：仓库零外部素材，指针也必须代码生成；
 * 三种状态（静止 / 可点 / 不可点）画完转 PNG data URI 交给 CSS `cursor`。
 * 位图按 SCALE 倍绘制：浏览器对指针位图有 128px 上限，32 CSS px × 2 正好清晰又不越界。
 */

/** 位图倍率：CSS 尺寸 32 时出 64×64，够 retina 用 */
const SCALE = 2
/** 指针位图的 CSS 尺寸 */
const SIZE = 32
/** 箭头尖端在 32 单位坐标里的位置，同时作为 CSS cursor 的热点 */
const HOTSPOT_X = 3
const HOTSPOT_Y = 2

type Rgba = readonly [number, number, number, number]

const EDGE: Rgba = [18, 16, 13, 235]
const RIM: Rgba = [255, 252, 240, 130]
const RUST: Rgba = [138, 84, 52, 190]
const EMBER: Rgba = [255, 176, 112, 255]

/** 箭头轮廓（32 单位空间）：尖在左上，边线故意不齐，像从石头上崩下来的一角 */
const ARROW: ReadonlyArray<readonly [number, number]> = [
  [3, 2],
  [4.1, 7.6],
  [2.9, 10.4],
  [4.4, 13.1],
  [2.8, 17.9],
  [4.0, 21.2],
  [3.1, 23.9],
  [9.3, 18.4],
  [11.8, 24.4],
  [13.9, 28.4],
  [15.5, 27.3],
  [16.5, 29.0],
  [18.3, 26.9],
  [13.5, 16.9],
  [21.8, 17.1],
  [21.3, 15.2],
]

/** 裂纹走向：从箭头腰部斜切到尾部，像被打断过 */
const CRACK: ReadonlyArray<readonly [number, number]> = [
  [6.4, 12.4],
  [10.2, 15.2],
  [8.6, 19.6],
  [12.4, 22.4],
]

function css(color: Rgba): string {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3] / 255})`
}

function trace(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath()
  ARROW.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.closePath()
}

/** 把轮廓整体平移后填色：用来垫出侧壁，比描边更像一块有厚度的石头 */
function offsetFill(ctx: CanvasRenderingContext2D, dx: number, dy: number, fill: string): void {
  ctx.save()
  ctx.translate(dx, dy)
  trace(ctx)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.restore()
}

/** 画一枚石箭头；hot 为真时尖端亮起余烬，blocked 为真时压暗并加一道裂纹 */
function paintCursor(hot: boolean, blocked: boolean): string {
  const canvas = document.createElement('canvas')
  const bitmap = SIZE * SCALE
  canvas.width = bitmap
  canvas.height = bitmap
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('拿不到 2d 上下文，指针退化为系统箭头')
  ctx.scale(SCALE, SCALE)
  ctx.lineJoin = 'round'

  // 侧壁：往右下错开 1.1/1.3 的暗块，光源在上左，所以厚度只出现在右下
  offsetFill(ctx, 1.1, 1.3, 'rgba(16, 14, 11, 0.82)')
  offsetFill(ctx, 0.5, 0.6, 'rgba(52, 47, 40, 0.9)')

  trace(ctx)
  const body = ctx.createLinearGradient(3, 2, 20, 28)
  if (blocked) {
    body.addColorStop(0, '#6b665c')
    body.addColorStop(0.5, '#45413a')
    body.addColorStop(1, '#26241f')
  } else {
    body.addColorStop(0, '#efeade')
    body.addColorStop(0.34, '#c6bfb0')
    body.addColorStop(0.72, '#8f887a')
    body.addColorStop(1, '#575246')
  }
  ctx.fillStyle = body
  ctx.fill()

  // 石面颗粒与锈斑都裁在轮廓里
  ctx.save()
  trace(ctx)
  ctx.clip()
  const grains: ReadonlyArray<readonly [number, number, number, string]> = [
    [6.4, 6.2, 0.55, 'rgba(88, 82, 72, 0.5)'],
    [8.2, 9.4, 0.40, 'rgba(255, 250, 238, 0.5)'],
    [5.2, 13.6, 0.45, 'rgba(78, 72, 63, 0.45)'],
    [11.6, 8.0, 0.35, 'rgba(70, 64, 56, 0.4)'],
    [15.2, 12.4, 0.30, 'rgba(255, 250, 238, 0.42)'],
    [7.4, 21.4, 0.40, 'rgba(74, 68, 59, 0.4)'],
    [12.6, 22.6, 0.35, 'rgba(64, 59, 51, 0.4)'],
  ]
  for (const [x, y, r, fill] of grains) {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = fill
    ctx.fill()
  }
  ctx.fillStyle = css(RUST)
  for (const [x, y, r] of [[14.6, 9.2, 0.62], [10.2, 15.6, 0.5], [16.4, 18.4, 0.42]] as const) {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  // 顶面受光：从尖往腰的一条窄亮带，出立体感
  const sheen = ctx.createLinearGradient(3, 2, 7.4, 12)
  sheen.addColorStop(0, 'rgba(255, 253, 246, 0.5)')
  sheen.addColorStop(1, 'rgba(255, 253, 246, 0)')
  ctx.fillStyle = sheen
  ctx.fillRect(0, 0, SIZE, SIZE)
  ctx.restore()

  trace(ctx)
  ctx.strokeStyle = css(EDGE)
  ctx.lineWidth = 0.8
  ctx.stroke()

  // 左上外沿一条细高光，把箭头从暗背景里拉出来
  ctx.beginPath()
  ctx.moveTo(HOTSPOT_X + 0.6, HOTSPOT_Y + 2)
  ctx.lineTo(3.4, 21.8)
  ctx.strokeStyle = css(RIM)
  ctx.lineWidth = 0.7
  ctx.stroke()

  // 发丝裂：可点与不可点都要有，只是不可点更深更长
  ctx.beginPath()
  CRACK.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.strokeStyle = blocked ? 'rgba(14, 12, 10, 0.92)' : 'rgba(32, 28, 23, 0.55)'
  ctx.lineWidth = blocked ? 1.1 : 0.6
  ctx.stroke()

  if (hot) {
    // 尖端一点余烬：光只落在笔尖大小的地方，不做整块光晕，免得像现代发光元素
    const ember = ctx.createRadialGradient(4.6, 4.4, 0, 4.6, 4.4, 5.4)
    ember.addColorStop(0, css([EMBER[0], EMBER[1], EMBER[2], 150]))
    ember.addColorStop(0.45, css([EMBER[0], EMBER[1], EMBER[2], 46]))
    ember.addColorStop(1, css([EMBER[0], EMBER[1], EMBER[2], 0]))
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = ember
    ctx.beginPath()
    ctx.arc(4.6, 4.4, 5.4, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  return canvas.toDataURL('image/png')
}

/** 指针样式的选择器与对应状态 */
interface CursorRule {
  selectors: readonly string[]
  state: 'idle' | 'hot' | 'blocked'
}

const RULES: readonly CursorRule[] = [
  {
    selectors: [
      'body:not(.is-playing)',
      '#screen-loading',
      '#screen-menu',
      '#screen-loadout',
      '#screen-map',
      '#screen-pause',
      '#screen-result',
    ],
    state: 'idle',
  },
  {
    selectors: [
      'button:not(:disabled)',
      'a[href]',
      '[role="button"]:not([aria-disabled="true"])',
      '.card',
      '.map-card:not(:disabled)',
      'input:not(:disabled)',
      'select:not(:disabled)',
    ],
    state: 'hot',
  },
  {
    selectors: ['button:disabled', '.map-card:disabled', '[aria-disabled="true"]'],
    state: 'blocked',
  },
]

/**
 * 给整个界面换一套实物指针。
 *
 * 只在细指针设备（鼠标/触控板）上生效：触屏没有悬停，换指针没有意义还白花一次位图编码。
 * 游戏内（body.is-playing）画布恢复隐藏指针，免得浮在准星旁边抢注意力。
 */
export function mountThemedCursor(): void {
  if (!window.matchMedia('(pointer: fine)').matches) return

  let urls: Record<'idle' | 'hot' | 'blocked', string>
  try {
    urls = {
      idle: paintCursor(false, false),
      hot: paintCursor(true, false),
      blocked: paintCursor(false, true),
    }
  } catch {
    // 画不出来就用系统指针，不因为这个功能挂掉整个界面
    return
  }

  const decl = (state: 'idle' | 'hot' | 'blocked', fallback: string): string =>
    `url("${urls[state]}") ${HOTSPOT_X} ${HOTSPOT_Y}, ${fallback}`

  const blocks: string[] = []
  for (const rule of RULES) {
    const fallback = rule.state === 'blocked' ? 'not-allowed' : rule.state === 'hot' ? 'pointer' : 'auto'
    // !important 是必要的：组件自带 `.plank-btn:disabled`、`.btn:disabled` 的特异性比这里高，
    // 皮肤层不压住就会出现"箭头换了、禁用项还是系统指针"的割裂
    blocks.push(`${rule.selectors.join(',\n')} { cursor: ${decl(rule.state, fallback)} !important; }`)
  }
  // 游戏中指针锁会自己藏起光标；没有锁的环境里也别让箭头压在准星旁
  blocks.push('body.is-playing #game-root canvas { cursor: none !important; }')

  const style = document.createElement('style')
  style.id = 'themed-cursor'
  style.textContent = blocks.join('\n')
  document.head.appendChild(style)
  document.documentElement.classList.add('themed-cursor')
}
