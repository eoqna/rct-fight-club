import { defineRoom, defineServer } from '@colyseus/core'
import { Msg, ROOM_NAME, type DevLatencyEvent } from '@fight-club/shared'
import { ArenaRoom, notifyAllArenas } from './rooms/ArenaRoom.ts'

/** 개발용 지연 주입의 상한 (ms, 왕복) */
const MAX_SIMULATED_LATENCY_MS = 1000

/** 지금 주입된 왕복 지연. 서버 시작 시 COLYSEUS_LATENCY로도 줄 수 있다 */
let simulatedLatencyMs = Number(process.env.COLYSEUS_LATENCY) || 0

export const server = defineServer({
  rooms: {
    [ROOM_NAME]: defineRoom(ArenaRoom),
  },
  express: (app) => {
    app.get('/healthz', (_req, res) => {
      res.send('ok')
    })

    if (process.env.NODE_ENV !== 'production') {
      // 개발 전용: 넷코드 체감 시험용 왕복 지연 주입 (S1) — 예: POST /dev/latency?ms=150
      app.get('/dev/latency', (_req, res) => {
        res.set('Access-Control-Allow-Origin', '*')
        const event: DevLatencyEvent = { latencyMs: simulatedLatencyMs }
        res.json(event)
      })
      app.post('/dev/latency', (req, res) => {
        res.set('Access-Control-Allow-Origin', '*')
        const ms = Number(req.query.ms)
        if (!Number.isInteger(ms) || ms < 0 || ms > MAX_SIMULATED_LATENCY_MS) {
          res.status(400).json({ error: `ms는 0~${MAX_SIMULATED_LATENCY_MS} 사이 정수여야 합니다` })
          return
        }
        simulatedLatencyMs = ms
        server.simulateLatency(ms)
        // Colyseus는 수신 지연을 입장할 때 연결에 묶는다. 바뀐 값을 양방향에 적용하려면 다시 입장해야 하므로 알린다
        const event: DevLatencyEvent = { latencyMs: ms }
        notifyAllArenas(Msg.DevLatency, event)
        res.json(event)
      })
    }
  },
})
