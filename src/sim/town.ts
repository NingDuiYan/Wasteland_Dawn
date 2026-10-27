/**
 * 程序化小镇：纯数据，不含任何 three 依赖
 *
 * 生成顺序是这个文件的核心：街道 → 人行道 → 地块 → 建筑 → 道具。
 * 反过来（先撒房子再划街）必然出现"房子压在马路中间"，
 * 而网格化之后每一块地都天然有归属，规则只用写一次。
 *
 * 约定：世界是 XZ 平面，x 向东、z 向南，原点在镇中心十字路口。
 */

import { PALETTE, TOWN, WORLD_EXTENT } from '../config'
import { Rng } from './random'

export type BuildingKind = 'house' | 'shop' | 'shed'
export type PropKind = 'car' | 'barrel' | 'crate' | 'tree' | 'rubble' | 'lamp' | 'fence'

/** 轴对齐包围盒（XZ）+ 高度：碰撞与射线都用它 */
export interface Box {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  height: number
}

/** 立面朝向：决定门开在哪一侧、窗户朝哪面 */
export type Facing = 'x+' | 'x-' | 'z+' | 'z-'

export interface TownBuilding {
  id: number
  kind: BuildingKind
  x: number
  z: number
  w: number
  d: number
  h: number
  front: Facing
  wall: number
  roof: number
}

export interface TownProp {
  id: number
  kind: PropKind
  x: number
  z: number
  /** 绕 Y 轴旋转（弧度） */
  rotY: number
  scale: number
  /** 同一类道具的配色/形态变体编号 */
  variant: number
}

export interface TownLayout {
  seed: number
  size: number
  /** 街道中心线坐标（横竖共用同一组） */
  streets: number[]
  streetWidth: number
  sidewalkWidth: number
  buildings: TownBuilding[]
  props: TownProp[]
  colliders: Box[]
  spawn: { x: number; z: number; yaw: number }
}

/** 浮点比较用小量，避免道具卡在墙缝里 */
const EPS = 0.05

function overlaps(a: Box, b: Box): boolean {
  return a.minX < b.maxX - EPS && a.maxX > b.minX + EPS && a.minZ < b.maxZ - EPS && a.maxZ > b.minZ + EPS
}

export function boxOfBuilding(b: TownBuilding): Box {
  return {
    minX: b.x - b.w / 2,
    maxX: b.x + b.w / 2,
    minZ: b.z - b.d / 2,
    maxZ: b.z + b.d / 2,
    height: b.h,
  }
}

/** 街道中心线：5 条 → -88 / -44 / 0 / 44 / 88 */
function makeStreets(): number[] {
  const count = TOWN.streetCount
  const half = (count - 1) / 2
  return Array.from({ length: count }, (_, i) => (i - half) * TOWN.streetSpacing)
}

/** 某点是否落在任意一条街道的车行道上 */
export function onStreet(x: number, z: number, streets: number[]): boolean {
  const half = TOWN.streetWidth / 2
  return streets.some((s) => Math.abs(x - s) < half) || streets.some((s) => Math.abs(z - s) < half)
}

/** 离建筑最近的那条街在哪一侧：决定门与窗朝向 */
function pickFacing(x: number, z: number, streets: number[]): Facing {
  let best: Facing = 'z-'
  let bestDistance = Number.POSITIVE_INFINITY
  for (const s of streets) {
    const candidates: { facing: Facing; distance: number }[] = [
      { facing: 'z-', distance: Math.abs(z - (s - TOWN.streetWidth / 2)) },
      { facing: 'z+', distance: Math.abs(z - (s + TOWN.streetWidth / 2)) },
      { facing: 'x-', distance: Math.abs(x - (s - TOWN.streetWidth / 2)) },
      { facing: 'x+', distance: Math.abs(x - (s + TOWN.streetWidth / 2)) },
    ]
    for (const candidate of candidates) {
      if (candidate.distance < bestDistance) {
        bestDistance = candidate.distance
        best = candidate.facing
      }
    }
  }
  return best
}

