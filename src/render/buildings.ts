/**
 * 小镇的建筑与道具
 *
 * 全部由方块/圆柱拼装：低模 + 明确的光照方向 + 后处理，比堆细节更能出效果，
 * 而且几何共享后整镇几百个物件只有个位数 draw call 级别的顶点开销。
 * 唯一需要每帧驱动的是窗户与路灯的自发光（白天必须灭），所以把材质引用交回去。
 */

import * as THREE from 'three'
import { PALETTE, TOWN } from '../config'
import type { TownBuilding, TownLayout, TownProp } from '../sim/town'

/** 单位方块 / 单位圆柱：所有建筑与道具缩放到需要的尺寸后共用 */
let unitBox: THREE.BoxGeometry | null = null
let unitCylinder: THREE.CylinderGeometry | null = null
let unitSphere: THREE.IcosahedronGeometry | null = null

function box(): THREE.BoxGeometry {
  if (!unitBox) unitBox = new THREE.BoxGeometry(1, 1, 1)
  return unitBox
}

function cylinder(): THREE.CylinderGeometry {
  if (!unitCylinder) unitCylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 10)
  return unitCylinder
}

function sphere(): THREE.IcosahedronGeometry {
  if (!unitSphere) unitSphere = new THREE.IcosahedronGeometry(0.5, 0)
  return unitSphere
}

const solidCache = new Map<number, THREE.MeshLambertMaterial>()

function solid(color: number): THREE.MeshLambertMaterial {
  const cached = solidCache.get(color)
  if (cached) return cached
  const material = new THREE.MeshLambertMaterial({ color })
  solidCache.set(color, material)
  return material
}

/** 摆一个缩放到指定尺寸的方块 */
function put(
  parent: THREE.Object3D,
  material: THREE.Material,
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  rotY = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(box(), material)
  mesh.scale.set(width, height, depth)
  mesh.position.set(x, y, z)
  mesh.rotation.y = rotY
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

/** 墙面法线与沿墙的切线方向：窗户只贴在临街那一面 */
function faceOf(building: TownBuilding): { nx: number; nz: number; offset: number; wallWidth: number } {
  switch (building.front) {
    case 'x+':
      return { nx: 1, nz: 0, offset: building.w / 2, wallWidth: building.d }
    case 'x-':
      return { nx: -1, nz: 0, offset: building.w / 2, wallWidth: building.d }
    case 'z+':
      return { nx: 0, nz: 1, offset: building.d / 2, wallWidth: building.w }
    default:
      return { nx: 0, nz: -1, offset: building.d / 2, wallWidth: building.w }
  }
}

/** 每栋楼一扇门：贴在临街墙面底部，门框用更暗的木头色 */
function addDoor(parent: THREE.Object3D, building: TownBuilding): void {
  const face = faceOf(building)
  const doorWidth = 1.15
  const doorHeight = 2.15
  const x = building.x + face.nx * (face.offset + 0.02)
  const z = building.z + face.nz * (face.offset + 0.02)
  const rotY = face.nx !== 0 ? Math.PI / 2 : 0
  put(parent, solid(PALETTE.wood), doorWidth, doorHeight, 0.12, x, doorHeight / 2, z, rotY)
}

/** 四个立面都要开窗：只给临街一面开，走到侧面就是一片死墙 */
function facesOf(building: TownBuilding): { nx: number; nz: number; offset: number; wallWidth: number }[] {
  return [
    { nx: 1, nz: 0, offset: building.w / 2, wallWidth: building.d },
    { nx: -1, nz: 0, offset: building.w / 2, wallWidth: building.d },
    { nx: 0, nz: 1, offset: building.d / 2, wallWidth: building.w },
    { nx: 0, nz: -1, offset: building.d / 2, wallWidth: building.w },
  ]
}

/** 窗户实例：一层楼一排，列距 windowSpacing，全部塞进一个 InstancedMesh */
function addWindows(
  parent: THREE.Object3D,
  buildings: readonly TownBuilding[],
  material: THREE.MeshLambertMaterial,
): void {
  const placements: { x: number; y: number; z: number; rotY: number }[] = []
  for (const building of buildings) {
    const front = faceOf(building)
    const floors = Math.max(1, Math.floor((building.h - 0.6) / TOWN.windowFloorHeight))
    for (const face of facesOf(building)) {
      const columns = Math.max(1, Math.floor((face.wallWidth - 1.2) / TOWN.windowSpacing))
      const rotY = face.nx !== 0 ? Math.PI / 2 : 0
      const tangentX = face.nz === 0 ? 0 : 1
      const tangentZ = face.nx === 0 ? 0 : 1
      const isFront = face.nx === front.nx && face.nz === front.nz
      for (let floor = 0; floor < floors; floor += 1) {
        const y = 1.55 + floor * TOWN.windowFloorHeight
        if (y > building.h - 0.7) break
        for (let column = 0; column < columns; column += 1) {
          const t = (column - (columns - 1) / 2) * TOWN.windowSpacing
          // 临街那一面的底层中央是门，别把窗户叠在门上
          if (isFront && floor === 0 && Math.abs(t) < 1.0) continue
          placements.push({
            x: building.x + face.nx * (face.offset + 0.03) + tangentX * t,
            y,
            z: building.z + face.nz * (face.offset + 0.03) + tangentZ * t,
            rotY,
          })
        }
      }
    }
  }

  const geometry = new THREE.BoxGeometry(0.95, 1.15, 0.08)
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length)
  const matrix = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3(1, 1, 1)
  placements.forEach((placement, index) => {
    quaternion.setFromEuler(new THREE.Euler(0, placement.rotY, 0))
    position.set(placement.x, placement.y, placement.z)
    matrix.compose(position, quaternion, scale)
    mesh.setMatrixAt(index, matrix)
  })
  mesh.instanceMatrix.needsUpdate = true
  parent.add(mesh)
}

