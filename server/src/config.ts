import { JOINS_PER_MINUTE, MAX_CONNECTIONS_PER_IP } from '@fight-club/shared'

/** /admin 비밀번호 최소 길이 */
const MIN_ADMIN_PASSWORD = 12

/** 서버 설정 — 환경 변수에서 읽는다 (design §6.8). 테스트는 필드를 바꿔 쓰고 되돌린다 */
export interface ServerConfig {
  /** NODE_ENV=production */
  production: boolean
  /**
   * TRUST_PROXY: 서버 앞에 둔 리버스 프록시 수 (Caddy 한 대면 1). 이만큼만 X-Forwarded-For를 믿는다.
   * 0이면 헤더를 보지 않고 소켓 주소를 쓴다 — 클라이언트가 직접 붙는 서버에서 헤더를 믿으면 IP 제한을 피해 갈 수 있다
   */
  trustProxy: number
  /** ALLOWED_ORIGINS: 게임 서버에 들어올 수 있는 웹 페이지 출처 (쉼표로 구분). 비어 있으면 검사하지 않는다 (개발) */
  allowedOrigins: string[]
  /** ADMIN_PASSWORD: /admin 비밀번호 (사용자 이름 admin). 없으면 /admin을 열지 않는다 */
  adminPassword: string | null
  /** 같은 IP의 동시 접속 상한, 1분 동안의 입장 요청 상한 (NFR-06) */
  maxConnectionsPerIp: number
  joinsPerMinute: number
  /** 같은 컴퓨터(루프백)에서 온 접속은 IP 제한에서 뺀다 — 개발 중 탭 여러 개로 시험할 수 있게. 운영에서는 끈다 */
  exemptLoopback: boolean
  /** 받는 입장 방식 (/matchmake/:method). null이면 모두 받는다 — 테스트 도구는 joinById로 들어온다 */
  matchmakeMethods: string[] | null
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const production = env.NODE_ENV === 'production'

  const trustProxy = Number(env.TRUST_PROXY ?? 0)
  if (!Number.isInteger(trustProxy) || trustProxy < 0) {
    throw new Error(`TRUST_PROXY는 0 이상의 정수여야 합니다 (받은 값: ${env.TRUST_PROXY})`)
  }

  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  for (const origin of allowedOrigins) {
    if (!isOrigin(origin)) throw new Error(`ALLOWED_ORIGINS의 "${origin}"은 출처가 아닙니다 — https://도메인[:포트] 꼴로, 끝에 / 없이 적어 주세요`)
  }
  if (production && allowedOrigins.length === 0) {
    throw new Error('운영(NODE_ENV=production)에서는 ALLOWED_ORIGINS를 정해야 합니다 — 예: ALLOWED_ORIGINS=https://fight.example.com')
  }

  const adminPassword = env.ADMIN_PASSWORD || null
  if (adminPassword !== null && adminPassword.length < MIN_ADMIN_PASSWORD) {
    throw new Error(`ADMIN_PASSWORD는 ${MIN_ADMIN_PASSWORD}자 이상이어야 합니다`)
  }

  return {
    production,
    trustProxy,
    allowedOrigins,
    adminPassword,
    maxConnectionsPerIp: MAX_CONNECTIONS_PER_IP,
    joinsPerMinute: JOINS_PER_MINUTE,
    exemptLoopback: !production,
    // 운영에서는 클라이언트가 쓰는 방식만 — create로 빈 경기장(봇 3명과 60Hz 루프)을 마구 만들지 못하게
    matchmakeMethods: production ? ['joinOrCreate'] : null,
  }
}

function isOrigin(value: string): boolean {
  try {
    return new URL(value).origin === value
  } catch {
    return false
  }
}

export const config: ServerConfig = loadConfig()
