/**
 * 2.5D 遮挡验证场景
 * 只做一件事：把"底部锚点 + y 深度 + 脚下阴影 + 遮挡半透明"跑通，用来验证视角手感
 * 场景保持薄：状态来自 sim/World，这里只做同步渲染
 */

import Phaser from 'phaser'
import { BUILD_GRID, WORLD_SIZE } from '../config'
import { ASSETS } from '../manifest'
import { ActorState, TreeState, World, ZombieVariant } from '../sim/world'
import { Hud } from '../ui/hud'
import { Upright, applyOcclusion, isBehindTree } from '../view/entity'
import { createTintedVariant } from '../view/textures'

/** 变种外观：靠预烘焙的染色贴图 + 缩放区分，不用 setTint（Canvas 渲染器不支持） */
const ZOMBIE_SKIN: Record<ZombieVariant, { texture: string; scale: number }> = {
  basic: { texture: 'zombie-basic', scale: 1 },
  runner: { texture: 'zombie-runner', scale: 1.08 },
  brute: { texture: 'zombie-brute', scale: 1.32 },
}

interface KeyMap {
  W: Phaser.Input.Keyboard.Key
  A: Phaser.Input.Keyboard.Key
  S: Phaser.Input.Keyboard.Key
  D: Phaser.Input.Keyboard.Key
  F: Phaser.Input.Keyboard.Key
  G: Phaser.Input.Keyboard.Key
}

export class GameScene extends Phaser.Scene {
  private world!: World
  private playerView!: Upright
  private treeViews: Array<{ state: TreeState; view: Upright }> = []
  private zombieViews: Array<{ state: ActorState; view: Upright }> = []
  private keys!: KeyMap
  private hud!: Hud
  private selfMarker!: Phaser.GameObjects.Triangle
  private gridLayer!: Phaser.GameObjects.Graphics
  private hudTimer = 0
  private isShadowsOn = true
  private isGridOn = false

  constructor() {
    super('game')
  }

  preload(): void {
    for (const [key, url] of Object.entries(ASSETS)) {
      this.load.image(key, url)
    }
  }

  create(): void {
    this.world = new World()
    this.createGround()
    this.createGridLayer()
    this.createTrees()
    this.createPlayer()
    this.createZombieTextures()
    this.createZombies()
    this.setupCamera()
    this.setupInput()

    this.hud = new Hud()
  }

  update(time: number, delta: number): void {
    const dtSec = Math.min(delta, 50) / 1000
    const input = this.readMoveInput()

    this.world.update(dtSec, input)
    this.syncPlayer(time, input.x !== 0 || input.y !== 0)
    this.syncZombies(time)
    const isOccluded = this.syncTrees()
    this.syncMarker()

    this.hudTimer += delta
    if (this.hudTimer > 120) {
      this.hudTimer = 0
      this.hud.update({
        fps: this.game.loop.actualFps,
        zombies: this.world.zombies.length,
        playerX: this.world.player.x,
        playerY: this.world.player.y,
        occluded: isOccluded,
        shadowsOn: this.isShadowsOn,
        gridOn: this.isGridOn,
      })
    }
  }

  /** 地面用程序化生成的无缝小图平铺，避免依赖图集切分 */
  private createGround(): void {
    const tile = BUILD_GRID * 2
    const g = this.make.graphics({ x: 0, y: 0 }, false)

    for (let y = 0; y < tile; y += BUILD_GRID) {
      for (let x = 0; x < tile; x += BUILD_GRID) {
        const isEven = (x / BUILD_GRID + y / BUILD_GRID) % 2 === 0
        g.fillStyle(isEven ? 0x5d4c39 : 0x574734, 1)
        g.fillRect(x, y, BUILD_GRID, BUILD_GRID)
      }
    }

    // 固定种子的碎屑，保证每次刷新纹理一致
    let seed = 1337
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x100000000
    }
    for (let i = 0; i < 26; i += 1) {
      const x = Math.floor(rnd() * tile)
      const y = Math.floor(rnd() * tile)
      g.fillStyle(0x6b5943, 0.55)
      g.fillRect(x, y, 2, 2)
    }

    g.generateTexture('ground-tile', tile, tile)
    g.destroy()

