import Phaser from 'phaser'
import { VIEW_HEIGHT, VIEW_WIDTH } from './config'
import { GameScene } from './scenes/GameScene'

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-root',
  width: VIEW_WIDTH,
  height: VIEW_HEIGHT,
  backgroundColor: '#2a241c',
  // 像素风：禁用纹理平滑，整数缩放不发虚
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [GameScene],
}

new Phaser.Game(config)
