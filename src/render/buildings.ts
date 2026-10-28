/**
 * 小镇的建筑与道具
 *
 * 全部由方块/圆柱拼装：低模 + 明确的光照方向 + 后处理，比堆细节更能出效果，
 * 而且几何共享后整镇几百个物件只有个位数 draw call 级别的顶点开销。
 * 唯一需要每帧驱动的是窗户与路灯的自发光（白天必须灭），所以把材质引用交回去。
 */

import * as THREE from 'three'
import { FACADE, PALETTE, TREE, TOWN } from '../config'
import { Rng } from '../sim/random'
import type { TownBuilding, TownLayout, TownProp } from '../sim/town'

/** 单位方块 / 单位圆柱：所有建筑与道具缩放到需要的尺寸后共用 */
let unitBox: THREE.BoxGeometry | null = null
let unitCylinder: THREE.CylinderGeometry | null = null
let unitSphere: THREE.IcosahedronGeometry | null = null
let unitTaper: THREE.CylinderGeometry | null = null

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

/** 锥形圆柱：树干/树枝用，上细下粗才有"长"的感觉 */
function taper(): THREE.CylinderGeometry {
  if (!unitTaper) unitTaper = new THREE.CylinderGeometry(0.55, 1, 1, 7)
  return unitTaper
}

/**
 * 确定性哈希 → [0,1)
 * 立面装饰的"有没有""什么颜色"全靠它。不用 Math.random，否则每次刷新同一条街都不一样
 */
function hash01(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt + 1, 374761393)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0
  h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const solidCache = new Map<number, THREE.MeshLambertMaterial>()

function solid(color: number): THREE.MeshLambertMaterial {
  const cached = solidCache.get(color)
  if (cached) return cached
  const material = new THREE.MeshLambertMaterial({ color })
  solidCache.set(color, material)
  return material
}

let wallMap: THREE.CanvasTexture | null = null

/**
 * 墙面贴图：白底 + 斑驳 + 竖向水渍 + 底部积灰
 *
 * 亮度压在 0.84~1.0，所以它只负责"这面墙不是一块纯色"，
 * 颜色仍然由材质自身的 color 决定 —— 换墙色不用重新烘贴图。
 */
