# AGENTS.md — 《求生 Survival》

给 AI 编码助手的项目上下文。改动前先读这份文件。

## 项目概述

浏览器**第一人称射击**（Three.js / WebGL2）。场景是一座废土小镇，**街道、房屋、道具、丧尸、音效全部由代码程序化生成，仓库里没有任何图片或音频文件**。固定种子，刷新后布局完全一致。

- 开局傍晚，1 分钟后入夜，丧尸视野变大、能见度骤降
- 开局选装备 / 选图（主武器 AK47 突击步枪或泵动霰弹枪，副武器手枪或左轮，另有近战与投掷），左键射击、R 换弹、丧尸追人、死亡结算
- 武器数值全在 `src/weapons.ts`（4 枪 / 2 近战 / 2 投掷），视图模型造型在 `src/render/viewmodel.ts` + `ak47.ts`
- 晴 / 阴 / 雨 / 暴雨四档天气，8 秒线性过渡

**当前状态**：第一人称重建已完成并通过浏览器实测（`npx tsc --noEmit` exit 0、零 console exception、1280×720 下 40~60 FPS）。待办见 `docs/TODO.md`。

## 关键文档

- 设计文档（唯一事实源）：`docs/superpowers/specs/2026-10-28-fps-town-design.md`
- 项目汇总与待办：`docs/TODO.md`
- 本文件只保留 AI 容易搞错的硬规则，数值细节查设计文档
- `docs/superpowers/specs/2026-10-26-*.md` 与 `2026-10-27-*.md` 已废弃（Phaser 2.5D 时代），只作历史参考

## 技术栈

Three.js 0.186 + TypeScript 5.9 + Vite 7.3（版本固定），DOM 覆盖层做 HUD，无后端。
**Phaser 已完全移除**（代码、依赖、素材都已经清掉）。`@types/three` 在 devDependencies。

## 架构硬规则

1. **模拟与渲染分离**：`src/sim/` 是纯 TS，**禁止 import three**。游戏规则（移动、射击射线、丧尸 AI、天气状态机、小镇生成）全在 sim 层，可单测。`src/render/` 只读 sim 状态，不反向写
2. **零外部素材**：仓库里不提交任何图片/音频。视觉用几何体与 canvas 烘焙贴图，声音用 WebAudio 程序化合成。新增内容也必须是代码生成
3. **数值与颜色全在数据表**：世界常数与调色板在 `src/config.ts`（调色板 `PALETTE`），武器数值在 `src/weapons.ts`；业务代码里禁出现魔法数字与十六进制色值
4. **输入映射集中一处**：`src/render/app.ts` 的 keydown 分支 + `keys: Set<string>`（按 `event.code`，不用 `event.key`）

## 3D 硬规则（容易写错）

- **单位是米 / 秒**：人眼高 1.62、门高 2.15、街道宽 10 —— 写几何时不要换算，直接按真实尺寸写
- **坐标系**：x 东、z 南、y 上；地面是 y = 0 平面。**没有"屏幕 y"概念**，深度由相机投影负责
- **相机**：`camera.rotation.order = 'YXZ'`，`rotation.set(pitch, yaw, 0)` 与 sim 的 `direction()` 完全对齐（玩家前方 = `(-sin yaw, -cos yaw)`）
- **丧尸模型面向 +z**：`yaw = atan2(dx, dz)` 直接赋给 `group.rotation.y`，不要额外加 PI（加了就是倒退着走）
- **命中判定分两层**：先算丧尸胶囊体交点，再算 `layout.colliders` 的 box 交点，取更近者 —— 隔着墙必须打不到人
- **后处理色彩空间**：three 往 RenderTarget 写的是线性值。RenderTarget 标 `LinearSRGBColorSpace`，片元里先 `pow(linear, 1/2.2)` 再进效果体；标成 sRGB 会二次解码变暗
- **光斑按世界坐标投影**：用相机 `project()` 把光源投到屏幕 uv；`z > 1`（在相机背后）时必须把光强清零
- **天空球要跟着相机**（`SkyRig` 每帧找名为 `main-camera` 的对象），否则走到边缘会看到球的边界
- **太阳角度按小时算**，不要拿"日照强度"当角度 —— 强度最大时太阳正好在地平线上，画面最暗

## 目录约定（当前实际结构）

