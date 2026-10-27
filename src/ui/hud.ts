/**
 * HUD
 *
 * 所有文字与数值都走 DOM 而不是 canvas 贴图：改数字不重建纹理，
 * 也不会因为渲染分辨率变化而糊。代价是每帧写 DOM 会掉帧，
 * 所以只在数值真的变了的时候写（set 里先比一次）。
 */

export interface HudElements {
  hpFill: HTMLElement
  hpText: HTMLElement
  ammoText: HTMLElement
  killsText: HTMLElement
  clockText: HTMLElement
  weatherText: HTMLElement
  fpsText: HTMLElement
  crosshair: HTMLElement
  hitMarker: HTMLElement
  status: HTMLElement
}

function pick(id: string): HTMLElement {
  const element = document.getElementById(id)
  if (!element) throw new Error('HUD 缺少元素 #' + id)
  return element
}

export class Hud {
  private readonly el: HudElements
  private lastHp = -1
  private lastAmmo = -1
  private lastKills = -1
  private lastClock = ''
  private lastWeather = ''
  private lastFps = -1
  private hitLeft = 0

  constructor() {
    this.el = {
      hpFill: pick('hud-hp-fill'),
      hpText: pick('hud-hp-text'),
      ammoText: pick('hud-ammo'),
      killsText: pick('hud-kills'),
      clockText: pick('hud-clock'),
      weatherText: pick('hud-weather'),
      fpsText: pick('hud-fps'),
      crosshair: pick('hud-crosshair'),
      hitMarker: pick('hud-hit-marker'),
      status: pick('hud-status'),
    }
  }

  setHp(hp: number): void {
    const value = Math.max(0, Math.round(hp))
    if (value === this.lastHp) return
    this.lastHp = value
    const ratio = Math.max(0, Math.min(1, value / 100))
    this.el.hpFill.style.width = (ratio * 100).toFixed(1) + '%'
    this.el.hpFill.style.background = ratio > 0.6 ? '#7ec86a' : ratio > 0.3 ? '#e2b441' : '#d1453b'
    this.el.hpText.textContent = String(value)
  }

  setAmmo(ammo: number, reloading: boolean): void {
    const key = ammo * 2 + (reloading ? 1 : 0)
    if (key === this.lastAmmo) return
    this.lastAmmo = key
    this.el.ammoText.textContent = reloading ? '换弹…' : String(ammo)
    this.el.ammoText.classList.toggle('is-reloading', reloading)
  }

  setKills(kills: number): void {
    if (kills === this.lastKills) return
    this.lastKills = kills
    this.el.killsText.textContent = String(kills)
  }

  setClock(hour: number): void {
    const hours = Math.floor(hour) % 24
    const minutes = Math.floor((hour - Math.floor(hour)) * 60)
    const text = String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0')
    if (text === this.lastClock) return
    this.lastClock = text
    this.el.clockText.textContent = text
  }

  setWeather(label: string): void {
    if (label === this.lastWeather) return
    this.lastWeather = label
    this.el.weatherText.textContent = label
  }

  setFps(fps: number): void {
    const value = Math.round(fps)
    if (value === this.lastFps) return
    this.lastFps = value
    this.el.fpsText.textContent = String(value)
  }

  /** 命中提示：准星旁边闪一个 X，持续 120ms */
  flashHit(): void {
    this.hitLeft = 0.12
    this.el.hitMarker.classList.add('is-on')
  }

  update(dtSec: number): void {
    if (this.hitLeft <= 0) return
    this.hitLeft -= dtSec
    if (this.hitLeft <= 0) this.el.hitMarker.classList.remove('is-on')
  }

  setCrosshairVisible(visible: boolean): void {
    this.el.crosshair.style.opacity = visible ? '1' : '0'
  }

  showStatus(text: string, visible: boolean): void {
    this.el.status.textContent = text
    this.el.status.style.opacity = visible ? '1' : '0'
  }
}
