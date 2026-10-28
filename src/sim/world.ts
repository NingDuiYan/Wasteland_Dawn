/**
 * 纯模拟层：第一人称射击的全部规则都在这里，不含任何 three 依赖
 *
 * 只负责"世界怎么变"，不负责"怎么画"。这样做的实际收益是：
 * 命中判定、丧尸推挤、碰撞滑行都能在浏览器之外推理和验证，
 * 而渲染层每一帧只是把 x/z/yaw 抄到 mesh 上。
 *
 * 坐标约定与世界一致：x 向东、z 向南、y 向上，yaw=0 面向 -z（北）。
 */

import { PLAYER, TIME, WORLD_EXTENT, ZOMBIE } from '../config'
import { DEFAULT_LOADOUT, GUNS, THROWABLES, slotSpec } from '../weapons'
import type { GunSpec, Loadout, MeleeSpec, ThrowableSpec, WeaponId, WeaponSlot, WeaponSpec } from '../weapons'
import { blastDamage, createGrenade, stepGrenade } from './grenade'
import type { Explosion, GrenadeState } from './grenade'
import { Rng } from './random'
import { castPellet, meleeTargets, nearestTarget, rangePoint, spreadDirection } from './shooting'
import type { PelletHit, ShotResult } from './shooting'
import type { Box, TownLayout } from './town'

export type { ShotKind, ShotResult } from './shooting'

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
  /** 当前拿在手上的槽位 */
  slot: WeaponSlot
  /** 本局装备方案：四个槽位各自的武器 id */
  loadout: Loadout
  /**
   * 每把枪自己的弹匣余弹：按武器记而不是按槽位记，
   * 换到副武器再换回来，主武器还剩几发就是几发。近战与投掷填 0 占位。
   */
  ammoByWeapon: Record<WeaponId, number>
  /** 剩余投掷物数量 */
  throwLeft: number
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

/** 尸体停留时长：够玩家看清"打中了"，又不至于堆满地面 */
const CORPSE_SEC = 2.2
/** 走一步的动画频率倍数 */
const STRIDE = 3.4
/** 两次投掷的最小间隔：手滑连点也不会一次扔出两个 */
const THROW_INTERVAL_SEC = 0.35
/** 丧尸受击白闪持续时长：短到像被打了一下，长到肉眼能看见 */
const ZOMBIE_HURT_SEC = 0.12

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2
  return ((angle % twoPi) + twoPi) % twoPi
}