```
src/
├── main.ts            入口：交给 render/app.startApp，失败显示 WebGL2 提示
├── config.ts          全部数值与调色板（单位米/秒）
├── weapons.ts         武器表：4 枪 / 2 近战 / 2 投掷 + 槽位与默认配装
├── maps.ts            地图表（医院 / 地铁占位，先把选图流程打通）
├── sim/
│   ├── random.ts      种子 LCG（Rng: next/range/int/chance/pick）
│   ├── town.ts        createTown(seed) → TownLayout（街道/建筑/道具/碰撞盒）
│   ├── world.ts       World：玩家 + 丧尸 + 移动推翻
│   ├── shooting.ts    命中判定：射线求交 + 近战扇形（两层，隔墙打不到）
│   ├── grenade.ts     投掷物 sim 侧状态（抛物线 + 引爆时刻）
│   └── weather.ts     Weather：四档天气状态机 + 线性过渡 + 闪电
├── render/
│   ├── app.ts         主循环、输入、场景装配、窗口缩放、性能兜底
│   ├── level.ts       关卡装配（地面 / 远景 / 小镇）
│   ├── ground.ts      地面贴图 + 法线贴图烘焙
│   ├── buildings.ts   建筑/窗户/道具/路灯/路缘
│   ├── skyline.ts     远景城市剪影（InstancedMesh）
│   ├── zombies.ts     低模丧尸 + 关节动画
│   ├── viewmodel.ts   视图模型动作层（后坐/换弹/枪口火光）+ 7 件武器造型
│   ├── weaponParts.ts 武器零件工厂（几何/材质记账、配色、握枪的手）
│   ├── ak47.ts        突击步枪 AK47 造型（分段尺寸 + 布条/皮革/胶带旧化）
│   ├── tracers.ts     曳光弹（预分配对象池）
│   ├── grenades.ts    投掷物与爆炸表现（几何预分配，战斗中不 new）
│   ├── sky.ts         太阳、半球光、雾、天球
│   ├── effects.ts     后处理 GLSL 片段（纯字符串，无依赖）
│   └── postfx.ts      后处理管线（RT + 全屏 quad）
├── ui/
│   ├── hud.ts         DOM HUD（HP/弹药/击杀/时间/天气/FPS/准星/命中标记）
│   ├── screens.ts     六层全屏界面流（加载/菜单/选装备/选地图/暂停/结算）+ 武器剪影 canvas
│   ├── weatherTabs.ts 天气选项卡（读 #weather-tabs 的 data-weather）
│   ├── menuBackdrop.ts 主菜单背景 canvas（夜雾/手电指针/涟漪/视差/雾中眼睛）
│   ├── plankSwing.ts  木牌弹簧阻尼摆动（每帧写 --swing）
│   ├── titleTree.ts   「生」的竖笔长成一棵枯树（标题石刻，种子固定）
│   ├── loadingArt.ts  加载页：调色、几何与位图烘焙（光柱/木牌/刻石/底噪，全部 canvas）
│   ├── loadingRig.ts  加载页：一帧怎么画（铁链/悬挂物/倒影/灰烬/余辉，纯绘制）
│   ├── loadingBackdrop.ts 加载页：时间轴与挂载（追进度、呼吸、收尾闪灯与淡出）
│   └── themedCursor.ts 主题指针（canvas 现画三种状态转 PNG data URI）
└── audio/sfx.ts       程序化 WebAudio 音效（无音频文件）
```

## 编码规范

- 2 空格缩进，单引号，无分号；函数 ≤80 行，文件 ≤500 行
- TS 显式声明类型，禁 any；优先 interface
- 注释用中文，解释"为什么"而非"做了什么"；公共函数写 JSDoc
- 异步必须 try/catch；生产禁 console.log/debugger（唯一例外：`import.meta.env.DEV` 下的 `window.__world` 调试钩子）
- tsconfig 开了 `noUnusedLocals` 与 `noUnusedParameters`：**任何没被用到的 import / 参数都会让 tsc 失败**

## DOM 契约（index.html ↔ TS，缺一个就 throw）

- HUD：`#hud`（`pointer-events: none`）内含 `#hud-hp-fill` `#hud-hp-text` `#hud-ammo` `#hud-kills` `#hud-clock` `#hud-weather` `#hud-fps` `#hud-crosshair` `#hud-hit-marker` `#hud-status`
- 全屏效果：`#hud-hurt`（受击红闪）
- 交互层（必须 `pointer-events: auto`）：`#weather-tabs`、`#start-overlay`
- 容器：`#game-root`

