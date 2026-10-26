/**
 * 变种配色贴图
 * Canvas 渲染器不支持 setTint，直接染色会在无 WebGL 的环境里失效，
 * 所以这里把颜色烘焙进贴图，保证两种渲染器下表现一致
 */

import Phaser from 'phaser'

function toHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

/**
 * 用 multiply 混合生成染色贴图
 * @param scene 目标场景
 * @param sourceKey 原贴图 key
 * @param targetKey 新贴图 key
 * @param color 染色值，浅色效果更好（深色会把原图压成黑块）
 */
export function createTintedVariant(
  scene: Phaser.Scene,
  sourceKey: string,
  targetKey: string,
  color: number,
): void {
  if (scene.textures.exists(targetKey)) return

  const source = scene.textures.get(sourceKey).getSourceImage() as HTMLImageElement
  const canvasTexture = scene.textures.createCanvas(
    targetKey,
    source.width,
    source.height,
  )
  if (!canvasTexture) return

  const ctx = canvasTexture.getContext()
  ctx.drawImage(source, 0, 0)
  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = toHex(color)
  ctx.fillRect(0, 0, source.width, source.height)
  // 用原图 alpha 裁掉染色溢出，透明边缘不会被填成色块
  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(source, 0, 0)

  canvasTexture.refresh()
}
