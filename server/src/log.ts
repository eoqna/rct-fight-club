import { pino } from 'pino'

/** 로그가 나가는 곳 — 기본은 표준 출력. 테스트는 write를 바꿔 끼워 내용을 확인한다 */
export const logSink = {
  write(line: string) {
    process.stdout.write(line)
  },
}

/**
 * 서버 로그 (pino, 한 줄에 JSON 하나) — design §8.3. LOG_LEVEL로 수준을 정한다 (테스트 중에는 기본으로 끔).
 * IP는 남기지 않는다 (NFR-10): 로그에 넘기지 않고, 혹시 섞여 들어와도 아래 이름의 필드는 지운다
 */
export const log = pino(
  {
    level: process.env.LOG_LEVEL ?? (process.env.VITEST ? 'silent' : 'info'),
    base: { pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ['ip', '*.ip', 'remoteAddress', '*.remoteAddress', 'headers', '*.headers', 'clientKey', '*.clientKey'],
      censor: '[지움]',
    },
  },
  logSink,
)
