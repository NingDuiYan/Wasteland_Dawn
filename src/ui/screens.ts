/**
 * 全屏界面流：加载 → 主菜单 → 选装备 → 选地图 → 进入游戏 →（死亡）结算 → 重来/主菜单
 *
 * 为什么菜单用 DOM 而不是画进 canvas：按钮要能被 Tab 到、要能带 aria-pressed，canvas 里做等于手写一套无障碍层。
 * 六层同一时刻只有一层带 .is-on，其余 display:none。
 */

import { GAME } from '../config'
import { DEFAULT_LOADOUT, LOADOUT_SLOTS, WEAPONS } from '../weapons'
import { DEFAULT_MAP, MAPS, unlockedMaps } from '../maps'
import { Rng } from '../sim/random'
import { mountLoadingScene } from './loadingBackdrop'
import type { Loadout, WeaponId, WeaponSlot, WeaponSpec } from '../weapons'
import type { MapDef, MapId } from '../maps'
import type { LoadingScene } from './loadingBackdrop'

export interface ScreensOptions {
  onResume: () => void
}

/** 六层界面的 id，与 index.html 一一对应 */
const SCREEN_IDS = [
  'screen-loading',
  'screen-menu',
  'screen-loadout',
  'screen-map',
  'screen-pause',
  'screen-result',
] as const

/** 缩略图的绘制空间：显示多大写在 CSS 里，这里只决定 canvas 的坐标系 */
const ICON_W = 120
const ICON_H = 72
const ART_W = 512
const ART_H = 192

/** 剪影的三种墨色，与 index.html 的界面 token 同口径 */
const TONE_COLORS = {
  light: 'rgba(232, 220, 200, 0.86)',
  dark: 'rgba(11, 13, 16, 0.92)',
  accent: '#ffd166',
} as const

type Tone = keyof typeof TONE_COLORS

type Shape =
  | { kind: 'rect', x: number, y: number, w: number, h: number, tone?: Tone }
  | { kind: 'circle', x: number, y: number, r: number, tone?: Tone }
  | { kind: 'poly', points: readonly number[], tone?: Tone }

/**
 * 八件武器的剪影图元，坐标都在 120×72 的空间里。
 * 做成数据表而不是每件武器一个绘制函数：加武器只加几行图元，不用碰绘制逻辑。
 */
const SILHOUETTES: Record<WeaponId, readonly Shape[]> = {
  // AK47：木托 → 圆顶机匣 → 木护木 → 细枪管 → 准星座，弯弹匣是剪影的第一识别点
  rifle: [
    { kind: 'poly', points: [6, 48, 7, 34, 24, 32, 24, 48] },
    { kind: 'rect', x: 24, y: 28, w: 34, h: 9 },
    { kind: 'rect', x: 26, y: 24, w: 30, h: 5 },
    { kind: 'rect', x: 52, y: 24, w: 6, h: 4 },
    { kind: 'rect', x: 58, y: 26, w: 18, h: 5 },
    { kind: 'rect', x: 58, y: 32, w: 20, h: 7 },
    { kind: 'rect', x: 78, y: 27, w: 6, h: 10 },
    { kind: 'rect', x: 84, y: 33, w: 22, h: 3 },
    { kind: 'rect', x: 104, y: 26, w: 3, h: 9 },
    { kind: 'rect', x: 108, y: 31, w: 6, h: 4 },
    { kind: 'poly', points: [36, 37, 44, 37, 47, 55, 40, 64, 35, 58] },
    { kind: 'rect', x: 27, y: 41, w: 9, h: 3, tone: 'dark' },
    { kind: 'poly', points: [25, 37, 31, 37, 28, 55, 21, 50] },
  ],
  shotgun: [
    { kind: 'poly', points: [6, 48, 12, 28, 26, 26, 26, 46] },
    { kind: 'rect', x: 26, y: 26, w: 32, h: 13 },
    { kind: 'rect', x: 58, y: 28, w: 56, h: 7 },
    { kind: 'rect', x: 58, y: 36, w: 44, h: 5 },
    { kind: 'rect', x: 70, y: 33, w: 16, h: 10, tone: 'dark' },
  ],
  pistol: [
    { kind: 'rect', x: 40, y: 26, w: 52, h: 11 },
    { kind: 'rect', x: 46, y: 37, w: 40, h: 6 },
    { kind: 'poly', points: [44, 43, 60, 43, 54, 64, 36, 58] },
  ],
  revolver: [
    { kind: 'rect', x: 56, y: 28, w: 44, h: 8 },
    { kind: 'rect', x: 42, y: 26, w: 20, h: 14 },
    { kind: 'circle', x: 54, y: 44, r: 11 },
    { kind: 'poly', points: [42, 44, 56, 46, 50, 66, 32, 58] },
  ],
  machete: [
    { kind: 'poly', points: [22, 52, 86, 14, 96, 24, 30, 60] },
    { kind: 'poly', points: [10, 56, 22, 50, 27, 58, 15, 66] },
  ],
  bat: [
    { kind: 'poly', points: [14, 54, 20, 66, 98, 34, 94, 20] },
    { kind: 'circle', x: 13, y: 56, r: 4 },
    { kind: 'rect', x: 26, y: 48, w: 6, h: 12, tone: 'dark' },
  ],
  grenade: [
    { kind: 'circle', x: 58, y: 42, r: 20 },
    { kind: 'rect', x: 50, y: 18, w: 16, h: 8 },
    { kind: 'poly', points: [66, 20, 80, 28, 76, 34, 62, 26] },
    { kind: 'circle', x: 46, y: 20, r: 4, tone: 'accent' },
    { kind: 'rect', x: 40, y: 40, w: 36, h: 3, tone: 'dark' },
  ],
  molotov: [
    { kind: 'poly', points: [44, 34, 68, 34, 76, 64, 38, 62] },
    { kind: 'rect', x: 55, y: 18, w: 10, h: 16 },
    { kind: 'poly', points: [54, 6, 66, 12, 58, 20, 50, 13], tone: 'accent' },
    { kind: 'rect', x: 46, y: 44, w: 26, h: 12, tone: 'dark' },
  ],
}

