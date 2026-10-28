/**
 * 第一人称手里的武器（4 枪 + 2 近战 + 2 投掷）
 *
 * 挂在相机下，所以永远相对屏幕固定：位置、后坐、换弹动作全在相机局部空间里做，
 * 不用管玩家在世界里怎么转。REST / SCALE 是调过手感的既有口径，换造型时不要动。
 * 火光用加色球壳而不是点光源：光源会让所有材质多跑一遍着色，而 50 毫秒的火光
 * 根本看不清它的光照贡献，只有"亮斑"本身有价值。
 */

import * as THREE from 'three'
import { COLOR, Parts, addHand } from './weaponParts'
import { buildAk } from './ak47'
import type { Built } from './weaponParts'
import type { WeaponSpec } from '../weapons'

/** 枪在相机局部空间里的静止位置：往下、往右压得比"射击游戏标配"更狠 */
const REST = new THREE.Vector3(0.27, -0.27, -0.5)
const RELOAD_DROP = 0.34
/** 整体缩放：按真实枪长画会占掉三分之一屏幕 */
const SCALE = 0.66
const DEG = Math.PI / 180

/** 手感参数：属于表现层而不是 sim 的世界常数，所以不进 config.ts */
const MOTION = {
  recoilDecay: 9,
  swayFreq: 7.2,
  swayX: 0.004, swayY: 0.005,
  swayRotY: 0.01,
  /** 换弹下压时额外的低头角度（弧度） */
  reloadTilt: 0.9,
  /** 套筒 / 泵动护木跟随后坐往复的距离（米） */
  slideTravel: 0.03,
  /** spec 里没有对应字段时的兜底时长（秒） */
  flashFallbackSec: 0.05, swingFallbackSec: 0.3,
  throwSec: 0.5,
} as const

/** 挥砍弧：28% 处把刀拉到左下蓄力，62% 处甩到右上，剩下时间收招（位置米、角度弧度） */
const SWING_ARC = {
  windEnd: 0.28,
  strikeEnd: 0.62,
  xWind: -0.09, xStrike: 0.2,
  yWind: -0.1, yStrike: 0.14,
  zWind: 0.05, zStrike: -0.13,
  rxWind: -0.2, rxStrike: -0.3,
  ryWind: 0.1, ryStrike: 0.28,
  rzWind: 0.75, rzStrike: -1.5,
} as const

/** 投掷：先后拉蓄力，手臂前送时投掷物离手（模型缩到看不见），动作末尾回到静止位 */
const THROW_ARC = {
  windEnd: 0.3,
  pushEnd: 0.72,
  xPush: 0.1,
  yPull: 0.1, yPush: 0.16,
  zPull: 0.08, zPush: -0.3,
  rxPush: -0.85,
  ryPush: 0.2, rzPush: -0.35,
} as const

/** 泵动霰弹枪：粗枪管 + 管式弹仓 + 随后坐滑动的泵动护木 */
function buildShotgun(parts: Parts): Built {
  parts.tube(0.46, 0.028, 0.026, COLOR.steelDark, 0, 0.045, -0.36)
  parts.tube(0.36, 0.018, 0.018, COLOR.steel, 0, 0.006, -0.32)
  parts.box(0.06, 0.072, 0.24, COLOR.steelDark, 0, 0.01, -0.02)
  const slide = parts.box(0.068, 0.058, 0.16, COLOR.woodDark, 0, 0.012, -0.3)
  parts.box(0.052, 0.085, 0.24, COLOR.wood, 0, -0.004, 0.22)
  parts.box(0.04, 0.06, 0.06, COLOR.wood, 0, -0.04, 0.1).rotation.x = -0.2
  parts.box(0.014, 0.012, 0.014, COLOR.steel, 0, 0.08, -0.56)
  addHand(parts, -0.06, 0.06, -0.28)
  return { emitter: new THREE.Vector3(0, 0.045, -0.6), slide }
}