## UI 视觉规范（《求生》风格）

所有界面（HUD 与六层全屏界面）共用同一套视觉语言。核心一句：**UI 里没有平面图形，只有实物** —— 文字是刻在材质上的凹痕，按钮是挂在铁链上的旧木牌，加上顶上一盏快没电的灯。氛围要绝境、孤独、压抑但不恐怖，极简克制。**禁止**：现代平面 UI、科技感 HUD、霓虹发光、圆角按钮、渐变卡片、血腥恐怖元素。

### 色彩

- 主色纯黑 `#0a0a0a`，铺满画面 90% 以上；只有聚光区可见
- 主光源暖白、微弱（手电筒 / 油灯那种），不是白光洗屏
- 点缀橙红火光 `#ff8a5c`，只做强调，占比极小
- 材质色：深棕木、灰白石材、锈铁灰
- 文字灰白 `#e8dcc8`，靠凹陷阴影出体积，不用纯白亮字
- 整体高对比、大面积暗部

### 材质（只能从这五种里选，禁止塑料 / 玻璃 / 光滑金属）

- 风化旧木：深棕、木纹粗糙、边缘毛边裂痕 —— 按钮、木牌
- 风化石材：灰白、表面裂纹、凹凸不平 —— 标题、刻字、碎石
- 生锈金属：暗灰铁链铁环、锈迹斑斑 —— 悬挂结构
- 旧布条 / 绳索：暗黄、磨损起毛 —— 装饰小物件
- 灰烬 / 灰尘：半透明细小颗粒 —— 氛围粒子

### 文字

- 一律"刻在材质上"：凹陷刻字 + 内阴影，不是平面印刷
- 标题：粗粝厚重的石刻体，带裂纹磨损（形如枯树）
- 按钮：刻在木牌上，字深凹陷
- 提示：刻在碎石上，极小、若隐若现
- 禁止无衬线现代字体、发光字、描边字、渐变字

### 元素设计语言

- 按钮 = 风化木牌，铁链从上方悬挂，边缘不规则，带钉孔与裂痕
- 进度不用进度条：靠灯光亮度变化、裂缝火光蔓延、元素逐个点亮
- 装饰只放有生存感的实物：铁链、绳索、旧布条、碎石、灰烬
- 图标用实物轮廓（门形、枪形），不用矢量线性图标

### 光影

- 单一顶光，向下照，范围小
- 阴影柔和但浓重、边缘模糊；90% 画面在暗部
- 光束里漂灰尘 / 灰烬颗粒，要有空气感

### 动效

- 一律缓慢、轻微、有呼吸感；过渡淡入淡出，不硬切
- 悬挂物微摆 ±2~3 度，像被风吹
- 灯光呼吸：亮度缓慢明暗交替，像心跳
- 粒子：灰尘缓慢飘落，位置随机
- 禁止快速闪烁、弹跳、滑入滑出等现代 UI 动效
- 新动效必须挂进 `index.html:870` 的 `prefers-reduced-motion: reduce` 媒体查询

### 页面清单

- 加载页：聚光灯下铁链挂木牌，灯光逐渐变亮代表进度
- 主菜单：中央石质标题（「求生」二字像枯树）+ 三块铁链木牌按钮
- 装备选择：选项做成不同材质的牌（石板牌、金属牌、骨质牌）
- 所有页面：纯黑背景 + 顶光聚光 + 实物材质 + 刻字效果

### 落地口径（改 UI 前先看）

