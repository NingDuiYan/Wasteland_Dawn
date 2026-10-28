/**
 * 全局数值配置
 * 所有可调参数集中在此，禁止在业务代码里散落魔法数字
 *
 * 单位统一为米 / 秒：1 单位 = 1 米，门高 2.1、人眼高 1.62 —— 这样写几何时不用换算，
 * 也保证第一人称的尺度感不会因为"贴片像素"这类历史包袱跑偏。
 */

/** 帧循环节奏 */
export const LOOP = {
  /** 单帧最大步进，防止切标签页回来后角色瞬移穿墙 */
  maxStepMs: 50,
  /** HUD 刷新间隔，避免每帧写 DOM */
  hudIntervalMs: 120,
} as const

/** 世界范围：正方形，中心在原点 */
export const WORLD = {
  /** 世界边长（米），镇子外围留一圈荒地 */
  size: 220,
} as const

export const WORLD_EXTENT = WORLD.size / 2

/**
 * 程序化小镇
 *
 * 整座镇子由代码按固定种子长出来：没有任何外部素材，刷新后布局完全一致。
 * 网格化街区（街道 → 人行道 → 地块 → 建筑）是这类小镇唯一可靠的生成顺序：
 * 先划街，街道之间自然形成地块，地块里再放房子与杂物，就不会出现"房子压在马路中间"。
 */
export const TOWN = {
  seed: 20261127,
  /** 相邻街道中心距（米） */
  streetSpacing: 44,
  /** 车行道宽度：双向两车道 */
  streetWidth: 10,
  /** 每个方向的街道条数，5 条 → 4×4 个街区 */
  streetCount: 5,
  /** 人行道宽度（街道两侧各一条） */
  sidewalkWidth: 2.6,
  /** 地块之间的过道，防止两栋楼贴成一片 */
  lotGap: 2.2,
  /** 地面贴图的像素密度：8 px/米 → 220 米就是 1760px 的一张贴图 */
  pxPerMeter: 8,
  /** 地块内建筑尺寸范围（米） */
  houseMin: 7.5,
  houseMax: 12.5,
  houseHeightMin: 3.4,
  houseHeightMax: 7.8,
  /** 空地块做成荒园的概率 */
  vacantChance: 0.18,
  /** 街道两侧立面的窗户层高与列距（米），用来算每面墙几扇窗 */
  windowFloorHeight: 3.1,
  windowSpacing: 2.7,
  /** 窗户本体尺寸：玻璃 + 窗框 + 窗台。三者叠起来才不是"贴在墙上的色块" */
  windowWidth: 0.95,
  windowHeight: 1.15,
  windowFrame: 0.09,
  windowDepth: 0.07,
  windowSillDepth: 0.2,
  windowSillHeight: 0.09,
  /** 各类道具数量：按"走两条街能遇到一个"来控制密度 */
  carCount: 14,
  barrelCount: 18,
  crateCount: 14,
  treeCount: 22,
  rubbleCount: 20,
  lampCount: 12,
  /** 栅栏段数量（沿地块边界，带缺口） */
  fenceSegments: 18,
  /** 街道家具：沿人行道按间隔撒。数量直接决定"这条街有多热闹" */
  binCount: 22,
  hydrantCount: 14,
  poleCount: 16,
  signCount: 10,
  dumpsterCount: 8,
} as const

/** 玩家 */
export const PLAYER = {
  eyeHeight: 1.62,
  walkSpeed: 3.5,
  /** Shift 疾跑 */
  runSpeed: 6.0,
  /** 碰撞半径，用来做圆 vs 方盒的推挤 */
  radius: 0.42,
  hp: 100,
  /** 走路时的镜头起伏；第一人称没有它像摄像机在冰面上滑 */
  bobAmplitude: 0.045,
  bobFreq: 8.2,
  /** 眩晕后回血：站着不动每秒回多少，让玩家敢从小规模遭遇战里撤出来 */
  regenPerSec: 1.6,
  regenDelaySec: 6,
} as const

/** 第一人称相机 */
export const VIEW = {
  fovDeg: 76,
  /** 鼠标灵敏度（弧度/像素） */
  sensitivity: 0.0022,
  /** 抬头低头夹取，留 5 度余量避免万向锁翻转 */
  maxPitchDeg: 85,
  near: 0.08,
  far: 340,
} as const

/** 游戏标识：标题、副标题与版本，界面文案统一从这里取 */
export const GAME = {
  name: '求生',
  subtitle: 'Survival',
  version: '0.3.0',
} as const