/** 一行关键数值：这里只需要"标签 + 值"，元组比对象字面量省一半行 */
type StatRow = readonly [label: string, value: string]

function pick(id: string): HTMLElement {
  const element = document.getElementById(id)
  if (!element) throw new Error('界面缺少元素 #' + id)
  return element
}

function pickButton(id: string): HTMLButtonElement {
  const element = pick(id)
  if (!(element instanceof HTMLButtonElement)) throw new Error('#' + id + ' 必须是 button')
  return element
}

function pickCanvas(id: string): HTMLCanvasElement {
  const element = pick(id)
  if (!(element instanceof HTMLCanvasElement)) throw new Error('#' + id + ' 必须是 canvas')
  return element
}

/** 建节点顺手带上类名与文案，省掉一大片三行式样板 */
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className !== undefined) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** 按设备像素比开画布：backing 放大、CSS 尺寸不动，高 DPI 下剪影才不会糊 */
function context2d(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D {
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(width * ratio)
  canvas.height = Math.round(height * ratio)
  canvas.setAttribute('aria-hidden', 'true')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持 canvas 2D')
  ctx.scale(ratio, ratio)
  return ctx
}

/** 秒数 → mm:ss，结算界面的存活时长 */
function formatDuration(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec))
  return String(Math.floor(safe / 60)).padStart(2, '0') + ':' + String(safe % 60).padStart(2, '0')
}

/** 每秒射速，枪与近战同一口径 */
function perSec(intervalSec: number): string {
  return (1 / intervalSec).toFixed(1) + '/秒'
}

/** 卡片的三个关键数值：按武器类型换口径，玩家扫一眼就能比 */
function statRows(spec: WeaponSpec): StatRow[] {
  if (spec.kind === 'gun') {
    const damage = spec.pellets > 1 ? spec.damage + '×' + spec.pellets : String(spec.damage)
    return [['伤害', damage], ['射速', perSec(spec.fireIntervalSec)], ['弹匣', String(spec.ammoPerMag)]]
  }
  if (spec.kind === 'melee') {
    return [['伤害', String(spec.damage)], ['距离', spec.range.toFixed(1) + ' 米'], ['挥速', perSec(spec.fireIntervalSec)]]
  }
  return [['伤害', String(spec.damage)], ['半径', spec.radius.toFixed(1) + ' 米'], ['携带', spec.count + ' 个']]
}

/** 把图元画成剪影：逐块填色，靠亮/暗/强调三层区分枪身与细节 */
function paintShapes(ctx: CanvasRenderingContext2D, shapes: readonly Shape[]): void {
  for (const shape of shapes) {
    ctx.fillStyle = TONE_COLORS[shape.tone ?? 'light']
    if (shape.kind === 'rect') {
      ctx.fillRect(shape.x, shape.y, shape.w, shape.h)
      continue
    }
    ctx.beginPath()
    if (shape.kind === 'circle') {
      ctx.arc(shape.x, shape.y, shape.r, 0, Math.PI * 2)
    } else {
      ctx.moveTo(shape.points[0], shape.points[1])
      for (let i = 2; i < shape.points.length; i += 2) ctx.lineTo(shape.points[i], shape.points[i + 1])
      ctx.closePath()
    }
    ctx.fill()
  }
}

