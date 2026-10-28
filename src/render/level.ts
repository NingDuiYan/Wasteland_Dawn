import * as THREE from 'three'
import type { MapDef } from '../maps'
import { createTown, type TownLayout } from '../sim/town'
import { buildTown } from './buildings'
import { createGround } from './ground'
import { createSkyline } from './skyline'

/** 建筑生成器返回的一堆可调材质与灯位，跟着 Level 一起活 */
export type TownRefs = ReturnType<typeof buildTown>

/** 递归释放几何、材质与贴图：换地图时旧场景必须整棵清掉，否则显存只涨不落 */
function disposeTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.geometry.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      material.map?.dispose()
      material.normalMap?.dispose()
      material.dispose()
    }
  })
}

/**
 * 一张地图的全部静态场景：地面、远景剪影、建筑与道具。
 *
 * 和 World 分开的原因：地形只跟地图有关，一局结束重开时没必要重新生成 500 行布局，
 * 但换地图时它又必须整体换掉 —— 两者的生命周期不一样。
 */
export class Level {
  readonly group = new THREE.Group()
  readonly layout: TownLayout
  readonly town: TownRefs

  constructor(map: MapDef) {
    this.group.name = 'level-' + map.id
    this.layout = createTown(map.seed)
    this.town = buildTown(this.layout)
    this.group.add(createGround(this.layout, map.seed))
    this.group.add(createSkyline(map.seed))
    this.group.add(this.town.group)
  }

  get lampPositions(): THREE.Vector3[] {
    return this.town.lampPositions
  }

  dispose(): void {
    this.group.removeFromParent()
    disposeTree(this.group)
    this.group.clear()
  }
}
