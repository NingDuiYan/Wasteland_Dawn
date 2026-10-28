import { VIEW, ZOMBIE } from '../config'
import type { Rng } from './random'
import type { Box } from './town'

/**
 * 命中判定：射线求交与近战扇形
 *
 * 为什么单独一个文件：求交是纯几何（输入坐标，输出距离），和世界状态无关，
 * 放一起既方便推理，也避免 world.ts 无限膨胀。
 */

export type ShotKind = 'zombie' | 'world' | 'none'

export interface ShotResult {
  /** 这一下是开枪、挥砍还是投掷 */
  action: 'fired' | 'swung' | 'thrown'
  /** 命中类型：zombie=打中丧尸，world=打在建筑/地面/道具上，none=什么都没碰到 */
  kind: ShotKind
  /** 命中的丧尸 id；没打中丧尸时为 0 */
  zombieId: number
  /** 命中点的世界坐标 */
  x: number
  y: number
  z: number
  /** 从眼睛到命中点的距离（米） */
  distance: number
  /** 这一下是否打出击杀 */
  killed: boolean
  /** 命中数：枪械是打中丧尸的弹丸数，近战是扫到的丧尸数 */
  hits: number
}

/** 单位方向向量（x 东 / y 上 / z 南） */
export interface Direction {
  x: number
  y: number
  z: number
}

/** 判定只需要这几个字段：传 ZombieState 时靠结构类型直接兼容 */
export interface HitTarget {
  id: number
  x: number
  z: number
  dead: boolean
}

/** 单颗弹丸的判定结果 */
export interface PelletHit {
  kind: ShotKind
  zombieId: number
  x: number
  y: number
  z: number
  distance: number
}

/** 抬头低头的夹取上限，与 World.look() 用的是同一个角度 */
const MAX_PITCH = (VIEW.maxPitchDeg * Math.PI) / 180

/** 朝向向量：yaw=0 面向 -z，pitch 正数抬头，与相机的 YXZ 旋转完全一致 */
export function faceDirection(yaw: number, pitch: number): Direction {
  const cosPitch = Math.cos(pitch)
  return { x: -Math.sin(yaw) * cosPitch, y: Math.sin(pitch), z: -Math.cos(yaw) * cosPitch }
}

/** 加散布的方向：yaw 与 pitch 各自独立抖动 ±spread（弧度） */
export function spreadDirection(yaw: number, pitch: number, spread: number, rng: Rng): Direction {
  const jitterYaw = yaw + rng.range(-spread, spread)
  const jitterPitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, pitch + rng.range(-spread, spread)))
  return faceDirection(jitterYaw, jitterPitch)
}

/**
 * 单颗弹丸：丧尸圆柱与场景遮挡各求一次最近交点，取更近的那个
 *
 * 先算两者的距离再比较，而不是"命中后补判遮挡" ——
 * 隔着墙打不到人才是这层判定的目的，顺序反了就会出现穿墙击杀。
 */
export function castPellet(
  ox: number,
  oy: number,
  oz: number,
  dir: Direction,
  targets: readonly HitTarget[],
  colliders: readonly Box[],
  range: number,
): PelletHit {
  let zombieDistance = Number.POSITIVE_INFINITY
  let zombieId = 0
  for (const target of targets) {
    if (target.dead) continue
    const t = rayCylinder(ox, oy, oz, dir, target.x, target.z, ZOMBIE.hitRadius, ZOMBIE.hitHeight)
    if (t > 0 && t < zombieDistance) {
      zombieDistance = t
      zombieId = target.id
    }
  }

  const worldDistance = rayWorld(ox, oy, oz, dir, colliders)

  // 超出射程的目标与墙面都不算命中：曳光仍会飞到 range 处，所以命中点不在这里截断
  let kind: ShotKind = 'none'
  let hitZombie = 0
  let distance = range
  if (zombieDistance <= worldDistance && zombieDistance <= range) {
    kind = 'zombie'
    hitZombie = zombieId
    distance = zombieDistance
  } else if (worldDistance <= range) {
    kind = 'world'
    distance = worldDistance
  }
  return {
    kind,
    zombieId: hitZombie,
    x: ox + dir.x * distance,
    y: oy + dir.y * distance,
    z: oz + dir.z * distance,
    distance,
  }
}

