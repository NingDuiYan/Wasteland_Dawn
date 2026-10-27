/**
 * 丧尸的低模人形与行走动画
 *
 * 用方块拼人形而不是做骨骼蒙皮：第一人称里丧尸多半在 5~20 米外，
 * 决定"像不像活物"的是四肢摆动与身体倾斜的节奏，不是面数。
 * 每个丧尸的材质是独立实例 —— 受击闪白要单独控制，共享材质会让整群一起闪。
 */

import * as THREE from 'three'
import { PALETTE, ZOMBIE } from '../config'
import type { ZombieState } from '../sim/world'

const PART = {
  body: { w: 0.5, h: 0.7, d: 0.3 },
  head: { w: 0.32, h: 0.34, d: 0.3 },
  arm: { w: 0.13, h: 0.62, d: 0.13 },
  leg: { w: 0.17, h: 0.76, d: 0.19 },
} as const

/** 三个变种的外形差异：普通、快跑（瘦小）、蛮尸（高大） */
const VARIANT_SCALE = [1, 0.9, 1.32] as const

let boxGeometry: THREE.BoxGeometry | null = null

function box(): THREE.BoxGeometry {
  if (!boxGeometry) boxGeometry = new THREE.BoxGeometry(1, 1, 1)
  return boxGeometry
}

interface ZombieRig {
  group: THREE.Group
  skin: THREE.MeshLambertMaterial
  cloth: THREE.MeshLambertMaterial
  armLeft: THREE.Group
  armRight: THREE.Group
  legLeft: THREE.Group
  legRight: THREE.Group
  shadow: THREE.Mesh
  variant: number
}

/** 一条肢体：外层 Group 当关节，内层 mesh 往下偏移半截，转关节就是转整条 */
function limb(
  material: THREE.Material,
  size: { w: number; h: number; d: number },
  pivotY: number,
  x: number,
  z: number,
): THREE.Group {
  const joint = new THREE.Group()
  joint.position.set(x, pivotY, z)
  const mesh = new THREE.Mesh(box(), material)
  mesh.scale.set(size.w, size.h, size.d)
  mesh.position.y = -size.h / 2
  joint.add(mesh)
  return joint
}

function makeShadow(): THREE.Mesh {
  const geometry = new THREE.CircleGeometry(0.42, 16)
  geometry.rotateX(-Math.PI / 2)
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.y = 0.015
  return mesh
}

export class ZombieView {
  private readonly rigs = new Map<number, ZombieRig>()
  private readonly root = new THREE.Group()

  constructor(scene: THREE.Scene) {
    this.root.name = 'zombies'
    scene.add(this.root)
  }

  /** 每帧把 sim 状态抄到场景里；sim 移除的尸体这里同步回收 */
  sync(zombies: readonly ZombieState[]): void {
    const seen = new Set<number>()
    for (const zombie of zombies) {
      seen.add(zombie.id)
      const rig = this.rigs.get(zombie.id) ?? this.create(zombie)
      this.pose(rig, zombie)
    }
    for (const [id, rig] of this.rigs) {
      if (seen.has(id)) continue
      this.root.remove(rig.group)
      this.disposeRig(rig)
      this.rigs.delete(id)
    }
  }

  private create(zombie: ZombieState): ZombieRig {
    const scale = VARIANT_SCALE[zombie.variant] ?? 1
    const skin = new THREE.MeshLambertMaterial({
      color: PALETTE.zombieSkin[zombie.variant % PALETTE.zombieSkin.length],
      emissive: new THREE.Color(0x8a1a10),
      emissiveIntensity: 0,
    })
    const cloth = new THREE.MeshLambertMaterial({
      color: PALETTE.zombieCloth[zombie.variant % PALETTE.zombieCloth.length],
    })

    const group = new THREE.Group()
    group.scale.setScalar(scale)

    const body = new THREE.Mesh(box(), cloth)
    body.scale.set(PART.body.w, PART.body.h, PART.body.d)
    body.position.y = 1.02
    group.add(body)

    const head = new THREE.Mesh(box(), skin)
    head.scale.set(PART.head.w, PART.head.h, PART.head.d)
    head.position.set(0, 1.55, 0.02)
    group.add(head)

    const armLeft = limb(skin, PART.arm, 1.33, -0.31, 0.06)
    const armRight = limb(skin, PART.arm, 1.33, 0.31, 0.06)
    const legLeft = limb(cloth, PART.leg, 0.72, -0.13, 0)
    const legRight = limb(cloth, PART.leg, 0.72, 0.13, 0)
    group.add(armLeft, armRight, legLeft, legRight)

    const shadow = makeShadow()
    group.add(shadow)

    // 丧尸是场景里唯一会动的实体：让它投影，玩家才能从影子上判断距离
    group.traverse((child) => {
      if (child instanceof THREE.Mesh && child !== shadow) child.castShadow = true
    })

    this.root.add(group)
    const rig: ZombieRig = {
      group,
      skin,
      cloth,
      armLeft,
      armRight,
      legLeft,
      legRight,
      shadow,
      variant: zombie.variant,
    }
    this.rigs.set(zombie.id, rig)
    return rig
  }

  /** 摆姿势：行走摆动 → 受击闪白 → 倒地 */
  private pose(rig: ZombieRig, zombie: ZombieState): void {
    rig.group.position.set(zombie.x, 0, zombie.z)
    rig.group.rotation.y = zombie.yaw

    const swing = Math.sin(zombie.phase) * 0.62
    const stride = Math.cos(zombie.phase)
    rig.legLeft.rotation.x = swing
    rig.legRight.rotation.x = -swing
    // 丧尸的手不摆：双臂前伸，靠肩膀轻微起伏
    rig.armLeft.rotation.x = -1.28 + stride * 0.1
    rig.armRight.rotation.x = -1.24 - stride * 0.1
    // 驼背：躯干整体前倾，头部跟着压下去
    const hunch = zombie.variant === 2 ? 0.18 : 0.26
    if (zombie.dead) {
      const progress = Math.min(1, zombie.deadElapsed / 0.45)
      rig.group.rotation.x = progress * (Math.PI / 2) * 0.92
      rig.group.position.y = -progress * 0.1
      rig.skin.emissiveIntensity = 0
    } else {
      rig.group.rotation.x = hunch * 0.35
      rig.group.position.y = Math.abs(Math.cos(zombie.phase)) * 0.035
      // 只剩一丝血时整只发白，玩家能凭外观判断还要不要补枪
      const wounded = 1 - zombie.hp / zombie.maxHp
      rig.skin.emissiveIntensity = zombie.hurtLeft > 0 ? 1.4 : wounded * 0.12
      if (zombie.hurtLeft > 0) rig.cloth.emissive.setRGB(0.7, 0.15, 0.1)
      else rig.cloth.emissive.setRGB(0, 0, 0)
    }

    const shadowScale = (rig.variant === 2 ? 1.3 : 1) * (1 - Math.min(1, zombie.deadElapsed))
    rig.shadow.scale.setScalar(Math.max(0.001, shadowScale))
  }

  private disposeRig(rig: ZombieRig): void {
    rig.skin.dispose()
    rig.cloth.dispose()
    ;(rig.shadow.material as THREE.Material).dispose()
    rig.shadow.geometry.dispose()
  }

  /** 暴露给需要"丧尸有多高"的地方（命中判定用的胶囊高度与它对齐） */
  static get eyeHeight(): number {
    return ZOMBIE.hitHeight
  }
}
