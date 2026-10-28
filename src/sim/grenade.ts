import type { ThrowableSpec } from '../weapons'
import type { Box } from './town'

/**
 * 投掷物的 sim 侧状态。渲染层只读，不要在这里碰 three。
 */

/** 空中的投掷物。落地后弹几次就躺平，靠引信倒计时引爆 */
export interface GrenadeState {
  id: number
  spec: ThrowableSpec
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** 剩余引信秒数，<= 0 即爆炸 */
  fuseLeft: number
  /** 已经弹了几次，超过 GRENADE.maxBounces 就不再弹 */
  bounces: number
}

/** 一次爆炸：伤害由 sim 在生成时就结算完，渲染层只负责表演 */
export interface Explosion {
  x: number
  y: number
  z: number
  radius: number
}

/** 出手状态：玩家眼位 + 水平朝向，投掷物从这里飞出去 */
export interface ThrowOrigin {
  x: number
  y: number
  z: number
  yaw: number
}

/** 爆炸只需要平面位置：传 ZombieState 时靠结构类型直接兼容 */
export interface BlastPoint {
  x: number
  z: number
}

/** 投掷物的物理常数：重力与地面弹性，独立于 weapons.ts 的具体武器 */
export const GRENADE = {
  /** 重力加速度，和世界其它地方保持同一个量级 */
  gravity: 16,
  /** 落地保留的水平速度比例 */
  groundFriction: 0.55,
  /** 落地反弹的竖直速度比例 */
  restitution: 0.32,
  /** 弹几次后躺平 */
  maxBounces: 3,
  /** 击中建筑盒时的能量损耗 */
  wallDamping: 0.45,
  /** 碰撞半径：看不见的小球，用来做落地与撞墙判定（躺平时就停在这个高度） */
  radius: 0.09,
} as const

/** 出手点往前挪的距离：从眼睛里冒出来的手雷会先糊自己一脸 */
const THROW_FORWARD = 0.42
/** 出手点往下压的距离：手是往下甩的，抛物线起点比视线低 */
const THROW_DROP = 0.2

/**
 * 生成一个刚脱手的投掷物
 *
 * 速度按「水平朝向 × 初速 + 上抛分量」合成：朝向只有水平分量，
 * 拱高交给 throwLift 单独控制，这样射程与拱高可以分开调。
 */
export function createGrenade(id: number, spec: ThrowableSpec, from: ThrowOrigin): GrenadeState {
  const forwardX = -Math.sin(from.yaw)
  const forwardZ = -Math.cos(from.yaw)
  return {
    id,
    spec,
    x: from.x + forwardX * THROW_FORWARD,
    y: from.y - THROW_DROP,
    z: from.z + forwardZ * THROW_FORWARD,
    vx: forwardX * spec.throwSpeed,
    vy: spec.throwLift,
    vz: forwardZ * spec.throwSpeed,
    fuseLeft: spec.fuseSec,
    bounces: 0,
  }
}

/**
 * 推进一帧：引信倒计时 → 重力积分 → 落地反弹 → 撞墙回弹
 *
 * 弹够次数就躺平、不再积分：否则每一帧都会在贴地与下落之间反复抖一次，
 * 渲染层看到的手雷会一直抽搐。引信在躺平后照常走，所以先倒计时再返回。
 */
export function stepGrenade(grenade: GrenadeState, dtSec: number, colliders: readonly Box[]): void {
  grenade.fuseLeft -= dtSec
  if (grenade.bounces > GRENADE.maxBounces) return

  grenade.vy -= GRENADE.gravity * dtSec
  grenade.x += grenade.vx * dtSec
  grenade.y += grenade.vy * dtSec
  grenade.z += grenade.vz * dtSec

  if (grenade.y <= GRENADE.radius) {
    grenade.y = GRENADE.radius
    grenade.bounces += 1
    grenade.vx *= GRENADE.groundFriction
    grenade.vz *= GRENADE.groundFriction
    if (grenade.bounces > GRENADE.maxBounces) {
      grenade.vx = 0
      grenade.vy = 0
      grenade.vz = 0
    } else {
      grenade.vy = -grenade.vy * GRENADE.restitution
    }
  }
  bounceOffWalls(grenade, colliders)
}

/** 撞墙：进入盒子的水平范围后，沿穿透最浅的那条轴弹开并衰减该轴速度 */
function bounceOffWalls(grenade: GrenadeState, colliders: readonly Box[]): void {
  const radius = GRENADE.radius
  for (const box of colliders) {
    // 从矮墙上方飞过去不算撞墙，所以先比高度
    if (grenade.y - radius > box.height) continue
    const toMinX = grenade.x - (box.minX - radius)
    const toMaxX = box.maxX + radius - grenade.x
    const toMinZ = grenade.z - (box.minZ - radius)
    const toMaxZ = box.maxZ + radius - grenade.z
    if (toMinX <= 0 || toMaxX <= 0 || toMinZ <= 0 || toMaxZ <= 0) continue

    const depth = Math.min(toMinX, toMaxX, toMinZ, toMaxZ)
    if (depth === toMinX) {
      grenade.x = box.minX - radius
      grenade.vx = -grenade.vx * GRENADE.wallDamping
    } else if (depth === toMaxX) {
      grenade.x = box.maxX + radius
      grenade.vx = -grenade.vx * GRENADE.wallDamping
    } else if (depth === toMinZ) {
      grenade.z = box.minZ - radius
      grenade.vz = -grenade.vz * GRENADE.wallDamping
    } else {
      grenade.z = box.maxZ + radius
      grenade.vz = -grenade.vz * GRENADE.wallDamping
    }
  }
}

/**
 * 爆炸对单个目标的伤害：爆心满伤，边缘线性衰减到 0，超出半径没有伤害
 *
 * 只看水平距离：目标是贴地走的丧尸，爆炸高度不该让炸点正下方的丧尸少吃伤害。
 */
export function blastDamage(spec: ThrowableSpec, x: number, z: number, target: BlastPoint): number {
  const distance = Math.hypot(target.x - x, target.z - z)
  if (distance >= spec.radius) return 0
  return spec.damage * (1 - distance / spec.radius)
}
