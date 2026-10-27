/**
 * 纯模拟层：第一人称射击的全部规则都在这里，不含任何 three 依赖
 *
 * 只负责"世界怎么变"，不负责"怎么画"。这样做的实际收益是：
 * 命中判定、丧尸推挤、碰撞滑行都能在浏览器之外推理和验证，
 * 而渲染层每一帧只是把 x/z/yaw 抄到 mesh 上。
 *
 * 坐标约定与世界一致：x 向东、z 向南、y 向上，yaw=0 面向 -z（北）。
 */

import { GUN, PLAYER, TIME, WORLD_EXTENT, ZOMBIE } from '../config'
import { Rng } from './random'
import type { Box, TownLayout } from './town'

/** 每帧输入（-1..1 归一化后的轴向量 + 疾跑） */
export interface InputState {
  forward: number
  strafe: number
  run: boolean
}

export interface PlayerState {
  x: number
  z: number
  /** 水平朝向（弧度），0 面向 -z */
  yaw: number
  /** 俯仰（弧度），正数抬头 */
  pitch: number
  hp: number
  /** 弹匣内剩余子弹 */
  ammo: number
  /** 换弹剩余时间，>0 表示正在换弹 */
  reloadLeft: number
  /** 开火冷却 */
  fireLeft: number
  /** 受击后多久开始回血 */
  hurtLeft: number
  dead: boolean
}

export type ZombieVariant = 0 | 1 | 2

export interface ZombieState {
  id: number
  x: number
  z: number
  yaw: number
  hp: number
  maxHp: number
  /** 移动速度（米/秒） */
  speed: number
  variant: ZombieVariant
  /** 行走相位，渲染层拿它驱动四肢摆动 */
  phase: number
  /** 攻击冷却 */
  attackLeft: number
  /** 受击闪白剩余时间 */
  hurtLeft: number
  /** 已经死亡，等待尸体淡出 */
  dead: boolean
  /** 死亡后经过的时间，渲染层用它做倒地动画 */
  deadElapsed: number
}

export type ShotKind = 'zombie' | 'world' | 'none'

export interface ShotResult {
  kind: ShotKind
  /** 命中丧尸时的 id */
  zombieId: number
  x: number
  y: number
  z: number
  distance: number
  /** 这一枪是否把丧尸打死了 */
  killed: boolean
}

/** 尸体停留时长：够玩家看清"打中了"，又不至于堆满地面 */
const CORPSE_SEC = 2.2
/** 走一步的动画频率倍数 */
const STRIDE = 3.4

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2
  return ((angle % twoPi) + twoPi) % twoPi
}

/**
 * 圆 vs 轴对齐方盒：沿最小穿透轴推出去
 *
 * 只做一次推出会留缝（贴着两面墙的夹角时推一个方向又进另一个），
 * 所以渲染层外面还会多跑两轮；这里保持单步、纯函数，便于在推挤循环里复用。
 */
export function pushOutOfBoxes(x: number, z: number, radius: number, boxes: readonly Box[]): { x: number; z: number } {
  let px = x
  let pz = z
  for (const box of boxes) {
    const closestX = clamp(px, box.minX, box.maxX)
    const closestZ = clamp(pz, box.minZ, box.maxZ)
    const dx = px - closestX
    const dz = pz - closestZ
    const distanceSq = dx * dx + dz * dz
    if (distanceSq > radius * radius) continue

    if (distanceSq > 1e-6) {
      const distance = Math.sqrt(distanceSq)
      const push = radius - distance
      px += (dx / distance) * push
      pz += (dz / distance) * push
      continue
    }

    // 圆心已经落在盒子里：朝最近的那条边挤出去，避免除零
    const toLeft = px - box.minX
    const toRight = box.maxX - px
    const toTop = pz - box.minZ
    const toBottom = box.maxZ - pz
    const min = Math.min(toLeft, toRight, toTop, toBottom)
    if (min === toLeft) px = box.minX - radius
    else if (min === toRight) px = box.maxX + radius
    else if (min === toTop) pz = box.minZ - radius
    else pz = box.maxZ + radius
  }
  return { x: px, z: pz }
}

/** 射线与竖直圆柱（丧尸胶囊体）求交，返回进入距离或 -1 */
function rayCylinder(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cz: number,
  radius: number,
  height: number,
): number {
  const mx = ox - cx
  const mz = oz - cz
  const a = dx * dx + dz * dz
  if (a < 1e-8) return -1
  const b = 2 * (mx * dx + mz * dz)
  const c = mx * mx + mz * mz - radius * radius
  const disc = b * b - 4 * a * c
  if (disc < 0) return -1
  const sqrt = Math.sqrt(disc)
  const t1 = (-b - sqrt) / (2 * a)
  const t2 = (-b + sqrt) / (2 * a)
  for (const t of [t1, t2]) {
    if (t <= 0) continue
    const y = oy + dy * t
    if (y >= 0 && y <= height) return t
  }
  return -1
}