function wallTexture(): THREE.CanvasTexture {
  if (wallMap) return wallMap
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('墙面贴图：拿不到 2D 上下文')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)

  const rng = new Rng(TOWN.seed ^ 0x5a5a)
  // 大块斑驳：脏的地方成片，不均匀撒点
  for (let i = 0; i < 26; i += 1) {
    const cx = rng.range(0, size)
    const cy = rng.range(0, size)
    const radius = rng.range(18, 64)
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
    gradient.addColorStop(0, 'rgba(70,60,50,0.10)')
    gradient.addColorStop(1, 'rgba(70,60,50,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2)
  }
  // 竖向水渍：从某个高度往下流，越往下越淡
  for (let i = 0; i < 30; i += 1) {
    const x = rng.range(0, size)
    const top = rng.range(0, size * 0.6)
    const length = rng.range(size * 0.2, size * 0.7)
    const width = rng.range(1.5, 5)
    const gradient = ctx.createLinearGradient(0, top, 0, top + length)
    gradient.addColorStop(0, 'rgba(52,44,36,0.16)')
    gradient.addColorStop(1, 'rgba(52,44,36,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(x, top, width, length)
  }
  // 底部积灰：贴地那圈总是最脏
  const base = ctx.createLinearGradient(0, size, 0, size * 0.72)
  base.addColorStop(0, 'rgba(48,40,32,0.30)')
  base.addColorStop(1, 'rgba(48,40,32,0)')
  ctx.fillStyle = base
  ctx.fillRect(0, size * 0.72, size, size * 0.28)

  wallMap = new THREE.CanvasTexture(canvas)
  wallMap.wrapS = THREE.RepeatWrapping
  wallMap.wrapT = THREE.RepeatWrapping
  wallMap.repeat.set(2, 2)
  wallMap.colorSpace = THREE.SRGBColorSpace
  return wallMap
}

const wallCache = new Map<number, THREE.MeshLambertMaterial>()

/** 墙体材质：带污渍贴图，与纯色 solid() 区分开 */
function wallMaterial(color: number): THREE.MeshLambertMaterial {
  const cached = wallCache.get(color)
  if (cached) return cached
  const material = new THREE.MeshLambertMaterial({ color, map: wallTexture() })
  wallCache.set(color, material)
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

/** 建筑 id → 固定的 [0,1)，立面装饰用它决定"有没有"和"选哪个颜色" */
function seedOf(building: TownBuilding): number {
  return hash01(Math.imul(building.id + 1, 40503), 17)
}

/**
 * 临街面的局部坐标系：局部 +z 指向墙外，局部 +x 沿墙
 * 立面装饰全部按"贴墙往里 0.1 米、沿墙偏移"来摆，比在世界坐标里算 sin/cos 好读
 */
function frontFrame(building: TownBuilding): THREE.Group {
  const face = faceOf(building)
  const frame = new THREE.Group()
  frame.position.set(building.x + face.nx * face.offset, 0, building.z + face.nz * face.offset)
  frame.rotation.y = Math.atan2(face.nx, face.nz)
  return frame
}

/** 雨棚：一块向外斜下的板，商住楼才有。既是细节也是投影来源 */
function addAwning(frame: THREE.Group, building: TownBuilding): void {
  const color = PALETTE.awning[Math.floor(seedOf(building) * PALETTE.awning.length) % PALETTE.awning.length]
  const awning = put(
    frame,
    solid(color),
    FACADE.awningWidth,
    FACADE.awningThickness,
    FACADE.awningDepth,
    0,
    FACADE.awningY,
    FACADE.awningDepth / 2,
  )
  awning.rotation.x = FACADE.awningTilt
  const frontY = FACADE.awningY - Math.sin(FACADE.awningTilt) * FACADE.awningDepth
  // 前沿垂布：没有它，雨棚就是一块飘在墙上的薄板
  put(
    frame,
    solid(0x2b2723),
    FACADE.awningWidth + 0.04,
    FACADE.awningValance,
    0.08,
    0,
    frontY - FACADE.awningValance / 2,
    FACADE.awningDepth,
  )
  // 两根斜撑：把雨棚"挂"回墙上，结构上说得通，视觉上多两条投影
  for (const side of [-1, 1]) {
    const rod = put(
      frame,
      solid(0x302c28),
      0.06,
      FACADE.awningDepth * 1.05,
      0.06,
      side * (FACADE.awningWidth / 2 - 0.3),
      FACADE.awningY - 0.1,
      FACADE.awningDepth * 0.5,
    )
    rod.rotation.x = FACADE.awningTilt * 2.4
  }
}

/** 招牌：贴在雨棚上方，夜里靠自发光亮起来，是街上唯一的彩色光源 */
function addSign(
  frame: THREE.Group,
  building: TownBuilding,
  material: THREE.MeshLambertMaterial,
): void {
  // 每栋楼的招牌宽度略有出入，否则整条街像同一条模板复制出来的
  const width = FACADE.signWidth * (0.82 + seedOf(building) * 0.36)
  // 外框在前、灯箱在后：外框大一圈，露出的那圈木边就是招牌的边框
  put(frame, solid(PALETTE.wood), width + 0.18, FACADE.signHeight + 0.16, 0.1, 0, FACADE.signY, 0.05)
  put(frame, material, width, FACADE.signHeight, 0.08, 0, FACADE.signY, 0.07)
  // 上沿吊架：招牌从墙上"伸"出来一点才不像贴纸
  put(
    frame,
    solid(0x2b2723),
    width + 0.1,
    0.07,
    0.3,
    0,
    FACADE.signY + FACADE.signHeight / 2 + 0.08,
    0.14,
  )
}

/** 门廊：平台 + 两根柱 + 小顶，门前才有"进得去"的暗示 */
function addPorch(frame: THREE.Group): void {
  const half = FACADE.porchWidth / 2
  put(frame, solid(0x6b6357), FACADE.porchWidth, FACADE.porchHeight, FACADE.porchDepth, 0, FACADE.porchHeight / 2, FACADE.porchDepth / 2)
  for (const side of [-1, 1]) {
    put(frame, solid(0x5d5548), 0.13, FACADE.porchRoofY, 0.13, side * (half - 0.16), FACADE.porchRoofY / 2, FACADE.porchDepth - 0.14)
  }
  put(frame, solid(0x3b3630), FACADE.porchWidth + 0.24, 0.14, FACADE.porchDepth + 0.2, 0, FACADE.porchRoofY, FACADE.porchDepth / 2)
}

/** 落水管：沿墙两根竖管。竖线一立，墙面立刻有"高度"而不是一片墙皮 */
function addDownpipes(frame: THREE.Group, building: TownBuilding, wallWidth: number): void {
  const material = solid(0x3a352f)
  for (const side of [-1, 1]) {
    const pipe = new THREE.Mesh(cylinder(), material)
    pipe.scale.set(0.14, building.h, 0.14)
    pipe.position.set(side * (wallWidth / 2 - 0.24), building.h / 2, 0.1)
    pipe.castShadow = true
    frame.add(pipe)
  }
}

/** 腰线：一道横向凸出的窄条，把墙面切成上下两段，比例才不像一整块 */
function addStringCourse(frame: THREE.Group, building: TownBuilding, wallWidth: number): void {
  const y = Math.min(2.95, building.h * 0.52)
  put(frame, solid(0x6d6355), wallWidth - 0.12, 0.13, 0.14, 0, y, 0.07)
}

/** 配电箱 / 空调外机：墙上的小方块，人视线高度上最有说服力的"有人住过" */
function addUtilityBox(frame: THREE.Group, building: TownBuilding): void {
  const color = seedOf(building) > 0.5 ? 0x6a6659 : 0x4d5a52
  put(frame, solid(color), 0.44, 0.58, 0.2, 1.45, 1.52, 0.12)
}

/** 海报/涂鸦：贴在墙面腰高位置的小色块。纯色墙有一两块"人留下的东西"就不像空壳 */
function addPoster(frame: THREE.Group, building: TownBuilding, wallWidth: number): void {
  const color = PALETTE.poster[Math.floor(seedOf(building) * 977) % PALETTE.poster.length]
  const offset = (seedOf(building) - 0.5) * (wallWidth - 2.0)
  put(frame, solid(color), FACADE.posterWidth, FACADE.posterHeight, 0.04, offset, FACADE.posterY, 0.05)
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
  const placements: { x: number; y: number; z: number; rotY: number; nx: number; nz: number }[] = []
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
            x: building.x + face.nx * face.offset + tangentX * t,
            y,
            z: building.z + face.nz * face.offset + tangentZ * t,
            rotY,
            nx: face.nx,
            nz: face.nz,
          })
        }
      }
    }
  }

  const frame = TOWN.windowFrame
  const width = TOWN.windowWidth
  const height = TOWN.windowHeight
  // 窗框、玻璃、窗台三层：玻璃永远在最前面，窗框才会露出"一圈边"读成窗洞
  addInstances(
    parent,
    new THREE.BoxGeometry(width + frame * 2, height + frame * 2, TOWN.windowDepth),
    solid(0x4a423a),
    placements,
    TOWN.windowDepth * 0.5,
    0,
  )
  addInstances(
    parent,
    new THREE.BoxGeometry(width, height, TOWN.windowDepth * 0.6),
    material,
    placements,
    TOWN.windowDepth * 1.15,
    0,
  )
  addInstances(
    parent,
    new THREE.BoxGeometry(width + frame * 2 + 0.12, TOWN.windowSillHeight, TOWN.windowSillDepth),
    solid(0x8d8577),
    placements,
    TOWN.windowSillDepth * 0.5,
    -height / 2 - frame - TOWN.windowSillHeight / 2,
  )
}

