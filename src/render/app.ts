/**
 * 第一人称主循环 + 整局流程编排
 *
 * 流程：加载 → 主菜单 → 选装备 → 选地图 → 游戏 → 结算 →（重来 / 回主菜单）
 * 这一层只做三件事：把 sim 与渲染接起来、处理输入、决定现在该显示哪一屏。
 * 场景（Level）跟着地图复用，世界（World）每局重建 —— 重开一局不该重新生成地形。
 */

import * as THREE from 'three'
import { LOOP, PALETTE, PLAYER, SKY, VIEW } from '../config'
import { DEFAULT_MAP, MAPS, mapOf, type MapId } from '../maps'
import { World, type InputState } from '../sim/world'
import { Weather, type WeatherKind, type WeatherState } from '../sim/weather'
import { Sfx } from '../audio/sfx'
import { Hud } from '../ui/hud'
import { Screens } from '../ui/screens'
import { WEATHER_TABS, WeatherTabs } from '../ui/weatherTabs'
import {
  DEFAULT_LOADOUT,
  slotLabel,
  WEAPON_ORDER,
  type Loadout,
  type WeaponSlot,
  type WeaponSpec,
} from '../weapons'
import type { PostFxParams } from './effects'
import { GrenadeView } from './grenades'
import { Level } from './level'
import { PostFX } from './postfx'
import { SkyRig } from './sky'
import { Tracers } from './tracers'
import { ViewModel } from './viewmodel'
import { ZombieView } from './zombies'

const WEATHER_ORDER: readonly WeatherKind[] = WEATHER_TABS.map((tab) => tab.kind)
/** 倒下后停一会儿再弹结算：让最后一击的画面先落地，别一黑屏就切走 */
const DEATH_SETTLE_SEC = 1.8
/** 数字键 1-4 与四个槽位的对应关系，顺序跟选择界面一致 */
const SLOT_KEYS = WEAPON_ORDER.map((slot, index) => ({ code: 'Digit' + (index + 1), slot }))

function applyWeather(params: PostFxParams, state: WeatherState, nightFactor: number): void {
  params.saturation = state.saturation
  params.vignette = state.vignette
  params.grain = state.grain
  params.wet = state.wet
  params.rain = state.rainIntensity
  // 夜色与天气的暗度取更暗的那个：暴雨夜里比晴天夜里更看不见路
  // 夜里要"看不清远处但仍能行动"：压暗交给灯光 mask，而不是把整屏压成黑
  params.darkness = Math.min(1, Math.max(state.darkness, nightFactor * 0.42))
  params.flash = state.lightning
  params.tint.r = state.tint.r
  params.tint.g = state.tint.g
  params.tint.b = state.tint.b
}

/** 曳光寿命跟着武器走；近战与投掷没有弹道，返回 0 表示不画 */
function tracerLife(spec: WeaponSpec): number {
  return spec.kind === 'gun' ? spec.tracerSec : 0
}

