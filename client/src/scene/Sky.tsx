import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BackSide, Color, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, ShaderMaterial, SphereGeometry, Vector3,
  type InstancedMesh, type Mesh,
} from 'three'
import { createCloudTexture, seededRandom } from './arenaTextures.ts'

/** 하늘 색: 위 · 지평선 · 아래 (카메라가 내려다보므로 화면에는 주로 아래쪽 하늘이 보인다) */
const SKY_TOP = '#8cc9ff'
const SKY_HORIZON = '#e4f3ff'
const SKY_BOTTOM = '#7db8ee'
const CLOUDS = 18
/** 구름이 흘러가는 범위 (경기장 중심 기준, m)와 빠르기 (m/s) */
const CLOUD_RANGE = 80
const CLOUD_DRIFT = 0.8

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const skyFragment = /* glsl */ `
uniform vec3 top;
uniform vec3 horizon;
uniform vec3 bottom;
varying vec3 vDir;
void main() {
  float h = normalize(vDir).y;
  vec3 color = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon, bottom, pow(-h, 0.45));
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`

/** 하늘에 떠 있는 경기장의 배경: 카메라를 따라다니는 하늘 구와, 경기장 아래로 천천히 흘러가는 구름 (design §7.5) */
export function Sky() {
  const dome = useRef<Mesh>(null)
  const sky = useMemo(() => ({
    geometry: new SphereGeometry(150, 32, 16),
    material: new ShaderMaterial({
      uniforms: { top: { value: new Color(SKY_TOP) }, horizon: { value: new Color(SKY_HORIZON) }, bottom: { value: new Color(SKY_BOTTOM) } },
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      side: BackSide,
      depthWrite: false,
    }),
  }), [])
  const clouds = useMemo(() => {
    const map = createCloudTexture()
    const rand = seededRandom(5)
    return {
      map,
      geometry: new PlaneGeometry(1, 0.5).rotateX(-Math.PI / 2),
      material: new MeshBasicMaterial({ map, transparent: true, depthWrite: false, opacity: 0.9 }),
      items: Array.from({ length: CLOUDS }, () => ({
        x: rand() * 2 * CLOUD_RANGE,
        y: -14 - rand() * 26,
        z: (rand() * 2 - 1) * CLOUD_RANGE,
        size: 14 + rand() * 20,
        turn: (rand() - 0.5) * 0.6,
      })),
    }
  }, [])
  useEffect(() => () => {
    sky.geometry.dispose()
    sky.material.dispose()
    clouds.geometry.dispose()
    clouds.material.dispose()
    clouds.map.dispose()
  }, [sky, clouds])

  const cloudMesh = useRef<InstancedMesh>(null)
  const drift = useRef(0)
  useFrame(({ camera }, delta) => {
    dome.current?.position.copy(camera.position)
    const mesh = cloudMesh.current
    if (!mesh) return
    drift.current += CLOUD_DRIFT * delta
    for (let i = 0; i < clouds.items.length; i++) {
      const c = clouds.items[i]
      // 오른쪽으로 흘러가다 범위 끝에서 왼쪽 끝으로 돌아온다
      const x = ((c.x + drift.current) % (CLOUD_RANGE * 2)) - CLOUD_RANGE
      matrix.compose(position.set(x, c.y, c.z), rotation.setFromAxisAngle(UP, c.turn), scale.set(c.size, 1, c.size))
      mesh.setMatrixAt(i, matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <mesh ref={dome} geometry={sky.geometry} material={sky.material} frustumCulled={false} renderOrder={-1} />
      <instancedMesh ref={cloudMesh} args={[clouds.geometry, clouds.material, CLOUDS]} frustumCulled={false} />
    </>
  )
}

const UP = new Vector3(0, 1, 0)
const matrix = new Matrix4()
const position = new Vector3()
const rotation = new Quaternion()
const scale = new Vector3()
