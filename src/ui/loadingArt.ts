/**
 * 加载页的烘焙层：木牌、灰石、光柱都是程序化噪声画出来的位图，
 * 只在窗口尺寸变化时重做一次，之后每帧只做合成 —— 加载页不该和游戏抢 GPU。
 *
 * 与 index.html 的 --ui-* token 同口径：木料 / 锈铁 / 金属三色直接取 PALETTE，
 * 仓库里依旧没有任何图片文件。
 */
import { PALETTE } from '../config'
import { Rng } from '../sim/random'

export type Rgb = readonly [number, number, number]

export const TAU = Math.PI * 2

/** 画面构图：竖向全部按画面高度算，横向只借宽度定链心，换比例时构图不散 */
export const LAYOUT = {
  /** 木牌顶端在画面高度的比例 */
  plankTop: 0.292,
  /** 木牌高（占画面高度）与宽高比，按设计稿量出来 */
  plankHeight: 0.106,
  plankAspect: 0.62,
  /** 整串挂在画面以上：这个点只借来当旋转轴 */
  anchorY: -0.03,
  /** 地表；倒影从这儿往下排，越远越淡越糊 */
  groundY: 0.55,
  /** 左下角刻石的中心与尺寸（占画面宽 / 高） */
  stoneX: 0.19,
  stoneY: 0.836,
  stoneWidth: 0.155,
  stoneHeight: 0.068,
} as const

