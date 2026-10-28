/**
 * 武器视图模型的零件工厂
 *
 * 从 viewmodel.ts 拆出来只为一件事：AK47 的造型数据本身七十多行，塞回一个 500 行上限的
 * 文件会爆表。而 Parts 只管"建几何 + 记账释放"，与后坐、换弹这些动作没有耦合，
 * 拆开不会多出一层抽象。
 */

import * as THREE from 'three'
import { PALETTE, SKY } from '../config'

/** 两种色值的线性混合：调色板里没有皮肤色这类值，派生比再散落一个十六进制干净 */
export function mix(base: number, other: number, t: number): THREE.Color {
  return new THREE.Color(base).lerp(new THREE.Color(other), t)
}

/** 武器配色：全部从 PALETTE 派生，仓库里不出现散落的十六进制色值 */
export const COLOR = {
  steel: mix(PALETTE.metal, PALETTE.sidewalk, 0.35),
  steelDark: mix(PALETTE.metal, PALETTE.crack, 0.6),
  frame: mix(PALETTE.metal, PALETTE.crack, 0.78),
  wood: new THREE.Color(PALETTE.wood),
  woodDark: mix(PALETTE.wood, PALETTE.crack, 0.4),
  rust: new THREE.Color(PALETTE.rust),
  skin: mix(PALETTE.wood, PALETTE.poster[1], 0.62),
  sleeve: new THREE.Color(PALETTE.zombieCloth[1]),
  grenade: new THREE.Color(PALETTE.awning[1]),
  molotov: new THREE.Color(PALETTE.poster[3]),
  flash: mix(SKY.sunDusk, PALETTE.poster[1], 0.45),
} as const

export type Tint = THREE.ColorRepresentation

/**
 * 一把武器用到的几何与材质
 *
 * 每个部件建独立几何（各尺寸本来就不通用），切枪时整批释放 ——
 * 只把 mesh 从场景摘掉而不 dispose，显存会随着来回切枪一路涨上去。
 */
export class Parts {
  readonly group = new THREE.Group()
  private readonly geometries: THREE.BufferGeometry[] = []
  private readonly materials = new Set<THREE.MeshStandardMaterial>()
  private readonly cache = new Map<string, THREE.MeshStandardMaterial>()

  /** 取材质：同色同粗糙度共用一份；没有环境贴图，金属度一高就发黑，金属感靠低粗糙度 */
  material(color: Tint, roughness: number, metalness: number): THREE.MeshStandardMaterial {
    const key = `${new THREE.Color(color).getHex()}|${roughness}|${metalness}`
    const cached = this.cache.get(key)
    if (cached) return cached
    const material = new THREE.MeshStandardMaterial({ color, roughness, metalness })
    this.materials.add(material)
    this.cache.set(key, material)
    return material
  }

  /** 方块部件：以 pivot 局部坐标定位，返回 mesh 以便调用方补旋转或拿去动画 */
  box(w: number, h: number, d: number, color: Tint, x: number, y: number, z: number,
    roughness = 0.5, metalness = 0.25): THREE.Mesh {
    return this.attach(new THREE.BoxGeometry(w, h, d), color, x, y, z, roughness, metalness)
  }

  /**
   * 沿 z 轴的圆柱：枪管、弹仓管、刀柄、球棒都用它。
   * 旋转烘进几何而不是 mesh.rotation —— 后面做动画时不用再补偿。
   * @param radiusBack 靠玩家一端（+z）的半径
   * @param radiusFront 朝向枪口一端（-z）的半径
   */
  tube(length: number, radiusBack: number, radiusFront: number, color: Tint,
    x: number, y: number, z: number, segments = 10, roughness = 0.45, metalness = 0.3): THREE.Mesh {
    const geometry = new THREE.CylinderGeometry(radiusBack, radiusFront, length, segments)
    geometry.rotateX(Math.PI / 2)
    return this.attach(geometry, color, x, y, z, roughness, metalness)
  }

  /** 球体：手雷本体用 */
  ball(radius: number, color: Tint, x: number, y: number, z: number): THREE.Mesh {
    return this.attach(new THREE.SphereGeometry(radius, 10, 8), color, x, y, z, 0.7, 0.15)
  }

  /** 统一挂到 group 并登记资源；手里的东西不投影（阴影是当前最大的性能开销） */
  private attach(geometry: THREE.BufferGeometry, color: Tint, x: number, y: number,
    z: number, roughness: number, metalness: number): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, this.material(color, roughness, metalness))
    mesh.position.set(x, y, z)
    mesh.castShadow = false
    mesh.receiveShadow = false
    this.geometries.push(geometry)
    this.group.add(mesh)
    return mesh
  }

  /** 释放这一把的全部几何与材质 */
  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose()
    for (const material of this.materials) material.dispose()
    this.geometries.length = 0
    this.materials.clear()
    this.cache.clear()
  }
}

/** 造型的返回值：发射点（枪口 / 刀尖 / 手部）+ 需要跟随后坐往复的部件 */
export type Built = { emitter: THREE.Vector3; slide?: THREE.Mesh }

/**
 * 握持的手与小臂：8 种外观共用
 * 手和胳膊必须换色（皮肤 / 袖子），同色会读成一根香肠
 */
export function addHand(parts: Parts, gripY: number, gripZ: number, tilt: number): void {
  const hand = parts.box(0.062, 0.078, 0.088, COLOR.skin, 0.004, gripY, gripZ, 0.85, 0.02)
  hand.rotation.x = tilt
  const cuff = parts.box(0.074, 0.074, 0.035, COLOR.sleeve, 0.016, gripY - 0.046, gripZ + 0.062, 0.9, 0.05)
  cuff.rotation.x = 0.3
  const foreArm = parts.box(0.07, 0.07, 0.26, COLOR.sleeve, 0.022, gripY - 0.088, gripZ + 0.162, 0.9, 0.05)
  foreArm.rotation.x = 0.3
}
