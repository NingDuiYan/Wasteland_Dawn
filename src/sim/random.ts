/**
 * 线性同余随机数（纯 TS，无外部依赖）
 *
 * 为什么不用 Math.random：小镇布局、道具落点、丧尸出生点都要求"同一种子出同一结果"，
 * 否则刷新一次镇子就换个样子，调光照时根本没法对比。
 */

export class Rng {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  /** 0..1 */
  next(): number {
    this.state = (this.state * 1664525 + 1013904223) >>> 0
    return this.state / 0x100000000
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** 闭区间 [min, max] 的整数 */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1))
  }

  chance(probability: number): boolean {
    return this.next() < probability
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length) % items.length]
  }
}