/**
 * 一排楼块：宽度高度按种子抖动，远处矮、近处高。
 * 窗只给近景画 —— 远景再铺窗点就成棋盘了。
 */
function paintSkyline(
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  baseY: number,
  count: number,
  min: number,
  max: number,
  lit: boolean,
): void {
  const step = ART_W / count
  for (let i = 0; i < count; i += 1) {
    const width = step * rng.range(0.6, 0.98)
    const height = rng.range(min, max)
    const x = i * step + rng.range(-6, 6)
    ctx.fillRect(x, baseY - height, width, height)
    if (!lit) continue
    ctx.save()
    ctx.globalAlpha = 0.22
    ctx.fillStyle = TONE_COLORS.accent
    for (let wx = x + 5; wx < x + width - 8; wx += 13) {
      for (let wy = baseY - height + 7; wy < baseY - 12; wy += 16) ctx.fillRect(wx, wy, 4, 7)
    }
    ctx.restore()
  }
}

/** 街景剪影：卡片底色已经是 tint 渐变，这里只叠两层楼与一条地面 */
function drawMapArt(canvas: HTMLCanvasElement, map: MapDef): void {
  const ctx = context2d(canvas, ART_W, ART_H)
  // 未解锁地图的 seed 是 0，用 id 派生兜底种子，三张卡的剪影才不会长得一样
  const rng = new Rng(map.seed || map.id.length * 7919)
  ctx.fillStyle = 'rgba(9, 11, 15, 0.55)'
  paintSkyline(ctx, rng, ART_H - 52, 11, 26, 58, false)
  ctx.fillStyle = 'rgba(6, 7, 10, 0.92)'
  paintSkyline(ctx, rng, ART_H - 20, 7, 40, 96, true)
  ctx.fillStyle = 'rgba(4, 5, 7, 0.9)'
  ctx.fillRect(0, ART_H - 20, ART_W, 20)
}

/** 全屏界面控制器：所有"选择"都是 Promise，本类只负责显示、收集选择、在点中时 resolve */
export class Screens {
  private readonly options: ScreensOptions
  private readonly layers = new Map<string, HTMLElement>()
  private readonly abort = new AbortController()
  /** 卡片 → 该卡代表的选择，避免回头再去读 dataset 里的字符串 */
  private readonly cardChoice = new Map<HTMLButtonElement, { slot: WeaponSlot, weapon: WeaponId }>()
  private readonly mapChoice = new Map<HTMLButtonElement, MapId>()
  /** 加载页那一屏画在 canvas 上：进度就是灯的亮度，没有进度条 */
  private readonly loadingScene: LoadingScene
  private readonly slotsHost: HTMLElement
  private readonly mapHost: HTMLElement
  private readonly resultKills: HTMLElement
  private readonly resultSurvived: HTMLElement
  private loadout: Loadout = { ...DEFAULT_LOADOUT }
  private selectedMap: MapId = DEFAULT_MAP
  private pendingMenu: (() => void) | null = null
  private pendingLoadout: ((value: Loadout) => void) | null = null
  private pendingMap: ((value: MapId) => void) | null = null
  private pendingResult: ((value: 'retry' | 'menu') => void) | null = null

  constructor(options: ScreensOptions) {
    this.options = options
    for (const id of SCREEN_IDS) this.layers.set(id, pick(id))
    this.loadingScene = mountLoadingScene(pickCanvas('loading-scene'))
    this.slotsHost = pick('loadout-slots')
    this.mapHost = pick('map-grid')
    this.resultKills = pick('result-kills')
    this.resultSurvived = pick('result-survived')
    this.applyBranding()
    this.buildLoadout()
    this.buildMaps()
    this.wire()
  }

  showLoading(): void {
    // 每次重新上台都从最暗起：过程序里再进一次加载页，灯也要重新亮起来
    this.loadingScene.reset()
    this.setLoading(0)
    this.show('screen-loading')
  }

  /**
   * 加载页里没有一个字：进度就是那盏灯亮到哪儿，超出范围的光度会被夹到合法区间。
   * @param progress 0..1
   */
  setLoading(progress: number): void {
    this.loadingScene.setProgress(Math.max(0, Math.min(1, progress)))
  }

  /** 灯停在最亮 1 秒 → 接触不良闪一下 → 淡出，画面全黑后才摘掉这一层 */
  async hideLoading(): Promise<void> {
    await this.loadingScene.complete()
    this.layers.get('screen-loading')?.classList.remove('is-on')
  }