/** 开局的弹匣：每把枪都是满的，近战与投掷不耗弹药，填 0 占位 */
function initialAmmo(): Record<WeaponId, number> {
  const ammo: Record<WeaponId, number> = { rifle: 0, shotgun: 0, pistol: 0, revolver: 0, machete: 0, bat: 0, grenade: 0, molotov: 0 }
  for (const gun of Object.values(GUNS)) ammo[gun.id] = gun.ammoPerMag
  return ammo
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

export class World {
  readonly layout: TownLayout
  readonly player: PlayerState
  readonly zombies: ZombieState[] = []
  /** 空中的投掷物：渲染层每帧读它画手雷 */
  readonly grenades: GrenadeState[] = []
  kills = 0
  elapsedSec = 0

  private readonly rng: Rng
  /** 本帧待消费的爆炸事件，由 drainExplosions 取走 */
  private readonly explosions: Explosion[] = []
  private nextZombieId = 1
  private nextGrenadeId = 1
  private respawnLeft = 0

  constructor(layout: TownLayout, seed: number, loadout: Loadout = { ...DEFAULT_LOADOUT }) {
    this.layout = layout
    this.rng = new Rng(seed ^ 0x9e3779b9)
    this.player = {
      x: layout.spawn.x,
      z: layout.spawn.z,
      yaw: layout.spawn.yaw,
      pitch: 0,
      hp: PLAYER.hp,
      slot: 'primary',
      loadout,
      ammoByWeapon: initialAmmo(),
      throwLeft: THROWABLES[loadout.throwable].count,
      reloadLeft: 0,
      fireLeft: 0,
      hurtLeft: 0,
      dead: false,
    }
    for (let i = 0; i < Math.min(6, ZOMBIE.maxAlive); i += 1) this.spawnZombie(true)
  }

  /** 当前拿在手上的武器数值 */
  get weapon(): WeaponSpec {
    return slotSpec(this.player.loadout, this.player.slot)
  }

  /** 当前枪械的弹匣余弹；近战与投掷不耗弹药，返回 0 */
  get ammo(): number {
    const spec = this.weapon
    return spec.kind === 'gun' ? this.player.ammoByWeapon[spec.id] : 0
  }

  /** 当前枪械换弹需要多久；非枪械返回 0，HUD 拿它画换弹进度 */
  get reloadTotalSec(): number {
    const spec = this.weapon
    return spec.kind === 'gun' ? spec.reloadSec : 0
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
    this.stepGrenades(dtSec)
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
        // 换弹期间切槽会取消换弹，所以走到这里时手上的枪还是开换的那把
        const spec = this.weapon
        if (spec.kind === 'gun') p.ammoByWeapon[spec.id] = spec.ammoPerMag
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

  /**
   * 切槽：正在进行的换弹会被取消（换一半换走就白换了），各枪的弹匣余量各自保留。
   * 出手冷却也一并清掉 —— 留着上一把枪的冷却会让新武器"拔出来打不动"，
   * 手感上像卡住了（例如挥完棒子立刻切燃烧瓶却扔不出去）
   */
  switchSlot(slot: WeaponSlot): void {
    const p = this.player
    if (p.dead || p.slot === slot) return
    p.slot = slot
    p.reloadLeft = 0
    p.fireLeft = 0
  }

  /** 换弹：只对枪械生效，弹匣已满或者正在换弹就忽略 */
  reload(): void {
    const p = this.player
    const spec = this.weapon
    if (p.dead || p.reloadLeft > 0 || spec.kind !== 'gun') return
    if (p.ammoByWeapon[spec.id] >= spec.ammoPerMag) return
    p.reloadLeft = spec.reloadSec
  }

  /**
   * 扣一次扳机；返回 null 表示这一下没发生（冷却中 / 换弹中 / 弹药耗尽 / 已死亡）
   *
   * 三个槽位的手感完全不同，这里只做分发；连发与否由渲染层按 spec.auto 决定。
   */
  shoot(): ShotResult | null {
    const p = this.player
    if (p.dead) return null
    const spec = this.weapon
    if (spec.kind === 'gun') return this.fireGun(spec)
    if (spec.kind === 'melee') return this.swingMelee(spec)
    return this.throwThrowable(spec)
  }

  /** 取走本帧的爆炸事件并清空队列：渲染层每帧调一次，取走之后就没了 */
  drainExplosions(): Explosion[] {
    return this.explosions.splice(0, this.explosions.length)
  }

  /** 开火：每颗弹丸独立散布、独立判定，命中谁算谁 */
  private fireGun(spec: GunSpec): ShotResult | null {
    const p = this.player
    if (p.fireLeft > 0 || p.reloadLeft > 0) return null
    if (p.ammoByWeapon[spec.id] <= 0) {
      // 空仓时扣扳机自动换弹：玩家听到一声空枪就够了，不必再手动按一次
      this.reload()
      return null
    }
    p.ammoByWeapon[spec.id] -= 1
    p.fireLeft = spec.fireIntervalSec

    const ox = p.x
    const oy = PLAYER.eyeHeight
    const oz = p.z
    let hits = 0
    let killed = false
    let zombieHit: PelletHit | null = null
    let worldHit: PelletHit | null = null

    for (let i = 0; i < spec.pellets; i += 1) {
      const dir = spreadDirection(p.yaw, p.pitch, spec.spread, this.rng)
      const hit = castPellet(ox, oy, oz, dir, this.zombies, this.layout.colliders, spec.range)
      if (hit.kind === 'zombie') {
        hits += 1
        if (this.damageZombie(hit.zombieId, spec.damage)) killed = true
        if (!zombieHit || hit.distance < zombieHit.distance) zombieHit = hit
      } else if (hit.kind === 'world' && (!worldHit || hit.distance < worldHit.distance)) {
        worldHit = hit
      }
    }
    if (p.ammoByWeapon[spec.id] <= 0) this.reload()

    // 齐射取最近的丧尸命中点（渲染层要在那里放血花），一颗都没打中才退到墙面
    const pick = zombieHit ?? worldHit ?? rangePoint(ox, oy, oz, p.yaw, p.pitch, spec.range)
    return {
      action: 'fired',
      kind: zombieHit ? 'zombie' : worldHit ? 'world' : 'none',
      zombieId: pick.zombieId,
      x: pick.x,
      y: pick.y,
      z: pick.z,
      distance: pick.distance,
      killed,
      hits,
    }
  }

  /** 挥砍：扇形内的活丧尸全部吃伤害，命中数就是扫到几只 */
  private swingMelee(spec: MeleeSpec): ShotResult | null {
    const p = this.player
    if (p.fireLeft > 0) return null
    p.fireLeft = spec.fireIntervalSec

    const targets = meleeTargets(this.zombies, p.x, p.z, p.yaw, spec.range, spec.arcRad)
    let killed = false
    for (const target of targets) {
      if (this.damageZombie(target.id, spec.damage)) killed = true
    }

    // 挥砍是贴着人扫的，命中点取刀刃落点（朝向在有效距离处），渲染层拿它放火花
    const near = nearestTarget(targets, p.x, p.z)
    const blade = rangePoint(p.x, PLAYER.eyeHeight, p.z, p.yaw, p.pitch, spec.range)
    return {
      action: 'swung',
      kind: near ? 'zombie' : 'none',
      zombieId: near ? near.target.id : 0,
      x: blade.x,
      y: blade.y,
      z: blade.z,
      distance: near ? near.distance : spec.range,
      killed,
      hits: targets.length,
    }
  }

  /** 投掷：只生成实体，伤害与爆炸由 stepGrenades 在引信走完时结算 */
  private throwThrowable(spec: ThrowableSpec): ShotResult | null {
    const p = this.player
    if (p.throwLeft <= 0 || p.fireLeft > 0) return null
    p.throwLeft -= 1
    p.fireLeft = THROW_INTERVAL_SEC
    const grenade = createGrenade(this.nextGrenadeId, spec, { x: p.x, y: PLAYER.eyeHeight, z: p.z, yaw: p.yaw })
    this.nextGrenadeId += 1
    this.grenades.push(grenade)
    // 投掷没有命中点，但调用方需要一个事件来播音效与视图模型动作
    return {
      action: 'thrown',
      kind: 'none',
      zombieId: 0,
      x: grenade.x,
      y: grenade.y,
      z: grenade.z,
      distance: 0,
      killed: false,
      hits: 0,
    }
  }

  /** 推进所有投掷物；引信到点的就地引爆，倒着遍历才能在循环里删除 */
  private stepGrenades(dtSec: number): void {
    for (let i = this.grenades.length - 1; i >= 0; i -= 1) {
      const grenade = this.grenades[i]
      stepGrenade(grenade, dtSec, this.layout.colliders)
      if (grenade.fuseLeft > 0) continue
      this.grenades.splice(i, 1)
      this.explode(grenade)
    }
  }

  /** 爆炸：半径内按距离线性衰减扣血，不做遮挡判定，也不伤玩家 */
  private explode(grenade: GrenadeState): void {
    for (const zombie of this.zombies) {
      if (zombie.dead) continue
      const amount = blastDamage(grenade.spec, grenade.x, grenade.z, zombie)
      if (amount <= 0) continue
      this.damageZombie(zombie.id, amount)
    }
    this.explosions.push({ x: grenade.x, y: grenade.y, z: grenade.z, radius: grenade.spec.radius })
  }

  damageZombie(id: number, amount: number): boolean {
    const zombie = this.zombies.find((z) => z.id === id)
    if (!zombie || zombie.dead) return false
    zombie.hp -= amount
    zombie.hurtLeft = ZOMBIE_HURT_SEC
    if (zombie.hp > 0) return false
    zombie.dead = true
    zombie.deadElapsed = 0
    this.kills += 1
    return true
  }
}