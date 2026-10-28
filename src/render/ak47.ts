/**
 * 突击步枪的视图模型：一把废土上捡来的 AK47
 *
 * 尺寸口径（米，枪口朝 -z，膛线轴 y = +0.040）：托尾 +0.355 → 枪口 -0.555，总长 0.910，
 * 三段是 托 0.253 / 机匣 0.262 / 前段 0.395，木托与机匣 0.97:1 —— 与实枪比例吻合。
 *
 * 玩家看到的是枪的左侧与顶面（相机在枪的左后方），右面的快慢机与拉机柄永远在背面，
 * 但形状照样要建全：造型缺件，从别的角度看就是一支假枪。
 * 认 AK 靠的是弹匣弧度、木/皮/钢三段配色、圆顶防尘盖、导气箍台阶与通条这五样。
 *
 * 旧化全部用几何做：布条、胶带、铁丝都是"比被缠截面稍大的薄片"。这个距离上一毫米才
 * 一像素，贴图抠不出细节，能读出来的只有色块节奏和形体。
 */

import * as THREE from 'three'
import { PALETTE } from '../config'
import { COLOR, addHand, mix } from './weaponParts'
import type { Built, Parts, Tint } from './weaponParts'

/** 废土改装件：布条、皮革、胶带全部从调色板派生，不另写十六进制 */
const AK = {
  /** 撕成条的旧棉布：暗黄里发灰 */
  cloth: mix(PALETTE.line, PALETTE.sidewalk, 0.5),
  clothDark: mix(PALETTE.sidewalk, PALETTE.crack, 0.45),
  /** 包护木的旧皮革：比木托更暗更闷 */
  leather: mix(PALETTE.wood, PALETTE.crack, 0.62),
  /** 加固弹匣的黄胶带，粘性已经掉了 */
  tape: mix(PALETTE.poster[1], PALETTE.sidewalk, 0.55),
  /** 绑护木的铁丝：锈得发暗，只剩一点金属反光 */
  wire: mix(PALETTE.rust, PALETTE.metal, 0.45),
  /** 原厂胶木握把磨出的包浆 */
  grip: mix(PALETTE.gunWood, PALETTE.crack, 0.35),
} as const

/** 枪托布条：[z, y, 宽, 高, 歪斜]。间距不等 —— 撕一条缠一条，才是废土的样子 */
const STOCK_WRAPS: readonly (readonly [number, number, number, number, number])[] = [
  [0.340, 0.004, 0.046, 0.080, -0.16],
  [0.316, 0.004, 0.046, 0.079, 0.13],
  [0.292, 0.005, 0.046, 0.078, -0.11],
  [0.266, 0.008, 0.046, 0.074, 0.15],
  [0.240, 0.012, 0.047, 0.070, -0.09],
  [0.196, 0.020, 0.048, 0.066, 0.12],
]

/** 弹匣三段折线：[y, z, 宽, 前后厚, 折角]。包角 32°，底缘前移 0.067 */
const MAG_SEGS: readonly (readonly [number, number, number, number, number])[] = [
  [-0.0279, -0.0693, 0.033, 0.062, 0.06],
  [-0.1022, -0.0828, 0.033, 0.060, 0.30],
  [-0.1709, -0.1139, 0.033, 0.056, 0.55],
]

/** 两道绑皮革的铁丝，以及准星护耳的一对耳片 */
const WIRE_Z = [-0.310, -0.238] as const
const EAR_X = [-0.0095, 0.0095] as const

/** 缠绕带：一块比被缠截面稍大的薄片，歪一点才读得出是"随手缠上去的" */
function wrap(parts: Parts, w: number, h: number, d: number, color: Tint,
  x: number, y: number, z: number, tilt: number): void {
  parts.box(w, h, d, color, x, y, z, 0.96, 0.02).rotation.x = tilt
}

/** 枪托：实心木托 + 钢托底板 + 六圈布条。z > +0.27 的后段落在画面下沿外，不做细节 */
function buildStock(parts: Parts): void {
  parts.box(0.036, 0.078, 0.012, COLOR.steelDark, 0, 0.002, 0.349, 0.6, 0.35)
  parts.box(0.040, 0.066, 0.114, COLOR.wood, 0, 0.004, 0.286, 0.85, 0.04)
  parts.box(0.042, 0.058, 0.130, COLOR.woodDark, 0, 0.020, 0.165, 0.85, 0.04)
  STOCK_WRAPS.forEach(([z, y, w, h, tilt], i) => {
    wrap(parts, w, h, 0.02, i % 2 === 0 ? AK.cloth : AK.clothDark, 0, y, z, tilt)
  })
}

