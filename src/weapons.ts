/**
 * 武器表：全项目唯一的武器数值来源。
 *
 * 为什么独立成文件而不是塞进 config.ts：config 是「世界常数」（重力、墙高、天气），
 * 武器是「可选内容」，会随着新枪加入持续膨胀，放一起会让 config 变成大杂烩。
 */

/** 装备槽位，顺序即数字键 1-4 的顺序 */
export type WeaponSlot = 'primary' | 'secondary' | 'melee' | 'throwable'

export type GunId = 'rifle' | 'shotgun' | 'pistol' | 'revolver'
export type MeleeId = 'machete' | 'bat'
export type ThrowableId = 'grenade' | 'molotov'
export type WeaponId = GunId | MeleeId | ThrowableId

/** 枪械：远程槽位（主武器 / 副武器）共用一套参数 */
export interface GunSpec {
  kind: 'gun'
  id: GunId
  name: string
  /** 一句话说明，选装备界面直接显示 */
  desc: string
  /** 单发伤害；pellets > 1 时是「每颗弹丸」的伤害 */
  damage: number
  /** 两次开火的最小间隔（秒） */
  fireIntervalSec: number
  /** 超过这个距离不再判定命中（米） */
  range: number
  /** 弹道散布（弧度），每发独立随机 */
  spread: number
  ammoPerMag: number
  reloadSec: number
  /** true = 按住鼠标连发 */
  auto: boolean
  /** 一次扣扳机打出几颗弹丸，霰弹枪 > 1 */
  pellets: number
  /** 视图模型后退量与抬枪角度 */
  recoilKick: number
  recoilDeg: number
  muzzleFlashSec: number
  /** 曳光弹拖尾的残留时长 */
  tracerSec: number
}

/** 近战：不耗弹药，靠距离 + 扇形角落判定 */
export interface MeleeSpec {
  kind: 'melee'
  id: MeleeId
  name: string
  desc: string
  damage: number
  /** 有效距离（米），从玩家中心算起 */
  range: number
  /** 挥砍扇形的半角（弧度）：0.68 ≈ 单侧 39° */
  arcRad: number
  fireIntervalSec: number
  /** 挥砍动画时长，视图模型用 */
  swingSec: number
}

/** 投掷：抛物线飞行 + 引信 + 范围伤害 */
export interface ThrowableSpec {
  kind: 'throwable'
  id: ThrowableId
  name: string
  desc: string
  /** 爆心处的伤害，边缘按距离线性衰减到 0 */
  damage: number
  /** 伤害半径（米） */
  radius: number
  /** 从脱手到爆炸的时间 */
  fuseSec: number
  /** 一局携带数量 */
  count: number
  /** 出手初速度（米/秒） */
  throwSpeed: number
  /** 出手时的上抛分量，决定抛物线的拱高 */
  throwLift: number
}

export type WeaponSpec = GunSpec | MeleeSpec | ThrowableSpec

/**
 * 枪械数值设计口径：以丧尸基础血量 62 为标尺。
 * 步枪 3 发、霰弹贴脸 1 发、手枪 2 发、左轮 1 发 —— 差异只体现在射速与容错上。
 */
export const GUNS: Record<GunId, GunSpec> = {
  rifle: {
    kind: 'gun',
    id: 'rifle',
    name: 'AK47 突击步枪',
    desc: '废土上捡来的老 AK：木托缠布条、护木包皮、弹匣缠胶带；全自动，中距离压制力强',
    damage: 24,
    fireIntervalSec: 0.105,
    range: 110,
    spread: 0.019,
    ammoPerMag: 30,
    reloadSec: 2.1,
    auto: true,
    pellets: 1,
    recoilKick: 0.035,
    recoilDeg: 1.1,
    muzzleFlashSec: 0.05,
    tracerSec: 0.04
  },
  shotgun: {
    kind: 'gun',
    id: 'shotgun',
    name: '泵动霰弹枪',
    desc: '贴脸一枪带走，超过二十米几乎打不中',
    damage: 13,
    fireIntervalSec: 0.8,
    range: 32,
    spread: 0.075,
    ammoPerMag: 6,
    reloadSec: 2.8,
    auto: false,
    pellets: 8,
    recoilKick: 0.11,
    recoilDeg: 3.2,
    muzzleFlashSec: 0.08,
    tracerSec: 0.05
  },
  pistol: {
    kind: 'gun',
    id: 'pistol',
    name: '半自动手枪',
    desc: '射速与威力平衡，换弹快，主武器空仓时的保险',
    damage: 34,
    fireIntervalSec: 0.15,
    range: 80,
    spread: 0.012,
    ammoPerMag: 12,
    reloadSec: 1.4,
    auto: false,
    pellets: 1,
    recoilKick: 0.06,
    recoilDeg: 1.7,
    muzzleFlashSec: 0.055,
    tracerSec: 0.045
  },
  revolver: {
    kind: 'gun',
    id: 'revolver',
    name: '左轮手枪',
    desc: '一枪一个，但六发打完要等很久',
    damage: 62,
    fireIntervalSec: 0.55,
    range: 90,
    spread: 0.008,
    ammoPerMag: 6,
    reloadSec: 2.4,
    auto: false,
    pellets: 1,
    recoilKick: 0.1,
    recoilDeg: 2.8,
    muzzleFlashSec: 0.07,
    tracerSec: 0.05
  }
}

