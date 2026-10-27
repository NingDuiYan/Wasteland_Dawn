/**
 * 第一人称手里的枪
 *
 * 挂在相机下（camera 的子节点），所以永远相对屏幕固定 —— 这是第一人称枪模的标准做法：
 * 位置/后坐/换弹动作全在相机局部空间里做，不用管玩家在世界里怎么转。
 *
 * 枪口火光用一块加色平面而不是点光源：光源会让所有材质多跑一遍着色，
 * 而 55 毫秒的火光根本看不清它的光照贡献，只有"亮斑"本身有价值。
 */

import * as THREE from 'three'
import { GUN } from '../config'

const REST = new THREE.Vector3(0.22, -0.19, -0.46)
const RELOAD_DROP = 0.34

function boxMesh(
  width: number,
  height: number,
  depth: number,
  color: number,
  roughness = 0,
): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(width, height, depth)
  const material = new THREE.MeshLambertMaterial({ color })
  void roughness
  return new THREE.Mesh(geometry, material)
}

export class ViewModel {
  readonly root = new THREE.Group()

  private readonly pivot = new THREE.Group()
  private readonly flash: THREE.Mesh
  private readonly flashMaterial: THREE.MeshBasicMaterial
  private readonly muzzle = new THREE.Vector3()
  private recoil = 0
  private flashLeft = 0
  private reloadLeft = 0
  private sway = 0

  constructor() {
    this.pivot.position.copy(REST)
    // 整体缩到 0.78：枪离眼睛只有半米，按真实尺寸画会挡住半边屏幕
    this.pivot.scale.setScalar(0.78)
    this.root.add(this.pivot)
    this.root.name = 'viewmodel'

    const metal = 0x4a4d55
    const steel = 0x6d7078
    const grip = 0x3a3229

    // 套筒、枪管、握把、护圈：四块就够读出"这是一把手枪"
    const slide = boxMesh(0.052, 0.056, 0.34, metal)
    slide.position.set(0, 0.028, -0.1)
    this.pivot.add(slide)

    const barrel = boxMesh(0.036, 0.036, 0.12, steel)
    barrel.position.set(0, 0.03, -0.3)
    this.pivot.add(barrel)

    const frame = boxMesh(0.046, 0.036, 0.2, grip)
    frame.position.set(0, -0.006, -0.06)
    this.pivot.add(frame)

    const handle = boxMesh(0.046, 0.13, 0.06, grip)
    handle.position.set(0, -0.078, 0.02)
    handle.rotation.x = -0.28
    this.pivot.add(handle)

    // 手：一块肉色方块压在握把上，第一人称最低限度的"有人"
    const hand = boxMesh(0.07, 0.075, 0.1, 0x9c7f65)
    hand.position.set(0.004, -0.076, 0.02)
    hand.rotation.x = -0.28
    this.pivot.add(hand)

    const foreArm = boxMesh(0.062, 0.062, 0.22, 0x6d5a49)
    foreArm.position.set(0.02, -0.15, 0.16)
    foreArm.rotation.x = 0.22
    this.pivot.add(foreArm)

    this.muzzle.set(0, 0.032, -0.38)

    this.flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd9a0,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), this.flashMaterial)
    this.flash.position.copy(this.muzzle)
    this.pivot.add(this.flash)
  }

  /** 记一枪：后坐 + 火光 */
  fire(): void {
    this.recoil = 1
    this.flashLeft = GUN.muzzleFlashSec
  }

  /** 换弹动作：枪身下沉再抬起 */
  setReloading(reloadLeft: number): void {
    this.reloadLeft = reloadLeft
  }

  /** 行走摆动：相机起伏之外，枪自己要慢半拍，才有"拿着东西"的重量 */
  update(dtSec: number, moving: number): void {
    this.recoil = Math.max(0, this.recoil - dtSec * 9)
    this.flashLeft = Math.max(0, this.flashLeft - dtSec)
    this.sway += dtSec * 7.2

    const kick = this.recoil * GUN.recoilKick
    const reloadProgress = this.reloadLeft > 0 ? Math.min(1, this.reloadLeft / GUN.reloadSec) : 0
    // 换弹用正弦包络：抬到一半再落回去，比线性更像"换了个弹匣"
    const reloadOffset = Math.sin(reloadProgress * Math.PI) * RELOAD_DROP

    this.pivot.position.set(
      REST.x + Math.sin(this.sway * 0.5) * 0.004 * moving,
      REST.y + Math.cos(this.sway) * 0.005 * moving - reloadOffset,
      REST.z + kick,
    )
    this.pivot.rotation.set(
      this.recoil * GUN.recoilDeg * (Math.PI / 180) + reloadOffset * 0.9,
      Math.sin(this.sway * 0.5) * 0.01 * moving,
      0,
    )

    this.flashMaterial.opacity = this.flashLeft > 0 ? 1 : 0
    this.flash.scale.setScalar(this.flashLeft > 0 ? 0.8 + Math.random() * 0.7 : 0.001)
    this.flash.rotation.z = Math.random() * Math.PI
  }

  /** 枪口在世界坐标里的位置：曳光弹从这里出发 */
  muzzleWorld(target: THREE.Vector3): THREE.Vector3 {
    return this.pivot.localToWorld(target.copy(this.muzzle))
  }
}
