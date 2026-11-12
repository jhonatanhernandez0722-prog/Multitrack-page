/**
 * Modo ensayo múltiple: UNA sala para todo el equipo (Durable Object con WebSocket).
 *
 *  - El PC del administrador es la única fuente: publica el servicio ("service": canciones con su letra,
 *    acordes y secciones) cuando cambia, y unas 4 veces por segundo el estado del reproductor ("tick":
 *    canción, reproducción, posición, salto pendiente…). Con "end" termina el ensayo.
 *  - Los demás integrantes (cualquier cuenta autorizada) solo reciben: lo que manden se ignora.
 *  - Quien entra o se reconecta recibe enseguida el último servicio y el último estado.
 *  - El servicio se guarda (sobrevive a que la sala se duerma). Si el PC del admin calla 20 minutos (se
 *    apagó sin terminar), el ensayo se olvida: nadie queda atrapado en un ensayo viejo. Si el PC vuelve,
 *    publica otra vez el servicio y todos lo siguen de nuevo.
 * El rol (admin o integrante) lo pone el Worker, que comprobó la cuenta con Neon; no lo elige el cliente.
 */
export const REHEARSAL_TTL_MS = 20 * 60 * 1000
/** Cada cuánto se anota (en el almacenamiento) que el admin sigue activo. */
const SEEN_EVERY_MS = 60 * 1000
const MAX_SERVICE = 512 * 1024
const MAX_TICK = 16 * 1024

/**
 * Qué hacer con un mensaje: { broadcast, memory } (memory = { service, serviceAt, tick }).
 * Solo el admin publica; un integrante no puede cambiar ni terminar el ensayo.
 */
export function rehearsalMessage(role, raw, memory, now = Date.now()) {
  const keep = { broadcast: false, memory }
  if (role !== 'admin' || typeof raw !== 'string') return keep
  let msg
  try {
    msg = JSON.parse(raw)
  } catch {
    return keep
  }
  if (!msg || typeof msg !== 'object') return keep
  if (msg.type === 'service') {
    if (raw.length > MAX_SERVICE || !msg.service || typeof msg.service !== 'object') return keep
    return { broadcast: true, memory: { ...memory, service: raw, serviceAt: now } }
  }
  if (msg.type === 'tick') {
    if (raw.length > MAX_TICK) return keep
    return { broadcast: true, memory: { ...memory, tick: raw, serviceAt: memory.service ? now : memory.serviceAt } }
  }
  if (msg.type === 'end') return { broadcast: true, memory: { service: null, serviceAt: 0, tick: null } }
  return keep
}

export class RehearsalRoom {
  constructor(state) {
    this.state = state
    this.memory = null
    this.savedAt = 0
  }

  async load() {
    if (this.memory) return this.memory
    const saved = (await this.state.storage.get('service')) ?? null
    this.memory = { service: saved?.raw ?? null, serviceAt: saved?.at ?? 0, tick: null }
    return this.memory
  }

  /** Lo último (servicio y estado) para quien entra; un ensayo viejo se olvida. */
  async replay(ws) {
    const m = await this.load()
    if (m.service && Date.now() - m.serviceAt > REHEARSAL_TTL_MS) {
      this.memory = { service: null, serviceAt: 0, tick: null }
      await this.state.storage.delete('service')
      return
    }
    try {
      if (m.service) ws.send(m.service)
      if (m.service && m.tick) ws.send(m.tick)
    } catch {
      // se cerró mientras entraba
    }
  }

  /** Cuántos dispositivos siguen el ensayo (para el admin). `leaving`: la conexión que se está cerrando. */
  announce(leaving) {
    const all = this.state.getWebSockets().filter((ws) => ws !== leaving)
    const msg = JSON.stringify({ type: 'room', devices: Math.max(0, all.length - 1) })
    for (const ws of all) {
      if (this.state.getTags(ws).includes('admin')) {
        try {
          ws.send(msg)
        } catch {
          // cerrada
        }
      }
    }
  }

  async fetch(req) {
    if (req.headers.get('upgrade') !== 'websocket') return new Response('Se esperaba WebSocket', { status: 426 })
    const role = req.headers.get('x-gosen-role') === 'admin' ? 'admin' : 'member'
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.state.acceptWebSocket(server, [role])
    await this.replay(server)
    this.announce()
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string') return
    if (raw === '{"type":"hello"}') return this.replay(ws)
    const before = await this.load()
    const role = this.state.getTags(ws).includes('admin') ? 'admin' : 'member'
    const { broadcast, memory } = rehearsalMessage(role, raw, before)
    this.memory = memory
    // Se guarda el servicio cuando cambia y, mientras el admin sigue activo, cada minuto la hora.
    if (memory.service !== before.service || (memory.service && memory.serviceAt - this.savedAt > SEEN_EVERY_MS)) {
      if (memory.service) await this.state.storage.put('service', { raw: memory.service, at: memory.serviceAt })
      else await this.state.storage.delete('service')
      this.savedAt = memory.serviceAt
    }
    if (!broadcast) return
    for (const other of this.state.getWebSockets()) {
      if (other === ws) continue
      try {
        other.send(raw)
      } catch {
        // conexión cerrada: la sala la quita sola
      }
    }
  }

  webSocketClose(ws, code) {
    try {
      ws.close(code, 'cerrado')
    } catch {
      // ya cerrada
    }
    this.announce(ws)
  }
}