/** 手枪：沿用原来那把的造型与偏移（手感是调过的，只把色值换回调色板） */
function buildPistol(parts: Parts): Built {
  const slide = parts.box(0.05, 0.052, 0.3, COLOR.steelDark, 0, 0.03, -0.09)
  parts.box(0.012, 0.014, 0.022, COLOR.steel, 0, 0.062, -0.23)
  parts.box(0.028, 0.028, 0.07, COLOR.steel, 0, 0.03, -0.26)
  parts.box(0.044, 0.032, 0.17, COLOR.frame, 0, 0, -0.05)
  parts.box(0.045, 0.125, 0.058, COLOR.frame, 0, -0.07, 0.03, 0.8, 0.05).rotation.x = -0.3
  addHand(parts, -0.072, 0.028, -0.3)
  return { emitter: new THREE.Vector3(0, 0.032, -0.38), slide }
}

/** 左轮：短枪管 + 六棱转轮 + 木握把，转轮比机匣粗，一眼就能和手枪区分 */
function buildRevolver(parts: Parts): Built {
  parts.box(0.048, 0.055, 0.2, COLOR.steelDark, 0, 0.014, -0.02)
  parts.tube(0.2, 0.019, 0.017, COLOR.steel, 0, 0.032, -0.19)
  parts.tube(0.072, 0.042, 0.042, COLOR.steel, 0, 0.03, -0.02, 6)
  parts.box(0.018, 0.032, 0.022, COLOR.steelDark, 0, 0.056, 0.06).rotation.x = -0.4
  parts.box(0.046, 0.012, 0.06, COLOR.steelDark, 0, -0.026, -0.045)
  parts.box(0.04, 0.12, 0.05, COLOR.wood, 0, -0.075, 0.05, 0.8, 0.05).rotation.x = -0.32
  parts.box(0.01, 0.012, 0.014, COLOR.steel, 0, 0.058, -0.28)
  addHand(parts, -0.075, 0.05, -0.3)
  return { emitter: new THREE.Vector3(0, 0.032, -0.3) }
}

/** 开山刀：扁长刀身 + 斜切刀尖 + 十字护手 + 木柄 */
function buildMachete(parts: Parts): Built {
  parts.box(0.014, 0.085, 0.4, COLOR.steel, 0, 0.1, -0.32, 0.32, 0.45)
  parts.box(0.012, 0.05, 0.1, COLOR.steel, 0, 0.105, -0.56, 0.32, 0.45).rotation.x = 0.25
  parts.box(0.022, 0.1, 0.05, COLOR.steelDark, 0, 0.09, -0.08)
  parts.tube(0.15, 0.018, 0.02, COLOR.woodDark, 0, 0.075, 0.03, 8, 0.85, 0.05)
  parts.tube(0.02, 0.024, 0.024, COLOR.rust, 0, 0.075, 0.115, 8)
  addHand(parts, 0.075, 0.03, 0)
  return { emitter: new THREE.Vector3(0, 0.1, -0.6) }
}

/** 棒球棍：粗细渐变的长圆柱 + 缠胶带的握持段 + 粗端封头 */
function buildBat(parts: Parts): Built {
  parts.tube(0.46, 0.014, 0.03, COLOR.wood, 0, 0.06, -0.28, 8, 0.85, 0.05)
  parts.tube(0.02, 0.031, 0.031, COLOR.wood, 0, 0.06, -0.52, 8, 0.85, 0.05)
  parts.tube(0.1, 0.019, 0.019, COLOR.rust, 0, 0.06, -0.02, 8, 0.9, 0.05)
  parts.tube(0.02, 0.03, 0.03, COLOR.woodDark, 0, 0.06, 0.04, 8, 0.85, 0.05)
  addHand(parts, 0.06, 0.02, 0)
  return { emitter: new THREE.Vector3(0, 0.06, -0.54) }
}

