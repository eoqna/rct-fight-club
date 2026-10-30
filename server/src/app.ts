import { defineRoom, defineServer } from '@colyseus/core'
import { ROOM_NAME } from '@fight-club/shared'
import { ArenaRoom } from './rooms/ArenaRoom.ts'

export const server = defineServer({
  rooms: {
    [ROOM_NAME]: defineRoom(ArenaRoom),
  },
  express: (app) => {
    app.get('/healthz', (_req, res) => {
      res.send('ok')
    })
  },
})
