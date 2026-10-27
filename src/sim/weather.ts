/**
 * 天气状态机（纯 TS，无 Phaser 依赖，可单测）
 *
 * 设计意图：天气只对外暴露一组"观感数值"（雨量、雾、暗度、色温…），
 * 渲染层照着这些数字调 shader 与图层，双方不互相知道对方怎么实现。
 * 所有变化都走线性过渡，跳变会让人怀疑掉帧。
 */

import { WEATHER, WeatherKindKey } from '../config'

export type WeatherKind = WeatherKindKey

interface WeatherPreset {
  rain: number
  fog: number
  wind: number
  darkness: number
  saturation: number
  vignette: number
  grain: number
  wet: number
  tint: { r: number; g: number; b: number }
}

/** 对外可读的天气观感；渲染层只读这个 */
export interface WeatherState {
  kind: WeatherKind
  rainIntensity: number
  fogAlpha: number
  windStrength: number
  darkness: number
  saturation: number
  vignette: number
  grain: number
  wet: number
  tint: { r: number; g: number; b: number }
  /** 0..1，闪电当前强度 */
  lightning: number
}

const PRESETS = WEATHER.presets as unknown as Record<WeatherKind, WeatherPreset>

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export class Weather {
  readonly state: WeatherState

  private target: WeatherPreset
  /** 距离下一次闪电还有多久；只在暴雨里倒数 */
  private nextFlashSec = 0
  /** 过渡还剩多少秒；为 0 表示已稳定在目标值上 */
  private transitionLeftSec = 0
  private flashLeftSec = 0
  private seed: number

  constructor(kind: WeatherKind = 'overcast', seed = 20261027) {
    const preset = PRESETS[kind]
    this.seed = seed >>> 0
    this.target = preset
    this.state = {
      kind,
      rainIntensity: preset.rain,
      fogAlpha: preset.fog,
      windStrength: preset.wind,
      darkness: preset.darkness,
      saturation: preset.saturation,
      vignette: preset.vignette,
      grain: preset.grain,
      wet: preset.wet,
      tint: { ...preset.tint },
      lightning: 0,
    }
    this.nextFlashSec = this.randomFlashGap()
  }

  /** 切换天气只改目标值，实际观感由 update 慢慢追上去 */
  setKind(kind: WeatherKind): void {
    this.state.kind = kind
    this.target = PRESETS[kind]
    this.transitionLeftSec = WEATHER.transitionSec
    if (kind === 'storm') {
      this.nextFlashSec = this.randomFlashGap()
    } else {
      this.flashLeftSec = 0
      this.state.lightning = 0
    }
  }

  /** 按真实时间推进；dtSec 必须是不被钳制的时钟，否则切后台回来天气会跳 */
  update(dtSec: number): void {
    const s = this.state
    const target = this.target
    /*
     * 步长按"剩余过渡时间"分配，而不是固定 dt/transitionSec。
     * 固定比例是指数逼近：每帧只走完剩余差距的一部分，永远到不了终点
     * （实测切到暴雨 9.5 秒后 wet 还停在 0.59，而不是 0.85）。
     * 按剩余时间分配则是线性插值，transitionSec 之后精确落在目标值上。
     */
    const t =
      this.transitionLeftSec > 0 ? Math.min(1, dtSec / this.transitionLeftSec) : 0
    this.transitionLeftSec = Math.max(0, this.transitionLeftSec - dtSec)

    s.rainIntensity = lerp(s.rainIntensity, target.rain, t)
    s.fogAlpha = lerp(s.fogAlpha, target.fog, t)
    s.windStrength = lerp(s.windStrength, target.wind, t)
    s.darkness = lerp(s.darkness, target.darkness, t)
    s.saturation = lerp(s.saturation, target.saturation, t)
    s.vignette = lerp(s.vignette, target.vignette, t)
    s.grain = lerp(s.grain, target.grain, t)
    s.wet = lerp(s.wet, target.wet, t)
    s.tint = {
      r: lerp(s.tint.r, target.tint.r, t),
      g: lerp(s.tint.g, target.tint.g, t),
      b: lerp(s.tint.b, target.tint.b, t),
    }

    this.updateLightning(dtSec)
  }

  private updateLightning(dtSec: number): void {
    const s = this.state

    if (s.kind === 'storm') {
      this.nextFlashSec -= dtSec
      if (this.nextFlashSec <= 0 && this.flashLeftSec <= 0) {
        this.flashLeftSec = WEATHER.lightning.durationSec
        this.nextFlashSec = this.randomFlashGap()
      }
    }

    if (this.flashLeftSec > 0) {
      this.flashLeftSec -= dtSec
      const total = WEATHER.lightning.durationSec
      const progress = 1 - Math.max(0, this.flashLeftSec) / total
      // 3 段子闪光：真实闪电是"闪两下停一下"，单一衰减看着假
      const pulse = Math.sin(progress * Math.PI * 3)
      s.lightning = Math.max(0, pulse * pulse * (1 - progress))
    } else {
      s.lightning = 0
    }
  }

  private randomFlashGap(): number {
    const { minGapSec, maxGapSec } = WEATHER.lightning
    return minGapSec + this.random() * (maxGapSec - minGapSec)
  }

  /** 自带 LCG，天气的随机不依赖 Math.random，方便复现与单测 */
  private random(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0
    return this.seed / 0x100000000
  }
}
