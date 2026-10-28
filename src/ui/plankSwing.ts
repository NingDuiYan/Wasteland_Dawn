/**
 * 主菜单三块木牌挂在铁链上：鼠标划过给一次冲量，之后靠弹簧阻尼摆回原位。
 * 这里只负责算角度、写 --swing 变量，真正的绘制仍由 menuBackdrop 的 rAF 循环驱动，
 * 不额外起定时器，也不用再开一层动画。
 */
interface Pendulum {
  el: HTMLElement
  angle: number
  vel: number
  /** 指针偏移到角度的换算系数：鼠标在边上时牌子的最大倾角 */
  gain: number
  stiffness: number
  damping: number
  /** 鼠标横移一像素换多少角速度 */
  kick: number
}

export interface PlankSwing {
  /** 鼠标横移时给一次冲量，dx 是本次移动的像素差 */
  kick: (dx: number) => void
  /** 每帧推进物理，aim 是 -1..1 的指针横向偏移，dt 单位秒 */
  update: (dt: number, aim: number) => void
}

/** 越靠下的牌子链子越长：摆幅更大，回得也更慢 */
const SETUP = [
  { gain: 2.4, stiffness: 26, damping: 3.4, kick: 0.06 },
  { gain: 3.6, stiffness: 18, damping: 2.8, kick: 0.1 },
  { gain: 5, stiffness: 13, damping: 2.2, kick: 0.14 },
]

const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value))

export function createPlankSwing(menu: HTMLElement): PlankSwing | null {
  const nodes = Array.from(menu.querySelectorAll<HTMLElement>('.plank'))
  if (nodes.length === 0) return null
  const pendulums: Pendulum[] = nodes.map((el, index) => ({
    el,
    angle: 0,
    vel: 0,
    ...SETUP[Math.min(index, SETUP.length - 1)],
  }))

  return {
    kick: (dx: number): void => {
      for (const p of pendulums) p.vel = clamp(p.vel - dx * p.kick, -30, 30)
    },
    update: (dt: number, aim: number): void => {
      for (const p of pendulums) {
        const goal = clamp(aim, -1, 1) * p.gain
        p.vel += (goal - p.angle) * p.stiffness * dt
        p.vel -= p.vel * p.damping * dt
        p.angle += p.vel * dt
        p.el.style.setProperty('--swing', `${p.angle.toFixed(2)}deg`)
      }
    },
  }
}
