/**
 * Control en vivo entre los dispositivos de una misma cuenta (p. ej. el admin con la app en el PC y en
 * el celular): una sala por cuenta (Durable Object) con WebSocket. La sala solo reenvía: el PC que
 * reproduce publica su estado ("state") y los demás mandan órdenes ("cmd") que ejecuta el PC con su
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
  if (msg.type === 'bye') return null
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
