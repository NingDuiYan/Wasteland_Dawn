import * as THREE from 'three'
import { PALETTE } from '../config'

const TRACER_COUNT = 12

/**
 * 曳光弹池：短命、廉价，切成预分配的十二条，不在开火时新建几何。
 *
 * 寿命由调用方按当前武器传入（霰弹枪的拖尾比步枪粗长），
 * 池子不做武器区分，谁抢到空槽谁用。
 */
export class Tracers {
  private readonly meshes: THREE.Mesh[] = []
  private readonly materials: THREE.MeshBasicMaterial[] = []
  private readonly lives: number[] = []

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    for (let i = 0; i < TRACER_COUNT; i += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: PALETTE.tracer,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.visible = false
      scene.add(mesh)
      this.meshes.push(mesh)
      this.materials.push(material)
      this.lives.push(0)
    }
  }

  spawn(from: THREE.Vector3, to: THREE.Vector3, lifeSec: number): void {
    let slot = this.lives.indexOf(0)
    if (slot < 0) slot = 0
    const mesh = this.meshes[slot]
    const length = from.distanceTo(to)
    mesh.position.copy(from).lerp(to, 0.5)
    mesh.scale.set(0.022, 0.022, Math.max(0.1, length))
    // 盒子的 +z 是长度方向，lookAt 让 -z 朝目标，两端对称所以不影响
    mesh.lookAt(to)
    mesh.visible = true
    this.lives[slot] = lifeSec
    this.materials[slot].opacity = 0.75
  }

  update(dtSec: number): void {
    for (let i = 0; i < this.meshes.length; i += 1) {
      if (this.lives[i] <= 0) continue
      const ratio = this.lives[i] / Math.max(0.0001, this.lives[i] + dtSec)
      this.lives[i] -= dtSec
      this.materials[i].opacity = Math.max(0, ratio) * 0.75
      if (this.lives[i] <= 0) this.meshes[i].visible = false
    }
  }
}