/** 路缘石：沿街两侧各一条，跳过路口。有厚度，街道才不是画在地上的一条色带 */
function addCurbs(parent: THREE.Object3D, layout: TownLayout): void {
  const material = solid(0x8d8577)
  const half = layout.streetWidth / 2
  const offset = half + 0.14
  const streets = layout.streets
  for (const street of streets) {
    for (let index = 0; index < streets.length - 1; index += 1) {
      const from = streets[index] + half
      const to = streets[index + 1] - half
      const length = to - from
      if (length <= 0.6) continue
      const middle = (from + to) / 2
      for (const side of [-1, 1]) {
        // 竖向街道的两侧路缘（沿 z 铺），再补横向街道的两侧（沿 x 铺）
        put(parent, material, 0.26, 0.16, length, street + side * offset, 0.08, middle)
        put(parent, material, length, 0.16, 0.26, middle, 0.08, street + side * offset)
      }
    }
  }
}

function buildBuilding(parent: THREE.Object3D, building: TownBuilding): void {
  const material = solid(building.wall)
  put(parent, material, building.w, building.h, building.d, building.x, building.h / 2, building.z)
  // 屋檐：比主体宽 0.4 米，边缘因此有一道投影线，楼才"坐"在地上
  put(
    parent,
    solid(building.roof),
    building.w + 0.4,
    0.32,
    building.d + 0.4,
    building.x,
    building.h + 0.1,
    building.z,
  )
  // 勒脚：一圈略深的墙裙，楼才像从地里长出来，而不是悬在地上
  const skirt = new THREE.Color(building.wall).multiplyScalar(0.62).getHex()
  put(parent, solid(skirt), building.w + 0.08, 0.42, building.d + 0.08, building.x, 0.21, building.z)
  addDoor(parent, building)
  addRooftop(parent, building)
}