- 颜色 token 在 `index.html:15-24` 的 `:root`：`--ui-text` `--ui-dim` `--ui-line` `--ui-accent` `--ui-warn` `--ui-rust` `--ui-wood` `--ui-metal` `--ui-sand`；canvas 侧同口径走 `src/ui/screens.ts:36-40` 的 `TONE_COLORS`。**组件里不写裸十六进制**
- 材质全部代码生成：CSS 渐变 + SVG 滤镜（`#menu-stone` 石位移滤镜、`#menu-chain` 铁链 symbol）+ canvas 烘焙（`src/ui/menuBackdrop.ts`、`src/ui/titleTree.ts`）。**不引入任何图片 / 贴图文件**（对齐"零外部素材"）
- 六层界面 id 集中在 `SCREEN_IDS`（`src/ui/screens.ts:20-27`），同一时刻只有一层带 `.is-on`（`index.html:237`），其余 `display:none`；新页面沿用这套开关，不另造可见性机制
- 交互元素必须 `pointer-events: auto`，否则点击穿透到画布变成开火；`focus-visible` 不能因为"要质感"而删（`.plank-btn:focus-visible` 在 `index.html:540`）
- 木牌摆动是弹簧阻尼（`src/ui/plankSwing.ts` 每帧写 `--swing`，`.plank` 的 `transform: rotate(calc(var(--tilt) + var(--swing)))`），静态歪斜已有 ±1.2°，总幅度别超 3 度
- **加载页最短 5 秒，且只当下限**（`MIN_LOADING_SEC`，在 `src/ui/loadingBackdrop.ts`）：灯永远跟着 `setLoading` 递进来的真实进度（不按秒数拉长），资源比 5 秒快才留在这里等满，比 5 秒慢就加载完直接收尾 —— 实际时长 = `max(加载耗时, 5 - 1.92) + 1.92`。收尾固定 1 秒停留 + 0.42 秒闪 + 0.5 秒淡出
- **加载页没有进度条**：进度就是聚光灯的亮度（0% 只见铁链轮廓 → 50% 木纹锈迹浮出 → 100% 全细节，停 1 秒后灯像接触不良闪一下再淡出）。实现在 `src/ui/loadingArt.ts`（烘焙）+ `loadingRig.ts`（一帧）+ `loadingBackdrop.ts`（时间轴），`Screens.setLoading` 只往它递一个 0..1 的亮度；改画面先量参考图，别凭手感调亮度
- 加载页的 DOM 只有 `#loading-scene`（canvas）+ `.loading-scrim`（暗角）：**这一屏没有任何文字**（没有标题、没有状态行、没有进度条，与参考图一致），`Screens.setLoading` 只收一个 0..1 的亮度；要加回任何文案，先跟设计稿对齐

## 音频

浏览器自动播放限制：`AudioContext` 必须由用户手势唤醒。`Sfx.resume()` 在 `#start-overlay` 的点击回调里调用，不要放到构造或定时器里。

## AI 行为约定

- **不主动运行** build / dev / install / test / commit；需要时先询问（用户已明确说"提交"时除外）
- **不主动生成** README 或其他文档
- 修改前先读文件；新增代码优先复用现有实现
- 改动先说明变更点及影响范围；多种实现时列方案并推荐

## Git 约定

- 远端：`https://github.com/NingDuiYan/Wasteland_Dawn.git`（main）
- 提交格式：`<type>(<scope>): <subject>`，type 用 feat/fix/docs/style/refactor/perf/test/chore
- 推送用 `git push`；若遇 403 检查 App 仓库授权范围

## 已知风险提醒（动手前看）

- **阴影是当前最大的性能开销**：软件光栅下开阴影直接从 60 掉到 40 FPS。已有"6 秒后 FPS < 45 自动关阴影"的兜底，不要轻易加大阴影贴图或改用 PCFSoft
- **天空球靠 `camera.name = 'main-camera'` 找相机**：改名字会让天球停在世界原点
- **HUD 的 `pointer-events`**：`#hud` 整体是 `none`，任何要点的东西（选项卡、开始遮罩）必须自己写 `auto`，否则点击会穿透到画布变成开火
- **改天气数值前先读设计文档第 3 节**：四档预设是成组调的，单独拉高一个会让另外三档明显失真

## 实测教训（踩过的坑，勿重蹈）

1. **`PlaneGeometry` 默认居中**：世界坐标是 ±110 时不用挪，若是 0..N 就必须挪到 N/2，否则只有四分之一在画面里
2. **`THREE.Clock` 在 r186 已废弃**：用 `THREE.Timer`（挂 Page Visibility，切标签页回来不会甩出一个巨大的 delta）
3. **没有 Pointer Lock 也要能开火**：内嵌 webview / 无头环境下拿不到锁，否则连枪都开不了（视角转动仍要求锁定）
4. **纹理无缝靠"周期性噪声 + 3×3 重复绘制"**，且元素坐标必须先算好再重复画，否则每份副本形状不同，接缝照样在
5. **`tools.edit` 偶发 Windows 文件占用**（`ReplaceFileW EIO (Win32 1175)`）：同一调用重试即可
