# AGENTS.md — 《废土黎明 Wasteland Dawn》

给 AI 编码助手的项目上下文。改动前先读这份文件。

## 项目概述

浏览器**第一人称射击**（Three.js / WebGL2）。场景是一座废土小镇，**街道、房屋、道具、丧尸、音效全部由代码程序化生成，仓库里没有任何图片或音频文件**。固定种子，刷新后布局完全一致。

- 开局傍晚，1 分钟后入夜，丧尸视野变大、能见度骤降
- 手枪射击（12 发弹匣、R 换弹）、丧尸追人、死亡结算
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
3. **数值与颜色全在 config**：`src/config.ts` 是唯一数值表，业务代码里禁出现魔法数字与十六进制色值（调色板用 `PALETTE`）
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
├── sim/
│   ├── random.ts      种子 LCG（Rng: next/range/int/chance/pick）
│   ├── town.ts        createTown(seed) → TownLayout（街道/建筑/道具/碰撞盒）
│   ├── world.ts       World：玩家 + 丧尸 + 射线 + 移动推翻
│   └── weather.ts     Weather：四档天气状态机 + 线性过渡 + 闪电
├── render/
│   ├── app.ts         主循环、输入、场景装配、窗口缩放、性能兜底
│   ├── ground.ts      地面贴图 + 法线贴图烘焙
│   ├── buildings.ts   建筑/窗户/道具/路灯/路缘
│   ├── skyline.ts     远景城市剪影（InstancedMesh）
│   ├── zombies.ts     低模丧尸 + 关节动画
│   ├── viewmodel.ts   手枪视图模型（后坐/换弹/枪口火光）
│   ├── sky.ts         太阳、半球光、雾、天球
│   ├── effects.ts     后处理 GLSL 片段（纯字符串，无依赖）
│   └── postfx.ts      后处理管线（RT + 全屏 quad）
├── ui/
│   ├── hud.ts         DOM HUD（HP/弹药/击杀/时间/天气/FPS/准星/命中标记）
│   └── weatherTabs.ts 天气选项卡（读 #weather-tabs 的 data-weather）
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
