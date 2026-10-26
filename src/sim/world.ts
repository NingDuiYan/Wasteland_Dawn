/**
 * 纯模拟层：不含任何 Phaser 依赖，可独立单测
 * 只负责"世界状态怎么变"，不负责"怎么画"
 */

import {
  PLAYER,
  SPAWN_CLEAR_RADIUS,
  TREE_COUNT,
  WORLD_SIZE,
  ZOMBIE,
} from '../config'

export type TreeAssetKey = 'tree-dead' | 'tree-oak' | 'tree-pine'
export type ZombieVariant = 'basic' | 'runner' | 'brute'

export interface ActorState {
  id: number
  x: number
  y: number
  /** 1 朝右 / -1 朝左，画面上只做 flipX，不旋转 */
  facing: 1 | -1
  speed: number
  variant: ZombieVariant
}

export interface TreeState {
  id: number
  x: number
  y: number
  assetKey: TreeAssetKey
  scale: number
}

export interface MoveInput {
  x: number
  y: number
}

const TREE_KEYS: TreeAssetKey[] = ['tree-dead', 'tree-oak', 'tree-pine']

/** 各变种的移动速度，和视图层的 tint/缩放解耦 */
const VARIANT_SPEED: Record<ZombieVariant, number> = {
  basic: ZOMBIE.speed,
  runner: ZOMBIE.speed * 1.85,
  brute: ZOMBIE.speed * 0.72,
}

/** 线性同余随机，保证每次刷新场景一致，便于反复对比手感 */
function createRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export class World {
  readonly width = WORLD_SIZE
  readonly height = WORLD_SIZE
  readonly player: ActorState
  readonly zombies: ActorState[] = []
  readonly trees: TreeState[] = []

  private readonly rng = createRng(20261026)

  constructor() {
    const cx = this.width / 2
    const cy = this.height / 2

    this.player = {
      id: 0,
      x: cx,
      y: cy,
      facing: 1,
      speed: PLAYER.speed,
      variant: 'basic',
    }

    this.spawnTrees(cx, cy)
    this.spawnZombies(cx, cy)
  }

  private spawnTrees(cx: number, cy: number): void {
    // 出生点正上方固定一棵高树：保证"向上走两秒"必然进入遮挡区，便于反复验证手感
    this.trees.push({
      id: 0,
      x: cx,
      y: cy - 210,
      assetKey: 'tree-oak',
      scale: 1.15,
    })

    let attempts = 0
    while (this.trees.length < TREE_COUNT && attempts < 400) {
      attempts += 1
      const x = 120 + this.rng() * (this.width - 240)
      const y = 140 + this.rng() * (this.height - 260)
      const dx = x - cx
      const dy = y - cy
      // 出生点附近留空，避免一开局就站在树后被挡住
      if (Math.hypot(dx, dy) < SPAWN_CLEAR_RADIUS) continue
      // 树之间保持间距，避免叠成一坨没法判断遮挡
      if (this.trees.some((t) => Math.hypot(t.x - x, t.y - y) < 150)) continue

      this.trees.push({
        id: this.trees.length,
        x,
        y,
        assetKey: TREE_KEYS[Math.floor(this.rng() * TREE_KEYS.length)],
        scale: 0.85 + this.rng() * 0.35,
      })
    }
  }

  private spawnZombies(cx: number, cy: number): void {
    const variants: ZombieVariant[] = ['basic', 'basic', 'runner', 'brute']
    for (let i = 0; i < ZOMBIE.count; i += 1) {
      const angle = (Math.PI * 2 * i) / ZOMBIE.count + this.rng() * 0.4
      const dist = 300 + this.rng() * 260
      const variant = variants[i % variants.length]
      this.zombies.push({
        id: i + 1,
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        facing: 1,
        speed: VARIANT_SPEED[variant],
        variant,
      })
    }
  }

  /** dtSec 用秒，避免把帧率耦合进移动速度 */
  update(dtSec: number, input: MoveInput): void {
    this.updatePlayer(dtSec, input)
    this.updateZombies(dtSec)
  }

  private updatePlayer(dtSec: number, input: MoveInput): void {
    const len = Math.hypot(input.x, input.y)

    if (len > 0) {
      const nx = input.x / len
      const ny = input.y / len
      this.player.x = clamp(
        this.player.x + nx * this.player.speed * dtSec,
        24,
        this.width - 24,
      )
      this.player.y = clamp(
        this.player.y + ny * this.player.speed * dtSec,
        24,
        this.height - 24,
      )
      if (nx !== 0) this.player.facing = nx > 0 ? 1 : -1
    }
  }

  private updateZombies(dtSec: number): void {
    for (const z of this.zombies) {
      const dx = this.player.x - z.x
      const dy = this.player.y - z.y
      const len = Math.hypot(dx, dy) || 1

      // 贴到玩家身上就停：否则 10 只尸会把玩家完全盖住，看不出遮挡关系
      const approach = len > ZOMBIE.minDistanceToPlayer ? 1 : 0
      let vx = (dx / len) * z.speed * approach
      let vy = (dy / len) * z.speed * approach

      // 互相推开，否则 10 只尸会叠成一个点，看不清遮挡关系
      for (const other of this.zombies) {
        if (other.id === z.id) continue
        const ox = z.x - other.x
        const oy = z.y - other.y
        const od = Math.hypot(ox, oy)
        if (od > 0 && od < ZOMBIE.separation) {
          const push = (ZOMBIE.separation - od) / ZOMBIE.separation
          vx += (ox / od) * z.speed * push * 1.6
          vy += (oy / od) * z.speed * push * 1.6
        }
      }

      z.x = clamp(z.x + vx * dtSec, 24, this.width - 24)
      z.y = clamp(z.y + vy * dtSec, 24, this.height - 24)
      if (Math.abs(vx) > 0.5) z.facing = vx > 0 ? 1 : -1
    }
  }
}
