/**
 * DOM 覆盖层 HUD：文字密度和刷新频率都比塞进 canvas 更好控制
 * 容器整体 pointer-events: none，不拦截画布输入
 */

export interface HudState {
  fps: number
  zombies: number
  playerX: number
  playerY: number
  occluded: boolean
  shadowsOn: boolean
  gridOn: boolean
}

function pick<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`HUD 缺少元素 #${id}`)
  return el as T
}

export class Hud {
  private readonly fps = pick('hud-fps')
  private readonly zombies = pick('hud-zombies')
  private readonly coords = pick('hud-coords')
  private readonly occluded = pick('hud-occluded')
  private readonly shadows = pick('hud-shadows')
  private readonly grid = pick('hud-grid')

  update(state: HudState): void {
    this.fps.textContent = String(Math.round(state.fps))
    this.zombies.textContent = String(state.zombies)
    this.coords.textContent = `${Math.round(state.playerX)}, ${Math.round(state.playerY)}`
    this.occluded.textContent = state.occluded ? '是' : '否'
    this.occluded.classList.toggle('warn', state.occluded)
    this.shadows.textContent = state.shadowsOn ? '开' : '关'
    this.grid.textContent = state.gridOn ? '开' : '关'
  }
}
