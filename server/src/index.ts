import { listen } from '@colyseus/tools'
import { DEFAULT_PORT } from '@fight-club/shared'
import { server } from './app.ts'

await listen(server, Number(process.env.PORT) || DEFAULT_PORT)