/** 等一帧再继续：加载页那盏灯要真的一档档亮起来，一口气同步干完浏览器不会重绘 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

export async function startApp(container: HTMLElement): Promise<void> {
  document.body.classList.add('view-fps')

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  // 阴影是这类场景最划算的一步：盒子一投影，房子和地面立刻分层
  renderer.shadowMap.enabled = true
  // 软阴影在软件光栅下太贵：PCF 硬边在这个尺度上几乎看不出差别
  renderer.shadowMap.type = THREE.PCFShadowMap
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(VIEW.fovDeg, 1, VIEW.near, VIEW.far)
  camera.name = 'main-camera'
  camera.rotation.order = 'YXZ'
  scene.add(camera)

  const hud = new Hud()
  const sfx = new Sfx()
  const sky = new SkyRig(scene)
  const zombieView = new ZombieView(scene)
  const grenadeView = new GrenadeView(scene)
  const postfx = new PostFX()
  const tracers = new Tracers(scene)
  const weather = new Weather('clear')

  const viewModel = new ViewModel()
  camera.add(viewModel.root)
  // 枪自带一盏很近的灯：世界光一到夜里就压到接近全黑，
  // 没有这盏灯手里的枪会变成一块看不见的黑影
  const handLight = new THREE.PointLight(PALETTE.handLight, 1.15, 1.6, 2)
  camera.add(handLight)
  // 最近一盏路灯用一个真实点光源：只点一盏，够照亮脚下路面，成本可接受
  const lampLight = new THREE.PointLight(PALETTE.streetLamp, 0, 24, 2)
  scene.add(lampLight)

  let level: Level | null = null
  let levelMapId: MapId | null = null
  let currentMapId: MapId = DEFAULT_MAP
  // 世界在「选完地图」之后才建：开局界面不该出现玩家还没选的那张图
  let world!: World
  let playing = false
  // 暂停（丢失指针锁定）时必须停掉 sim：否则在菜单里站着也会被丧尸咬死
  let paused = false
  let deathTimer = 0
  let deathResolve: (() => void) | null = null
  let hurtFlash = 0
  // 显式 number：PLAYER 是 as const，直接赋值会把 lastHp 推成字面量类型 100
  let lastHp: number = PLAYER.hp
  let lastReloadLeft = 0
  let bobPhase = 0
  let fpsFrames = 0
  let fpsElapsed = 0
  let hudElapsed = 0
  /** 连续低帧秒数：阴影降级的判据，单帧抖动不算 */
  let lowFpsSec = 0

  const requestLock = (): void => {
    if (world.player.dead) return
    // 无头浏览器 / 内嵌 webview 会直接拒绝锁定；拒绝只是"拿不到鼠标"，不是错误，
    // 不接住的话控制台会多出一条未捕获的 promise 拒绝
    const request = renderer.domElement.requestPointerLock() as unknown
    if (request instanceof Promise) void request.catch(() => undefined)
  }

  /** 暂停层点「继续」：先解除暂停再尝试锁定；拿不到锁的环境也能接着玩 */
  const resumeGame = (): void => {
    paused = false
    requestLock()
  }

  const screens = new Screens({ onResume: resumeGame })
  // 仅开发期：暂停层不好在无头环境里自然触发（拿不到鼠标锁），
  // 留个钩子让 CDP 脚本能直接开关它做视觉验收
  if (import.meta.env.DEV) {
    ;(window as unknown as { __screens?: Screens }).__screens = screens
  }

  /** 按需重建整张场景：同图重开时地形不动，换图才整套清掉重建 */
  const ensureLevel = (mapId: MapId): Level => {
    if (level && levelMapId === mapId) return level
    if (level) level.dispose()
    const created = new Level(mapOf(mapId) ?? MAPS[0])
    level = created
    levelMapId = mapId
    scene.add(created.group)
    return created
  }

  const startRound = (loadout: Loadout, mapId: MapId): void => {
    currentMapId = mapId
    const active = ensureLevel(mapId)
    const map = mapOf(mapId) ?? MAPS[0]
    world = new World(active.layout, map.seed, loadout)
    viewModel.setWeapon(world.weapon)
    lastHp = world.player.hp
    lastReloadLeft = 0
    hurtFlash = 0
    deathTimer = 0
    deathResolve = null
    bobPhase = 0
    hud.setWeapon(world.weapon.name, slotLabel(world.player.slot))
    hud.setThrowable(world.player.throwLeft)
    hud.setHp(world.player.hp)
    hud.setKills(0)
    // 仅开发期：浏览器里可直接读/改世界状态，方便用 CDP 做自动化验收
    if (import.meta.env.DEV) {
      ;(window as unknown as { __world?: World }).__world = world
    }
  }

  const muzzle = new THREE.Vector3()
  const hitPoint = new THREE.Vector3()

  /** 执行一次开火；返回 false 表示这一下没打出去（冷却中/空仓），点击就还留着下一次机会 */
  const shootOnce = (): boolean => {
    const shot = world.shoot()
    if (!shot) return false
    if (shot.action === 'fired') {
      viewModel.fire()
      sfx.shoot()
      viewModel.muzzleWorld(muzzle)
      hitPoint.set(shot.x, shot.y, shot.z)
      tracers.spawn(muzzle, hitPoint, tracerLife(world.weapon))
    } else if (shot.action === 'swung') {
      viewModel.swing()
      sfx.swing()
    } else {
      viewModel.throwOut()
      sfx.throwOut()
    }
    if (shot.kind === 'zombie') {
      hud.flashHit()
      sfx.hitFlesh()
    } else if (shot.kind === 'world') {
      sfx.hitWorld()
    }
    return true
  }

  const switchSlot = (slot: WeaponSlot): void => {
    if (world.player.slot === slot) return
    world.switchSlot(slot)
    viewModel.setWeapon(world.weapon)
    sfx.switchWeapon()
    hud.setWeapon(world.weapon.name, slotLabel(slot))
    hud.setAmmo(world.weapon.kind === 'gun' ? world.ammo : null, false)
  }

  const setWeather = (kind: WeatherKind): void => {
    weather.setKind(kind)
    tabs.setActive(kind)
    const tab = WEATHER_TABS.find((item) => item.kind === kind)
    hud.setWeather(tab ? tab.label : kind)
  }
  const tabs = new WeatherTabs(setWeather, weather.state.kind)
  // 同步一次 HUD 的天气文字：只有点选项卡时才刷新的话，开局会一直显示占位符 "--"
  setWeather(weather.state.kind)
  const cycleWeather = (): void => {
    const next = (WEATHER_ORDER.indexOf(weather.state.kind) + 1) % WEATHER_ORDER.length
    setWeather(WEATHER_ORDER[next])
  }

  const keys = new Set<string>()
  const hurtOverlay = document.getElementById('hud-hurt')
  let triggerHeld = false
  let fireQueued = 0

  window.addEventListener('keydown', (event) => {
    keys.add(event.code)
    if (!playing || world.player.dead) return
    if (event.code === 'KeyR') world.reload()
    if (event.code === 'KeyP') cycleWeather()
    const mapped = SLOT_KEYS.find((item) => item.code === event.code)
    if (mapped) switchSlot(mapped.slot)
  })
  window.addEventListener('keyup', (event) => keys.delete(event.code))
  // 切走窗口时松开所有键与扳机，否则回来会一直往前冲
  window.addEventListener('blur', () => {
    keys.clear()
    triggerHeld = false
  })

  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === renderer.domElement
    if (locked) {
      paused = false
      screens.hidePause()
      return
    }
    if (!playing || world.player.dead) return
    paused = true
    keys.clear()
    triggerHeld = false
    fireQueued = 0
    screens.showPause()
  })

  document.addEventListener('mousemove', (event) => {
    if (!playing) return
    if (document.pointerLockElement !== renderer.domElement) return
    world.look(event.movementX, event.movementY, VIEW.sensitivity)
  })

  document.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return
    // 只要已经开局就允许开火：某些环境拿不到 pointer lock（内嵌 webview、无头浏览器），
    // 那时连枪都不能开就直接不能玩了；视角转动仍然需要锁定鼠标
    // 暂停层上的点击只用来恢复，不能顺带打出一枪
    if (!playing || paused || world.player.dead) return
    triggerHeld = true
    fireQueued = 1
  })
  document.addEventListener('mouseup', (event) => {
    if (event.button === 0) triggerHeld = false
  })

  renderer.domElement.addEventListener('pointerdown', () => {
    if (!playing) return
    if (document.pointerLockElement !== renderer.domElement) requestLock()
  })

  const input: InputState = { forward: 0, strafe: 0, run: false }

  /** 读输入 + 推进 sim + 处理开火；返回 0/1 级别的移动强度，相机与视图模型都要用 */
  const stepGame = (dtSec: number): number => {
    input.forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0)
    input.strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0)
    input.run = keys.has('ShiftLeft') || keys.has('ShiftRight')
    const speedRatio = Math.hypot(input.forward, input.strafe) > 0.1 ? 1 : 0
    if (!playing || paused || world.player.dead) return 0

    world.update(dtSec, input)
    const spec = world.weapon
    // 按住能连续出手的只有全自动枪和近战：手枪/左轮/霰弹/投掷要求一下一次点击
    const repeatable = spec.kind === 'gun' ? spec.auto : spec.kind === 'melee'
    if (repeatable) {
      // 连发/近战也认残留的队列：点得快时按下与抬起可能落在同一帧内，
      // 只认 triggerHeld 会让这次点击彻底消失（还会漏给下一个槽位）
      if (triggerHeld || fireQueued > 0) {
        fireQueued = 0
        shootOnce()
      }
    } else if (fireQueued > 0) {
      // 半自动只认"按下这一下"：冷却中再点就丢掉，否则按住手枪会变成自动武器
      fireQueued = 0
      shootOnce()
    }
    return speedRatio
  }

  const syncWorldViews = (dtSec: number, speedRatio: number): void => {
    zombieView.sync(world.zombies)
    viewModel.setReloading(world.player.reloadLeft, world.reloadTotalSec)
    viewModel.update(dtSec, speedRatio)
    tracers.update(dtSec)
    const explosions = world.drainExplosions()
    if (explosions.length > 0) sfx.explode()
    grenadeView.sync(world.grenades, explosions)
    grenadeView.update(dtSec)
    if (world.player.reloadLeft > 0 && lastReloadLeft === 0) sfx.reload()
    lastReloadLeft = world.player.reloadLeft
  }

  const updateCamera = (dtSec: number, speedRatio: number): void => {
    // 相机：位置 + 呼吸起伏 + 一点滚转，让"在走路"能靠画面本身读出来
    const moving = speedRatio * (input.run ? 1.25 : 1)
    bobPhase += dtSec * PLAYER.bobFreq * Math.max(0.0001, moving)
    const bob = Math.sin(bobPhase) * PLAYER.bobAmplitude * moving
    const p = world.player
    camera.position.set(p.x, PLAYER.eyeHeight + bob, p.z)
    camera.rotation.set(p.pitch, p.yaw, Math.sin(bobPhase * 0.5) * 0.008 * moving)
  }

  const updateLighting = (dtSec: number): void => {
    if (!level) return
    const p = world.player
    weather.update(dtSec)
    const skyState = sky.update(world.hour, weather.state)
    applyWeather(postfx.params, weather.state, skyState.nightFactor)
    // 玩家自己的光圈：位置在视线稍前方，看起来像"手电照出去"而不是"身上发光"
    postfx.projectLight(postfx.params.playerLight, p.x, PLAYER.eyeHeight, p.z, camera)

    const towardNight = SKY.windowEmissiveNight - SKY.windowEmissiveDay
    level.town.windowMaterial.emissiveIntensity = SKY.windowEmissiveDay + skyState.nightFactor * towardNight
    level.town.lampMaterial.emissiveIntensity = SKY.windowEmissiveDay + skyState.nightFactor * towardNight
    // 招牌比窗户更亮：夜里它是街上唯一有颜色的光源
    level.town.signMaterial.emissiveIntensity =
      SKY.signEmissiveDay + skyState.nightFactor * (SKY.signEmissiveNight - SKY.signEmissiveDay)

    // 最近的一盏路灯搬到玩家附近，避免远处灯白算；强度按夜色渐亮
    let nearest: THREE.Vector3 | null = null
    let nearestDistance = SKY.lampIntensityNight > 0 ? 40 : 0
    for (const position of level.lampPositions) {
      const distance = (position.x - p.x) ** 2 + (position.z - p.z) ** 2
      if (distance < nearestDistance * nearestDistance) {
        nearestDistance = Math.sqrt(distance)
        nearest = position
      }
    }
    if (nearest) {
      lampLight.position.copy(nearest)
      lampLight.intensity = skyState.nightFactor * SKY.lampIntensityNight
    } else {
      lampLight.intensity = 0
    }
  }

  const syncHud = (dtSec: number): void => {
    const p = world.player
    hud.update(dtSec)
    if (p.hp < lastHp) {
      hurtFlash = 0.85
      sfx.hurt()
    }
    lastHp = p.hp
    hurtFlash = Math.max(0, hurtFlash - dtSec * 1.6)
    if (hurtOverlay) hurtOverlay.style.opacity = hurtFlash.toFixed(2)
    hud.setCrosshairVisible(playing && !p.dead)

    hudElapsed += dtSec
    fpsFrames += 1
    fpsElapsed += dtSec
    if (hudElapsed < LOOP.hudIntervalMs / 1000) return
    hudElapsed = 0
    hud.setHp(p.hp)
    hud.setAmmo(world.weapon.kind === 'gun' ? world.ammo : null, p.reloadLeft > 0)
    hud.setThrowable(p.throwLeft)
    hud.setKills(world.kills)
    hud.setClock(world.hour)
    const fps = fpsElapsed > 0 ? fpsFrames / fpsElapsed : 0
    hud.setFps(fps)
    fpsFrames = 0
    fpsElapsed = 0
    // 集成显卡 + 高分辨率撑不住阴影时自动降级：宁可没有阴影，也不能掉到卡顿。
    // 判据必须是"连续几秒都低"而不是"这一瞬间低"——着色器编译、GC、切窗口
    // 都会让单个采样窗口掉到 20 帧，那种抖动不该被当成"撑不住"
    if (renderer.shadowMap.enabled && performance.now() > 8000) {
      lowFpsSec = fps < 40 ? lowFpsSec + LOOP.hudIntervalMs / 1000 : 0
      if (lowFpsSec >= 3) {
        renderer.shadowMap.enabled = false
        scene.traverse((object) => {
          if (object instanceof THREE.Mesh) object.castShadow = false
        })
      }
    }
  }

  /** 倒下后数秒再放行结算，避免结算层直接糊在最后一帧脸上 */
  const handleDeath = (dtSec: number): void => {
    if (!playing || !world.player.dead) return
    if (deathTimer === 0) {
      hud.setCrosshairVisible(false)
      if (document.pointerLockElement) document.exitPointerLock()
    }
    deathTimer += dtSec
    if (deathTimer < DEATH_SETTLE_SEC || !deathResolve) return
    const resolve = deathResolve
    deathResolve = null
    resolve()
  }

  const resize = (): void => {
    const width = container.clientWidth || window.innerWidth
    const height = container.clientHeight || window.innerHeight
    renderer.setSize(width, height, false)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    camera.aspect = width / Math.max(1, height)
    camera.updateProjectionMatrix()
    postfx.setSize(width, height, renderer.getPixelRatio())
  }
  window.addEventListener('resize', resize)
  resize()

  const timer = new THREE.Timer()
  timer.connect(document)
  let elapsed = 0

  renderer.setAnimationLoop((timestamp: number) => {
    timer.update(timestamp)
    const dtSec = Math.min(timer.getDelta(), LOOP.maxStepMs / 1000)
    elapsed += dtSec
    // 菜单/选装备/选地图阶段世界还没生成：跳过整帧，
    // 否则开局前每一帧都会抛一次 TypeError
    if (!world) return

    const speedRatio = stepGame(dtSec)
    syncWorldViews(dtSec, speedRatio)
    updateCamera(dtSec, speedRatio)
    updateLighting(dtSec)
    syncHud(dtSec)
    handleDeath(dtSec)

    postfx.render(renderer, scene, camera, elapsed)
  })

  // ---- 流程：加载 → 主菜单 → 选装备 → 选地图 → 生成小镇 → 游戏 → 结算 ----
  // 启动只点亮渲染器，小镇等玩家选完地图再生成：
  // 生成的世界会立刻被主循环画出来，抢在地图选择之前建等于提前泄露了还没选的图
  // 灯跟着这里的档位走（真活儿做到哪儿就亮到哪儿）：加载页本身不拖进度，
  // 它只保证这一屏总共不少于 MIN_LOADING_SEC（loadingBackdrop，默认 5 秒）
  screens.showLoading()
  screens.setLoading(0.35)
  await nextFrame()
  screens.setLoading(1)
  await nextFrame()
  await screens.hideLoading()

  /** 生成这一局的世界：要卡几百毫秒，整段藏在加载层后面 */
  const buildRound = async (loadout: Loadout): Promise<void> => {
    screens.showLoading()
    screens.setLoading(0.25)
    await nextFrame()
    startRound(loadout, currentMapId)
    screens.setLoading(0.8)
    await nextFrame()
    screens.setLoading(1)
    await nextFrame()
    await screens.hideLoading()
  }

  const playRound = async (loadout: Loadout): Promise<'retry' | 'menu'> => {
    await buildRound(loadout)
    playing = true
    paused = false
    screens.enterGame()
    sfx.resume()
    requestLock()
    await new Promise<void>((resolve) => {
      deathResolve = resolve
    })
    playing = false
    keys.clear()
    triggerHeld = false
    fireQueued = 0
    if (document.pointerLockElement) document.exitPointerLock()
    return screens.showResult({ kills: world.kills, survivedSec: world.elapsedSec })
  }

  let loadout: Loadout = DEFAULT_LOADOUT
  let action: 'retry' | 'menu' = 'menu'
  for (;;) {
    if (action === 'menu') {
      await screens.showMenu()
      loadout = await screens.pickLoadout(loadout)
      currentMapId = await screens.pickMap()
    }
    action = await playRound(loadout)
  }
}
