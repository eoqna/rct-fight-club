import { Color, Vector4, type MeshStandardMaterial } from 'three'
import type { CharacterModel } from '../game/characters.ts'

/** 색상 변형이 바꾸는 아틀라스 사각형 최대 개수 */
const MAX_RECTS = 8
const DEG = Math.PI / 180

const HEADER = /* glsl */ `
uniform vec4 fcRects[${MAX_RECTS}];
uniform int fcRectModes[${MAX_RECTS}];
uniform float fcRectHues[${MAX_RECTS}];
uniform vec3 fcRectTints[${MAX_RECTS}];
uniform int fcRectCount;
vec3 fcHueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735026919);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
`

/** 텍스처 색을 읽은 직후, 처음 맞는 사각형(옷 부위)의 방식대로 색을 돌리거나(1) 곱한다(2) */
const VARIANT_FRAGMENT = /* glsl */ `
#include <map_fragment>
#ifdef USE_MAP
for (int i = 0; i < ${MAX_RECTS}; i++) {
  if (i >= fcRectCount) break;
  vec4 r = fcRects[i];
  if (vMapUv.x >= r.x && vMapUv.x < r.z && vMapUv.y >= r.y && vMapUv.y < r.w) {
    diffuseColor.rgb = fcRectModes[i] == 1 ? max(fcHueRotate(diffuseColor.rgb, fcRectHues[i]), 0.0) : diffuseColor.rgb * fcRectTints[i];
    break;
  }
}
#endif
`

type Region = CharacterModel['variants'][number]

/**
 * 플레이어 한 명이 쓸 머티리얼 — 원본을 복제해(깜빡임·번쩍임을 따로 주려고) 색상 변형을 입힌다 (FR-08).
 * 아틀라스 머티리얼은 셰이더로 옷 부위만 바꾸고, 단색 덧붙임은 이름이 변형 목록에 있으면 색을 바꾼다. 변형 0은 원래 색
 */
export function cloneCharacterMaterial(source: MeshStandardMaterial, model: CharacterModel, variant: number): MeshStandardMaterial {
  const material = source.clone()
  const regions: readonly Region[] = variant > 0 ? model.variants : []
  if (material.map) {
    const rects: { rect: readonly number[]; region: Region }[] = regions.flatMap((region) => region.rects.map((rect) => ({ rect, region })))
    const slots = Array.from({ length: MAX_RECTS }, (_, i) => rects[i])
    const uniforms = {
      fcRects: { value: slots.map((s) => (s ? new Vector4(s.rect[0], s.rect[1], s.rect[2], s.rect[3]) : new Vector4())) },
      fcRectModes: { value: slots.map((s) => (s?.region.mode === 'hue' ? 1 : 2)) },
      fcRectHues: { value: slots.map((s) => (s?.region.mode === 'hue' ? s.region.values[variant - 1] * DEG : 0)) },
      fcRectTints: { value: slots.map((s) => new Color(s?.region.mode === 'tint' ? s.region.values[variant - 1] : '#ffffff')) },
      fcRectCount: { value: Math.min(MAX_RECTS, rects.length) },
    }
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${HEADER}`)
        .replace('#include <map_fragment>', VARIANT_FRAGMENT)
    }
    // 모든 캐릭터·변형이 같은 셰이더를 쓴다 (값은 uniform으로)
    material.customProgramCacheKey = () => 'fc-character'
  } else {
    const region = regions.find((r) => (r.parts as readonly string[]).includes(material.name))
    if (region?.mode === 'hue') hueRotate(material.color, region.values[variant - 1] * DEG)
    else if (region?.mode === 'tint') material.color.multiply(new Color(region.values[variant - 1]))
  }
  return material
}

/** 셰이더의 fcHueRotate와 같은 식 (회색 축을 중심으로 색을 돌린다) */
function hueRotate(color: Color, angle: number) {
  const { r, g, b } = color
  const k = 1 / Math.sqrt(3)
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const gray = ((r + g + b) / 3) * (1 - c)
  color.setRGB(
    Math.max(0, r * c + k * (b - g) * s + gray),
    Math.max(0, g * c + k * (r - b) * s + gray),
    Math.max(0, b * c + k * (g - r) * s + gray),
  )
}
