/**
 * 경기장 번호 (#1, #2 …) — 쓰고 있지 않은 가장 작은 번호를 준다 (design §6.1).
 * 서버 프로세스가 여럿이 되면 모든 프로세스가 같은 번호표를 봐야 하므로 Redis 구현으로 바꾼다 (design §8.2)
 */
export interface ArenaNumbers {
  claim(): Promise<number>
  release(arenaNo: number): Promise<void>
}

/** 이 프로세스의 메모리에 두는 구현 */
export class MemoryArenaNumbers implements ArenaNumbers {
  private readonly used = new Set<number>()

  async claim(): Promise<number> {
    let arenaNo = 1
    while (this.used.has(arenaNo)) arenaNo++
    this.used.add(arenaNo)
    return arenaNo
  }

  async release(arenaNo: number): Promise<void> {
    this.used.delete(arenaNo)
  }
}
