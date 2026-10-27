/**
 * 程序化音效
 *
 * 一个外部音频文件都没有 —— 全是 WebAudio 现场合成。
 * 枪声是"噪声爆 + 低频冲击"，命中是短促的噪声脉冲，换弹是两声金属咔哒。
 *
 * AudioContext 必须由用户手势唤醒（浏览器自动播放策略），
 * 所以入口是 resume()，在"点击开始"里调一次。
 */

export class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null

  /** 用户第一次点击时调用；重复调用无害 */
  resume(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.42
      this.master.connect(this.ctx.destination)
      this.noise = this.createNoise(0.5)
    }
    void this.ctx.resume()
  }

  private createNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx as AudioContext
    const length = Math.floor(ctx.sampleRate * seconds)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1
    return buffer
  }

  private burst(options: {
    duration: number
    gain: number
    fromHz: number
    toHz: number
    type?: BiquadFilterType
  }): void {
    const ctx = this.ctx
    const master = this.master
    const noise = this.noise
    if (!ctx || !master || !noise) return

    const now = ctx.currentTime
    const source = ctx.createBufferSource()
    source.buffer = noise

    const filter = ctx.createBiquadFilter()
    filter.type = options.type ?? "bandpass"
    filter.frequency.setValueAtTime(options.fromHz, now)
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, options.toHz), now + options.duration)
    filter.Q.value = 1.1

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(options.gain, now + 0.006)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + options.duration)

    source.connect(filter)
    filter.connect(gain)
    gain.connect(master)
    source.start(now)
    source.stop(now + options.duration + 0.02)
  }

  private tone(frequency: number, duration: number, gainValue: number, delay = 0): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    const now = ctx.currentTime + delay
    const oscillator = ctx.createOscillator()
    oscillator.type = "triangle"
    oscillator.frequency.setValueAtTime(frequency, now)
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, frequency * 0.55), now + duration)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.004)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    oscillator.connect(gain)
    gain.connect(master)
    oscillator.start(now)
    oscillator.stop(now + duration + 0.02)
  }

  shoot(): void {
    this.burst({ duration: 0.16, gain: 0.85, fromHz: 2600, toHz: 260 })
    this.tone(120, 0.13, 0.5)
  }

  hitFlesh(): void {
    this.burst({ duration: 0.09, gain: 0.4, fromHz: 900, toHz: 180, type: "lowpass" })
  }

  hitWorld(): void {
    this.burst({ duration: 0.07, gain: 0.22, fromHz: 3200, toHz: 1200, type: "highpass" })
  }

  reload(): void {
    this.tone(680, 0.05, 0.22)
    this.tone(430, 0.06, 0.2, 0.16)
  }

  hurt(): void {
    this.tone(160, 0.22, 0.35)
    this.burst({ duration: 0.2, gain: 0.3, fromHz: 600, toHz: 120, type: "lowpass" })
  }

  empty(): void {
    this.tone(900, 0.03, 0.12)
  }
}
