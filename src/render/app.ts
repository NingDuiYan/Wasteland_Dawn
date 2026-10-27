/**
 * 第一人称主循环
 *
 * 职责切得很干净：sim 只认输入和 dt，渲染只读 sim 的状态。
 * 这一层除了"把两者接起来"，只做三件需要跨层信息的事：
 * 相机的呼吸/晃动（要玩家速度）、曳光弹（要命中点）、环境光（要时刻与天气）。
 */

import * as THREE from 'three'
import { GUN, LOOP, PLAYER, SKY, TOWN, VIEW, ZOMBIE } from '../config'
import { createTown } from '../sim/town'
import { World, type InputState } from '../sim/world'
import { Weather, type WeatherKind, type WeatherState } from '../sim/weather'
import { Sfx } from '../audio/sfx'
import { Hud } from '../ui/hud'
import { WEATHER_TABS, WeatherTabs } from '../ui/weatherTabs'
import { buildTown } from './buildings'
import type { PostFxParams } from './effects'
import { createGround } from './ground'
import { createSkyline } from './skyline'
import { PostFX } from './postfx'
import { SkyRig } from './sky'
import { ViewModel } from './viewmodel'
import { ZombieView } from './zombies'

const WEATHER_ORDER: readonly WeatherKind[] = WEATHER_TABS.map((tab) => tab.kind)
const TRACER_COUNT = 12