interface Lot {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** 把一个街区切成两块地；偶尔不切，留出整块空地当荒园 */
function splitBlock(block: Lot, rng: Rng): Lot[] {
  const gap = TOWN.lotGap
  if (rng.chance(0.18)) return [block]
  if (rng.chance(0.5)) {
    const mid = (block.minX + block.maxX) / 2
    return [
      { ...block, maxX: mid - gap / 2 },
      { ...block, minX: mid + gap / 2 },
    ]
  }
  const mid = (block.minZ + block.maxZ) / 2
  return [
    { ...block, maxZ: mid - gap / 2 },
    { ...block, minZ: mid + gap / 2 },
  ]
}

export function createTown(seed: number = TOWN.seed): TownLayout {
  const rng = new Rng(seed)
  const streets = makeStreets()
  const layout: TownLayout = {
    seed,
    size: WORLD_EXTENT * 2,
    streets,
    streetWidth: TOWN.streetWidth,
    sidewalkWidth: TOWN.sidewalkWidth,
    buildings: [],
    props: [],
    colliders: [],
    spawn: { x: 0, z: 0, yaw: 0 },
  }

  fillBuildings(layout, rng)
  placeStreetLamps(layout, rng)
  placeCars(layout, rng)
  placeAlleyProps(layout, rng)
  placeNature(layout, rng)
  placeFences(layout, rng)
  return layout
}

/** 街区 → 地块 → 建筑（空的留作荒园，由 placeNature 补树） */
function fillBuildings(layout: TownLayout, rng: Rng): void {
  const { streets } = layout
  const inset = layout.streetWidth / 2 + layout.sidewalkWidth
  let id = 0

  for (let i = 0; i < streets.length - 1; i += 1) {
    for (let j = 0; j < streets.length - 1; j += 1) {
      const block: Lot = {
        minX: streets[i] + inset,
        maxX: streets[i + 1] - inset,
        minZ: streets[j] + inset,
        maxZ: streets[j + 1] - inset,
      }
      for (const lot of splitBlock(block, rng)) {
        // 荒园：不盖楼，留给树与废墟
        if (rng.chance(TOWN.vacantChance)) continue
        const lotW = lot.maxX - lot.minX
        const lotD = lot.maxZ - lot.minZ
        const w = Math.min(lotW - 1.2, rng.range(TOWN.houseMin, TOWN.houseMax))
        const d = Math.min(lotD - 1.2, rng.range(TOWN.houseMin, TOWN.houseMax))
        if (w < 4 || d < 4) continue
        const x = rng.range(lot.minX + w / 2 + 0.4, lot.maxX - w / 2 - 0.4)
        const z = rng.range(lot.minZ + d / 2 + 0.4, lot.maxZ - d / 2 - 0.4)
        const kind: BuildingKind = rng.chance(0.16) ? 'shop' : rng.chance(0.14) ? 'shed' : 'house'
        const shrink = kind === 'shed' ? 0.62 : 1
        const h = rng.range(TOWN.houseHeightMin, TOWN.houseHeightMax) * (kind === 'shop' ? 1.25 : shrink)
        layout.buildings.push({
          id: id++,
          kind,
          x,
          z,
          w: w * shrink,
          d: d * shrink,
          h,
          front: pickFacing(x, z, streets),
          wall: rng.pick(PALETTE.wall),
          roof: rng.pick(PALETTE.roof),
        })
      }
    }
  }

  // 镇子外围补几栋孤楼：走远了也不会看到"地图到头了"
  for (let k = 0; k < 6; k += 1) {
    const angle = (k / 6) * Math.PI * 2 + rng.range(-0.3, 0.3)
    const radius = rng.range(96, 104)
    layout.buildings.push({
      id: id++,
      kind: 'shed',
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      w: rng.range(7, 10),
      d: rng.range(7, 10),
      h: rng.range(3.5, 6),
      front: 'z+',
      wall: rng.pick(PALETTE.wall),
      roof: rng.pick(PALETTE.roof),
    })
  }

  for (const building of layout.buildings) {
    layout.colliders.push(boxOfBuilding(building))
  }
}

/** 路灯：交叉口对角两盏，按间隔挑选避免整条街密密麻麻 */
function placeStreetLamps(layout: TownLayout, rng: Rng): void {
  const { streets } = layout
  const offset = layout.streetWidth / 2 + layout.sidewalkWidth * 0.6
  const spots: { x: number; z: number }[] = []
  for (const sx of streets) {
    for (const sz of streets) {
      spots.push({ x: sx + offset, z: sz + offset })
      spots.push({ x: sx - offset, z: sz - offset })
    }
  }
  let id = 5000
  let placed = 0
  for (let i = 0; i < spots.length && placed < TOWN.lampCount; i += 4) {
    const spot = spots[i]
    layout.props.push({
      id: id++,
      kind: 'lamp',
      x: spot.x,
      z: spot.z,
      rotY: rng.int(0, 3) * (Math.PI / 2),
      scale: 1,
      variant: 0,
    })
    layout.colliders.push({
      minX: spot.x - 0.2,
      maxX: spot.x + 0.2,
      minZ: spot.z - 0.2,
      maxZ: spot.z + 0.2,
      height: 5.2,
    })
    placed += 1
  }
}

/** 弃车：只停在车行道上，并避开路口（路口是玩家转身的地方，堵住会很难受） */
function placeCars(layout: TownLayout, rng: Rng): void {
  const { streets } = layout
  let placed = 0
  let id = 1000
  let guard = 0
  while (placed < TOWN.carCount && guard < TOWN.carCount * 40) {
    guard += 1
    const vertical = rng.chance(0.5)
    const line = rng.pick(streets)
    const along = rng.range(-WORLD_EXTENT + 12, WORLD_EXTENT - 12)
    const lane = (rng.chance(0.5) ? 1 : -1) * rng.range(1.6, 3.2)
    const x = vertical ? line + lane : along
    const z = vertical ? along : line + lane
    if (streets.some((s) => Math.abs(x - s) < 8) && streets.some((s) => Math.abs(z - s) < 8)) {
      continue
    }
    const halfW = vertical ? 1.05 : 2.1
    const halfD = vertical ? 2.1 : 1.05
    const box: Box = { minX: x - halfW, maxX: x + halfW, minZ: z - halfD, maxZ: z + halfD, height: 1.55 }
    if (layout.colliders.some((c) => overlaps(c, box))) continue
    layout.props.push({
      id: id++,
      kind: 'car',
      x,
      z,
      rotY: (vertical ? Math.PI / 2 : 0) + rng.range(-0.1, 0.1),
      scale: rng.range(0.94, 1.06),
      variant: rng.int(0, PALETTE.carPaint.length - 1),
    })
    layout.colliders.push(box)
    placed += 1
  }
}

/** 巷子里的桶与箱：贴着建筑外墙放，读起来才像"人用过" */
function placeAlleyProps(layout: TownLayout, rng: Rng): void {
  let id = 2000
  let barrels = 0
  let crates = 0
  let guard = 0

  while ((barrels < TOWN.barrelCount || crates < TOWN.crateCount) && guard < 1200) {
    guard += 1
    if (layout.buildings.length === 0) break
    const host = rng.pick(layout.buildings)
    const side = rng.int(0, 3)
    const alongX = side < 2
    const sign = side % 2 === 0 ? 1 : -1
    const spread = Math.max(0.9, (alongX ? host.w : host.d) / 2)
    const offset = rng.range(0.7, spread) * (rng.chance(0.5) ? 1 : -1)
    const x = alongX ? host.x + offset : host.x + sign * (host.w / 2 + 0.95)
    const z = alongX ? host.z + sign * (host.d / 2 + 0.95) : host.z + offset
    if (onStreet(x, z, layout.streets)) continue

    const isBarrel = barrels < TOWN.barrelCount && (crates >= TOWN.crateCount || rng.chance(0.5))
    const radius = isBarrel ? 0.44 : 0.64
    const box: Box = {
      minX: x - radius,
      maxX: x + radius,
      minZ: z - radius,
      maxZ: z + radius,
      height: isBarrel ? 0.95 : 0.9,
    }
    if (layout.colliders.some((c) => overlaps(c, box))) continue
    layout.props.push({
      id: id++,
      kind: isBarrel ? 'barrel' : 'crate',
      x,
      z,
      rotY: rng.range(0, Math.PI),
      scale: rng.range(0.88, 1.12),
      variant: rng.int(0, 1),
    })
    layout.colliders.push(box)
    if (isBarrel) barrels += 1
    else crates += 1
  }

  // 碎石堆：躺在地上，不挡路也不参与碰撞，纯粹让地面有层次
  for (let i = 0; i < TOWN.rubbleCount; i += 1) {
    const x = rng.range(-WORLD_EXTENT + 8, WORLD_EXTENT - 8)
    const z = rng.range(-WORLD_EXTENT + 8, WORLD_EXTENT - 8)
    if (onStreet(x, z, layout.streets) && rng.chance(0.75)) continue
    layout.props.push({
      id: id++,
      kind: 'rubble',
      x,
      z,
      rotY: rng.range(0, Math.PI * 2),
      scale: rng.range(0.7, 1.5),
      variant: rng.int(0, 2),
    })
  }
}

/** 树：荒园、街区边缘与镇外荒地，避开路面与建筑 */
function placeNature(layout: TownLayout, rng: Rng): void {
  let id = 3000
  let placed = 0
  let guard = 0
  while (placed < TOWN.treeCount && guard < TOWN.treeCount * 40) {
    guard += 1
    const x = rng.range(-WORLD_EXTENT + 6, WORLD_EXTENT - 6)
    const z = rng.range(-WORLD_EXTENT + 6, WORLD_EXTENT - 6)
    if (onStreet(x, z, layout.streets)) continue
    const box: Box = {
      minX: x - 0.5,
      maxX: x + 0.5,
      minZ: z - 0.5,
      maxZ: z + 0.5,
      height: 4.4,
    }
    if (layout.colliders.some((c) => overlaps(c, box))) continue
    layout.props.push({
      id: id++,
      kind: 'tree',
      x,
      z,
      rotY: rng.range(0, Math.PI * 2),
      scale: rng.range(0.8, 1.35),
      variant: rng.int(0, 2),
    })
    layout.colliders.push(box)
    placed += 1
  }
}

/** 栅栏：贴在地块边界上成段摆放，中间留缺口让玩家能穿过去 */
function placeFences(layout: TownLayout, rng: Rng): void {
  let id = 4000
  const panelLength = 2.2
  for (let i = 0; i < TOWN.fenceSegments; i += 1) {
    const host = rng.pick(layout.buildings)
    const alongX = rng.chance(0.5)
    const panels = rng.int(2, 5)
    const startX = alongX ? host.x - (panels * panelLength) / 2 : host.x + host.w / 2 + 1.7
    const startZ = alongX ? host.z + host.d / 2 + 1.7 : host.z - (panels * panelLength) / 2
    for (let p = 0; p < panels; p += 1) {
      // 每隔三四段留一个缺口：能翻过去的栅栏等于装饰，围死的栅栏等于迷宫
      if (p > 0 && rng.chance(0.18)) continue
      const x = alongX ? startX + p * panelLength : startX
      const z = alongX ? startZ : startZ + p * panelLength
      if (onStreet(x, z, layout.streets)) continue
      const box: Box = {
        minX: x - (alongX ? panelLength / 2 : 0.12),
        maxX: x + (alongX ? panelLength / 2 : 0.12),
        minZ: z - (alongX ? 0.12 : panelLength / 2),
        maxZ: z + (alongX ? 0.12 : panelLength / 2),
        height: 1.15,
      }
      if (layout.colliders.some((c) => overlaps(c, box))) continue
      layout.props.push({
        id: id++,
        kind: 'fence',
        x,
        z,
        rotY: alongX ? 0 : Math.PI / 2,
        scale: 1,
        variant: rng.int(0, 1),
      })
      layout.colliders.push(box)
    }
  }
}
