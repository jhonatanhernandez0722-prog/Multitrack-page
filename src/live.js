/**
 * Control en vivo PC ↔ celular: una sala por iglesia (Durable Object) con WebSocket, para sus
 * administradores y su equipo de consola. La sala solo reenvía: el PC que reproduce publica su estado
 * ("state") y los celulares mandan órdenes ("cmd", dirigidas a un PC con "to") que ejecuta ese PC con su
 * propio reloj de audio. Quien entra recibe enseguida el último estado.
 */

/** Reparte un mensaje de un dispositivo a los demás de la sala. Devuelve el último estado a recordar. */
export function relay(sockets, from, raw, last) {
  let msg
  try {
    msg = JSON.parse(raw)
  } catch {
    return last
  }
  if (!msg || typeof msg !== 'object' || (msg.type !== 'state' && msg.type !== 'cmd' && msg.type !== 'bye') || raw.length > 64 * 1024) return last
  for (const ws of sockets) {
    if (ws === from) continue
    try {
      ws.send(raw)
    } catch {
      // conexión cerrada: la sala la quita sola
    }
  }
  if (msg.type === 'state') return raw
  // Al dejar de reproducir un PC se olvida SU estado (no el de otro PC de la sala).
  if (msg.type === 'bye') {
    if (!last || !msg.device) return null
    try {
      return JSON.parse(last).state?.device === msg.device ? null : last
    } catch {
      return null
    }
  }
  return last
}

export class LiveRoom {
  constructor(state) {
    this.state = state
    /** Último estado publicado por el PC (para quien entra después). */
    this.last = null
  }

  async fetch(req) {
    if (req.headers.get('upgrade') !== 'websocket') return new Response('Se esperaba WebSocket', { status: 426 })
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.state.acceptWebSocket(server)
    if (this.last) server.send(this.last)
    return new Response(null, { status: 101, webSocket: client })
  }

  webSocketMessage(ws, raw) {
    if (typeof raw !== 'string') return
    this.last = relay(this.state.getWebSockets(), ws, raw, this.last)
  }

  webSocketClose(ws, code) {
    try {
      ws.close(code, 'cerrado')
    } catch {
      // ya cerrada
    }
  }
}