export const MELEES: Record<MeleeId, MeleeSpec> = {
  machete: {
    kind: 'melee',
    id: 'machete',
    name: '开山刀',
    desc: '挥得快、劈得狠，需要靠得更近',
    damage: 42,
    range: 1.95,
    arcRad: 0.68,
    fireIntervalSec: 0.55,
    swingSec: 0.32
  },
  bat: {
    kind: 'melee',
    id: 'bat',
    name: '棒球棍',
    desc: '范围更大、能一次扫到两个，伤害略低',
    damage: 30,
    range: 2.15,
    arcRad: 0.85,
    fireIntervalSec: 0.45,
    swingSec: 0.28
  }
}

export const THROWABLES: Record<ThrowableId, ThrowableSpec> = {
  grenade: {
    kind: 'throwable',
    id: 'grenade',
    name: '破片手雷',
    desc: '范围最大、伤害最高，落地两秒半后爆炸',
    damage: 130,
    radius: 5.5,
    fuseSec: 2.6,
    count: 2,
    throwSpeed: 15,
    throwLift: 3.2
  },
  molotov: {
    kind: 'throwable',
    id: 'molotov',
    name: '燃烧瓶',
    desc: '引信短、范围小，但一局能带三个',
    damage: 78,
    radius: 4,
    fuseSec: 1.2,
    count: 3,
    throwSpeed: 13,
    throwLift: 2.4
  }
}

/** 按 id 查任意武器；三个子表键不重叠，展开即可 */
export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  ...GUNS,
  ...MELEES,
  ...THROWABLES
}

/** 选装备界面的槽位元数据：label 做标题，hint 解释这个槽位存在的意义 */
export interface SlotMeta {
  slot: WeaponSlot
  label: string
  hint: string
  options: readonly WeaponId[]
}

export const LOADOUT_SLOTS: readonly SlotMeta[] = [
  {
    slot: 'primary',
    label: '主武器',
    hint: '决定中远距离的压制力，子弹打空时切到副武器',
    options: ['rifle', 'shotgun']
  },
  {
    slot: 'secondary',
    label: '副武器',
    hint: '轻便、换弹快，主武器来不及 reload 时的救火队员',
    options: ['pistol', 'revolver']
  },
  {
    slot: 'melee',
    label: '近战武器',
    hint: '不耗弹药，被贴脸缠住时唯一不卡壳的东西',
    options: ['machete', 'bat']
  },
  {
    slot: 'throwable',
    label: '投掷武器',
    hint: '一口清掉一小片，数量有限，别当普通子弹用',
    options: ['grenade', 'molotov']
  }
]

/** 一局的装备方案：键名与 WeaponSlot 一一对应，便于 loadout[slot] 取值 */
export interface Loadout {
  primary: GunId
  secondary: GunId
  melee: MeleeId
  throwable: ThrowableId
}

export const DEFAULT_LOADOUT: Loadout = {
  primary: 'rifle',
  secondary: 'pistol',
  melee: 'machete',
  throwable: 'grenade'
}

/** 数字键 1-4 的切换顺序，与 LOADOUT_SLOTS 一致 */
export const WEAPON_ORDER: readonly WeaponSlot[] = ['primary', 'secondary', 'melee', 'throwable']

/** 取某槽位当前装备的武器 id */
export function slotWeapon(loadout: Loadout, slot: WeaponSlot): WeaponId {
  return loadout[slot]
}

/** 取某槽位当前装备的武器数值 */
export function slotSpec(loadout: Loadout, slot: WeaponSlot): WeaponSpec {
  return WEAPONS[loadout[slot]]
}

/** 槽位的中文名，HUD 与结算界面共用 */
export function slotLabel(slot: WeaponSlot): string {
  switch (slot) {
    case 'primary':
      return '主武器'
    case 'secondary':
      return '副武器'
    case 'melee':
      return '近战'
    case 'throwable':
      return '投掷'
  }
}
