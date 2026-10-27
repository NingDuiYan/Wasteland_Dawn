import { startApp } from './render/app'

const container = document.getElementById('game-root')
if (!container) throw new Error('缺少 #game-root 容器')

void startApp(container).catch((error: unknown) => {
  console.error('启动失败', error)
  const message = document.createElement('p')
  message.className = 'fatal'
  message.textContent = '渲染器启动失败：浏览器需要支持 WebGL2（请检查显卡驱动或硬件加速设置）'
  document.body.appendChild(message)
})
