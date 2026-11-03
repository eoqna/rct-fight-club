import { CloseCode, JoinRejectStatus, MAX_CONNECTIONS_PER_IP } from '@fight-club/shared/protocol'
import { describe, expect, it } from 'vitest'
import { joinFailureText } from './texts.ts'

describe('입장 실패 안내 (P6-1)', () => {
  it('서버가 거절한 이유마다 무엇을 하면 되는지 알려 준다', () => {
    expect(joinFailureText(CloseCode.TooManyConnections, '')).toContain(`동시에 ${MAX_CONNECTIONS_PER_IP}명까지만`)
    expect(joinFailureText(JoinRejectStatus.TooManyRequests, '')).toContain('1분쯤 뒤')
    expect(joinFailureText(JoinRejectStatus.Forbidden, '')).toContain('들어갈 수 없습니다')
    // 모르는 오류는 일반 안내에 내용을 덧붙인다
    expect(joinFailureText(undefined, 'ECONNREFUSED')).toBe('경기장에 들어가지 못했습니다. 잠시 뒤 다시 시도해 주세요. (ECONNREFUSED)')
  })
})