/** 屋顶小件：烟囱或水箱，按 id 决定有无，让天际线不全是同一个平顶 */
function addRooftop(parent: THREE.Object3D, building: TownBuilding): void {
  const seed = (building.id * 2654435761) >>> 0
  const variant = seed % 3
  if (variant === 0) return
  const offsetX = building.w * 0.22 * (seed % 2 === 0 ? 1 : -1)
  const offsetZ = building.d * 0.18 * (seed % 3 === 0 ? 1 : -1)
  if (variant === 1) {
    const chimney = new THREE.Mesh(cylinder(), solid(0x6b5a4b))
    chimney.scale.set(0.46, 1.1, 0.46)
    chimney.position.set(building.x + offsetX, building.h + 0.6, building.z + offsetZ)
    chimney.castShadow = true
    parent.add(chimney)
    return
  }
  put(parent, solid(0x4a4f52), 1.1, 0.72, 0.9, building.x + offsetX, building.h + 0.42, building.z + offsetZ)
}

function buildCar(parent: THREE.Object3D, prop: TownProp): void {
  const car = new THREE.Group()
  car.position.set(prop.x, 0, prop.z)
  car.rotation.y = prop.rotY
  const paint = PALETTE.carPaint[prop.variant % PALETTE.carPaint.length]
  put(car, solid(paint), 1.86, 0.66, 4.3, 0, 0.62, 0)
  put(car, solid(paint), 1.66, 0.62, 2.1, 0, 1.23, -0.12)
  put(car, solid(0x20242a), 1.72, 0.42, 1.6, 0, 1.16, -0.12)
  for (const dx of [-0.94, 0.94]) {
    for (const dz of [-1.42, 1.42]) {
      const wheel = new THREE.Mesh(cylinder(), solid(0x1b1b1d))
      wheel.scale.set(0.66, 0.24, 0.66)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(dx, 0.33, dz)
      car.add(wheel)
    }
  }
  parent.add(car)
}

function buildBarrel(parent: THREE.Object3D, prop: TownProp): void {
  const barrel = new THREE.Mesh(cylinder(), solid(prop.variant % 2 === 0 ? PALETTE.rust : PALETTE.metal))
  barrel.scale.set(0.58, 0.9, 0.58)
  barrel.position.set(prop.x, 0.45 * prop.scale, prop.z)
  parent.add(barrel)
  const ring = new THREE.Mesh(cylinder(), solid(0x2c2723))
  ring.scale.set(0.62, 0.08, 0.62)
  ring.position.set(prop.x, 0.62 * prop.scale, prop.z)
  parent.add(ring)
}

function buildCrate(parent: THREE.Object3D, prop: TownProp): void {
  const size = 0.82 * prop.scale
  put(parent, solid(PALETTE.wood), size, size, size, prop.x, size / 2, prop.z, prop.rotY)
  // 顶面压一道更亮的板缝，木箱才不会读成一块纯色方块
  put(parent, solid(0x8d6b45), size * 0.98, 0.06, size * 0.18, prop.x, size + 0.02, prop.z, prop.rotY)
}

function buildTree(parent: THREE.Object3D, prop: TownProp): void {
  const trunk = new THREE.Mesh(cylinder(), solid(0x4a3a2a))
  trunk.scale.set(0.34, 3.2, 0.34)
  trunk.position.set(prop.x, 1.6 * prop.scale, prop.z)
  parent.add(trunk)
  const foliage = solid(prop.variant % 2 === 0 ? 0x3e4a2c : 0x4a4526)
  for (let i = 0; i < 3; i += 1) {
    const blob = new THREE.Mesh(sphere(), foliage)
    const radius = (2.1 - i * 0.45) * prop.scale
    blob.scale.set(radius * 2, radius * 1.5, radius * 2)
    blob.position.set(
      prop.x + (i % 2 === 0 ? 0.24 : -0.2) * prop.scale,
      (3.1 + i * 0.62) * prop.scale,
      prop.z + (i === 1 ? 0.28 : -0.18) * prop.scale,
    )
    parent.add(blob)
  }
}

function buildRubble(parent: THREE.Object3D, prop: TownProp): void {
  const material = solid(0x5a544b)
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2 + prop.rotY
    const distance = 0.22 + (i % 3) * 0.16
    const size = 0.26 + (i % 2) * 0.14
    put(
      parent,
      material,
      size,
      size * 0.7,
      size,
      prop.x + Math.cos(angle) * distance,
      size * 0.35,
      prop.z + Math.sin(angle) * distance,
      angle,
    )
  }
}

