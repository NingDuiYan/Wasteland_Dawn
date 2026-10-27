import * as THREE from 'three'
import { Rng } from '../sim/random'

/**
 * 远处的城市剪影。
 *
 * 小镇地面只有 220 米见方，视线越过边缘就是天空，读起来像"一块飘着的盘子"。
 * 用一圈远景楼把地平线挡住，画面立刻有了纵深——而且它们只是不收阴影的盒子，
 * 成本几乎为零。
 */
interface FarBlock {
  x: number
  z: number
  w: number
  h: number
  d: number
  rotY: number
}

const COUNT = 46
const MIN_RADIUS = 195
const MAX_RADIUS = 320

export function createSkyline(seed: number): THREE.Group {
  const group = new THREE.Group()
  group.name = 'skyline'
  const rng = new Rng(seed ^ 0x5f3a91)
  // 必须比天空暗一大截：剪影一淡就变成"镇子外面还有一圈镇子"，纵深反而没了
  const material = new THREE.MeshLambertMaterial({ color: 0x1b222c })
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const blocks: FarBlock[] = []
  for (let index = 0; index < COUNT; index += 1) {
    // 沿圆周铺开并抖动角度：等距摆放会读成一排栅栏
    const angle = (index / COUNT) * Math.PI * 2 + rng.range(-0.05, 0.05)
    const radius = rng.range(MIN_RADIUS, MAX_RADIUS)
    const height = rng.range(14, 46)
    blocks.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      w: rng.range(16, 34),
      h: height,
      d: rng.range(16, 34),
      rotY: rng.range(-0.4, 0.4),
    })
  }
  const mesh = new THREE.InstancedMesh(geometry, material, blocks.length)
  const matrix = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()
  blocks.forEach((block, index) => {
    quaternion.setFromEuler(new THREE.Euler(0, block.rotY, 0))
    position.set(block.x, block.h / 2, block.z)
    scale.set(block.w, block.h, block.d)
    matrix.compose(position, quaternion, scale)
    mesh.setMatrixAt(index, matrix)
  })
  mesh.instanceMatrix.needsUpdate = true
  group.add(mesh)
  return group
}
