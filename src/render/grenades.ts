/**
 * 世界里的投掷物与爆炸表现
 *
 * sim 只给"现在有哪些投掷物 / 这一帧炸了哪几处"两个数组，这里只负责把状态映射到 mesh：
 * 几何全部预分配进对象池，战斗中（丢雷、连爆）不产生任何 new，
 * 否则每颗手雷的分配抖动会在 60 FPS 的帧预算里被放大成掉帧。
 */

import * as THREE from 'three'
import { PALETTE, SKY } from '../config'
import type { Explosion, GrenadeState } from '../sim/grenade'

/** 同时在空中的投掷物上限（玩家只有 2~3 颗，多的是兜底） */
const POOL = 8
/** 同屏爆炸上限：超出的复用最老的一个，宁可少一层火焰也不要建新对象 */
const BLAST_POOL = 4
/** 爆炸表现总时长（秒），与 damage 半径无关，纯视觉节奏 */
const BLAST_SEC = 0.35
/** 地面闪光的贴地高度，抬 2 厘米避免与地面 z-fighting */
const GROUND_Y = 0.02
/** 投掷物翻滚角速度（弧度/秒）：sim 不提供角速度，用固定值近似，重在"在翻"而不是精确 */
const SPIN_RATE = 6
/** 火球半径相对伤害半径的比例：伤害范围大于"看着被炸到"的范围，玩家才有躲的余地 */
const FIRE_SCALE = 0.42

/** 火球：亮橙色；地面冲击波稍暗一点，两层叠起来才有层次 */
const FIRE_COLOR = new THREE.Color(SKY.sunDusk)
const WAVE_COLOR = new THREE.Color(PALETTE.poster[1])

/** 一个投掷物的两种外观同时挂在槽位上，按 spec.id 切可见性，切类型不需要重建 */
interface ProjectileSlot {
  readonly root: THREE.Group
  readonly grenade: THREE.Group
  readonly molotov: THREE.Group
}

/** 一次爆炸的两层表现：空中的火球壳 + 贴地的冲击波圆面 */
interface BlastSlot {
  readonly group: THREE.Group
  readonly shell: THREE.Mesh
  readonly shellMat: THREE.MeshBasicMaterial
  readonly wave: THREE.Mesh
  readonly waveMat: THREE.MeshBasicMaterial
  /** 剩余表现时间（秒），<= 0 表示槽位空闲 */
  left: number
  /** 这次爆炸的伤害半径，决定表现尺寸 */
  radius: number
}

/**
 * 投掷物与爆炸的渲染者
 *
 * 由 app.ts 每帧调用：sync 喂 sim 状态，update 推进爆炸动画。
 */
export class GrenadeView {
  private readonly scene: THREE.Scene
  private readonly projectiles: ProjectileSlot[] = []
  private readonly blasts: BlastSlot[] = []
  /** 爆炸事件去重：sim 的数组可能跨帧保留同一条记录，靠对象身份保证只表演一次 */
  private readonly seen = new WeakSet<Explosion>()
  private readonly geometries: THREE.BufferGeometry[] = []
  private readonly materials: THREE.Material[] = []

  constructor(scene: THREE.Scene) {
    this.scene = scene
    for (let i = 0; i < POOL; i += 1) {
      const slot = this.createProjectile()
      this.projectiles.push(slot)
      scene.add(slot.root)
    }
    for (let i = 0; i < BLAST_POOL; i += 1) {
      const blast = this.createBlast()
      this.blasts.push(blast)
      scene.add(blast.group)
    }
  }

  /**
   * 同步 sim 状态到 mesh
   * @param grenades 当前活跃的投掷物（位置每帧都会被覆盖，所以按下标复用槽位是安全的）
   * @param explosions 这一帧新产生的爆炸，同一对象只会表演一次
   */
  sync(grenades: readonly GrenadeState[], explosions: readonly Explosion[]): void {
    for (let i = 0; i < this.projectiles.length; i += 1) {
      const slot = this.projectiles[i]
      const state: GrenadeState | undefined = grenades[i]
      if (!state) {
        slot.root.visible = false
        continue
      }
      slot.root.visible = true
      slot.root.position.set(state.x, state.y, state.z)
      // 外观只由 id 决定：伤害、半径这些都不许渲染层再算一遍
      const molotov = state.spec.id === 'molotov'
      slot.grenade.visible = !molotov
      slot.molotov.visible = molotov
    }

    for (const event of explosions) {
      if (this.seen.has(event)) continue
      this.seen.add(event)
      this.triggerBlast(event)
    }
  }

  /** 每帧推进：投掷物翻滚、爆炸表现收缩淡出 */
  update(dtSec: number): void {
    for (const slot of this.projectiles) {
      if (!slot.root.visible) continue
      slot.root.rotation.x += dtSec * SPIN_RATE
      slot.root.rotation.z += dtSec * SPIN_RATE * 0.6
    }
    for (const blast of this.blasts) {
      if (blast.left <= 0) continue
      blast.left = Math.max(0, blast.left - dtSec)
      this.applyBlast(blast)
    }
  }

  /** 释放全部几何与材质并摘掉池子：场景销毁前必须调，否则显存随重开一局累积 */
  dispose(): void {
    for (const slot of this.projectiles) this.scene.remove(slot.root)
    for (const blast of this.blasts) this.scene.remove(blast.group)
    this.projectiles.length = 0
    this.blasts.length = 0
    for (const geometry of this.geometries) geometry.dispose()
    for (const material of this.materials) material.dispose()
    this.geometries.length = 0
    this.materials.length = 0
  }