/** 丧尸 */
export const ZOMBIE = {
  maxAlive: 12,
  hp: 62,
  damage: 9,
  attackIntervalSec: 1.1,
  /** 够得着玩家的距离（米） */
  attackRange: 1.8,
  /** 发现玩家的距离；夜里更远，白天更近 */
  chaseRangeDay: 26,
  chaseRangeNight: 46,
  speedMin: 1.25,
  speedMax: 2.1,
  /** 丧尸之间互相推开的距离 */
  separation: 1.15,
  /** 击杀后隔多久在远处补一只 */
  respawnSec: 5,
  /** 出生环的半径范围：永远在视野外冒出来，别在玩家脸上凭空出现 */
  spawnMinDistance: 34,
  spawnMaxDistance: 72,
  /** 命中判定用的胶囊体尺寸 */
  hitRadius: 0.38,
  hitHeight: 1.78,
} as const

/**
 * 昼夜
 *
 * 一整天 600 秒（1 小时 = 25 秒）：开局傍晚，一分钟后天黑，
 * 夜里待 4 分多钟再天亮 —— 既看得到完整的黄昏过渡，也不会让人干等白天。
 */
export const TIME = {
  cycleSec: 600,
  startHour: 15.6,
  dawnHour: 5.6,
  duskHour: 19.4,
} as const

/** 天光：太阳/月光的方向、颜色与强度都从这几组值插值出来 */
export const SKY = {
  fogDay: 0xa7b1b0,
  fogDusk: 0x7a6250,
  fogNight: 0x0b111b,
  /** 天空/环境光在一天里的三个色标 */
  ambientDay: 0xb8c4c8,
  ambientDusk: 0x9a7a62,
  ambientNight: 0x2b3a58,
  sunDay: 0xfff2d8,
  sunDusk: 0xff8a44,
  sunNight: 0x6b86bd,
  /** 太阳强度：正午最亮，夜里换成月光（弱一个量级） */
  sunIntensityDay: 3.1,
  sunIntensityNight: 0.32,
  /** 半球光强度 */
  ambientIntensityDay: 0.5,
  ambientIntensityNight: 0.3,
  /** 天顶色：只在天亮时往这个蓝调上靠，夜里天球必须比地平线更暗 */
  zenith: 0x2a4f7d,
  /** 窗户与路灯在夜里才亮 */
  windowEmissiveNight: 2.6,
  windowEmissiveDay: 0.04,
  lampIntensityNight: 46,
  lampIntensityDay: 0,
  /** 招牌：夜里比窗户更亮，是街上唯一的彩色光源 */
  signEmissiveNight: 3.4,
  signEmissiveDay: 0.08,
  /** 冷暖交界：日落后多少弧度内开始偏橙 */
  duskBand: 0.35,
} as const

/**
 * 相机级后处理默认参数（仅 WebGL）
 * 默认值刻意接近中性，保证"开了后处理"与"没开"画面对得上，便于分辨真实改动
 */
export const POSTFX = {
  /** 色彩饱和度：暴雨夜压到 0.7 左右，画面立刻"发灰" */
  saturation: 1,
  /** 暗角强度，0 = 关 */
  vignette: 0.35,
  /** 胶片颗粒 */
  grain: 0.018,
  /** 雨幕折射强度，0 = 不下雨 */
  wet: 0,
  /** 闪电闪光强度，0..1，由天气系统驱动 */
  flash: 0,
  /** 雨线强度，0..1 */
  rain: 0,
  /** 环境暗度，0..1；光照遮罩按它把暗部混向夜色 */
  darkness: 0,
  /** 画面色偏，rgb 乘算 */
  tint: { r: 1, g: 1, b: 1 },
  /** 夜色基色与暖光色，供光照遮罩使用 */
  nightColor: { r: 0.05, g: 0.07, b: 0.12 },
  lightColor: { r: 1, g: 0.85, b: 0.62 },
  /** 光斑对画面的暖色增益 */
  lightGain: 0.16,
  /** S 形曲线对比度：0 = 原样，0.2 左右让暗部更沉、亮部更亮，画面立刻"立"起来 */
  contrast: 0.18,
} as const

/**
 * 天气预设
 *
 * 运行时只在目标值之间线性过渡（transitionSec），不直接跳变：
 * 天气突变会让人怀疑掉帧，而 8 秒的渐变读起来是"云压过来了"。
 */
export const WEATHER = {
  transitionSec: 8,
  presets: {
    clear: {
      rain: 0,
      fog: 0,
      wind: 0.25,
      darkness: 0,
      saturation: 1,
      vignette: 0.3,
      grain: 0.012,
      wet: 0,
      tint: { r: 1, g: 0.99, b: 0.94 },
    },
    overcast: {
      rain: 0,
      fog: 0.07,
      wind: 0.35,
      darkness: 0.12,
      saturation: 0.9,
      vignette: 0.35,
      grain: 0.016,
      wet: 0,
      tint: { r: 0.93, g: 0.95, b: 0.99 },
    },
    rain: {
      rain: 0.55,
      fog: 0.16,
      wind: 0.55,
      darkness: 0.26,
      saturation: 0.8,
      vignette: 0.45,
      grain: 0.02,
      wet: 0.5,
      tint: { r: 0.85, g: 0.9, b: 1 },
    },
    storm: {
      rain: 1,
      fog: 0.24,
      wind: 0.9,
      darkness: 0.36,
      saturation: 0.72,
      vignette: 0.48,
      grain: 0.024,
      wet: 0.85,
      tint: { r: 0.76, g: 0.84, b: 1 },
    },
  },
  /** 暴雨里的闪电：间隔区间与单次总时长（内部再切 3 段子闪光） */
  lightning: { minGapSec: 8, maxGapSec: 20, durationSec: 0.32 },
} as const

