/**
 * 天气选项卡（DOM）
 * 为什么用 DOM 而不是 canvas 内按钮：HUD 已经是 DOM 层，文字与命中区域都不用跟相机缩放较劲；
 * 但 #hud 整体是 pointer-events:none（给将来的射击让路），所以这块容器必须单独打开。
 */

import type { WeatherKind } from '../sim/weather'

interface TabItem {
  kind: WeatherKind
  label: string
}

/** 选项卡顺序与 P 键循环顺序一致，避免两套顺序让人困惑 */
export const WEATHER_TABS: readonly TabItem[] = [
  { kind: 'clear', label: '晴' },
  { kind: 'overcast', label: '阴' },
  { kind: 'rain', label: '雨' },
  { kind: 'storm', label: '暴雨' },
]

export class WeatherTabs {
  private readonly buttons = new Map<WeatherKind, HTMLButtonElement>()

  /**
   * @param onSelect 点击选项卡后的回调
   * @param initial 初始高亮的天气
   */
  constructor(onSelect: (kind: WeatherKind) => void, initial: WeatherKind) {
    const root = document.getElementById('weather-tabs')
    if (!root) throw new Error('HUD 缺少元素 #weather-tabs')

    // 事件委托：一个监听器管全部按钮，省掉逐个解绑
    root.addEventListener('click', (event) => {
      const target = event.target
      if (!(target instanceof HTMLButtonElement)) return
      const kind = target.dataset.weather as WeatherKind | undefined
      if (kind) onSelect(kind)
    })

    for (const { kind, label } of WEATHER_TABS) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = label
      button.dataset.weather = kind
      button.setAttribute('aria-pressed', 'false')
      root.appendChild(button)
      this.buttons.set(kind, button)
    }

    this.setActive(initial)
  }

  /** 同步高亮：P 键循环与鼠标点击都走这里，保证两种输入不会各说各话 */
  setActive(kind: WeatherKind): void {
    for (const [key, button] of this.buttons) {
      button.setAttribute('aria-pressed', key === kind ? 'true' : 'false')
    }
  }
}
