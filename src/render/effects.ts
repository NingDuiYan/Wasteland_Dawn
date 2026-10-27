/**
 * 全屏后处理的片元效果体（纯 GLSL 字符串 + 纯 TS 类型）
 *
 * "雨幕折射 / 光照遮罩 / 调色 / 闪电 / 颗粒 / S 曲线 / 暗角"这套画法集中在一处：
 * 调色时只改这个文件，第一人称与将来任何新视角都不会跑偏。
 * 这里刻意不 import three —— 效果体是纯字符串，谁引用都不会拖进渲染器。
 *
 * 约定：片元体统一读 `uv`（0..1 屏幕坐标）与 `color`（已采样到的颜色），返回新颜色。
 * 采样本身留在各自的 main 里 —— 两边的采样语句不一样（texture2D vs sampler2D 同名也一样，
 * 但 uniform 名字与 varying 名字不同），共用一份就得塞宏，反而更难读。
 */

/** 效果用到的 uniform（uMainSampler / tDiffuse 各自在 main 里声明） */
export const POSTFX_UNIFORMS = `
uniform vec2 uResolution;
uniform float uTime;
uniform float uSaturation;
uniform float uContrast;
uniform float uVignette;
uniform float uGrain;
uniform float uWet;
uniform float uRain;
uniform float uDarkness;
uniform float uFlash;
uniform vec3 uTint;
uniform vec3 uNightColor;
uniform vec3 uLightColor;
uniform float uLightGain;
// x,y = 屏幕像素坐标；z = 半径像素；w = 强度
uniform vec4 uLightA;
uniform vec4 uLightB;
`

export const POSTFX_FUNCS = `
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

/**
 * 一层雨线：把屏幕切成竖列格，每格随机决定"这一格下不下雨"，
 * 纵向按时间滚动形成下落。三层不同密度与速度叠出前后景。
 */
float rainLayer(vec2 uv, float density, float speed, float slant, vec2 cells) {
  vec2 p = vec2(uv.x + uv.y * slant, uv.y + uTime * speed);
  vec2 g = p * cells;
  vec2 cell = floor(g);
  vec2 f = fract(g);
  float rnd = hash(cell * 0.37 + 11.0);
  float on = step(1.0 - density, rnd);
  float horizontal = smoothstep(0.14, 0.0, abs(f.x - 0.5));
  float vertical = smoothstep(0.0, 0.22, f.y) * smoothstep(1.0, 0.74, f.y);
  return horizontal * vertical * on;
}

/** 一个圆形光斑：中心最亮，边缘平滑衰减到 0 */
float lightMask(vec4 light, vec2 px) {
  float d = distance(px, light.xy);
  return smoothstep(light.z, light.z * 0.15, d) * light.w;
}

/** 雨幕折射：按屏幕格滚动取噪声，轻微扰动采样坐标，画面就像隔着一层流动的水 */
vec2 refractUv(vec2 uv) {
  vec2 cell = floor(uv * uResolution * 0.5);
  float rainNoise = hash(cell + floor(uTime * 24.0)) - 0.5;
  return vec2(uv.x + rainNoise * 0.0016 * uWet, uv.y + rainNoise * 0.0006 * uWet);
}
`

export const POSTFX_APPLY = `
vec3 applyPostFx(vec2 uv, vec3 color) {
  // 调色：饱和度与色偏先做，后续叠加才有统一的底子
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(vec3(luma), color, uSaturation) * uTint;

  // 光照：暗部混向夜色，光斑内保留原色并加一点暖
  vec2 px = uv * uResolution;
  float mask = clamp(lightMask(uLightA, px) + lightMask(uLightB, px), 0.0, 1.0);
  color = mix(color, uNightColor, uDarkness * (1.0 - mask * 0.88));
  // 光斑的暖色增益必须跟着暗度走：晴天 uDarkness 是 0，这时再叠暖光
  // 会在角色周围凭空出现一圈不存在的光晕
  color += uLightColor * mask * uLightGain * clamp(uDarkness * 3.0, 0.0, 1.0);

  // 雨线：三层不同密度/速度，越靠前越快越亮
  // 增益必须压住：雨线是"细而暗"的存在，太亮会变成满屏划痕，抢走角色的注意力
  float rain = rainLayer(uv, 0.13 * uRain, 0.55, 0.10, vec2(150.0, 17.0))
             + 0.7 * rainLayer(uv, 0.10 * uRain, 0.95, 0.14, vec2(96.0, 12.0))
             + 0.45 * rainLayer(uv, 0.08 * uRain, 1.5, 0.18, vec2(56.0, 8.0));
  color += vec3(0.72, 0.80, 0.96) * rain * uRain * 0.26;

  // 闪电：暗部提亮多于高光，模拟曝光瞬间被拉高
  // 0.6 的系数很关键：满强度叠加会把画面直接刷白，闪电应该是"一瞬照亮"而不是过曝
  color += vec3(0.86, 0.92, 1.0) * uFlash * (0.4 + 0.6 * (1.0 - luma)) * 0.6;

  // 颗粒：手绘/胶片的脏感来源，纯色大块没有它就会显得"数码"
  color += (hash(uv * uResolution + uTime * 60.0) - 0.5) * uGrain;

  // S 形曲线：按 uContrast 混合 smoothstep 后的结果。
  // 只提饱和调不出"厚"的感觉——暗部沉下去、亮部顶上来，画面才有体积。
  color = mix(color, color * color * (3.0 - 2.0 * color), clamp(uContrast, 0.0, 1.0));

  // 暗角：把视线收回画面中心
  vec2 d = uv - 0.5;
  color *= clamp(1.0 - dot(d, d) * uVignette * 2.0, 0.0, 1.0);

  return color;
}
`

/**
 * 一个光源：屏幕 uv（0..1）+ 半径（屏幕短边的比例）+ 强度
 * 为什么由渲染层换算：后处理管线拿不到相机，世界位置只有场景知道
 */
export interface LightSource {
  u: number
  v: number
  radius: number
  strength: number
}

/** 运行时可由天气系统改写的后处理参数 */
export interface PostFxParams {
  saturation: number
  vignette: number
  grain: number
  wet: number
  rain: number
  darkness: number
  flash: number
  tint: { r: number; g: number; b: number }
  /** 玩家光：跟着人走的暖光，让画面始终有个视觉锚点 */
  playerLight: LightSource
  /** 营地光：常亮，暗示"家里有火" */
  campLight: LightSource
}