  /** 显示主菜单，玩家点「开始游戏」后 resolve */
  showMenu(): Promise<void> {
    document.body.classList.remove('is-playing')
    this.show('screen-menu')
    this.focusButton('menu-start')
    return new Promise<void>((resolve) => {
      this.pendingMenu = resolve
    })
  }

  /** 显示选装备界面，点「下一步」后 resolve 当前选择 */
  pickLoadout(initial?: Loadout): Promise<Loadout> {
    if (initial) this.loadout = { ...initial }
    this.refreshPressed(this.cardChoice, (choice) => this.loadout[choice.slot] === choice.weapon)
    this.show('screen-loadout')
    this.focusButton('loadout-next')
    return new Promise<Loadout>((resolve) => {
      this.pendingLoadout = resolve
    })
  }

  /** 显示选地图界面，点「开始探险」后 resolve 选中的地图 */
  pickMap(): Promise<MapId> {
    this.refreshPressed(this.mapChoice, (id) => id === this.selectedMap)
    this.show('screen-map')
    this.focusButton('map-start')
    return new Promise<MapId>((resolve) => {
      this.pendingMap = resolve
    })
  }

  /** 收起所有界面并进入局内状态；HUD 与天气选项卡靠 body.is-playing 显隐 */
  enterGame(): void {
    this.show('')
    document.body.classList.add('is-playing')
  }

  showPause(): void {
    this.show('screen-pause')
    this.focusButton('pause-resume')
  }

  hidePause(): void {
    this.layers.get('screen-pause')?.classList.remove('is-on')
  }

  /** 显示结算界面，玩家点「再来一次」或「返回主菜单」后 resolve */
  showResult(stats: { kills: number; survivedSec: number }): Promise<'retry' | 'menu'> {
    document.body.classList.remove('is-playing')
    this.resultKills.textContent = String(Math.max(0, Math.round(stats.kills)))
    this.resultSurvived.textContent = formatDuration(stats.survivedSec)
    this.show('screen-result')
    this.focusButton('result-retry')
    return new Promise<'retry' | 'menu'>((resolve) => {
      this.pendingResult = resolve
    })
  }

  /** 解绑所有监听并清掉动态生成的卡片；之后不应再使用本实例 */
  destroy(): void {
    this.abort.abort()
    this.loadingScene.destroy()
    this.cardChoice.clear()
    this.mapChoice.clear()
    this.slotsHost.textContent = ''
    this.mapHost.textContent = ''
    document.body.classList.remove('is-playing')
    this.show('')
  }

  /** 标题、副标题、版本号只从 config 的 GAME 取，界面里不写死文案 */
  private applyBranding(): void {
    const title = pick('menu-title')
    title.textContent = GAME.name
    // 石纹/裂纹层用 ::before + attr(data-text) 复刻同一段文字，标题改字必须同步
    title.dataset.text = GAME.name
    pick('menu-subtitle').textContent = GAME.subtitle
    pick('menu-version').textContent = 'v' + GAME.version
  }

  private wire(): void {
    const { signal } = this.abort
    const on = (id: string, action: () => void): void => pickButton(id).addEventListener('click', action, { signal })
    // Promise 多次 resolve 是空操作，所以这里不必清空字段，只保证"没人在等"时点击无副作用
    on('menu-start', () => this.pendingMenu?.())
    on('loadout-next', () => this.pendingLoadout?.({ ...this.loadout }))
    on('map-start', () => this.pendingMap?.(this.selectedMap))
    on('result-retry', () => this.pendingResult?.('retry'))
    on('result-menu', () => this.pendingResult?.('menu'))
    this.slotsHost.addEventListener('click', (event) => this.onLoadoutClick(event), { signal })
    this.mapHost.addEventListener('click', (event) => this.onMapClick(event), { signal })
    // 暂停层整块就是「点击继续」的命中区，按钮的点击冒泡到这里，只接一次
    this.layers.get('screen-pause')?.addEventListener('click', () => this.handleResume(), { signal })
  }

  private buildLoadout(): void {
    for (const meta of LOADOUT_SLOTS) {
      const head = element('div', 'slot-head')
      head.append(element('span', 'slot-name', meta.label), element('span', 'slot-hint', meta.hint))
      const cards = element('div', 'slot-cards')
      cards.setAttribute('role', 'group')
      cards.setAttribute('aria-label', meta.label)
      for (const id of meta.options) {
        const card = this.buildWeaponCard(id)
        cards.appendChild(card)
        this.cardChoice.set(card, { slot: meta.slot, weapon: id })
      }
      const row = element('div', 'slot-row')
      row.append(head, cards)
      this.slotsHost.appendChild(row)
    }
  }

