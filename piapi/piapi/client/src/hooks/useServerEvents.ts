import { useEffect, useRef, useState } from 'react'
import { API_BASE } from '../services/api'
import type { ServerEvent } from '../types'

type Handler = (event: ServerEvent) => void

/**
 * One EventSource shared by every subscriber; mounting several pages must not
 * open several streams (the server keeps one response object per connection).
 */
let source: EventSource | null = null
let refCount = 0
const handlers = new Set<Handler>()
const connectionListeners = new Set<(connected: boolean) => void>()

function notifyConnection(connected: boolean): void {
  connectionListeners.forEach((listener) => listener(connected))
}

function ensureSource(): void {
  if (source) return

  source = new EventSource(`${API_BASE}/events`)

  source.onopen = () => notifyConnection(true)

  source.onmessage = (message) => {
    try {
      const parsed = JSON.parse(message.data) as ServerEvent
      handlers.forEach((handler) => handler(parsed))
    } catch {
      /* heartbeat comments arrive as empty payloads */
    }
  }

  source.onerror = () => {
    notifyConnection(false)
    // EventSource reconnects on its own; tearing it down here would stop that.
  }
}

function releaseSource(): void {
  if (refCount > 0 || !source) return
  source.close()
  source = null
  notifyConnection(false)
}

export function useServerEvents(onEvent: Handler): { connected: boolean } {
  const [connected, setConnected] = useState(false)
  const handlerRef = useRef(onEvent)
  handlerRef.current = onEvent

  useEffect(() => {
    const stable: Handler = (event) => handlerRef.current(event)
    handlers.add(stable)
    connectionListeners.add(setConnected)
    refCount += 1
    ensureSource()

    if (source?.readyState === EventSource.OPEN) setConnected(true)

    return () => {
      handlers.delete(stable)
      connectionListeners.delete(setConnected)
      refCount -= 1
      releaseSource()
    }
  }, [])

  return { connected }
}
