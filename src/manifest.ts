/**
 * 资产清单：稳定 key → 文件 URL
 * 业务代码只允许用 key 取资源，禁止直接写资源路径（换图时零改代码）
 */

import playerIdle from './assets/characters/player-survivor.png'
import playerGun from './assets/characters/player-survivor-gun.png'
import zombieBasic from './assets/characters/zombie-basic.png'
import treeDead from './assets/environment/trees/tree-dead.png'
import treeOak from './assets/environment/trees/tree-oak.png'
import treePine from './assets/environment/trees/tree-pine.png'

export const ASSETS = {
  'player-idle': playerIdle,
  'player-gun': playerGun,
  'zombie-basic': zombieBasic,
  'tree-dead': treeDead,
  'tree-oak': treeOak,
  'tree-pine': treePine,
} as const

export type AssetKey = keyof typeof ASSETS