/** 手里握着的破片手雷：暗绿球体 + 金属引信头 + 保险压柄 */
function buildGrenadeHand(parts: Parts): Built {
  parts.ball(0.058, COLOR.grenade, 0, -0.01, -0.1)
  parts.tube(0.03, 0.022, 0.022, COLOR.steel, 0, 0.05, -0.1, 8)
  parts.box(0.014, 0.05, 0.014, COLOR.steel, 0.032, 0.035, -0.1).rotation.z = 0.2
  addHand(parts, -0.03, 0, -0.2)
  return { emitter: new THREE.Vector3(0, -0.01, -0.12) }
}

/** 手里握着的燃烧瓶：琥珀色瓶身 + 瓶颈 + 点着的布条 */
function buildMolotovHand(parts: Parts): Built {
  parts.tube(0.16, 0.048, 0.055, COLOR.molotov, 0, -0.03, -0.1, 10, 0.3, 0.05)
  parts.tube(0.06, 0.025, 0.048, COLOR.molotov, 0, 0.08, -0.1, 10, 0.3, 0.05)
  parts.tube(0.05, 0.022, 0.022, COLOR.molotov, 0, 0.13, -0.1, 8, 0.3, 0.05)
  parts.box(0.024, 0.06, 0.024, COLOR.rust, 0, 0.18, -0.1, 0.9, 0.05)
  addHand(parts, -0.04, 0.01, -0.2)
  return { emitter: new THREE.Vector3(0, 0.18, -0.1) }
}

/** id → 拼装函数：加新武器只改这张表与 weapons.ts 的枚举 */
const BUILDERS: Record<WeaponSpec['id'], (parts: Parts) => Built> = {
  rifle: buildAk,
  shotgun: buildShotgun,
  pistol: buildPistol,
  revolver: buildRevolver,
  machete: buildMachete,
  bat: buildBat,
  grenade: buildGrenadeHand,
  molotov: buildMolotovHand,
}

/** 一帧里所有动作叠加出来的偏移，统一加到 REST 上；用可变对象避免每帧分配 */
type Pose = { x: number; y: number; z: number; rx: number; ry: number; rz: number }

type Curve = { wind: number; push: number }

/**
 * 两段式动作曲线：蓄力段 wind 从 0 到 1；冲程段 wind 回落到 0、push 升到 1；
 * 之后 push 线性收招回 0（此时 wind 已是 0，所以动作结束时正好回到静止位）。
 */
function curveAt(progress: number, windEnd: number, peakEnd: number): Curve {
  if (progress <= windEnd) return { wind: progress / windEnd, push: 0 }
  if (progress <= peakEnd) {
    const travel = (progress - windEnd) / (peakEnd - windEnd)
    return { wind: 1 - travel, push: travel }
  }
  return { wind: 0, push: Math.max(0, 1 - (progress - peakEnd) / (1 - peakEnd)) }
}

export class ViewModel {
  readonly root = new THREE.Group()

