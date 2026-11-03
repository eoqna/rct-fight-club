/** 품질 단계 — design §7.8 */
export interface QualityTier {
  name: 'pc' | 'mobile'
  /** 해상도 배율 범위. 프레임이 떨어지면 maxDpr에서 minDpr까지 내려간다 */
  maxDpr: number
  minDpr: number
  antialias: boolean
  /** 내 캐릭터의 실시간 그림자 (끄면 모두 원형 그림자) */
  shadows: boolean
  /** 입자 수 배율 */
  particles: number
}

export const PC: QualityTier = { name: 'pc', maxDpr: 2, minDpr: 1, antialias: true, shadows: true, particles: 1 }
export const MOBILE: QualityTier = { name: 'mobile', maxDpr: 1.5, minDpr: 1, antialias: false, shadows: false, particles: 0.5 }

/**
 * 터치가 주 입력인 기기는 모바일 단계. 주소에 ?quality=mobile|pc를 붙이면 강제로 고른다 (확인·측정용).
 * 화면의 기기 배율보다 높게 그릴 필요는 없으므로 최대 배율은 devicePixelRatio를 넘지 않는다
 */
export function detectQuality(): QualityTier {
  const forced = new URLSearchParams(location.search).get('quality')
  const coarse = matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0
  const tier = forced === 'mobile' ? MOBILE : forced === 'pc' ? PC : coarse ? MOBILE : PC
  const maxDpr = Math.max(tier.minDpr, Math.min(tier.maxDpr, window.devicePixelRatio || 1))
  return { ...tier, maxDpr }
}

/** 성능 모니터가 1초마다 채우는 값 — 디버그 패널이 보여준다 (실기기 성능 측정 P3-8) */
export const renderStats = { tier: 'pc' as QualityTier['name'], dpr: 1, fps: 0 }

/** 이 브라우저가 WebGL2로 3D를 그릴 수 있는지 (NFR-08) */
export function hasWebGL2(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null
  } catch {
    return false
  }
}