/** 机匣：冲压钢板 + 圆顶防尘盖 + 照门座。圆顶是 AK 与平顶 AR 的分水岭，必须用 tube */
function buildReceiver(parts: Parts): void {
  parts.box(0.036, 0.042, 0.262, COLOR.steelDark, 0, 0.031, -0.029, 0.55, 0.3)
  parts.tube(0.196, 0.017, 0.017, COLOR.steel, 0, 0.053, 0.001, 14, 0.5, 0.3)
  parts.tube(0.014, 0.007, 0.007, COLOR.steel, 0, 0.058, 0.104, 8, 0.5, 0.3)
  parts.box(0.030, 0.020, 0.061, COLOR.steelDark, 0, 0.062, -0.1295, 0.55, 0.3)
  parts.box(0.013, 0.005, 0.058, COLOR.steel, 0, 0.0745, -0.128, 0.5, 0.35).rotation.x = 0.05
  parts.box(0.016, 0.007, 0.014, COLOR.steel, 0, 0.0775, -0.114, 0.5, 0.35)
  // 右面的快慢机拨片与拉机柄：构图上看不见，但这是 AK 的两块招牌铁片，不能省
  parts.box(0.004, 0.011, 0.115, COLOR.steelDark, 0.020, 0.036, -0.045, 0.5, 0.4)
  parts.box(0.010, 0.012, 0.020, COLOR.steel, 0.023, 0.048, 0.045, 0.5, 0.4)
}

/** 前段：木护木外包皮革 + 两道铁丝 + 导气箍 + 枪管 + 通条 + 准星座 + 斜切枪口 */
function buildFront(parts: Parts): void {
  parts.box(0.032, 0.024, 0.180, COLOR.wood, 0, 0.056, -0.256, 0.85, 0.04)
  parts.box(0.042, 0.044, 0.196, COLOR.wood, 0, 0.020, -0.262, 0.85, 0.04)
  parts.tube(0.230, 0.009, 0.009, COLOR.steelDark, 0, 0.058, -0.255, 8, 0.55, 0.3)
  // 皮革比木护木短 3 厘米：两端露出木头，木-皮-钢的色块节奏才立得住
  parts.box(0.036, 0.028, 0.150, AK.leather, 0, 0.056, -0.256, 0.9, 0.05)
  parts.box(0.046, 0.048, 0.164, AK.leather, 0, 0.020, -0.262, 0.9, 0.05)
  for (const z of WIRE_Z) wrap(parts, 0.050, 0.078, 0.005, AK.wire, 0, 0.033, z, 0.08)
  parts.box(0.028, 0.056, 0.052, COLOR.steelDark, 0, 0.038, -0.391, 0.6, 0.3)
  parts.tube(0.395, 0.0135, 0.009, COLOR.steelDark, 0, 0.040, -0.3575, 12, 0.55, 0.32)
  parts.tube(0.300, 0.0035, 0.0035, COLOR.steel, 0, 0.028, -0.370, 6, 0.6, 0.3)
  parts.box(0.026, 0.040, 0.058, COLOR.steelDark, 0, 0.026, -0.503, 0.55, 0.3)
  for (const x of EAR_X) parts.box(0.007, 0.026, 0.026, COLOR.steelDark, x, 0.057, -0.500, 0.55, 0.3)
  parts.box(0.0035, 0.020, 0.0035, COLOR.steel, 0, 0.074, -0.497, 0.5, 0.35)
  parts.tube(0.030, 0.0105, 0.0125, COLOR.steel, 0, 0.040, -0.540, 10, 0.5, 0.35).rotation.x = -0.26
}

/** 香蕉弹匣：三段折线拼弧度（每段轴向重叠 1 厘米，否则 14° 折角会在接缝张开一条亮缝） */
function buildMagazine(parts: Parts): void {
  for (const [y, z, w, d, tilt] of MAG_SEGS) {
    parts.box(w, 0.086, d, COLOR.steelDark, 0, y, z, 0.6, 0.35).rotation.x = tilt
  }
  // 胶带只缠下半截：比弹匣截面大 4 毫米，两圈就把"加固防开裂"读出来了
  for (const [y, z, w, d, tilt] of MAG_SEGS.slice(1)) {
    parts.box(w + 0.004, 0.030, d + 0.004, AK.tape, 0, y, z, 0.98, 0.02).rotation.x = tilt
  }
  parts.box(0.034, 0.010, 0.062, COLOR.steelDark, 0, -0.2033, -0.1337, 0.6, 0.35).rotation.x = 0.55
}

/** 握把与扳机组：握把后倾 24° —— tube 的长轴烘在 z 上，绕 x 转 1.151 正好"向下向后" */
function buildGrip(parts: Parts): void {
  parts.tube(0.136, 0.019, 0.024, AK.grip, 0, -0.048, 0.081, 10, 0.7, 0.08).rotation.x = 1.151
  parts.box(0.008, 0.026, 0.010, COLOR.steel, 0, -0.003, -0.005, 0.5, 0.35).rotation.x = -0.2
  parts.box(0.028, 0.006, 0.100, COLOR.steelDark, 0, -0.042, 0.008, 0.55, 0.35)
  parts.box(0.026, 0.026, 0.008, COLOR.steelDark, 0, -0.024, -0.040, 0.55, 0.35)
}

/** 拼出整把枪；发射点与旧步枪同一个坐标，曳光与火光位置零改动 */
export function buildAk(parts: Parts): Built {
  buildStock(parts)
  buildReceiver(parts)
  buildFront(parts)
  buildMagazine(parts)
  buildGrip(parts)
  addHand(parts, -0.075, 0.08, -0.3)
  return { emitter: new THREE.Vector3(0, 0.04, -0.56) }
}
