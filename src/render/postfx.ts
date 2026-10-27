/**
 * 第一人称的全屏后处理
 *
 * three 自带 EffectComposer，但那是 addons（额外一条依赖 + 一堆 pass 类），
 * 而这里只需要"渲染到 RT → 全屏 quad 过一遍片元"这一步。
 *
 * 色彩空间是这里唯一的坑：
 * three 往 RenderTarget 渲染时输出的是**线性**值（working color space），
 * 而效果体里的阈值、增益都是按 sRGB 显示空间调的。
 * 所以采样后先做一次 gamma 编码再进效果体，最后原样输出——
 * ShaderMaterial 不像内置材质那样会自动做 colorspace 转换。
 */

import * as THREE from 'three'
import { LIGHTING, POSTFX } from '../config'
import {
  POSTFX_APPLY,
  POSTFX_FUNCS,
  POSTFX_UNIFORMS,
  type LightSource,
  type PostFxParams,
} from './effects'

const VERT = `
varying vec2 vUv;

void main() {
  vUv = uv;
  // 顶点直接给裁剪空间坐标，不需要任何矩阵
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const FRAG = `
uniform sampler2D tDiffuse;

varying vec2 vUv;

${POSTFX_UNIFORMS}
${POSTFX_FUNCS}
${POSTFX_APPLY}

void main() {
  vec2 uv = refractUv(vUv);
  vec3 linear = texture2D(tDiffuse, uv).rgb;
  // 线性 → 显示空间：效果体里的阈值、增益都是按显示空间调的
  vec3 color = pow(max(linear, vec3(0.0)), vec3(1.0 / 2.2));
  gl_FragColor = vec4(applyPostFx(uv, color), 1.0);
}
`

export class PostFX {
  readonly params: PostFxParams = {
    saturation: POSTFX.saturation,
    vignette: POSTFX.vignette,
    grain: POSTFX.grain,
    wet: POSTFX.wet,
    rain: POSTFX.rain,
    darkness: POSTFX.darkness,
    flash: POSTFX.flash,
    tint: { ...POSTFX.tint },
    playerLight: { u: 0.5, v: 0.55, ...LIGHTING.playerLight },
    campLight: { u: 0.5, v: 0.5, ...LIGHTING.campLight },
  }

  private readonly target: THREE.WebGLRenderTarget
  private readonly quadScene = new THREE.Scene()
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly material: THREE.ShaderMaterial
  private readonly uniforms: Record<string, THREE.IUniform>
  private readonly projected = new THREE.Vector3()

  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      // 渲染目标里装的是线性值，标成 sRGB 会让采样二次解码、整体发暗
      colorSpace: THREE.LinearSRGBColorSpace,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    })

    this.uniforms = {
      tDiffuse: { value: this.target.texture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uSaturation: { value: 1 },
      uContrast: { value: POSTFX.contrast },
      uVignette: { value: POSTFX.vignette },
      uGrain: { value: POSTFX.grain },
      uWet: { value: POSTFX.wet },
      uRain: { value: POSTFX.rain },
      uDarkness: { value: POSTFX.darkness },
      uFlash: { value: POSTFX.flash },
      uTint: { value: new THREE.Vector3(1, 1, 1) },
      uNightColor: {
        value: new THREE.Vector3(POSTFX.nightColor.r, POSTFX.nightColor.g, POSTFX.nightColor.b),
      },
      uLightColor: {
        value: new THREE.Vector3(POSTFX.lightColor.r, POSTFX.lightColor.g, POSTFX.lightColor.b),
      },
      uLightGain: { value: POSTFX.lightGain },
      uLightA: { value: new THREE.Vector4(0, 0, 1, 0) },
      uLightB: { value: new THREE.Vector4(0, 0, 1, 0) },
    }

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
    })

    this.quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material))
  }

  /**
   * @param width 画布 CSS 尺寸
   * @param pixelRatio 必须带上：颗粒与雨幕的格子按绘制缓冲像素算，少乘一次就全变粗
   */
  setSize(width: number, height: number, pixelRatio: number): void {
    const bufferWidth = Math.max(1, Math.floor(width * pixelRatio))
    const bufferHeight = Math.max(1, Math.floor(height * pixelRatio))
    this.target.setSize(bufferWidth, bufferHeight)
    ;(this.uniforms.uResolution.value as THREE.Vector2).set(bufferWidth, bufferHeight)
  }

  /**
   * 把世界坐标的光源换算成屏幕 uv
   * 直接拿相机投影，比手算俯角三角函数可靠：换 FOV、转头、换镜头都不用跟着改
   */
  projectLight(light: LightSource, x: number, y: number, z: number, camera: THREE.Camera): void {
    this.projected.set(x, y, z).project(camera)
    // 相机背后的点投影会翻转，直接判掉，避免光斑"从屏幕另一侧穿出来"
    if (this.projected.z > 1) {
      light.strength = 0
      return
    }
    light.u = this.projected.x * 0.5 + 0.5
    // NDC 的 y 与纹理 v 轴同为"上为正"，所以不需要翻转
    light.v = this.projected.y * 0.5 + 0.5
  }

  /** 渲染一帧：先画进 RT，再用全屏 quad 输出到画布 */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, timeSec: number): void {
    this.uniforms.uTime.value = timeSec
    this.uniforms.uSaturation.value = this.params.saturation
    this.uniforms.uVignette.value = this.params.vignette
    this.uniforms.uGrain.value = this.params.grain
    this.uniforms.uWet.value = this.params.wet
    this.uniforms.uRain.value = this.params.rain
    this.uniforms.uDarkness.value = this.params.darkness
    this.uniforms.uFlash.value = this.params.flash
    ;(this.uniforms.uTint.value as THREE.Vector3).set(
      this.params.tint.r,
      this.params.tint.g,
      this.params.tint.b,
    )

    this.applyLight(this.uniforms.uLightA.value as THREE.Vector4, this.params.playerLight, renderer)
    this.applyLight(this.uniforms.uLightB.value as THREE.Vector4, this.params.campLight, renderer)

    renderer.setRenderTarget(this.target)
    renderer.clear()
    renderer.render(scene, camera)

    renderer.setRenderTarget(null)
    renderer.render(this.quadScene, this.quadCamera)
  }

  /** uv → 绘制缓冲像素，半径按短边换算，保证换分辨率后光圈大小一致 */
  private applyLight(out: THREE.Vector4, light: LightSource, renderer: THREE.WebGLRenderer): void {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2())
    const radiusPx = light.radius * Math.min(size.x, size.y)
    out.set(light.u * size.x, light.v * size.y, radiusPx, light.strength)
  }
}
