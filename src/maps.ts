import { TOWN } from './config'

/**
 * 地图表。当前只有小镇可进，医院与地铁是占位——先把选图流程和入口打通，
 * 等 createTown 支持新布局时只要把 unlocked 改成 true 并补生成函数。
 */

export type MapId = 'town' | 'hospital' | 'subway'

export interface MapDef {
  id: MapId
  name: string
  /** 副标题：一句氛围描述，选图卡片上显示 */
  subtitle: string
  desc: string
  /** 生成种子，同一张图每次进都一样 */
  seed: number
  /** false = 显示但不可选（后续地图） */
  unlocked: boolean
  /** 卡片背景渐变色（上/下），值来自调色板口径的十六进制 */
  tintTop: string
  tintBottom: string
}

export const MAPS: readonly MapDef[] = [
  {
    id: 'town',
    name: '小镇',
    subtitle: '落日街 · 废弃商业区',
    desc: '双向街道、成排的临街建筑和一地碎玻璃。视野开阔，适合远程点射，但丧尸会从两侧巷口涌进来。',
    seed: TOWN.seed,
    unlocked: true,
    tintTop: '#3a3f4a',
    tintBottom: '#14161a'
  },
  {
    id: 'hospital',
    name: '废弃医院',
    subtitle: '急诊楼 · 三层回廊',
    desc: '狭长走廊与病房，转角多、遭遇距离近。',
    seed: 0,
    unlocked: false,
    tintTop: '#33403c',
    tintBottom: '#121815'
  },
  {
    id: 'subway',
    name: '地铁隧道',
    subtitle: '二号线 · 停电区间',
    desc: '几乎没有自然光，只能靠手电与枪口火光。',
    seed: 0,
    unlocked: false,
    tintTop: '#2a2f3d',
    tintBottom: '#0d0f14'
  }
]

export const DEFAULT_MAP: MapId = 'town'

/** 按 id 查地图；非法 id 返回 undefined，调用方回退到默认图 */
export function mapOf(id: MapId): MapDef | undefined {
  return MAPS.find((map) => map.id === id)
}

/** 当前可选的地图（选图界面只渲染这些，锁定项单独做占位卡） */
export function unlockedMaps(): readonly MapDef[] {
  return MAPS.filter((map) => map.unlocked)
}
