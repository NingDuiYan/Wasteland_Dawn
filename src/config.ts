/**
 * 全局数值配置
 * 所有可调参数集中在此，禁止在业务代码里散落魔法数字
 */

/** 世界尺寸（px），与设计文档第 5 节一致 */
export const WORLD_SIZE = 1600

/** 逻辑分辨率，Phaser FIT 缩放到容器 */
export const VIEW_WIDTH = 960
export const VIEW_HEIGHT = 540

/** 建造网格 / 寻路网格 */
export const BUILD_GRID = 32
export const PATH_GRID = 16

export const PLAYER = {
  speed: 120,
  hp: 100,
} as const

export const ZOMBIE = {
  speed: 42,
  count: 10,
  /** 丧尸之间互相推开的半径，避免完全重叠 */
  separation: 26,
  /** 丧尸与玩家保持的最小距离，防止把玩家完全埋住看不见 */
  minDistanceToPlayer: 34,
} as const

/** 测试场景的树数量 */
export const TREE_COUNT = 16

/** 出生点周围不长树的安全区半径 */
export const SPAWN_CLEAR_RADIUS = 180

export const SHADOW = {
  /** 阴影相对于实体宽度的比例 */
  widthRatio: 0.62,
  opacity: 0.26,
} as const

/** 玩家被树遮挡时，树降到这个透明度 */
export const OCCLUDED_ALPHA = 0.45