/** 射线与轴对齐方盒求交（slab 法） */
function rayBox(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  box: Box,
): number {
  let tMin = 0
  let tMax = Number.POSITIVE_INFINITY
  const axes: [number, number, number, number][] = [
    [ox, dx, box.minX, box.maxX],
    [oy, dy, 0, box.height],
    [oz, dz, box.minZ, box.maxZ],
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

export class World {
  readonly layout: TownLayout
  readonly player: PlayerState = {
    x: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    hp: PLAYER.hp,
    ammo: GUN.ammoPerMag,
    reloadLeft: 0,
    fireLeft: 0,
    hurtLeft: 0,
    dead: false,
  }

  readonly zombies: ZombieState[] = []
  kills = 0
  elapsedSec = 0

  private readonly rng: Rng
  private nextZombieId = 1
  private respawnLeft = 0

  constructor(layout: TownLayout, seed: number) {
    this.layout = layout
    this.rng = new Rng(seed ^ 0x9e3779b9)
    this.player.x = layout.spawn.x
    this.player.z = layout.spawn.z
    this.player.yaw = layout.spawn.yaw
    for (let i = 0; i < Math.min(6, ZOMBIE.maxAlive); i += 1) this.spawnZombie(true)
  }

  /** 当前时刻（0..24） */
  get hour(): number {
    const hours = TIME.startHour + (this.elapsedSec / TIME.cycleSec) * 24
    return hours % 24
  }

  get isNight(): boolean {
    const h = this.hour
    return h < TIME.dawnHour || h > TIME.duskHour
  }

  /** 夜里丧尸追得更远：白天能绕开的街区，晚上绕不过去 */
  get chaseRange(): number {
    return this.isNight ? ZOMBIE.chaseRangeNight : ZOMBIE.chaseRangeDay
  }

  look(deltaX: number, deltaY: number, sensitivity: number): void {
    const maxPitch = (85 * Math.PI) / 180
    this.player.yaw = wrapAngle(this.player.yaw - deltaX * sensitivity)
    this.player.pitch = clamp(this.player.pitch - deltaY * sensitivity, -maxPitch, maxPitch)
  }

  update(dtSec: number, input: InputState): void {
    if (this.player.dead) return
    this.elapsedSec += dtSec
    this.advanceTimers(dtSec)
    this.movePlayer(dtSec, input)
    this.stepZombies(dtSec)
    this.tickRespawn(dtSec)
  }

  private advanceTimers(dtSec: number): void {
    const p = this.player
    p.fireLeft = Math.max(0, p.fireLeft - dtSec)
    p.hurtLeft = Math.max(0, p.hurtLeft - dtSec)
    if (p.reloadLeft > 0) {
      p.reloadLeft -= dtSec
      if (p.reloadLeft <= 0) {
        p.reloadLeft = 0
        p.ammo = GUN.ammoPerMag
      }
    }
    // 脱离战斗后缓慢回血：让玩家敢从小规模遭遇战里撤出来
    const hurtRecently = p.hurtLeft > 0
    if (!hurtRecently && p.hp < PLAYER.hp) {
      p.hp = Math.min(PLAYER.hp, p.hp + PLAYER.regenPerSec * dtSec)
    }
  }

  private movePlayer(dtSec: number, input: InputState): void {
    const p = this.player
    const sin = Math.sin(p.yaw)
    const cos = Math.cos(p.yaw)
    // 前 = (-sin, -cos)，右 = (cos, -sin)
    let mx = -sin * input.forward + cos * input.strafe
    let mz = -cos * input.forward - sin * input.strafe
    const length = Math.hypot(mx, mz)
    if (length > 1e-4) {
      mx /= length
      mz /= length
      const speed = (input.run ? PLAYER.runSpeed : PLAYER.walkSpeed) * dtSec
      p.x += mx * speed
      p.z += mz * speed
    }
    // 推两轮：贴着墙角走的时候一次推出会把角色顶进另一面墙
    for (let i = 0; i < 2; i += 1) {
      const solved = pushOutOfBoxes(p.x, p.z, PLAYER.radius, this.layout.colliders)
      p.x = solved.x
      p.z = solved.z
    }
    p.x = clamp(p.x, -WORLD_EXTENT + 2, WORLD_EXTENT - 2)
    p.z = clamp(p.z, -WORLD_EXTENT + 2, WORLD_EXTENT - 2)
  }

  private stepZombies(dtSec: number): void {
    const p = this.player
    for (const zombie of this.zombies) {
      if (zombie.dead) {
        zombie.deadElapsed += dtSec
        continue
      }
      zombie.hurtLeft = Math.max(0, zombie.hurtLeft - dtSec)
      zombie.attackLeft = Math.max(0, zombie.attackLeft - dtSec)

      const dx = p.x - zombie.x
      const dz = p.z - zombie.z
      const distance = Math.hypot(dx, dz)
      if (distance > this.chaseRange) {
        // 超出感知范围就原地摇晃，玩家因此能绕过一整片街区
        zombie.phase += dtSec * 0.6
        continue
      }

      if (distance <= ZOMBIE.attackRange) {
        if (zombie.attackLeft <= 0) {
          zombie.attackLeft = ZOMBIE.attackIntervalSec
          this.hurtPlayer(ZOMBIE.damage)
        }
        zombie.yaw = Math.atan2(dx, dz)
        zombie.phase += dtSec * STRIDE * 0.4
        continue
      }

      const step = zombie.speed * dtSec
      zombie.x += (dx / distance) * step
      zombie.z += (dz / distance) * step
      zombie.yaw = Math.atan2(dx, dz)
      zombie.phase += dtSec * STRIDE
      this.separate(zombie)
    }

    // 推挤之后再统一解一次墙，避免丧尸叠进建筑里
    for (const zombie of this.zombies) {
      if (zombie.dead) continue
      const solved = pushOutOfBoxes(zombie.x, zombie.z, 0.36, this.layout.colliders)
      zombie.x = clamp(solved.x, -WORLD_EXTENT + 2, WORLD_EXTENT - 2)
      zombie.z = clamp(solved.z, -WORLD_EXTENT + 2, WORLD_EXTENT - 2)
    }

    // 尸体停留够久就回收，同时在远处补一只，保证场上数量稳定
    for (let i = this.zombies.length - 1; i >= 0; i -= 1) {
      if (this.zombies[i].dead && this.zombies[i].deadElapsed > CORPSE_SEC) this.zombies.splice(i, 1)
    }
  }

  private separate(zombie: ZombieState): void {
    for (const other of this.zombies) {
      if (other === zombie || other.dead) continue
      const dx = zombie.x - other.x
      const dz = zombie.z - other.z
      const distance = Math.hypot(dx, dz)
      if (distance < 1e-4 || distance >= ZOMBIE.separation) continue
      const push = (ZOMBIE.separation - distance) * 0.5
      zombie.x += (dx / distance) * push
      zombie.z += (dz / distance) * push
    }
  }

  private hurtPlayer(amount: number): void {
    this.player.hp = Math.max(0, this.player.hp - amount)
    this.player.hurtLeft = PLAYER.regenDelaySec
    if (this.player.hp <= 0) this.player.dead = true
  }

  private tickRespawn(dtSec: number): void {
    const alive = this.zombies.filter((z) => !z.dead).length
    if (alive >= ZOMBIE.maxAlive) {
      this.respawnLeft = ZOMBIE.respawnSec
      return
    }
    this.respawnLeft -= dtSec
    if (this.respawnLeft <= 0) {
      this.respawnLeft = ZOMBIE.respawnSec
      this.spawnZombie(false)
    }
  }

  private spawnZombie(initial: boolean): void {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      // initial 时铺满一圈，之后只在玩家看不见的远处补
      const angle = this.rng.range(0, Math.PI * 2)
      const distance = initial
        ? this.rng.range(ZOMBIE.spawnMinDistance, ZOMBIE.spawnMaxDistance)
        : this.rng.range(ZOMBIE.spawnMinDistance + 6, ZOMBIE.spawnMaxDistance)
      const x = this.player.x + Math.cos(angle) * distance
      const z = this.player.z + Math.sin(angle) * distance
      if (Math.abs(x) > WORLD_EXTENT - 6 || Math.abs(z) > WORLD_EXTENT - 6) continue
      const solved = pushOutOfBoxes(x, z, 0.5, this.layout.colliders)
      if (Math.hypot(solved.x - x, solved.z - z) > 0.01) continue
      const variant: ZombieVariant = this.rng.chance(0.25) ? (this.rng.chance(0.3) ? 2 : 1) : 0
      this.zombies.push({
        id: this.nextZombieId++,
        x,
        z,
        yaw: 0,
        hp: ZOMBIE.hp * (variant === 2 ? 1.8 : variant === 1 ? 0.7 : 1),
        maxHp: ZOMBIE.hp * (variant === 2 ? 1.8 : variant === 1 ? 0.7 : 1),
        speed: this.rng.range(ZOMBIE.speedMin, ZOMBIE.speedMax) * (variant === 1 ? 1.45 : variant === 2 ? 0.7 : 1),
        variant,
        phase: this.rng.range(0, Math.PI * 2),
        attackLeft: 0,
        hurtLeft: 0,
        dead: false,
        deadElapsed: 0,
      })
      return
    }
  }

  /** 换弹：弹匣已满或者正在换弹就忽略 */
  reload(): void {
    const p = this.player
    if (p.dead || p.reloadLeft > 0 || p.ammo >= GUN.ammoPerMag) return
    p.reloadLeft = GUN.reloadSec
  }

  /**
   * 开一枪；返回 null 表示枪还没响（冷却中 / 换弹中 / 没子弹 / 已死亡）
   *
   * 命中判定完全在同一帧内完成：先求最近的丧尸交点，再求最近的场景遮挡交点，
   * 取更近的那个。这个顺序保证"墙后的丧尸打不到"，而不是先打中再判断遮挡。
   */
  shoot(): ShotResult | null {
    const p = this.player
    if (p.dead || p.fireLeft > 0 || p.reloadLeft > 0) return null
    if (p.ammo <= 0) {
      this.reload()
      return null
    }
    p.ammo -= 1
    p.fireLeft = GUN.fireIntervalSec
    if (p.ammo === 0) this.reload()

    const ox = p.x
    const oy = PLAYER.eyeHeight
    const oz = p.z
    const dir = this.direction()

    let zombieDistance = Number.POSITIVE_INFINITY
    let hitZombie: ZombieState | null = null
    for (const zombie of this.zombies) {
      if (zombie.dead) continue
      const t = rayCylinder(
        ox,
        oy,
        oz,
        dir.x,
        dir.y,
        dir.z,
        zombie.x,
        zombie.z,
        ZOMBIE.hitRadius,
        ZOMBIE.hitHeight,
      )
      if (t > 0 && t < zombieDistance) {
        zombieDistance = t
        hitZombie = zombie
      }
    }

    let worldDistance = Number.POSITIVE_INFINITY
    for (const box of this.layout.colliders) {
      const t = rayBox(ox, oy, oz, dir.x, dir.y, dir.z, box)
      if (t > 0 && t < worldDistance) worldDistance = t
    }
    // 地面也算遮挡：朝脚下开枪不该穿过地板
    if (dir.y < -1e-4) {
      const groundT = -oy / dir.y
      if (groundT > 0 && groundT < worldDistance) worldDistance = groundT
    }
    if (worldDistance > GUN.range) worldDistance = Number.POSITIVE_INFINITY

    if (hitZombie && zombieDistance <= worldDistance) {
      const killed = this.damageZombie(hitZombie.id, GUN.damage)
      return this.makeShot('zombie', hitZombie.id, ox, oy, oz, dir, zombieDistance, killed)
    }
    if (worldDistance < Number.POSITIVE_INFINITY) {
      return this.makeShot('world', 0, ox, oy, oz, dir, worldDistance, false)
    }
    // 打空了：曳光仍然朝远处飞出去，视觉上不能凭空消失
    return this.makeShot('none', 0, ox, oy, oz, dir, GUN.range, false)
  }

  private makeShot(
    kind: ShotKind,
    zombieId: number,
    ox: number,
    oy: number,
    oz: number,
    dir: { x: number; y: number; z: number },
    distance: number,
    killed: boolean,
  ): ShotResult {
    return {
      kind,
      zombieId,
      x: ox + dir.x * distance,
      y: oy + dir.y * distance,
      z: oz + dir.z * distance,
      distance,
      killed,
    }
  }

  /** 含散布的射击方向（yaw 与 pitch 各自加一点随机） */
  private direction(): { x: number; y: number; z: number } {
    const p = this.player
    const yaw = p.yaw + this.rng.range(-GUN.spread, GUN.spread)
    const pitch = clamp(p.pitch + this.rng.range(-GUN.spread, GUN.spread), -1.45, 1.45)
    const cosPitch = Math.cos(pitch)
    return { x: -Math.sin(yaw) * cosPitch, y: Math.sin(pitch), z: -Math.cos(yaw) * cosPitch }
  }

  damageZombie(id: number, amount: number): boolean {
    const zombie = this.zombies.find((z) => z.id === id)
    if (!zombie || zombie.dead) return false
    zombie.hp -= amount
    zombie.hurtLeft = 0.12
    if (zombie.hp > 0) return false
    zombie.dead = true
    zombie.deadElapsed = 0
    this.kills += 1
    return true
  }
}