    this.add
      .tileSprite(0, 0, WORLD_SIZE, WORLD_SIZE, 'ground-tile')
      .setOrigin(0, 0)
      .setDepth(-10000)
  }

  /** 32px 建造网格，按 G 开关，用来检查树和角色的落点是否贴合地面 */
  private createGridLayer(): void {
    const g = this.add.graphics().setDepth(-9000)
    // 相对地面棋盘格错开半格，否则两者边界重合，网格等于看不见
    const offset = BUILD_GRID / 2
    g.lineStyle(1, 0xffffff, 0.16)
    for (let x = offset; x <= WORLD_SIZE; x += BUILD_GRID) {
      g.lineBetween(x, 0, x, WORLD_SIZE)
    }
    for (let y = offset; y <= WORLD_SIZE; y += BUILD_GRID) {
      g.lineBetween(0, y, WORLD_SIZE, y)
    }
    g.setVisible(false)
    this.gridLayer = g
  }

  private createTrees(): void {
    for (const state of this.world.trees) {
      const sprite = this.add
        .image(state.x, state.y, state.assetKey)
        .setOrigin(0.5, 1)
        .setScale(state.scale)

      this.treeViews.push({ state, view: new Upright(this, sprite) })
    }
  }

  private createPlayer(): void {
    const sprite = this.add.image(
      this.world.player.x,
      this.world.player.y,
      'player-idle',
    )
    sprite.setOrigin(0.5, 1)
    this.playerView = new Upright(this, sprite)

    // 永远置顶的小箭头：即使被树挡住也能立刻找到自己
    this.selfMarker = this.add
      .triangle(0, 0, 0, 10, 14, 10, 7, 0, 0xffd166)
      .setDepth(9000)
  }

  private createZombieTextures(): void {
    createTintedVariant(this, 'zombie-basic', 'zombie-runner', 0x7cf07c)
    createTintedVariant(this, 'zombie-basic', 'zombie-brute', 0xc0504a)
  }

  private createZombies(): void {
    for (const state of this.world.zombies) {
      const skin = ZOMBIE_SKIN[state.variant]
      const sprite = this.add
        .image(state.x, state.y, skin.texture)
        .setOrigin(0.5, 1)
        .setScale(skin.scale)

      this.zombieViews.push({ state, view: new Upright(this, sprite) })
    }
  }

  private setupCamera(): void {
    const cam = this.cameras.main
    cam.setBounds(0, 0, WORLD_SIZE, WORLD_SIZE)
    cam.startFollow(this.playerView.sprite, true, 0.12, 0.12)
    cam.setDeadzone(140, 100)
  }

  private setupInput(): void {
    const kb = this.input.keyboard
    if (!kb) throw new Error('键盘输入不可用')

    this.keys = kb.addKeys('W,A,S,D,F,G') as KeyMap
    this.keys.F.on('down', () => {
      this.isShadowsOn = !this.isShadowsOn
      this.setShadowVisible(this.isShadowsOn)
    })
    this.keys.G.on('down', () => {
      this.isGridOn = !this.isGridOn
      this.gridLayer.setVisible(this.isGridOn)
    })
  }

  private setShadowVisible(visible: boolean): void {
    this.playerView.shadow.setVisible(visible)
    for (const t of this.treeViews) t.view.shadow.setVisible(visible)
    for (const z of this.zombieViews) z.view.shadow.setVisible(visible)
  }

  private readMoveInput(): { x: number; y: number } {
    const x = (this.keys.D.isDown ? 1 : 0) - (this.keys.A.isDown ? 1 : 0)
    const y = (this.keys.S.isDown ? 1 : 0) - (this.keys.W.isDown ? 1 : 0)
    return { x, y }
  }

  private syncPlayer(time: number, isMoving: boolean): void {
    const state = this.world.player
    this.playerView.setPosition(state.x, state.y)
    this.playerView.sprite.setFlipX(state.facing < 0)

    // 无行走帧，用轻微呼吸缩放代替，避免看起来像静态贴图
    const breath = isMoving ? 1 + Math.sin(time * 0.014) * 0.035 : 1
    this.playerView.sprite.setScale(1, breath)
  }

  private syncZombies(time: number): void {
    for (let i = 0; i < this.zombieViews.length; i += 1) {
      const { state, view } = this.zombieViews[i]
      view.setPosition(state.x, state.y)
      view.sprite.setFlipX(state.facing < 0)

      const base = ZOMBIE_SKIN[state.variant].scale
      const breath = 1 + Math.sin(time * 0.009 + i) * 0.03
      view.sprite.setScale(base, base * breath)
    }
  }

  /** 返回玩家此刻是否被任意一棵树遮住 */
  private syncTrees(): boolean {
    const p = this.world.player
    let occluded = false

    for (const { state, view } of this.treeViews) {
      const isOccluding = isBehindTree(p.x, p.y, view.sprite)
      if (isOccluding) occluded = true
      applyOcclusion(view.sprite, isOccluding)
      view.setPosition(state.x, state.y)
    }

    return occluded
  }

  private syncMarker(): void {
    const p = this.world.player
    this.selfMarker.setPosition(p.x - 7, p.y - this.playerView.sprite.displayHeight - 26)
  }
}
