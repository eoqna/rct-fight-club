import { config } from '../config.ts'
import { MemoryArenaNumbers, type ArenaNumbers } from './arenaNumbers.ts'
import { MemoryIpLimits, type IpLimits } from './limits.ts'

/**
 * 경기장끼리, 나중에는 서버 프로세스끼리 나눠야 하는 상태가 사는 곳 (P6-4).
 * 지금은 프로세스가 하나라 메모리 구현이다. 프로세스를 늘릴 때(design §8.2 2단계) 여기서만 Redis 구현으로 바꾸면 된다
 */
export const store: { arenaNumbers: ArenaNumbers; limits: IpLimits } = {
  arenaNumbers: new MemoryArenaNumbers(),
  limits: new MemoryIpLimits(config),
}
