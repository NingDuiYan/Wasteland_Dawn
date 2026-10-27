/**
 * 天空与天光
 *
 * 一天的变化全部由 hour 推出来：太阳位置、雾色、环境光、窗户与路灯的自发光。
 * 关键是把"日/夜"先算成一个 0..1 的连续量（daylight），
 * 所有色标与强度都用它插值 —— 这样黄昏不会突然跳变，也不会出现"日落了天还亮着"。
 */

import * as THREE from 'three'
import { SKY, TIME, VIEW, WORLD_EXTENT } from '../config'
import type { WeatherState } from '../sim/weather'

const SKY_VERT = `
varying vec3 vWorld;
void main() {
  vWorld = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const SKY_FRAG = `
uniform vec3 uHorizon;
uniform vec3 uZenith;
varying vec3 vWorld;
void main() {
  // 以球体局部坐标的 y 做渐变：抬头越往上看越深
  float t = clamp(normalize(vWorld).y * 0.5 + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(mix(uHorizon, uZenith, pow(t, 0.75)), 1.0);
}
`

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function mixColor(out: THREE.Color, night: number, day: number, amount: number): void {
  out.setHex(night).lerp(new THREE.Color(day), amount)
}

export interface SkyState {
  /** 0 = 深夜，1 = 正午 */
  daylight: number
  /** 1 = 深夜：窗户、路灯按它点亮 */
  nightFactor: number
  /** 0..1 的黄昏浓烈程度，用来给雾色加暖 */
  warm: number
}

export class SkyRig {
  readonly sun = new THREE.DirectionalLight(0xffffff, 1)
  readonly ambient = new THREE.HemisphereLight(0xffffff, 0x3a3226, 0.6)

  private readonly dome: THREE.Mesh
  private readonly domeMaterial: THREE.ShaderMaterial
  private readonly state: SkyState = { daylight: 1, nightFactor: 0, warm: 0 }

  constructor(private readonly scene: THREE.Scene) {
    this.sun.position.set(40, 60, 20)
    this.sun.castShadow = true
    // 一张覆盖整个小镇的阴影贴图：小镇 220 米，1024 够分出房子和树的轮廓，
    // 再高的分辨率在这个尺度上看不出差别，只会多占显存
    this.sun.shadow.mapSize.set(512, 512)
    const shadowCamera = this.sun.shadow.camera
    shadowCamera.left = -WORLD_EXTENT
    shadowCamera.right = WORLD_EXTENT
    shadowCamera.top = WORLD_EXTENT
    shadowCamera.bottom = -WORLD_EXTENT
    shadowCamera.near = 1
    shadowCamera.far = 260
    this.sun.shadow.bias = -0.0012
    this.sun.shadow.normalBias = 0.4
    this.scene.add(this.sun)
    this.scene.add(this.sun.target)
    this.scene.add(this.ambient)

    const geometry = new THREE.SphereGeometry(VIEW.far * 0.85, 20, 14)
    this.domeMaterial = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uHorizon: { value: new THREE.Color(SKY.fogDay) },
        uZenith: { value: new THREE.Color(0x33455c) },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    })
    this.dome = new THREE.Mesh(geometry, this.domeMaterial)
    this.dome.name = 'sky-dome'
    this.dome.renderOrder = -1
    this.scene.add(this.dome)

    this.scene.fog = new THREE.FogExp2(SKY.fogDay, 0.006)
    this.scene.background = new THREE.Color(SKY.fogDay)
  }

  /** 每帧推进：hour 来自 sim，weather 决定雾浓不浓 */
  update(hour: number, weather: WeatherState): SkyState {
    // 用两条平滑边把昼夜切成连续量，避免 hour 进位时突变
    const dawn = smoothstep(TIME.dawnHour - 0.8, TIME.dawnHour + 0.9, hour)
    const dusk = smoothstep(TIME.duskHour - 1.1, TIME.duskHour + 0.7, hour)
    const daylight = dawn * (1 - dusk)
    const warm = daylight * (1 - daylight) * 4

    this.state.daylight = daylight
    this.state.nightFactor = 1 - daylight
    this.state.warm = warm

    const dim = 1 - weather.darkness * 0.55

    // 天光颜色：夜 → 日，再按黄昏浓烈度往橙色拉
    const ambient = this.ambient.color
    mixColor(ambient, SKY.ambientNight, SKY.ambientDay, daylight)
    if (warm > 0) ambient.lerp(new THREE.Color(SKY.ambientDusk), warm * 0.55)

    const sunColor = this.sun.color
    mixColor(sunColor, SKY.sunNight, SKY.sunDay, daylight)
    if (warm > 0) sunColor.lerp(new THREE.Color(SKY.sunDusk), warm * 0.8)

    this.sun.intensity = (SKY.sunIntensityNight + (SKY.sunIntensityDay - SKY.sunIntensityNight) * daylight) * dim
    this.ambient.intensity =
      (SKY.ambientIntensityNight + (SKY.ambientIntensityDay - SKY.ambientIntensityNight) * daylight) * dim

    // 太阳绕东西向转：日出在 +x 贴着地平线，正午到头顶，日落沉到 -x。
    // 用 hour 而不是 daylight 推角度 —— daylight 是"亮不亮"，正午和黄昏都能是 1，
    // 拿它当角度会让太阳在最亮的时候正好趴在地平线上，整个镇子只剩环境光。
    const span = Math.max(0.001, TIME.duskHour - TIME.dawnHour)
    const arc = Math.min(Math.PI, Math.max(0, ((hour - TIME.dawnHour) / span) * Math.PI))
    const radius = 70
    this.sun.position.set(
      Math.cos(arc) * radius,
      // 太阳别真的压到地平线：贴地时所有立面几乎收不到光，镇子会变成一片灰
      Math.max(18, Math.sin(arc) * radius * 0.92 + 6),
      -26 + Math.sin(arc) * 14,
    )

    // 雾：夜里更浓（视野变窄），天气再叠一层
    const fog = this.scene.fog as THREE.FogExp2
    const fogColor = new THREE.Color(SKY.fogNight).lerp(new THREE.Color(SKY.fogDay), daylight)
    if (warm > 0) fogColor.lerp(new THREE.Color(SKY.fogDusk), warm * 0.7)
    fogColor.lerp(new THREE.Color(0x0a0f18), weather.darkness * 0.35)
    fog.color.copy(fogColor)
    fog.density = 0.0034 + (1 - daylight) * 0.0052 + weather.fogAlpha * 0.03

    if (this.scene.background instanceof THREE.Color) this.scene.background.copy(fogColor)
    ;(this.domeMaterial.uniforms.uHorizon.value as THREE.Color).copy(fogColor)
    ;(this.domeMaterial.uniforms.uZenith.value as THREE.Color)
      .copy(fogColor)
      .multiplyScalar(0.55)
      // 天顶不能只是地平线压暗：白天要有一层冷蓝，画面才有"天空"而不是"灰幕"
      .lerp(new THREE.Color(SKY.zenith), daylight * 0.62)

    // 天空球跟着相机走，否则走到世界边缘会看见"天球的内壁"
    const camera = this.scene.getObjectByName('main-camera')
    if (camera) this.dome.position.copy(camera.position)

    return this.state
  }
}