  /** 登记几何，dispose 时统一释放 */
  private ownGeometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry)
    return geometry
  }

  /** 登记材质，dispose 时统一释放 */
  private ownMaterial<T extends THREE.Material>(material: T): T {
    this.materials.push(material)
    return material
  }

  /** 建一个池槽位：两种投掷物外观都先建好，靠可见性切换 */
  private createProjectile(): ProjectileSlot {
    const root = new THREE.Group()
    root.visible = false
    const grenade = this.buildGrenade()
    const molotov = this.buildMolotov()
    molotov.visible = false
    root.add(grenade, molotov)
    return { root, grenade, molotov }
  }

  /** 破片手雷：暗绿球体 + 金属引信头 + 保险压柄，与视图模型里握着的同色系 */
  private buildGrenade(): THREE.Group {
    const group = new THREE.Group()
    const bodyMat = this.ownMaterial(new THREE.MeshStandardMaterial({
      color: PALETTE.awning[1],
      roughness: 0.8,
      metalness: 0.1,
    }))
    const body = new THREE.Mesh(this.ownGeometry(new THREE.SphereGeometry(0.085, 10, 8)), bodyMat)
    group.add(body)

    const metalMat = this.ownMaterial(new THREE.MeshStandardMaterial({
      color: PALETTE.metal,
      roughness: 0.45,
      metalness: 0.6,
    }))
    const fuse = new THREE.Mesh(this.ownGeometry(new THREE.CylinderGeometry(0.024, 0.024, 0.03, 8)), metalMat)
    fuse.position.y = 0.095
    group.add(fuse)

    const lever = new THREE.Mesh(this.ownGeometry(new THREE.BoxGeometry(0.014, 0.06, 0.014)), metalMat)
    lever.position.set(0.03, 0.075, 0)
    lever.rotation.z = 0.25
    group.add(lever)
    return group
  }

  /** 燃烧瓶：琥珀色瓶身 + 瓶颈 + 布条，玻璃感靠低粗糙度而不是透明（透明会打乱深度排序） */
  private buildMolotov(): THREE.Group {
    const group = new THREE.Group()
    const glassMat = this.ownMaterial(new THREE.MeshStandardMaterial({
      color: PALETTE.poster[3],
      roughness: 0.3,
      metalness: 0.05,
    }))
    const body = new THREE.Mesh(this.ownGeometry(new THREE.CylinderGeometry(0.05, 0.055, 0.17, 10)), glassMat)
    group.add(body)

    const neck = new THREE.Mesh(this.ownGeometry(new THREE.CylinderGeometry(0.022, 0.045, 0.07, 10)), glassMat)
    neck.position.y = 0.12
    group.add(neck)

    const wickMat = this.ownMaterial(new THREE.MeshStandardMaterial({
      color: PALETTE.rust,
      roughness: 0.95,
      metalness: 0,
    }))
    const wick = new THREE.Mesh(this.ownGeometry(new THREE.CylinderGeometry(0.02, 0.02, 0.06, 6)), wickMat)
    wick.position.y = 0.185
    group.add(wick)
    return group
  }

  /** 建一个爆炸槽位：加色球壳 + 贴地圆面，都用 basic 材质（不受光照，纯亮斑） */
  private createBlast(): BlastSlot {
    const group = new THREE.Group()
    group.visible = false
    const shellMat = this.ownMaterial(new THREE.MeshBasicMaterial({
      color: FIRE_COLOR,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }))
    const shell = new THREE.Mesh(this.ownGeometry(new THREE.SphereGeometry(1, 16, 12)), shellMat)
    group.add(shell)

    const waveMat = this.ownMaterial(new THREE.MeshBasicMaterial({
      color: WAVE_COLOR,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }))
    const wave = new THREE.Mesh(this.ownGeometry(new THREE.CircleGeometry(1, 20)), waveMat)
    wave.rotation.x = -Math.PI / 2
    group.add(wave)
    return { group, shell, shellMat, wave, waveMat, left: 0, radius: 1 }
  }

  /** 触发一次爆炸：占一个空闲槽位，没有空闲就抢最老的那个（视觉上叠一层，不漏表现） */
  private triggerBlast(event: Explosion): void {
    let chosen = this.blasts[0]
    for (const blast of this.blasts) {
      if (blast.left <= 0 || blast.left < chosen.left) chosen = blast
    }
    chosen.left = BLAST_SEC
    chosen.radius = Math.max(0.6, event.radius)
    chosen.group.position.set(event.x, event.y, event.z)
    chosen.group.visible = true
    // 冲击波贴在地面上：世界 y 固定在 GROUND_Y，所以局部高度要减掉爆炸中心
    chosen.wave.position.y = GROUND_Y - event.y
    this.applyBlast(chosen)
  }

  /**
   * 按剩余时间刷新尺寸与透明度：火球迅速膨胀后淡出，冲击波贴地向外扩散。
   * 火球视觉半径故意远小于伤害半径 —— 按伤害半径画会变成一个罩住半条街的
   * 半透明大球，既不像爆炸，也让人误判自己站在安全距离上
   */
  private applyBlast(blast: BlastSlot): void {
    const progress = 1 - blast.left / BLAST_SEC
    const alive = blast.left > 0
    const fade = (1 - progress) * (1 - progress)
    blast.shell.scale.setScalar(blast.radius * FIRE_SCALE * (0.45 + 0.85 * progress))
    blast.shellMat.opacity = alive ? 0.9 * fade : 0
    blast.wave.scale.setScalar(blast.radius * (0.45 + progress * 1.1))
    blast.waveMat.opacity = alive ? 0.5 * (1 - progress) * (1 - progress) : 0
    blast.group.visible = alive
  }
}
