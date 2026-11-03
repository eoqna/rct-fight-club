import { listen } from '@colyseus/tools'
import { DEFAULT_PORT } from '@fight-club/shared'
import { server } from './app.ts'
import { startMetricsLog } from './ops/metrics.ts'
import { listArenas } from './rooms/ArenaRoom.ts'

await listen(server, Number(process.env.PORT) || DEFAULT_PORT)
// 1분마다 접속자·경기장·틱 처리 시간·패치 크기를 로그로 남긴다 (P6-3)
startMetricsLog(listArenas)