/** 曳光弹池：短命、廉价，切成预分配的十二条，不在开火时新建几何 */
class Tracers {
  private readonly meshes: THREE.Mesh[] = []
  private readonly materials: THREE.MeshBasicMaterial[] = []
  private readonly lives: number[] = []

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    for (let i = 0; i < TRACER_COUNT; i += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffe0a8,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.visible = false
      scene.add(mesh)
      this.meshes.push(mesh)
      this.materials.push(material)
      this.lives.push(0)
    }
  }

  spawn(from: THREE.Vector3, to: THREE.Vector3): void {
    let slot = this.lives.indexOf(0)
    if (slot < 0) slot = 0
    const mesh = this.meshes[slot]
    const length = from.distanceTo(to)
    mesh.position.copy(from).lerp(to, 0.5)
    mesh.scale.set(0.022, 0.022, Math.max(0.1, length))
    // 盒子的 +z 是长度方向，lookAt 让 -z 朝目标，两端对称所以不影响
    mesh.lookAt(to)
    mesh.visible = true
    this.lives[slot] = GUN.tracerSec
    this.materials[slot].opacity = 0.75
  }

  update(dtSec: number): void {
    for (let i = 0; i < this.meshes.length; i += 1) {
      if (this.lives[i] <= 0) continue
      this.lives[i] -= dtSec
      const ratio = Math.max(0, this.lives[i] / GUN.tracerSec)
      this.materials[i].opacity = ratio * 0.75
      if (this.lives[i] <= 0) this.meshes[i].visible = false
    }
  }
}

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

  const layout = createTown(TOWN.seed)
  const world = new World(layout, TOWN.seed)
  scene.add(createGround(layout, TOWN.seed))
  scene.add(createSkyline(TOWN.seed))

  const town = buildTown(layout)
  scene.add(town.group)

  const zombieView = new ZombieView(scene)
  const sky = new SkyRig(scene)
  const viewModel = new ViewModel()
  camera.add(viewModel.root)
  // 枪自带一盏很近的灯：世界光一到夜里就压到接近全黑，
  // 没有这盏灯手里的枪会变成一块看不见的黑影
  const handLight = new THREE.PointLight(0xfff0d8, 1.15, 1.6, 2)
  camera.add(handLight)

  // 最近一盏路灯用一个真实点光源：只点一盏，够照亮脚下路面，成本可接受
  const lampLight = new THREE.PointLight(0xffd6a2, 0, 24, 2)
  scene.add(lampLight)

  const postfx = new PostFX()
  const tracers = new Tracers(scene)
  const hud = new Hud()
  const sfx = new Sfx()
  const weather = new Weather('clear')

  const setWeather = (kind: WeatherKind): void => {
    weather.setKind(kind)
    tabs.setActive(kind)
    const tab = WEATHER_TABS.find((item) => item.kind === kind)
    hud.setWeather(tab ? tab.label : kind)
  }
  const tabs = new WeatherTabs(setWeather, weather.state.kind)

  const keys = new Set<string>()
  let firing = false
  let started = false
  let hurtFlash = 0
  let lastHp = world.player.hp
  let bobPhase = 0
  let fpsFrames = 0
  let fpsElapsed = 0
  let hudElapsed = 0

  const overlay = document.getElementById('start-overlay')
  const hurt = document.getElementById('hud-hurt')

  const showOverlay = (text: string): void => {
    if (!overlay) return
    overlay.textContent = text
    overlay.style.opacity = '1'
    overlay.style.pointerEvents = 'auto'
  }
  const hideOverlay = (): void => {
    if (!overlay) return
    overlay.style.opacity = '0'
    overlay.style.pointerEvents = 'none'
  }

  const requestLock = (): void => {
    if (world.player.dead) return
    void renderer.domElement.requestPointerLock()
  }

  const begin = (): void => {
    sfx.resume()
    started = true
    hideOverlay()
    requestLock()
  }

  overlay?.addEventListener('pointerdown', begin)
  renderer.domElement.addEventListener('pointerdown', () => {
    if (!started) return begin()
    if (document.pointerLockElement !== renderer.domElement) requestLock()
  })

  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === renderer.domElement
    if (locked) {
      hideOverlay()
      return
    }
    if (!started || world.player.dead) return
    showOverlay('点击继续')
  })

  document.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement !== renderer.domElement) return
    world.look(event.movementX, event.movementY, VIEW.sensitivity)
  })

  document.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return
    // 只要已经开局就允许开火：某些环境拿不到 pointer lock（内嵌 webview、无头浏览器），
    // 那时连枪都不能开就直接不能玩了；视角转动仍然需要锁定鼠标
    if (started && !world.player.dead) firing = true
  })
  document.addEventListener('mouseup', (event) => {
    if (event.button === 0) firing = false
  })

  window.addEventListener('keydown', (event) => {
    keys.add(event.code)
    if (event.code === 'KeyP') {
      const next = (WEATHER_ORDER.indexOf(weather.state.kind) + 1) % WEATHER_ORDER.length
      setWeather(WEATHER_ORDER[next])
    }
    if (event.code === 'KeyR') {
      if (world.player.dead) window.location.reload()
      else world.reload()
    }
  })
  window.addEventListener('keyup', (event) => keys.delete(event.code))
  // 切走窗口时松开所有键与扳机，否则回来会一直往前冲
  window.addEventListener('blur', () => {
    keys.clear()
    firing = false
  })

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

  const input: InputState = { forward: 0, strafe: 0, run: false }
  const muzzle = new THREE.Vector3()
  const hitPoint = new THREE.Vector3()
  const desiredLight = new THREE.Vector3()

  const timer = new THREE.Timer()
  timer.connect(document)
  let elapsed = 0

  renderer.setAnimationLoop((timestamp: number) => {
    timer.update(timestamp)
    const dtSec = Math.min(timer.getDelta(), LOOP.maxStepMs / 1000)
    elapsed += dtSec

    input.forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0)
    input.strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0)
    input.run = keys.has('ShiftLeft') || keys.has('ShiftRight')

    if (!world.player.dead) {
      world.update(dtSec, input)
      if (firing) {
        const shot = world.shoot()
        if (shot) {
          viewModel.fire()
          sfx.shoot()
          viewModel.muzzleWorld(muzzle)
          hitPoint.set(shot.x, shot.y, shot.z)
          tracers.spawn(muzzle, hitPoint)
          if (shot.kind === 'zombie') {
            hud.flashHit()
            sfx.hitFlesh()
          } else if (shot.kind === 'world') {
            sfx.hitWorld()
          }
        }
      }
    }

    zombieView.sync(world.zombies)
    viewModel.setReloading(world.player.reloadLeft)
    const speedRatio = Math.hypot(input.forward, input.strafe) > 0.1 ? 1 : 0
    viewModel.update(dtSec, speedRatio)
    tracers.update(dtSec)

    // 相机：位置 + 呼吸起伏 + 一点滚转，让"在走路"能靠画面本身读出来
    const moving = speedRatio * (input.run ? 1.25 : 1)
    bobPhase += dtSec * PLAYER.bobFreq * Math.max(0.0001, moving)
    const bob = Math.sin(bobPhase) * PLAYER.bobAmplitude * moving
    const p = world.player
    camera.position.set(p.x, PLAYER.eyeHeight + bob, p.z)
    camera.rotation.set(p.pitch, p.yaw, Math.sin(bobPhase * 0.5) * 0.008 * moving)

    weather.update(dtSec)
    const skyState = sky.update(world.hour, weather.state)
    applyWeather(postfx.params, weather.state, skyState.nightFactor)
    // 玩家自己的光圈：位置在视线稍前方，看起来像"手电照出去"而不是"身上发光"
    postfx.projectLight(postfx.params.playerLight, p.x, PLAYER.eyeHeight, p.z, camera)

    town.windowMaterial.emissiveIntensity =
      SKY.windowEmissiveDay + skyState.nightFactor * (SKY.windowEmissiveNight - SKY.windowEmissiveDay)
    town.lampMaterial.emissiveIntensity =
      SKY.windowEmissiveDay + skyState.nightFactor * (SKY.windowEmissiveNight - SKY.windowEmissiveDay)

    // 最近的一盏路灯搬到玩家附近，避免远处灯白算；强度按夜色渐亮
    let nearest: THREE.Vector3 | null = null
    let nearestDistance = SKY.lampIntensityNight > 0 ? 40 : 0
    for (const position of town.lampPositions) {
      const distance = (position.x - p.x) ** 2 + (position.z - p.z) ** 2
      if (distance < nearestDistance * nearestDistance) {
        nearestDistance = Math.sqrt(distance)
        nearest = position
      }
    }
    if (nearest) {
      desiredLight.copy(nearest)
      lampLight.position.copy(desiredLight)
      lampLight.intensity = skyState.nightFactor * SKY.lampIntensityNight
    } else {
      lampLight.intensity = 0
    }

    hud.update(dtSec)
    hudElapsed += dtSec
    if (hudElapsed >= LOOP.hudIntervalMs / 1000) {
      hudElapsed = 0
      hud.setHp(p.hp)
      hud.setAmmo(p.ammo, p.reloadLeft > 0)
      hud.setKills(world.kills)
      hud.setClock(world.hour)
      const fps = fpsElapsed > 0 ? fpsFrames / fpsElapsed : 0
      hud.setFps(fps)
      fpsFrames = 0
      fpsElapsed = 0
      // 集成显卡 + 高分辨率撑不住阴影时自动降级：宁可没有阴影，也不能掉到卡顿
      if (renderer.shadowMap.enabled && performance.now() > 6000 && fps < 45) {
        renderer.shadowMap.enabled = false
        scene.traverse((object) => {
          if (object instanceof THREE.Mesh) object.castShadow = false
        })
      }
      if (hurt) hurt.style.opacity = hurtFlash.toFixed(2)
    }
    fpsFrames += 1
    fpsElapsed += dtSec

    if (p.hp < lastHp) {
      hurtFlash = 0.85
      sfx.hurt()
    }
    lastHp = p.hp
    hurtFlash = Math.max(0, hurtFlash - dtSec * 1.6)

    if (p.dead) {
      firing = false
      hud.showStatus('你倒下了 · 击杀 ' + world.kills + ' · 按 R 重新开始', true)
      hud.setCrosshairVisible(false)
      if (document.pointerLockElement) document.exitPointerLock()
    } else {
      hud.showStatus('', false)
      hud.setCrosshairVisible(started)
    }

    postfx.render(renderer, scene, camera, elapsed)
  })

  // 天气变化时更新 HUD 文案（初始值）
  // 仅开发期：浏览器里可直接读/改世界状态，方便用 CDP 做自动化验收
  if (import.meta.env.DEV) {
    ;(window as unknown as { __world?: World }).__world = world
  }

  const initialTab = WEATHER_TABS.find((item) => item.kind === weather.state.kind)
  if (initialTab) hud.setWeather(initialTab.label)
  hud.setAmmo(world.player.ammo, false)
  hud.setKills(0)
  hud.setHp(world.player.hp)
  hud.setCrosshairVisible(false)
  showOverlay('点击开始')
  void ZOMBIE
}