/** 把同一批位置塞进一个 InstancedMesh：窗框/玻璃/窗台各一次，一共只有 3 个 draw call */
function addInstances(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  placements: readonly { x: number; y: number; z: number; rotY: number; nx: number; nz: number }[],
  alongNormal: number,
  yOffset: number,
): void {
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length)
  const matrix = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3(1, 1, 1)
  placements.forEach((placement, index) => {
    quaternion.setFromEuler(new THREE.Euler(0, placement.rotY, 0))
    position.set(
      placement.x + placement.nx * alongNormal,
      placement.y + yOffset,
      placement.z + placement.nz * alongNormal,
    )
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

function buildBuilding(
  parent: THREE.Object3D,
  building: TownBuilding,
  signMaterial: THREE.MeshLambertMaterial,
): void {
  const material = wallMaterial(building.wall)
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
  addFacade(parent, building, signMaterial)
}

/**
 * 临街面的装饰。四样东西各有独立哈希位，所以"有雨棚没招牌"这种组合是自然出现的，
 * 不会整条街长得一模一样
 */
function addFacade(
  parent: THREE.Object3D,
  building: TownBuilding,
  signMaterial: THREE.MeshLambertMaterial,
): void {
  const frame = frontFrame(building)
  parent.add(frame)
  const wallWidth = faceOf(building).wallWidth
  // 小棚屋没地方挂招牌雨棚，只给临街面留一张海报
  const shopLike = building.kind !== 'shed'
  if (shopLike && hash01(building.id, 1) < FACADE.awningChance) addAwning(frame, building)
  if (shopLike && hash01(building.id, 2) < FACADE.signChance) addSign(frame, building, signMaterial)
  if (building.kind !== 'shop' && hash01(building.id, 3) < FACADE.porchChance) addPorch(frame)
  if (hash01(building.id, 4) < FACADE.posterChance) addPoster(frame, building, wallWidth)
  addDownpipes(frame, building, wallWidth)
  if (building.kind !== 'shed') addStringCourse(frame, building, wallWidth)
  if (hash01(building.id, 5) < 0.45) addUtilityBox(frame, building)
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
  const scale = prop.scale
  const bark = solid(0x4a3a2a)
  const trunkHeight = TREE.trunkHeight * scale
  const trunk = new THREE.Mesh(taper(), bark)
  trunk.scale.set(TREE.trunkRadius * 2 * scale, trunkHeight, TREE.trunkRadius * 2 * scale)
  trunk.position.set(prop.x, trunkHeight / 2, prop.z)
  trunk.castShadow = true
  trunk.receiveShadow = true
  parent.add(trunk)

  const leaf = solid(prop.variant % 2 === 0 ? 0x53613a : 0x5c5530)
  const seed = Math.imul(prop.id + 1, 2654435761)
  const baseY = trunkHeight * TREE.branchBase
  for (let i = 0; i < TREE.branchCount; i += 1) {
    const angle = prop.rotY + (i / TREE.branchCount) * Math.PI * 2 + hash01(seed, i) * 0.7
    const length = TREE.branchLength * scale * (0.72 + hash01(seed, i + 11) * 0.6)
    // 每根枝的倾角差得多一点，剪影才不会对称
    const tilt = TREE.branchTilt + hash01(seed, i + 23) * 0.5
    // 绕 Y 转 angle、再绕 Z 倾斜 tilt 之后，树枝轴（局部 +Y）在世界里的方向
    const dx = -Math.sin(tilt) * Math.cos(angle)
    const dy = Math.cos(tilt)
    const dz = Math.sin(tilt) * Math.sin(angle)
    const branch = new THREE.Mesh(taper(), bark)
    branch.scale.set(TREE.branchRadius * 2 * scale, length, TREE.branchRadius * 2 * scale)
    branch.rotation.order = 'YXZ'
    branch.rotation.y = angle
    branch.rotation.z = tilt
    branch.position.set(
      prop.x + dx * length * 0.5,
      baseY + dy * length * 0.5,
      prop.z + dz * length * 0.5,
    )
    branch.castShadow = true
    parent.add(branch)

    // 叶团挂在枝头：树冠因此是散开的，而不是"树干顶一个球"的蘑菇。
    // 一团挂在枝端、一小团挂在枝中，两团错开高度就不会连成一张平板
    const radius = TREE.foliageRadius * scale * (0.72 + hash01(seed, i + 37) * 0.5)
    const blob = new THREE.Mesh(sphere(), leaf)
    blob.scale.set(radius * 2, radius * 2 * TREE.foliageSquash, radius * 2)
    blob.position.set(prop.x + dx * length, baseY + dy * length, prop.z + dz * length)
    blob.castShadow = true
    parent.add(blob)

    const inner = new THREE.Mesh(sphere(), leaf)
    const innerRadius = radius * 0.72
    inner.scale.set(innerRadius * 2, innerRadius * 2 * TREE.foliageSquash, innerRadius * 2)
    inner.position.set(
      prop.x + dx * length * 0.62,
      baseY + dy * length * 0.62 + innerRadius * 0.5,
      prop.z + dz * length * 0.62,
    )
    inner.castShadow = true
    parent.add(inner)
  }
}

/** 垃圾桶：细圆柱 + 桶沿。街上最容易一眼认出的东西之一 */
function buildBin(parent: THREE.Object3D, prop: TownProp): void {
  const scale = prop.scale
  const body = new THREE.Mesh(cylinder(), solid(prop.variant % 2 === 0 ? 0x3f4a44 : 0x4a453c))
  body.scale.set(0.44 * scale, 0.92 * scale, 0.44 * scale)
  body.position.set(prop.x, 0.46 * scale, prop.z)
  body.rotation.z = 0.03
  body.castShadow = true
  body.receiveShadow = true
  parent.add(body)

  const rim = new THREE.Mesh(cylinder(), solid(0x2b312d))
  rim.scale.set(0.5 * scale, 0.07 * scale, 0.5 * scale)
  rim.position.set(prop.x, 0.93 * scale, prop.z)
  rim.castShadow = true
  parent.add(rim)
}

/** 消防栓：矮墩 + 顶帽 + 两个侧接口。暗红在灰色街面上是最醒目的一个点 */
function buildHydrant(parent: THREE.Object3D, prop: TownProp): void {
  const scale = prop.scale
  const red = solid(0x8a3b2e)
  const body = new THREE.Mesh(cylinder(), red)
  body.scale.set(0.26 * scale, 0.72 * scale, 0.26 * scale)
  body.position.set(prop.x, 0.36 * scale, prop.z)
  body.castShadow = true
  parent.add(body)

  const cap = new THREE.Mesh(sphere(), solid(0x9c4535))
  cap.scale.setScalar(0.3 * scale)
  cap.position.set(prop.x, 0.74 * scale, prop.z)
  cap.castShadow = true
  parent.add(cap)

  for (const side of [-1, 1]) {
    const nozzle = new THREE.Mesh(cylinder(), red)
    nozzle.scale.set(0.14 * scale, 0.12 * scale, 0.14 * scale)
    nozzle.rotation.z = Math.PI / 2
    nozzle.position.set(prop.x + side * 0.16 * scale, 0.48 * scale, prop.z)
    parent.add(nozzle)
  }
}

/** 电线杆：木杆 + 横担 + 三个绝缘子。竖线在街景里负责"高度" */
function buildPole(parent: THREE.Object3D, prop: TownProp): void {
  const pole = new THREE.Mesh(taper(), solid(0x4f3f2c))
  pole.scale.set(0.26 * prop.scale, 6.2 * prop.scale, 0.26 * prop.scale)
  pole.position.set(prop.x, 3.1 * prop.scale, prop.z)
  pole.castShadow = true
  parent.add(pole)

  const arm = new THREE.Mesh(box(), solid(0x453725))
  arm.scale.set(1.7, 0.11, 0.11)
  arm.position.set(prop.x, 5.6 * prop.scale, prop.z)
  arm.rotation.y = prop.rotY
  arm.castShadow = true
  parent.add(arm)

  for (const side of [-1, 0, 1]) {
    const insulator = new THREE.Mesh(cylinder(), solid(0x6c6a5c))
    insulator.scale.set(0.09, 0.16, 0.09)
    insulator.position.set(
      prop.x + Math.cos(prop.rotY) * side * 0.7,
      5.72 * prop.scale,
      prop.z - Math.sin(prop.rotY) * side * 0.7,
    )
    parent.add(insulator)
  }
}

/** 路牌：细杆 + 一块牌子。牌子上的字看不清也没关系，它只负责打破街面的空 */
function buildSign(parent: THREE.Object3D, prop: TownProp): void {
  const post = new THREE.Mesh(cylinder(), solid(0x6a6a66))
  post.scale.set(0.1, 2.3, 0.1)
  post.position.set(prop.x, 1.15, prop.z)
  post.castShadow = true
  parent.add(post)

  const plate = put(
    parent,
    solid(prop.variant % 2 === 0 ? 0x7d8a7a : 0x8a7f5f),
    0.66,
    0.5,
    0.05,
    prop.x,
    2.2,
    prop.z,
    prop.rotY,
  )
  plate.castShadow = true
}

/** 大垃圾箱：铁皮箱 + 斜盖 + 四个小轮 */
function buildDumpster(parent: THREE.Object3D, prop: TownProp): void {
  const scale = prop.scale
  const body = put(parent, solid(prop.variant % 2 === 0 ? 0x3c4a4a : 0x4a3f34), 1.9 * scale, 1.15 * scale, 1.05 * scale, prop.x, 0.6 * scale, prop.z, prop.rotY)
  body.castShadow = true

  const lid = put(parent, solid(0x2c3535), 1.94 * scale, 0.1 * scale, 1.1 * scale, prop.x, 1.22 * scale, prop.z, prop.rotY)
  lid.rotation.x = -0.12
  lid.castShadow = true

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wheel = new THREE.Mesh(cylinder(), solid(0x1e2020))
      wheel.scale.set(0.16 * scale, 0.1 * scale, 0.16 * scale)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(
        prop.x + Math.cos(prop.rotY) * sx * 0.8 * scale + Math.sin(prop.rotY) * sz * 0.42 * scale,
        0.08 * scale,
        prop.z - Math.sin(prop.rotY) * sx * 0.8 * scale + Math.cos(prop.rotY) * sz * 0.42 * scale,
      )
      parent.add(wheel)
    }
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
  /** 招牌自发光材质：夜里点亮，白天近黑 */
  signMaterial: THREE.MeshLambertMaterial
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

  // 招牌底色近黑、自发光暖橙：白天是块暗板，夜里是街上唯一的彩色光
  const signMaterial = new THREE.MeshLambertMaterial({
    color: PALETTE.signBoard,
    emissive: new THREE.Color(0xffb46a),
    emissiveIntensity: 0,
  })

  addCurbs(group, layout)
  for (const building of layout.buildings) buildBuilding(group, building, signMaterial)

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
      case 'bin':
        buildBin(group, prop)
        break
      case 'hydrant':
        buildHydrant(group, prop)
        break
      case 'pole':
        buildPole(group, prop)
        break
      case 'sign':
        buildSign(group, prop)
        break
      case 'dumpster':
        buildDumpster(group, prop)
        break
      default:
        break
    }
  }

  addWindows(group, layout.buildings, windowMaterial)

  return { group, windowMaterial, lampMaterial, signMaterial, lampPositions }
}
