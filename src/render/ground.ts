/**
 * 地面：一张按小镇布局画出来的路面贴图
 *
 * 为什么还要烘焙成大贴图，而不是用几个平铺材质拼：
 * 第一人称贴地看，任何平铺都会在 3 米内暴露重复。街道、人行道、斑马线、井盖、
 * 裂缝这些东西的位置本来就是布局的一部分，只有按真实坐标画一遍才不会穿帮。
 * 尺寸 = 世界边长 × pxPerMeter（220m × 8px/m = 1760px 见方），一次画好常驻显存。
 */

import * as THREE from 'three'
import { PALETTE, TOWN, WORLD, WORLD_EXTENT } from '../config'
import { Rng } from '../sim/random'
import type { TownLayout } from '../sim/town'

const SIZE_PX = Math.round(WORLD.size * TOWN.pxPerMeter)

/** 世界坐标 → 贴图像素 */
function toPx(value: number): number {
  return (value + WORLD_EXTENT) * TOWN.pxPerMeter
}

function css(hex: number, alpha = 1): string {
  const r = (hex >> 16) & 0xff
  const g = (hex >> 8) & 0xff
  const b = hex & 0xff
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** 一层抖动泥地：大块色斑 + 细颗粒，避免纯色地面像塑料 */
function paintDirtBase(ctx: CanvasRenderingContext2D, rng: Rng): void {
  ctx.fillStyle = css(PALETTE.dirt)
  ctx.fillRect(0, 0, SIZE_PX, SIZE_PX)

  for (let i = 0; i < 900; i += 1) {
    const x = rng.next() * SIZE_PX
    const y = rng.next() * SIZE_PX
    const r = rng.range(18, 90)
    const dark = rng.chance(0.5)
    ctx.fillStyle = css(dark ? PALETTE.dirtDark : PALETTE.sidewalk, rng.range(0.04, 0.1))
    ctx.beginPath()
    ctx.ellipse(x, y, r, r * rng.range(0.5, 1), rng.range(0, Math.PI), 0, Math.PI * 2)
    ctx.fill()
  }

  for (let i = 0; i < 14000; i += 1) {
    const x = rng.next() * SIZE_PX
    const y = rng.next() * SIZE_PX
    ctx.fillStyle = css(rng.chance(0.5) ? PALETTE.dirtDark : 0x8b7c65, rng.range(0.06, 0.22))
    ctx.fillRect(x, y, rng.range(1, 2.6), rng.range(1, 2.6))
  }
}

/** 一条街：车行道 + 两侧人行道；横向竖向各调用一次 */
function paintStreet(ctx: CanvasRenderingContext2D, rng: Rng, center: number, vertical: boolean): void {
  const half = TOWN.streetWidth / 2
  const walk = TOWN.sidewalkWidth
  const band = (from: number, to: number, color: number, alpha = 1): void => {
    const a = toPx(from)
    const b = toPx(to)
    ctx.fillStyle = css(color, alpha)
    if (vertical) ctx.fillRect(a, 0, b - a, SIZE_PX)
    else ctx.fillRect(0, a, SIZE_PX, b - a)
  }

  band(center - half - walk, center + half + walk, PALETTE.sidewalk)
  band(center - half, center + half, PALETTE.asphalt)

  // 路面磨损：沿街撒一些偏亮的补丁与深色油渍
  const lengthPx = SIZE_PX
  for (let i = 0; i < 70; i += 1) {
    const along = rng.next() * lengthPx
    const across = toPx(center + rng.range(-half + 0.4, half - 0.4))
    const r = rng.range(6, 26)
    ctx.fillStyle = css(rng.chance(0.45) ? PALETTE.asphaltWorn : PALETTE.crack, rng.range(0.1, 0.3))
    ctx.beginPath()
    ctx.ellipse(
      vertical ? across : along,
      vertical ? along : across,
      r,
      r * rng.range(0.4, 0.9),
      0,
      0,
      Math.PI * 2,
    )
    ctx.fill()
  }

  // 中线虚线：2.4 米实、1.6 米空，用米写是为了换街道宽度时不失调
  const dash = 2.4
  const gap = 1.6
  ctx.fillStyle = css(PALETTE.line, 0.55)
  for (let m = -WORLD_EXTENT; m < WORLD_EXTENT; m += dash + gap) {
    const a = toPx(m)
    const b = toPx(Math.min(m + dash, WORLD_EXTENT))
    const thickness = 0.16 * TOWN.pxPerMeter
    if (vertical) ctx.fillRect(toPx(center) - thickness / 2, a, thickness, b - a)
    else ctx.fillRect(a, toPx(center) - thickness / 2, b - a, thickness)
  }
}

/** 路口斑马线：每个方向 5 条，让街区交点有"街道"该有的细节 */
function paintCrosswalks(ctx: CanvasRenderingContext2D, streets: readonly number[]): void {
  const half = TOWN.streetWidth / 2
  const stripe = 0.55
  const step = 1.15
  ctx.fillStyle = css(0xd8d2c4, 0.5)
  for (const sx of streets) {
    for (const sz of streets) {
      for (let i = 0; i < 5; i += 1) {
        const offset = -half + 1.1 + i * step
        // 竖向街道上的横条
        ctx.fillRect(toPx(sx + offset), toPx(sz - half - 1.4), stripe * TOWN.pxPerMeter, 1.4 * TOWN.pxPerMeter)
        ctx.fillRect(toPx(sx + offset), toPx(sz + half), stripe * TOWN.pxPerMeter, 1.4 * TOWN.pxPerMeter)
        // 横向街道上的竖条
        ctx.fillRect(toPx(sx - half - 1.4), toPx(sz + offset), 1.4 * TOWN.pxPerMeter, stripe * TOWN.pxPerMeter)
        ctx.fillRect(toPx(sx + half), toPx(sz + offset), 1.4 * TOWN.pxPerMeter, stripe * TOWN.pxPerMeter)
      }
    }
  }
}

/** 裂缝：从街面随机一点出发的折线，越到后面越细 */
function paintCracks(ctx: CanvasRenderingContext2D, rng: Rng, streets: readonly number[]): void {
  ctx.strokeStyle = css(PALETTE.crack, 0.5)
  for (let i = 0; i < 160; i += 1) {
    const street = rng.pick(streets)
    let x = rng.chance(0.5) ? street + rng.range(-4, 4) : rng.range(-WORLD_EXTENT, WORLD_EXTENT)
    let y = rng.chance(0.5) ? street + rng.range(-4, 4) : rng.range(-WORLD_EXTENT, WORLD_EXTENT)
    let angle = rng.range(0, Math.PI * 2)
    ctx.lineWidth = rng.range(0.6, 1.8)
    ctx.beginPath()
    ctx.moveTo(toPx(x), toPx(y))
    const segments = rng.int(3, 7)
    for (let s = 0; s < segments; s += 1) {
      angle += rng.range(-0.7, 0.7)
      const len = rng.range(0.6, 2.4)
      x += Math.cos(angle) * len
      y += Math.sin(angle) * len
      ctx.lineTo(toPx(x), toPx(y))
    }
    ctx.stroke()
  }
}

/** 井盖：圆 + 内圈，出现在街与街之间的人行道上 */
function paintManholes(ctx: CanvasRenderingContext2D, rng: Rng, streets: readonly number[]): void {
  for (let i = 0; i < 26; i += 1) {
    const street = rng.pick(streets)
    const along = rng.range(-WORLD_EXTENT + 6, WORLD_EXTENT - 6)
    const vertical = rng.chance(0.5)
    const x = vertical ? street + rng.range(-3.4, 3.4) : along
    const y = vertical ? along : street + rng.range(-3.4, 3.4)
    const r = 0.42 * TOWN.pxPerMeter
    ctx.fillStyle = css(PALETTE.metal, 0.55)
    ctx.beginPath()
    ctx.arc(toPx(x), toPx(y), r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = css(PALETTE.crack, 0.5)
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.arc(toPx(x), toPx(y), r * 0.66, 0, Math.PI * 2)
    ctx.stroke()
  }
}

/** 小镇布局 → 路面贴图 */
export function paintGround(layout: TownLayout, seed: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE_PX
  canvas.height = SIZE_PX
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('地面贴图：拿不到 2D 上下文')

  const rng = new Rng(seed)
  paintDirtBase(ctx, rng)

  const verticals = layout.streets
  const horizontals = layout.streets
  for (const street of horizontals) paintStreet(ctx, rng, street, false)
  for (const street of verticals) paintStreet(ctx, rng, street, true)

  // 人行道边缘压一道暗线，街道与荒地的交界才"咬得住"
  ctx.strokeStyle = css(PALETTE.crack, 0.45)
  ctx.lineWidth = 1.6
  for (const street of horizontals) {
    const edge = TOWN.streetWidth / 2 + TOWN.sidewalkWidth
    ctx.beginPath()
    ctx.moveTo(0, toPx(street - edge))
    ctx.lineTo(SIZE_PX, toPx(street - edge))
    ctx.moveTo(0, toPx(street + edge))
    ctx.lineTo(SIZE_PX, toPx(street + edge))
    ctx.stroke()
  }
  for (const street of verticals) {
    const edge = TOWN.streetWidth / 2 + TOWN.sidewalkWidth
    ctx.beginPath()
    ctx.moveTo(toPx(street - edge), 0)
    ctx.lineTo(toPx(street - edge), SIZE_PX)
    ctx.moveTo(toPx(street + edge), 0)
    ctx.lineTo(toPx(street + edge), SIZE_PX)
    ctx.stroke()
  }

  paintCracks(ctx, rng, layout.streets)
  paintCrosswalks(ctx, layout.streets)
  paintManholes(ctx, rng, layout.streets)

  // 荒地碎屑：成簇撒，均匀撒会读成噪点。
  // 一张贴图铺满整个世界、不重复采样，所以不用管接缝，直接画一遍即可
  for (let c = 0; c < 90; c += 1) {
    const cx = rng.next() * SIZE_PX
    const cy = rng.next() * SIZE_PX
    for (let i = 0; i < 14; i += 1) {
      const x = cx + rng.range(-26, 26)
      const y = cy + rng.range(-20, 20)
      ctx.fillStyle = css(rng.chance(0.5) ? PALETTE.dirtDark : 0x6e6250, rng.range(0.2, 0.5))
      ctx.fillRect(x, y, rng.range(1.5, 4), rng.range(1, 3))
    }
  }

  return canvas
}

/** 法线贴图：让地面在逆光下有细微起伏，纯色平面在第一人称里"太干净" */
function paintNormal(size: number, seed: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('地面法线：拿不到 2D 上下文')
  const image = ctx.createImageData(size, size)
  const rng = new Rng(seed)
  // 低频高度场：直接在像素网格上做一次模糊随机，够用且省事
  const height = new Float32Array(size * size)
  for (let i = 0; i < height.length; i += 1) height[i] = rng.next()
  const blurred = new Float32Array(size * size)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const sx = (x + dx + size) % size
          const sy = (y + dy + size) % size
          sum += height[sy * size + sx]
        }
      }
      blurred[y * size + x] = sum / 9
    }
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const left = blurred[y * size + ((x - 1 + size) % size)]
      const right = blurred[y * size + ((x + 1) % size)]
      const up = blurred[((y - 1 + size) % size) * size + x]
      const down = blurred[((y + 1) % size) * size + x]
      const i = (y * size + x) * 4
      image.data[i] = Math.round((left - right) * 128 + 128)
      image.data[i + 1] = Math.round((up - down) * 128 + 128)
      image.data[i + 2] = 255
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(WORLD.size / 7, WORLD.size / 7)
  return texture
}

/** 地面网格：贴图 + 法线，铺满整个世界 */
export function createGround(layout: TownLayout, seed: number): THREE.Mesh {
  const texture = new THREE.CanvasTexture(paintGround(layout, seed))
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  // 一张贴图铺满世界，不再重复采样，所以不需要 RepeatWrapping

  const geometry = new THREE.PlaneGeometry(WORLD.size, WORLD.size)
  geometry.rotateX(-Math.PI / 2)
  const material = new THREE.MeshLambertMaterial({
    map: texture,
    normalMap: paintNormal(256, seed ^ 0x51ed270b),
    normalScale: new THREE.Vector2(0.35, 0.35),
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'ground'
  mesh.receiveShadow = true

  // 世界之外还得有"地"：远景楼群站在 ±110 米以外，没有这一层它们就悬在天上
  const apronGeometry = new THREE.PlaneGeometry(WORLD.size * 4, WORLD.size * 4)
  apronGeometry.rotateX(-Math.PI / 2)
  const apron = new THREE.Mesh(apronGeometry, new THREE.MeshLambertMaterial({ color: 0x3d3227 }))
  apron.position.y = -0.03
  apron.name = 'ground-apron'
  mesh.add(apron)

  return mesh
}