  private buildWeaponCard(id: WeaponId): HTMLButtonElement {
    const spec = WEAPONS[id]
    const card = element('button', 'card')
    card.type = 'button'
    card.setAttribute('aria-pressed', 'false')

    // 一个图标一只 canvas：绘制数据与 DOM 一一对应，改一件武器不用动其它卡
    const icon = element('canvas', 'card-icon')
    paintShapes(context2d(icon, ICON_W, ICON_H), SILHOUETTES[id])

    const stats = element('div', 'card-stats')
    for (const [label, value] of statRows(spec)) {
      const item = element('span', undefined, label + ' ')
      item.appendChild(element('b', undefined, value))
      stats.appendChild(item)
    }
    const body = element('div', 'card-body')
    body.append(element('div', 'card-name', spec.name), element('div', 'card-desc', spec.desc), stats)

    card.append(icon, body)
    return card
  }

  private buildMaps(): void {
    const unlocked = new Set(unlockedMaps().map((map) => map.id))
    for (const map of MAPS) {
      const card = element('button', 'map-card')
      card.type = 'button'
      card.style.background = 'linear-gradient(160deg, ' + map.tintTop + ', ' + map.tintBottom + ')'
      card.setAttribute('aria-pressed', 'false')

      const art = element('canvas', 'map-art')
      drawMapArt(art, map)
      card.append(art, this.buildMapBody(map))

      if (unlocked.has(map.id)) {
        this.mapChoice.set(card, map.id)
      } else {
        // 锁定项做成 disabled button：鼠标与键盘都走不进去，读屏仍然念得到
        card.classList.add('is-locked')
        card.disabled = true
        card.setAttribute('aria-disabled', 'true')
        card.setAttribute('aria-label', map.name + '（即将开放）')
        card.appendChild(element('span', 'map-badge', '即将开放'))
      }
      this.mapHost.appendChild(card)
    }
  }

  private buildMapBody(map: MapDef): HTMLElement {
    const body = element('div', 'map-body')
    body.append(
      element('div', 'map-name', map.name),
      element('div', 'map-sub', map.subtitle),
      element('p', 'map-desc', map.desc),
    )
    return body
  }

  private onLoadoutClick(event: Event): void {
    const choice = this.cardOf(event, 'button.card', this.cardChoice)
    if (!choice || !this.assign(choice.slot, choice.weapon)) return
    this.refreshPressed(this.cardChoice, (item) => this.loadout[item.slot] === item.weapon)
  }

  /** 槽位与武器类型必须对得上：主/副武器只收枪，近战与投掷各收各的 */
  private assign(slot: WeaponSlot, weapon: WeaponId): boolean {
    const spec = WEAPONS[weapon]
    if ((slot === 'primary' || slot === 'secondary') && spec.kind === 'gun') this.loadout[slot] = spec.id
    else if (slot === 'melee' && spec.kind === 'melee') this.loadout.melee = spec.id
    else if (slot === 'throwable' && spec.kind === 'throwable') this.loadout.throwable = spec.id
    else return false
    return true
  }

  private onMapClick(event: Event): void {
    const id = this.cardOf(event, 'button.map-card', this.mapChoice)
    if (!id) return
    this.selectedMap = id
    this.refreshPressed(this.mapChoice, (item) => item === id)
  }

  /** 事件委托：从点击目标往上找卡片，再查它对应的强类型记录 */
  private cardOf<T>(event: Event, selector: string, cards: Map<HTMLButtonElement, T>): T | null {
    const target = event.target
    if (!(target instanceof Element)) return null
    const card = target.closest(selector)
    if (!(card instanceof HTMLButtonElement)) return null
    return cards.get(card) ?? null
  }

  /** 选中的卡片同时给高亮样式（CSS 读 [aria-pressed='true']）与读屏状态 */
  private refreshPressed<T>(cards: Map<HTMLButtonElement, T>, isActive: (value: T) => boolean): void {
    for (const [card, value] of cards) card.setAttribute('aria-pressed', isActive(value) ? 'true' : 'false')
  }

  private handleResume(): void {
    this.hidePause()
    this.options.onResume()
  }

  private show(onlyId: string): void {
    for (const [id, layer] of this.layers) layer.classList.toggle('is-on', id === onlyId)
  }

  /** 进场就把焦点放到主操作上，键盘用户不用先 Tab 一圈才够得着按钮 */
  private focusButton(id: string): void {
    pickButton(id).focus({ preventScroll: true })
  }
}