function buildFence(parent: THREE.Object3D, prop: TownProp): void {
  const length = 2.4 * prop.scale
  const material = solid(0x6a5946)
  for (const offset of [-length / 2, length / 2]) {
    put(
      parent,
      material,
      0.12,
      1.15,
      0.12,
      prop.x + Math.cos(prop.rotY) * offset,
      0.58,
      prop.z + Math.sin(prop.rotY) * offset,
    )
  }
  put(parent, material, length, 0.1, 0.08, prop.x, 0.95, prop.z, -prop.rotY)
  put(parent, material, length, 0.1, 0.08, prop.x, 0.6, prop.z, -prop.rotY)
}

/** 路灯的主体；灯头材质单独拿出来给夜里点亮用 */
function buildLamp(parent: THREE.Object3D, prop: TownProp, lampMaterial: THREE.MeshLambertMaterial): THREE.Vector3 {
  const pole = new THREE.Mesh(cylinder(), solid(0x2e302f))
  pole.scale.set(0.16, 5.4, 0.16)
  pole.position.set(prop.x, 2.7, prop.z)
  parent.add(pole)

  const arm = new THREE.Mesh(box(), solid(0x2e302f))
  arm.scale.set(1.05, 0.1, 0.1)
  arm.position.set(prop.x + 0.5, 5.35, prop.z)
  arm.rotation.y = prop.rotY
  parent.add(arm)

  const head = new THREE.Mesh(box(), lampMaterial)
  head.scale.set(0.5, 0.16, 0.34)
  head.position.set(prop.x + Math.cos(prop.rotY) * 1.0, 5.2, prop.z + Math.sin(prop.rotY) * 1.0)
  head.rotation.y = prop.rotY
  parent.add(head)

  // 灯泡位置回给主循环：夜里用它驱动一盏真实点光源
  return new THREE.Vector3(
    prop.x + Math.cos(prop.rotY) * 1.0,
    5.05,
    prop.z + Math.sin(prop.rotY) * 1.0,
  )
}

export interface TownView {
  group: THREE.Group
  /** 窗户自发光材质：白天灭、夜里亮 */
  windowMaterial: THREE.MeshLambertMaterial
  /** 路灯灯头材质 */
  lampMaterial: THREE.MeshLambertMaterial
  /** 灯头世界坐标，供"最近路灯"点光源定位 */
  lampPositions: THREE.Vector3[]
}

/** 按布局生成整座小镇的静态几何 */
export function buildTown(layout: TownLayout): TownView {
  const group = new THREE.Group()
  group.name = 'town'

  const windowMaterial = new THREE.MeshLambertMaterial({
    color: 0x1e2126,
    emissive: new THREE.Color(0xffd39a),
    emissiveIntensity: 0,
  })
  const lampMaterial = new THREE.MeshLambertMaterial({
    color: 0x14161a,
    emissive: new THREE.Color(0xfff0c4),
    emissiveIntensity: 0,
  })

  addCurbs(group, layout)
  for (const building of layout.buildings) buildBuilding(group, building)

  const lampPositions: THREE.Vector3[] = []
  for (const prop of layout.props) {
    switch (prop.kind) {
      case 'car':
        buildCar(group, prop)
        break
      case 'barrel':
        buildBarrel(group, prop)
        break
      case 'crate':
        buildCrate(group, prop)
        break
      case 'tree':
        buildTree(group, prop)
        break
      case 'rubble':
        buildRubble(group, prop)
        break
      case 'fence':
        buildFence(group, prop)
        break
      case 'lamp':
        lampPositions.push(buildLamp(group, prop, lampMaterial))
        break
      default:
        break
    }
  }

  addWindows(group, layout.buildings, windowMaterial)

  return { group, windowMaterial, lampMaterial, lampPositions }
}