export type WeatherKindKey = keyof typeof WEATHER.presets

/**
 * 光照参数
 *
 * 为什么在 shader 里做而不是真实点光源铺满全场：
 * 每个动态点光源都会让所有材质的片元着色多跑一遍，几十盏路灯直接压垮帧率。
 * 而在已有的全屏 pass 里画一个光斑是零额外成本。
 */
export const LIGHTING = {
  /** 玩家手电/自身存在感的光斑：屏幕中心偏下，第一人称的"视觉锚点" */
  playerLight: { radius: 0.62, strength: 0.82 },
  /** 场景里一盏真实路灯的位置投影，用来证明光斑能钉在世界空间里 */
  campLight: { radius: 0.3, strength: 0.35 },
} as const

/**
 * 立面装饰：雨棚 / 招牌 / 门廊 / 海报
 * 有与无按建筑 id 哈希决定（不是随机数），所以刷新页面同一栋楼永远是同一副样子
 */
export const FACADE = {
  awningWidth: 2.9,
  awningDepth: 1.3,
  awningY: 2.6,
  awningThickness: 0.16,
  /** 前沿垂布：雨棚边缘挂下来的一片，风一吹最先晃的就是它 */
  awningValance: 0.24,
  /** 正值 = 外沿下垂，雨水才"流出去"而不是倒灌 */
  awningTilt: 0.26,
  signWidth: 2.0,
  signHeight: 0.66,
  signY: 3.42,
  porchWidth: 2.1,
  porchDepth: 1.05,
  porchHeight: 0.16,
  porchRoofY: 2.52,
  posterWidth: 0.56,
  posterHeight: 0.8,
  posterY: 1.46,
  awningChance: 0.55,
  signChance: 0.5,
  porchChance: 0.6,
  posterChance: 0.55,
} as const

/** 树：树干 + 三段斜枝 + 枝端叶团。单靠"树干顶一个球"会读成蘑菇 */
export const TREE = {
  trunkHeight: 3.3,
  trunkRadius: 0.17,
  /** 四根枝，角度与长度各自抖动：三根等距会读成风车 */
  branchCount: 4,
  branchLength: 1.9,
  branchRadius: 0.11,
  /** 分叉点高度占树干的比例 */
  branchBase: 0.6,
  /** 枝条倾角基准（弧度）：太小就竖直，叶团全挤在一点变成蘑菇 */
  branchTilt: 0.74,
  /** 叶团半径；比枝间距小，树冠才不会糊成一大团 */
  foliageRadius: 0.78,
  /** 叶团纵向压扁：树冠是横着铺开的 */
  foliageSquash: 0.72,
} as const

/** 颜色：整镇的调色板集中在这里，改氛围只改这张表 */
export const PALETTE = {
  dirt: 0x4a4034,
  dirtDark: 0x38302a,
  asphalt: 0x35353a,
  asphaltWorn: 0x45454a,
  sidewalk: 0x6a6559,
  line: 0xa8975a,
  crack: 0x24211d,
  wall: [0x6f665a, 0x7b6a58, 0x5d5a52, 0x6b6052, 0x807466],
  roof: [0x3b3630, 0x453c34, 0x2f2b27],
  wood: 0x7a5c3c,
  metal: 0x585856,
  rust: 0x8a4a2c,
  carPaint: [0x5c6b74, 0x7a4a3e, 0x6e6a4a, 0x45505c, 0x7c7466],
  awning: [0x8a4436, 0x3f5a4a, 0x6d5a2e, 0x54405c],
  poster: [0xb8452f, 0xc9b06a, 0x5b7f8c, 0xa8743a],
  /** 招牌板：底色近黑，靠自发光在夜里出彩 */
  signBoard: 0x241f1c,
  zombieSkin: [0x8f9c78, 0x7e8f6c, 0xa08c72],
  zombieCloth: [0x33302a, 0x3b332c, 0x2b2f35],
  /** 武器与枪口特效：视图模型、曳光、投掷物共用，避免渲染层散落十六进制 */
  gunBody: 0x2c2f33,
  gunMetal: 0x3a3d42,
  gunGrip: 0x24211d,
  gunWood: 0x6b4b2a,
  blade: 0x9aa0a6,
  tracer: 0xffe0a8,
  muzzle: 0xfff0d8,
  grenadeBody: 0x39432c,
  molotov: 0xd08a3a,
  explosion: 0xffb457,
  /** 场景里的两盏真实灯：手持照明与最近的路灯 */
  handLight: 0xfff0d8,
  streetLamp: 0xffd6a2,
} as const
