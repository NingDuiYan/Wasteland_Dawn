import { startApp } from './render/app'
import { mountMenuBackdrop } from './ui/menuBackdrop'
import { mountThemedCursor } from './ui/themedCursor'

const container = document.getElementById('game-root')
if (!container) throw new Error('缺少 #game-root 容器')

// 菜单背景与 WebGL 无关：先挂上，着色器还在编译时玩家也有画面可看
const menuScreen = document.getElementById('screen-menu')
if (!menuScreen) throw new Error('缺少 #screen-menu 容器')
mountMenuBackdrop(menuScreen)
mountThemedCursor()

void startApp(container).catch((error: unknown) => {
  console.error('启动失败', error)
  const message = document.createElement('p')
  message.className = 'fatal'
  message.textContent = '渲染器启动失败：浏览器需要支持 WebGL2（请检查显卡驱动或硬件加速设置）'
  document.body.appendChild(message)
})
