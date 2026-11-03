import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three'

/** 매번 같은 무늬가 나오는 난수 (선형 합동) */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function canvas2d(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D 캔버스를 만들 수 없습니다')
  return [canvas, ctx]
}

function texture(canvas: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(canvas)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 4
  return t
}

/**
 * 경기장 바닥: 2m 돌 타일 tiles×tiles장, 타일마다 조금씩 다른 색과 잔무늬, 어두운 줄눈.
 * 다운로드 없이 그때그때 그린다 (에셋 예산 §7.7에 들지 않는다)
 */
export function createStoneTexture(tiles: number): CanvasTexture {
  const px = 1024
  const cell = px / tiles
  const [canvas, ctx] = canvas2d(px, px)
  const rand = seededRandom(7)
  ctx.fillStyle = '#6f6253'
  ctx.fillRect(0, 0, px, px)
  for (let i = 0; i < tiles; i++) {
    for (let j = 0; j < tiles; j++) {
      const x = i * cell + 3, y = j * cell + 3, size = cell - 6
      const light = 57 + Math.round((rand() - 0.5) * 6)
      ctx.fillStyle = `hsl(34 17% ${light}%)`
      ctx.beginPath()
      ctx.roundRect(x, y, size, size, 6)
      ctx.fill()
      // 위·왼쪽은 밝게, 아래·오른쪽은 어둡게 — 살짝 도드라진 돌
      ctx.fillStyle = 'rgb(255 255 255 / 0.10)'
      ctx.fillRect(x + 4, y + 2, size - 8, 3)
      ctx.fillStyle = 'rgb(0 0 0 / 0.10)'
      ctx.fillRect(x + 4, y + size - 5, size - 8, 3)
      for (let k = 0; k < 18; k++) {
        ctx.fillStyle = `rgb(${rand() < 0.5 ? '0 0 0' : '255 255 255'} / ${0.02 + rand() * 0.03})`
        const r = 1.5 + rand() * 3
        ctx.beginPath()
        ctx.arc(x + 6 + rand() * (size - 12), y + 6 + rand() * (size - 12), r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  return texture(canvas)
}

/** 가장자리 띠: 노랑·검정 사선 줄무늬 (길이 방향으로 반복) — 낭떠러지 경계가 한눈에 보이게 (FR-15) */
export function createHazardTexture(): CanvasTexture {
  const [canvas, ctx] = canvas2d(128, 32)
  ctx.fillStyle = '#ffcf3a'
  ctx.fillRect(0, 0, 128, 32)
  ctx.fillStyle = '#2a2622'
  for (let x = -32; x < 128; x += 32) {
    ctx.beginPath()
    ctx.moveTo(x, 32)
    ctx.lineTo(x + 14, 32)
    ctx.lineTo(x + 46, 0)
    ctx.lineTo(x + 32, 0)
    ctx.fill()
  }
  const t = texture(canvas)
  t.wrapS = RepeatWrapping
  return t
}

/** 구름 한 덩이: 겹친 흰 원들의 부드러운 가장자리 */
export function createCloudTexture(): CanvasTexture {
  const [canvas, ctx] = canvas2d(256, 128)
  const rand = seededRandom(11)
  for (let i = 0; i < 9; i++) {
    const x = 50 + rand() * 156, y = 50 + rand() * 30, r = 26 + rand() * 30
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, 'rgb(255 255 255 / 0.9)')
    g.addColorStop(0.6, 'rgb(255 255 255 / 0.5)')
    g.addColorStop(1, 'rgb(255 255 255 / 0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 256, 128)
  }
  return texture(canvas)
}
