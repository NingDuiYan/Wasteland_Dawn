# AGENTS.md — 《废土黎明 Wasteland Dawn》

给 AI 编码助手的项目上下文。改动前先读这份文件。

## 项目概述

废土求生 2D 浏览器游戏：顶视角斜俯 2.5D（饥荒式倾斜投影），昼夜循环守家玩法。

- 白天（约 3 分钟）：离基地探索，采集木材/废铁/食物，搜刮遇敌
- 夜晚（约 2 分钟）：丧尸潮攻向基地，炮台/陷阱自动作战，玩家修墙补枪
- 无尽模式：难度逐夜递增，死亡结算，`localStorage` 存最高纪录

**当前状态**：设计定稿 + 全部素材就绪，**游戏代码尚未开始**。下一步是搭 Vite + TS + Phaser 骨架，先做 2.5D 遮挡验证场景。

## 关键文档

- 完整设计文档（唯一事实源）：`docs/superpowers/specs/2026-10-26-wasteland-dawn-design.md`
- 本文件只保留 AI 容易搞错的硬规则，数值细节查设计文档

## 技术栈（规划）

Phaser 3 + TypeScript + Vite，DOM 覆盖层做 HUD，无后端。

## 架构硬规则

1. **模拟与渲染分离**：`src/sim/` 是纯 TS，禁止 import Phaser。游戏规则全在 sim 层，可单测。`GameScene` 只做"读 GameState → 同步精灵"
2. **资产走 manifest**：所有资源通过 `src/manifest.ts` 的稳定 key 引用，禁止在业务代码里硬编码资源路径。换图零改代码
3. **数值全在 config**：昼夜时长、建筑属性、波次公式等集中在 `src/config.ts`，禁止魔法数字散落
4. **输入映射集中一处**：WASD 移动 / E 交互 / B 建造 / 1-4 选建筑 / 鼠标瞄准 + 左键射击 / Esc 取消 / P 暂停

## 2.5D 视角硬规则（容易写错）

- 所有立式精灵 `setOrigin(0.5, 1)`，底部中心贴地面
- 深度 = 脚底世界 y：`depth = sprite.y`，角色/丧尸/树/建筑统一参与
- 每个立式物件脚下画椭圆阴影，阴影固定画在物件之下、不参与排序
- 角色**不旋转**，只 `flipX`，永远面向镜头；敌我靠 tint 区分（奔跑者绿、胖尸暗红+1.35x）
- 建造预览：视觉框 32×24 压扁，实际占格 32×32；底层寻路网格 16px
- 建筑在 A* 里是"高代价可通行"节点（代价 8 vs 空地 1）：有路绕，无路啃

## 目录约定（目标结构）

```
src/
├── main.ts          # 入口
├── config.ts        # 数值表
├── manifest.ts      # 资产 key → 路径
├── sim/             # 纯模拟层（GameState + systems/）
├── scenes/          # BootScene / GameScene（薄）
├── view/            # 精灵工厂、锚点/深度/阴影、相机
├── ui/              # DOM HUD
└── assets/          # 已就位：characters/ environment/ trees/ audio/ licenses/
```

## 编码规范

- 2 空格缩进，单引号，无分号；函数 ≤80 行，文件 ≤500 行
- TS 显式声明类型，禁 any；优先 interface
- 注释用中文，解释"为什么"而非"做了什么"；公共函数写 JSDoc
- 列表渲染 key 必须稳定唯一；异步必须 try/catch；竞态用标志位
- 生产禁 console.log/debugger；禁硬编码密钥与 API 地址

## AI 行为约定

- **不主动运行** build/dev/install/test/commit；需要时先询问
- **不主动生成** README 或其他文档
- 修改前先读文件；新增代码优先复用现有代码
- 改动先说明变更点及影响范围；多种实现时列方案并推荐

## Git 约定

- 远端：`https://github.com/NingDuiYan/Wasteland_Dawn.git`（main）
- 提交格式：`<type>(<scope>): <subject>`，type 用 feat/fix/docs/style/refactor/perf/test/chore
- 推送用 `git push`（连接器授权已配好）；若遇 403 检查 App 仓库授权范围

## 素材与授权（全部 CC0 1.0）

| 类别 | 来源 | 位置 |
|------|------|------|
| 角色/丧尸 | Kenney Top-down Shooter（6 姿态，单帧无动画） | `characters/` |
| 地面/建筑 | Kenney Tower Defense（64px 瓦片，地面主用） | `environment/` |
| 树木 | AI 生成 3 种（枯树/半死阔叶/枯松），128×144 底部锚点 | `environment/trees/` |
| 音效 16 个 | Kenney Impact/Interface/RPG Audio/Jingles | `audio/sfx/` |
| BGM | Juhani Junkala《Post Apocalyptic Wastelands》（OGA） | `audio/bgm/wasteland-loop.ogg` |
| 授权文件 | 7 份原始 License | `licenses/` |

- Kenney 是扁平矢量高饱和风，仅占位，Phase 3 整体换像素风
- 缺口：枪声（暂用撞击音占位）、丧尸低吼、UI 图标（暂用 CSS 色块）—— 均标注在 spec
- 音频注意：浏览器自动播放限制，AudioContext 必须由"点击开始"手势唤醒；SFX 并发池上限 4

## 已知风险提醒（动手前看）

- A* 性能：丧尸上限 150，每帧只重算 8 只（时间分片），先压测 50 只再放开
- HUD 的 DOM 层必须 `pointer-events` 精确控制，防误触射击
- 资源经济：初始 40 资源点、每晚重生 15、场上封顶 60 —— 改数值前先读 spec 第 7 节的经济闭环推导
