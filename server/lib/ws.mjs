// WebSocket 中心：任务进度与日志的实时推送。
import { WebSocketServer } from 'ws'

const clients = new Set()

export function attachWs(server, pathCandidates) {
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    let pathname = ''
    try {
      pathname = new URL(req.url, 'http://x').pathname
    } catch {
      socket.destroy()
      return
    }
    if (pathCandidates.includes(pathname)) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        clients.add(ws)
        ws.on('close', () => clients.delete(ws))
        ws.on('error', () => clients.delete(ws))
        ws.send(JSON.stringify({ type: 'hello', ts: Date.now() }))
      })
    } else {
      socket.destroy()
    }
  })
  return wss
}

export function broadcast(obj) {
  const data = JSON.stringify(obj)
  for (const ws of clients) {
    if (ws.readyState === 1) {
      ws.send(data, (err) => {
        if (err) clients.delete(ws)
      })
    }
  }
}