  private readonly pivot = new THREE.Group()
  private readonly flash: THREE.Mesh
  private readonly flashMaterial: THREE.MeshBasicMaterial
  private readonly pose: Pose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }
  /** 发射点（枪口 / 刀尖 / 手部）在 pivot 局部空间里的位置 */
  private readonly emitter = new THREE.Vector3()
  private parts: Parts | null = null
  private slide: { node: THREE.Mesh; baseZ: number } | null = null
  private specId: WeaponSpec['id'] = 'pistol'
  private specKind: WeaponSpec['kind'] = 'gun'
  private recoilKick = 0
  private recoilDeg = 0
  private flashSec = 0
  private swingSec: number = MOTION.swingFallbackSec
  private throwSec: number = MOTION.throwSec
  private recoil = 0
  private flashLeft = 0
  private reloadLeft = 0
  private reloadSec = 0
  private swingLeft = 0
  private throwLeft = 0
  private handScale = 1
  private sway = 0

  constructor() {
    this.pivot.position.copy(REST)
    this.pivot.scale.setScalar(SCALE)
    // 枪口略微朝左：准星在屏幕正中，枪要"指着"它，否则读成斜插在画面角落的模型
    this.pivot.rotation.set(0, -0.1, 0.02)
    this.root.name = 'viewmodel'
    this.root.add(this.pivot)

    this.flashMaterial = new THREE.MeshBasicMaterial({
      color: COLOR.flash,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), this.flashMaterial)
    this.flash.visible = false
    this.pivot.add(this.flash)
  }

  /**
   * 切武器：按 spec.id 重建造型，并释放上一把的几何与材质
   * @param spec 目标武器（数值与类型都来自 src/weapons.ts）
   */
  setWeapon(spec: WeaponSpec): void {
    if (this.parts && this.specId === spec.id) return
    this.clear()
    this.specId = spec.id
    this.specKind = spec.kind
    this.recoilKick = spec.kind === 'gun' ? spec.recoilKick : 0
    this.recoilDeg = spec.kind === 'gun' ? spec.recoilDeg : 0
    this.flashSec = spec.kind === 'gun' ? spec.muzzleFlashSec : 0
    this.swingSec = spec.kind === 'melee' ? spec.swingSec : MOTION.swingFallbackSec

    const parts = new Parts()
    const built = BUILDERS[spec.id](parts)
    this.parts = parts
    this.emitter.copy(built.emitter)
    this.flash.position.copy(built.emitter)
    this.flash.visible = false
    this.slide = built.slide ? { node: built.slide, baseZ: built.slide.position.z } : null
    this.pivot.add(parts.group)
  }

  /** 扣扳机：枪是后坐 + 火光，近战/投掷转发给对应动作，免得调用方到处判断 */
  fire(): void {
    if (this.specKind === 'gun') {
      this.recoil = 1
      this.flashLeft = this.flashSec > 0 ? this.flashSec : MOTION.flashFallbackSec
      return
    }
    if (this.specKind === 'melee') this.swing()
    else this.throwOut()
  }

  /** 近战：从左下到右上的挥砍弧，时长取 spec.swingSec */
  swing(): void {
    this.swingLeft = this.swingSec
  }

  /** 投掷：手臂前送，投掷物在这一下离手（模型缩到看不见，动作走完再回到手里） */
  throwOut(): void {
    this.throwLeft = this.throwSec
  }

  /**
   * 换弹动作：交给 sim 侧的倒计时，这里只做归一化
   * @param reloadLeft 剩余秒数，<= 0 表示不在换弹
   * @param reloadSec 本次换弹的总时长，用来把进度归一化到 0..1
   */
  setReloading(reloadLeft: number, reloadSec: number): void {
    this.reloadLeft = Math.max(0, reloadLeft)
    this.reloadSec = Math.max(0, reloadSec)
  }

  /** 每帧推进动作：后坐衰减、火光计时、挥砍/投掷曲线、走路晃动 */
  update(dtSec: number, moving: number): void {
    this.recoil = Math.max(0, this.recoil - dtSec * MOTION.recoilDecay)
    this.flashLeft = Math.max(0, this.flashLeft - dtSec)
    this.swingLeft = Math.max(0, this.swingLeft - dtSec)
    this.throwLeft = Math.max(0, this.throwLeft - dtSec)
    this.handScale = 1
    this.sway += dtSec * MOTION.swayFreq

    // 换弹进度归一化后取正弦：0 → 压到底 → 0，正好是一次"低头装弹"的呼吸
    const reloadRatio = this.reloadLeft <= 0 || this.reloadSec <= 0
      ? 0
      : Math.min(1, this.reloadLeft / this.reloadSec)
    const reloadOffset = Math.sin(reloadRatio * Math.PI) * RELOAD_DROP
    const pose = this.pose
    pose.x = 0
    pose.y = -reloadOffset
    pose.z = this.recoil * this.recoilKick
    pose.rx = this.recoil * this.recoilDeg * DEG + reloadOffset * MOTION.reloadTilt
    pose.ry = 0
    pose.rz = 0
    this.addSwing(pose)
    this.addThrow(pose)

    this.pivot.position.set(
      REST.x + Math.sin(this.sway * 0.5) * MOTION.swayX * moving + pose.x,
      REST.y + Math.cos(this.sway) * MOTION.swayY * moving + pose.y,
      REST.z + pose.z,
    )
    this.pivot.rotation.set(pose.rx, Math.sin(this.sway * 0.5) * MOTION.swayRotY * moving + pose.ry, pose.rz)
    if (this.parts) this.parts.group.scale.setScalar(this.handScale)
    this.applySlide()
    this.applyFlash()
  }

  /** 发射点在世界坐标里的位置：曳光从这里出发；近战/投掷给的是刀尖或手部 */
  muzzleWorld(target: THREE.Vector3): THREE.Vector3 {
    // 相机在 render 之前还没刷新世界矩阵，这里主动算一次，否则曳光会晚一帧
    this.pivot.updateWorldMatrix(true, false)
    return this.pivot.localToWorld(target.copy(this.emitter))
  }

  /** 卸载视图模型：几何与材质全部释放，root 由调用方从 camera 上摘掉 */
  dispose(): void {
    this.clear()
    this.flash.geometry.dispose()
    this.flashMaterial.dispose()
  }

  /** 挥砍：蓄力拉向左下，出刀甩向右上，收招回静止位 */
  private addSwing(pose: Pose): void {
    if (this.swingLeft <= 0 || this.swingSec <= 0) return
    const arc = SWING_ARC
    const { wind, push } = curveAt(1 - this.swingLeft / this.swingSec, arc.windEnd, arc.strikeEnd)
    pose.x += arc.xWind * wind + arc.xStrike * push
    pose.y += arc.yWind * wind + arc.yStrike * push
    pose.z += arc.zWind * wind + arc.zStrike * push
    pose.rx += arc.rxWind * wind + arc.rxStrike * push
    pose.ry += arc.ryWind * wind + arc.ryStrike * push
    pose.rz += arc.rzWind * wind + arc.rzStrike * push
  }

  /** 投掷：后拉蓄力 → 手臂前送 → 回位；前送最大时投掷物已经离手 */
  private addThrow(pose: Pose): void {
    if (this.throwLeft <= 0 || this.throwSec <= 0) return
    const arc = THROW_ARC
    const { wind, push } = curveAt(1 - this.throwLeft / this.throwSec, arc.windEnd, arc.pushEnd)
    pose.x += arc.xPush * push
    pose.y += arc.yPush * push - arc.yPull * wind
    pose.z += arc.zPull * wind + arc.zPush * push
    pose.rx += arc.rxPush * push
    pose.ry += arc.ryPush * push
    pose.rz += arc.rzPush * push
    // 出手后手里不该还攥着一个：缩到 1% 读作"东西没了"，而不是"手臂缩小"
    this.handScale = Math.max(0.01, 1 - push)
  }

  /** 套筒 / 泵动护木跟着后坐往复：静止位记在 baseZ 上，这里只加偏移 */
  private applySlide(): void {
    if (!this.slide) return
    this.slide.node.position.z = this.slide.baseZ + this.recoil * MOTION.slideTravel
  }

  /** 火光只有 50 毫秒，随机缩放与旋转让连发时的每一枪都不一样 */
  private applyFlash(): void {
    const lit = this.flashLeft > 0
    this.flash.visible = lit
    this.flashMaterial.opacity = lit ? 1 : 0
    this.flash.scale.setScalar(lit ? 0.8 + Math.random() * 0.7 : 0.001)
    this.flash.rotation.z = Math.random() * Math.PI
  }

  /** 拆掉当前造型并把动作状态清零：只摘 mesh 不 dispose 会泄漏显存，旧动作也不该带进新武器 */
  private clear(): void {
    if (this.parts) {
      this.pivot.remove(this.parts.group)
      this.parts.dispose()
      this.parts = null
      this.slide = null
    }
    this.recoil = 0
    this.flashLeft = 0
    this.reloadLeft = 0
    this.reloadSec = 0
    this.swingLeft = 0
    this.throwLeft = 0
    this.handScale = 1
  }
}