/**
 * 挥砍扇形：水平距离 ≤ range，且与朝向夹角 ≤ arcRad
 *
 * 不做遮挡判定：挥砍本来就贴着人，能隔墙砍到的情形只有站在墙缝里才会出现，
 * 为此多跑一遍射线不划算。
 */
export function meleeTargets(
  targets: readonly HitTarget[],
  px: number,
  pz: number,
  yaw: number,
  range: number,
  arcRad: number,
): HitTarget[] {
  const forwardX = -Math.sin(yaw)
  const forwardZ = -Math.cos(yaw)
  const hits: HitTarget[] = []
  for (const target of targets) {
    if (target.dead) continue
    const dx = target.x - px
    const dz = target.z - pz
    const distance = Math.hypot(dx, dz)
    if (distance > range || distance < 1e-4) continue
    const cos = Math.min(1, Math.max(-1, (forwardX * dx + forwardZ * dz) / distance))
    if (Math.acos(cos) > arcRad) continue
    hits.push(target)
  }
  return hits
}

/** 场景遮挡：建筑盒取最近，另外地面也算一层（朝脚下开枪不该穿过地板） */
function rayWorld(ox: number, oy: number, oz: number, dir: Direction, colliders: readonly Box[]): number {
  let nearest = Number.POSITIVE_INFINITY
  for (const box of colliders) {
    const t = rayBox(ox, oy, oz, dir, box)
    if (t > 0 && t < nearest) nearest = t
  }
  if (dir.y < -1e-4) {
    const groundT = -oy / dir.y
    if (groundT > 0 && groundT < nearest) nearest = groundT
  }
  return nearest
}

/** 射线与竖直圆柱（丧尸胶囊体）求交，返回进入距离或 -1 */
function rayCylinder(
  ox: number,
  oy: number,
  oz: number,
  dir: Direction,
  cx: number,
  cz: number,
  radius: number,
  height: number,
): number {
  const mx = ox - cx
  const mz = oz - cz
  const a = dir.x * dir.x + dir.z * dir.z
  if (a < 1e-8) return -1
  const b = 2 * (mx * dir.x + mz * dir.z)
  const c = mx * mx + mz * mz - radius * radius
  const disc = b * b - 4 * a * c
  if (disc < 0) return -1
  const sqrt = Math.sqrt(disc)
  const t1 = (-b - sqrt) / (2 * a)
  const t2 = (-b + sqrt) / (2 * a)
  for (const t of [t1, t2]) {
    if (t <= 0) continue
    const y = oy + dir.y * t
    if (y >= 0 && y <= height) return t
  }
  return -1
}

/** 射线与轴对齐方盒求交（slab 法） */
function rayBox(ox: number, oy: number, oz: number, dir: Direction, box: Box): number {
  let tMin = 0
  let tMax = Number.POSITIVE_INFINITY
  const axes: [number, number, number, number][] = [
    [ox, dir.x, box.minX, box.maxX],
    [oy, dir.y, 0, box.height],
    [oz, dir.z, box.minZ, box.maxZ],
  ]
  for (const [origin, direction, min, max] of axes) {
    if (Math.abs(direction) < 1e-8) {
      if (origin < min || origin > max) return -1
      continue
    }
    const t1 = (min - origin) / direction
    const t2 = (max - origin) / direction
    tMin = Math.max(tMin, Math.min(t1, t2))
    tMax = Math.min(tMax, Math.max(t1, t2))
    if (tMin > tMax) return -1
  }
  return tMin > 0 ? tMin : -1
}

/** 最近目标的查找结果 */
export interface NearestTarget {
  target: HitTarget
  distance: number
}

/** 射程尽头的瞄准点：一颗都没打中时曳光也要有终点，不能凭空消失 */
export function rangePoint(ox: number, oy: number, oz: number, yaw: number, pitch: number, range: number): PelletHit {
  const dir = faceDirection(yaw, pitch)
  return {
    kind: 'none',
    zombieId: 0,
    x: ox + dir.x * range,
    y: oy + dir.y * range,
    z: oz + dir.z * range,
    distance: range,
  }
}

/** 离玩家最近的那个目标：近战的命中特效要落在它身上 */
export function nearestTarget(targets: readonly HitTarget[], x: number, z: number): NearestTarget | null {
  let nearest: HitTarget | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const target of targets) {
    const distance = Math.hypot(target.x - x, target.z - z)
    if (distance < nearestDistance) {
      nearest = target
      nearestDistance = distance
    }
  }
  return nearest ? { target: nearest, distance: nearestDistance } : null
}
