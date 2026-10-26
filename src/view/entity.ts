/**
 * 视图层的 2.5D 规则集中在这里：
 * 底部锚点、按脚底 y 排深度、脚下椭圆阴影、遮挡时半透明
 */

import Phaser from 'phaser'
import { OCCLUDED_ALPHA, SHADOW } from '../config'

export interface UprightOptions {
  /** 阴影宽度占精灵显示宽度的比例，默认取配置值 */
  shadowWidthRatio?: number
  /** 阴影压扁比例，模拟倾斜相机看到的地面 */
  shadowSquash?: number
}

/**
 * 一个"立在地上"的精灵 + 它的地面阴影
 * 用脚底 y 作为 depth，保证前后遮挡关系正确
 */
export class Upright {
  readonly sprite: Phaser.GameObjects.Image
  readonly shadow: Phaser.GameObjects.Ellipse

  constructor(
    scene: Phaser.Scene,
    sprite: Phaser.GameObjects.Image,
    options: UprightOptions = {},
  ) {
    const ratio = options.shadowWidthRatio ?? SHADOW.widthRatio
    const squash = options.shadowSquash ?? 0.34
    const w = sprite.displayWidth * ratio

    this.sprite = sprite
    this.shadow = scene.add.ellipse(
      sprite.x,
      sprite.y,
      w,
      Math.max(4, w * squash),
      0x000000,
      SHADOW.opacity,
    )

    this.syncDepth()
  }

  /** 把世界坐标同步到精灵与阴影，并刷新深度 */
  setPosition(x: number, y: number): void {
    this.sprite.setPosition(x, y)
    this.shadow.setPosition(x, y)
    this.syncDepth()
  }

  setVisible(visible: boolean): void {
    this.sprite.setVisible(visible)
    this.shadow.setVisible(visible)
  }

  /** 阴影永远紧跟脚底，且固定比本体低一层，避免盖住自己 */
  private syncDepth(): void {
    const y = this.sprite.y
    this.sprite.setDepth(y)
    this.shadow.setDepth(y - 0.5)
  }
}

/**
 * 判断玩家是否被某棵树挡住
 * 树以底部为锚点，所以"在树后面"= 玩家 y 更小（屏幕更靠上）且横向有重叠
 */
export function isBehindTree(
  playerX: number,
  playerY: number,
  tree: Phaser.GameObjects.Image,
): boolean {
  const halfW = tree.displayWidth * 0.5
  const height = tree.displayHeight
  const withinX = Math.abs(playerX - tree.x) < halfW * 0.75
  const withinY = playerY < tree.y && playerY > tree.y - height
  return withinX && withinY
}

/** 被遮挡时降低不透明度，让玩家看得见自己 */
export function applyOcclusion(
  tree: Phaser.GameObjects.Image,
  isOccluding: boolean,
): void {
  tree.setAlpha(isOccluding ? OCCLUDED_ALPHA : 1)
}