/** PALETTE 里是 0xRRGGBB，换成画布要的 0..255 */
function fromHex(value: number): Rgb {
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

export const RUST = fromHex(PALETTE.rust)
export const METAL = fromHex(PALETTE.metal)
/** 聚光灯的暖白：比 --ui-text 更黄一点，才像吊着一盏旧钨丝灯 */
export const GLOW: Rgb = [247, 236, 214]
/** 灰烬：几乎不带颜色，落进光里才泛白 */
export const ASH: Rgb = [226, 220, 206]
/** 虚空与阴影的底：纯黑会读成"关机"，留一点暖度才像暗处还有东西 */
export const INK: Rgb = [1, 1, 2]
/** 刻石比木牌冷一号 */
const STONE: Rgb = [58, 55, 50]

/* 木牌的三个上屏色。参考图里这块板被灯照得发白（p50 117、亮处 200+），
   比它背后的光（30~40）亮三倍；木纹是一条条头发丝粗的明暗交替，不是几道粗笔画 */
const WOOD_LIT: readonly [Rgb, Rgb, Rgb, Rgb] = [
  [108, 100, 88],
  [172, 161, 142],
  [140, 128, 112],
  [196, 183, 161],
]
const WOOD_GRAIN: Rgb = [92, 82, 70]
const WOOD_HILITE: Rgb = [242, 236, 224]
const WOOD_EDGE: Rgb = [204, 192, 174]

export function css(color: Rgb, alpha = 1): string {
  const r = Math.round(color[0])
  const g = Math.round(color[1])
  const b = Math.round(color[2])
  return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')'
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/** 0..1 的软过渡：木纹、锈迹、小物件各有各的"从黑暗里浮出来"的时间窗 */
export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * 光柱的竖向亮度。量参考图量出来的形状是"越往下越亮，亮到木牌上沿、过了牌面就散"：
 * 灯在画面外朝下打，近灯口那一段反而被灯罩遮住一半（顶边只有 33），
 * 到木牌上方才攒到最亮（66），木牌以下的余光是地面反光、不是光柱本体。
 */
export function beamProfile(t: number): number {
  if (t >= 1) return 0
  if (t <= 0) return 0.42
  const rise = 0.45 + 0.55 * smoothstep(0, 0.3, t)
  // 收得比放得快：木牌下沿一过（t≈0.44）就必须散掉，参考图 y0.6 那一行只剩 18 的地面反光
  return rise * (1 - smoothstep(0.44, 0.72, t))
}

/** 几何：所有尺寸都从画面高度派生，宽高比变了也只是多留些黑边 */
export interface Geo {
  w: number
  h: number
  cx: number
  /** 挂点（旋转轴），在画面之上 */
  anchorY: number
  plankTop: number
  plankW: number
  plankH: number
  /** 链环宽度：铁链、细绳、铁环的粗细全部按它派生 */
  link: number
}

export function geometry(w: number, h: number): Geo {
  const plankH = h * LAYOUT.plankHeight
  return {
    w,
    h,
    cx: w * 0.5,
    anchorY: h * LAYOUT.anchorY,
    plankTop: h * LAYOUT.plankTop,
    plankW: plankH * LAYOUT.plankAspect,
    plankH,
    link: Math.max(2, h * 0.0072),
  }
}

export interface Artwork {
  /** 虚空底噪：一团团极淡的云 */
  mottle: HTMLCanvasElement
  plank: HTMLCanvasElement
  /** 糊版木牌：倒影用，缩到 1/3 再放大就是一层免费的模糊 */
  plankSoft: HTMLCanvasElement
  /** 光柱：按 26% 分辨率烘焙，放大时的双线性插值正好当柔光 */
  beam: HTMLCanvasElement
  stone: HTMLCanvasElement
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持 2D 画布，加载页无法烘焙')
  return ctx
}

/**
 * 毛边：一条抖动的多边形把四边啃掉，配 destination-in 只保留形状里的木纹。
 * 只向内抖，绝不向外 —— 越界会被画布裁掉，角上就缺一块。
 */
function raggedRect(ctx: CanvasRenderingContext2D, rng: Rng, width: number, height: number): void {
  const steps = 9
  ctx.beginPath()
  ctx.moveTo(0, 0)
  for (let i = 0; i <= steps; i += 1) ctx.lineTo((i / steps) * width, rng.range(0, height * 0.018))
  for (let i = 1; i <= steps; i += 1) ctx.lineTo(width - rng.range(0, width * 0.028), (i / steps) * height)
  for (let i = steps - 1; i >= 0; i -= 1) ctx.lineTo((i / steps) * width, height - rng.range(0, height * 0.022))
  for (let i = steps - 1; i >= 0; i -= 1) ctx.lineTo(rng.range(0, width * 0.028), (i / steps) * height)
  ctx.closePath()
}

/** 风化木牌：竖向木纹 + 两个木节 + 啃过的边 + 钉孔，全部按固定种子长出来 */
function bakePlank(
  rng: Rng,
  width: number,
  height: number,
): { sharp: HTMLCanvasElement, soft: HTMLCanvasElement } {
  const canvas = createCanvas(width, height)
  const ctx = context2d(canvas)

  // 底色：这是一块被灯照白的旧木，不是黑木板 —— 参考图里牌面 p50 117、亮处 200+，
  // 比它背后的光（30~40）亮三倍，整页的视觉重心全靠这一块
  // 竖向配光按参考图那一列实测：顶沿被铁链与自身的厚度遮住一截（y=0.3 只有 98），
  // 亮度要到牌面中下段才攒起来（y=0.4 有 136），不是"顶上最亮往下渐暗"
  const base = ctx.createLinearGradient(0, 0, 0, height)
  base.addColorStop(0, css(WOOD_LIT[0]))
  base.addColorStop(0.24, css(WOOD_LIT[1]))
  base.addColorStop(0.72, css(WOOD_LIT[3]))
  base.addColorStop(1, css(WOOD_LIT[2]))
  ctx.fillStyle = base
  ctx.fillRect(0, 0, width, height)

  // 木纹：细密、几乎竖直的纤维。参考图的木纹是一条条头发丝粗的明暗交替，
  // 所以线要细、数量要多 —— 少了是"手绘木纹"，多了才像真的木头
  for (let i = 0; i < 64; i += 1) {
    const x = rng.range(-width * 0.04, width * 1.04)
    const amp = rng.range(width * 0.004, width * 0.022)
    const light = rng.chance(0.45)
    ctx.strokeStyle = light
      ? css(WOOD_HILITE, rng.range(0.12, 0.45))
      : css(WOOD_GRAIN, rng.range(0.12, 0.4))
    ctx.lineWidth = rng.range(width * 0.004, width * 0.013)
    ctx.beginPath()
    ctx.moveTo(x, 0)
    for (let s = 1; s <= 6; s += 1) ctx.lineTo(x + Math.sin(s * 2.3 + i) * amp, (height / 6) * s)
    ctx.stroke()
  }

  // 板子的厚度面：光从左上偏过来，右侧那一薄片是整块板最亮的地方
  const edge = ctx.createLinearGradient(width * 0.93, 0, width, 0)
  edge.addColorStop(0, css(WOOD_GRAIN, 0))
  edge.addColorStop(0.4, css(WOOD_EDGE, 0.3))
  edge.addColorStop(1, css(WOOD_HILITE, 0.26))
  ctx.fillStyle = edge
  ctx.fillRect(width * 0.93, 0, width * 0.07, height)
  // 左侧的薄影：没有它，板子会读成贴在光上的一张纸
  const shadow = ctx.createLinearGradient(0, 0, width * 0.1, 0)
  shadow.addColorStop(0, css(WOOD_GRAIN, 0.45))
  shadow.addColorStop(1, css(WOOD_GRAIN, 0))
  ctx.fillStyle = shadow
  ctx.fillRect(0, 0, width * 0.1, height)

  // 上沿一线天光：光竖直打下来，横断面上只有最上面这一薄片全亮
  const rim = ctx.createLinearGradient(0, 0, 0, height * 0.06)
  rim.addColorStop(0, css(WOOD_HILITE, 0.24))
  rim.addColorStop(1, css(WOOD_HILITE, 0))
  ctx.fillStyle = rim
  ctx.fillRect(0, 0, width, height * 0.07)

  // 几道深裂：沿纤维劈开的缝，比均匀随机纹更像被风化过的
  for (let i = 0; i < 3; i += 1) {
    const x = rng.range(width * 0.2, width * 0.8)
    const y0 = rng.range(height * 0.3, height * 0.75)
    ctx.strokeStyle = css(WOOD_GRAIN, rng.range(0.4, 0.7))
    ctx.lineWidth = Math.max(1, width * 0.008)
    ctx.beginPath()
    ctx.moveTo(x, y0)
    ctx.lineTo(x + rng.range(-width * 0.02, width * 0.02), y0 + rng.range(height * 0.1, height * 0.3))
    ctx.stroke()
  }

  // 边啃掉
  ctx.globalCompositeOperation = 'destination-in'
  raggedRect(ctx, rng, width, height)
  ctx.fillStyle = css([255, 255, 255])
  ctx.fill()
  ctx.globalCompositeOperation = 'source-over'

  // 钉孔与穿链孔：孔口下沿留一道亮边，才像"凿穿"而不是"点了两个点"
  const hole = (x: number, y: number, r: number, ring: number): void => {
    // 孔口周围先压一圈脏：铁链常年磨这块木头，边上是发黑的
    const dirt = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * ring)
    dirt.addColorStop(0, css(WOOD_GRAIN, 0.75))
    dirt.addColorStop(1, css(WOOD_GRAIN, 0))
    ctx.fillStyle = dirt
    ctx.fillRect(x - r * ring, y - r * ring, r * ring * 2, r * ring * 2)
    ctx.fillStyle = css([12, 10, 9], 0.94)
    ctx.beginPath()
    ctx.ellipse(x, y, r, r * 1.12, 0, 0, TAU)
    ctx.fill()
    // 孔壁下半圈吃到光：一个纯黑的洞，读起来是"贴了张圆点"
    ctx.strokeStyle = css(WOOD_HILITE, 0.22)
    ctx.lineWidth = Math.max(1, r * 0.22)
    ctx.beginPath()
    ctx.arc(x, y, r * 1.04, Math.PI * 0.35, Math.PI * 0.72)
    ctx.stroke()
  }
  hole(width * 0.5, height * 0.085, width * 0.062, 1.8)
  hole(width * 0.22, height * 0.42, width * 0.022, 2)
  hole(width * 0.72, height * 0.62, width * 0.028, 2)

  // 底边的劈裂：两三道细缝从锯口往上爬
  ctx.strokeStyle = css(INK, 0.5)
  for (let i = 0; i < 3; i += 1) {
    const sx = rng.range(width * 0.15, width * 0.85)
    ctx.lineWidth = Math.max(1, width * 0.012)
    ctx.beginPath()
    ctx.moveTo(sx, height)
    ctx.lineTo(
      sx + rng.range(-width * 0.05, width * 0.05),
      height - rng.range(height * 0.08, height * 0.26),
    )
    ctx.stroke()
  }

  for (let i = 0; i < 4; i += 1) {
    const sx = rng.range(width * 0.1, width * 0.9)
    ctx.strokeStyle = css([26, 22, 18], rng.range(0.5, 0.85))
    ctx.lineWidth = Math.max(1, width * 0.01)
    ctx.beginPath()
    ctx.moveTo(sx, height)
    ctx.lineTo(sx + rng.range(-width * 0.02, width * 0.02), height - rng.range(height * 0.12, height * 0.32))
    ctx.stroke()
  }

  const soft = createCanvas(width / 3, height / 3)
  context2d(soft).drawImage(canvas, 0, 0, soft.width, soft.height)
  return { sharp: canvas, soft }
}

/** 刻石：一块磕过的灰石，面上凿着「活下去」—— 刻痕上沿压暗、下沿接亮边 */
function bakeStone(rng: Rng, width: number, height: number): HTMLCanvasElement {
  const canvas = createCanvas(width, height)
  const ctx = context2d(canvas)

  ctx.beginPath()
  ctx.moveTo(width * 0.05, height * 0.36)
  ctx.lineTo(width * 0.17, height * 0.2)
  ctx.lineTo(width * 0.33, height * 0.24)
  ctx.lineTo(width * 0.5, height * 0.12)
  ctx.lineTo(width * 0.73, height * 0.2)
  ctx.lineTo(width * 0.95, height * 0.38)
  ctx.lineTo(width * 0.92, height * 0.7)
  ctx.lineTo(width * 0.78, height * 0.82)
  ctx.lineTo(width * 0.6, height * 0.79)
  ctx.lineTo(width * 0.45, height * 0.95)
  ctx.lineTo(width * 0.24, height * 0.86)
  ctx.lineTo(width * 0.07, height * 0.74)
  ctx.closePath()
  const face = ctx.createLinearGradient(0, 0, width, height)
  face.addColorStop(0, css(mix(STONE, GLOW, 0.24)))
  face.addColorStop(0.6, css(STONE, 0.92))
  face.addColorStop(1, css(mix(STONE, INK, 0.55)))
  ctx.fillStyle = face
  ctx.fill()

  // 石面颗粒：稀疏的暗点与亮点，纯色块一眼就是占位图
  for (let i = 0; i < 90; i += 1) {
    const r = rng.range(0.6, 2)
    ctx.fillStyle = rng.chance(0.6) ? css(INK, rng.range(0.06, 0.24)) : css(GLOW, rng.range(0.04, 0.14))
    ctx.fillRect(rng.range(0, width), rng.range(height * 0.1, height), r, r)
  }

  const size = height * 0.42
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '700 ' + Math.round(size) + 'px "STKaiti", "KaiTi", "STSong", "SimSun", serif'
  const text = '活下去'
  for (let i = 0; i < text.length; i += 1) {
    const x = width * (0.2 + i * 0.3)
    const y = height * 0.52
    ctx.fillStyle = css(INK, 0.92)
    ctx.fillText(text.charAt(i), x, y)
    ctx.fillStyle = css(mix(STONE, GLOW, 0.72), 0.34)
    ctx.fillText(text.charAt(i), x, y + Math.max(1, size * 0.05))
  }

  // 风化：字上再盖几粒石屑，刻痕才不会太干净
  for (let i = 0; i < 26; i += 1) {
    ctx.fillStyle = css(mix(STONE, INK, 0.3), rng.range(0.12, 0.4))
    ctx.fillRect(
      rng.range(width * 0.06, width * 0.94),
      rng.range(height * 0.3, height * 0.74),
      rng.range(1, 2.6),
      rng.range(1, 2.6),
    )
  }
  return canvas
}

/** 虚空底噪：纯黑会读成关机，几团极淡的云就够了 */
function bakeMottle(rng: Rng): HTMLCanvasElement {
  const width = 320
  const height = 180
  const canvas = createCanvas(width, height)
  const ctx = context2d(canvas)
  ctx.fillStyle = css(INK)
  ctx.fillRect(0, 0, width, height)
  for (let i = 0; i < 18; i += 1) {
    // 只在中段铺：参考图的四角是 0.8 的纯黑，底噪云一旦均匀铺满整屏，黑就变成了灰
    const x = rng.range(width * 0.22, width * 0.78)
    const y = rng.range(0, height)
    const r = rng.range(width * 0.12, width * 0.34)
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, rng.chance(0.5) ? css(mix([16, 15, 14], INK, 0.3), 0.2) : css(mix(GLOW, INK, 0.96), 0.16))
    grad.addColorStop(1, css(INK, 0))
    ctx.fillStyle = grad
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  return canvas
}

/** 光柱的满亮度系数：参考图里光的核心只有 40 左右的亮度，不是一柱白雾 */
const BEAM_GAIN = 0.22
/** 光柱有效高度（占画面高）：再往下只剩地面反光，不是光本身 */
export const BEAM_REACH = 0.9

/**
 * 光柱：逐像素算一个锥形高斯，再低级放大 —— 解析式没有任何拼接缝，
 * 比横切片叠出来的少一层横向条带（低分辨率放大本身就当柔光用）。
 * 只烘焙"满亮度"的一版，每帧用 globalAlpha 乘呼吸与闪灯 —— 形状不变，不必重画。
 */
function bakeBeam(geo: Geo): HTMLCanvasElement {
  // 0.25 的位图拉到全屏时，暗部会出现横向色阶带（一行源像素铺成四条屏幕行）；
  // 0.4 是能让 8 bit 的渐变在暗部看不出台阶的最省的一档
  const scale = 0.4
  const w = Math.max(32, Math.round(geo.w * scale))
  const h = Math.max(32, Math.round(geo.h * scale))
  const canvas = createCanvas(w, h)
  const ctx = context2d(canvas)
  const image = ctx.createImageData(w, h)
  const data = image.data
  for (let y = 0; y < h; y += 1) {
    const t = y / h / BEAM_REACH
    // 越往下越窄：参考图里这束光是"收到木牌上"的，顶部摊得开、落点只有牌面那么宽
    const half = 0.093 - 0.042 * Math.pow(Math.min(1, t), 0.5)
    const vert = beamProfile(t)
    for (let x = 0; x < w; x += 1) {
      // 归一化半径：1 就是光柱的边。**边要用 smoothstep 硬收**，
      // 纯高斯没有边界，放大之后就是一坨过曝的雾 —— 参考图里能数出这根锥的边线
      const e = Math.abs(x / w - 0.5) / half
      const body = 1 - smoothstep(0.62, 1.16, e)
      // 中间那根更亮的芯：光柱是有体积的，柱心一定比柱边亮一档
      const core = 1 - smoothstep(0, 0.5, e) * 0.42
      // 空气散射：极弱的一大圈，只负责让边不"切"在黑上
      const halo = 0.09 * (1 - smoothstep(0.8, 2.4, e))
      const offset = (y * w + x) * 4
      data[offset] = GLOW[0]
      data[offset + 1] = GLOW[1]
      data[offset + 2] = GLOW[2]
      data[offset + 3] = Math.round(Math.min(1, BEAM_GAIN * vert * (body * core + halo)) * 255)
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

/** 一次性烘焙这一屏要用的全部位图；窗口尺寸变了整体重做 */
export function bakeArtwork(geo: Geo): Artwork {
  const plank = bakePlank(new Rng(4127), geo.plankW * 3, geo.plankH * 3)
  return {
    mottle: bakeMottle(new Rng(907)),
    plank: plank.sharp,
    plankSoft: plank.soft,
    beam: bakeBeam(geo),
    stone: bakeStone(
      new Rng(6613),
      geo.w * LAYOUT.stoneWidth,
      geo.h * LAYOUT.stoneHeight,
    ),
  }
}
