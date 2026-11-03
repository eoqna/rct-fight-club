// 캐릭터 굽기 라이브러리 (브라우저 모듈) — KayKit 원본 GLTF에 recipes.js의 레시피를 적용한다
// 좌표는 모두 원본 메시의 바인드 자세 공간(y 위, z 앞, 키 약 2.2)이다
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'

/** 아틀라스: 8열 × 4행의 경사 칸 (원본 1024², 승인한 모습 그대로 원래 해상도로 내보낸다) */
const COLS = 8
const ROWS = 4

const cellOf = (u, v) => [Math.min(ROWS - 1, Math.max(0, Math.floor(v * ROWS))), Math.min(COLS - 1, Math.max(0, Math.floor(u * COLS)))]
const parseCell = (name) => [Number(name[1]), Number(name[3])]
const clamp01 = (f) => Math.min(0.98, Math.max(0.02, f))

/** 위치 조건 — 삼각형은 중심, 꼭짓점 연산은 꼭짓점 위치로 판단한다 */
function match(where = {}, [x, y, z]) {
  return (where.yMin === undefined || y >= where.yMin) && (where.yMax === undefined || y <= where.yMax)
    && (where.zMin === undefined || z >= where.zMin) && (where.zMax === undefined || z <= where.zMax)
    && (where.absXMin === undefined || Math.abs(x) >= where.absXMin) && (where.absXMax === undefined || Math.abs(x) <= where.absXMax)
    && (where.xMin === undefined || x >= where.xMin) && (where.xMax === undefined || x <= where.xMax)
    && (where.rMin === undefined || Math.hypot(x, z) >= where.rMin)
}

/**
 * 메시 편집. 삼각형 연산(칠하기·지우기·평면 누르기)과 꼭짓점 연산(오므리기·원기둥·채우기)이 있다.
 * - 칠하기는 처음 맞는 연산 하나만 적용한다 (연산 순서가 우선순위)
 * - 꼭짓점 연산은 같은 자리의 꼭짓점을 똑같이 옮기므로 이음매가 벌어지지 않는다
 */
export function editMesh(mesh, ops) {
  let g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
  const pos = g.attributes.position, uv = g.attributes.uv, nrm = g.attributes.normal
  const tris = pos.count / 3
  const centers = [], cells = []
  for (let t = 0; t < tris; t++) {
    centers.push([0, 1, 2].map((k) => (pos.getComponent(t * 3, k) + pos.getComponent(t * 3 + 1, k) + pos.getComponent(t * 3 + 2, k)) / 3))
    const u = (uv.getX(t * 3) + uv.getX(t * 3 + 1) + uv.getX(t * 3 + 2)) / 3
    const v = (uv.getY(t * 3) + uv.getY(t * 3 + 1) + uv.getY(t * 3 + 2)) / 3
    const [row, col] = cellOf(u, v)
    cells.push(`r${row}c${col}`)
  }
  const selected = (op, t) => (!op.cells || op.cells.includes(cells[t])) && match(op.where, centers[t])
  const keep = new Array(tris).fill(true)

  // 작은 조각 지우기: 조건에 맞는 삼각형을 꼭짓점 공유로 묶어, 기준보다 작은 묶음(단추·버클)만 지운다
  const posKey = (i) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`
  for (const op of ops) {
    if (op.removeIslands === undefined) continue
    const parent = new Map()
    const find = (a) => {
      while (parent.get(a) !== a) {
        parent.set(a, parent.get(parent.get(a)))
        a = parent.get(a)
      }
      return a
    }
    const owner = new Map()
    for (let t = 0; t < tris; t++) {
      if (!selected(op, t)) continue
      parent.set(t, t)
      for (let k = 0; k < 3; k++) {
        const key = posKey(t * 3 + k)
        if (owner.has(key)) parent.set(find(t), find(owner.get(key)))
        else owner.set(key, t)
      }
    }
    const groups = new Map()
    for (const t of parent.keys()) {
      const r = find(t)
      if (!groups.has(r)) groups.set(r, [])
      groups.get(r).push(t)
    }
    for (const list of groups.values()) {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
      for (const t of list) for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) {
        const val = pos.getComponent(t * 3 + k, a)
        min[a] = Math.min(min[a], val)
        max[a] = Math.max(max[a], val)
      }
      if (Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) < op.removeIslands) for (const t of list) keep[t] = false
    }
  }

  const vertexOp = (op) => op.removeIslands !== undefined || op.squeeze || op.fillZ || op.cylinder || op.tubeX
  for (let t = 0; t < tris; t++) {
    const row = Number(cells[t][1]), col = Number(cells[t][3])
    let painted = false
    for (const op of ops) {
      if (vertexOp(op) || !selected(op, t)) continue
      if (painted && (op.to || op.project)) continue
      if (op.to || op.project) painted = true
      if (op.remove) {
        keep[t] = false
        continue
      }
      if (op.planeZ) {
        // 평면 z = z0 + 기울기·(y − y0) 위로 눌러 표면과 같은 높이로. 법선도 평면 쪽으로 (눌린 옆면이 어둡게 보이지 않게)
        const [z0, slope, y0] = op.planeZ
        const n = new THREE.Vector3(0, -slope, 1).normalize()
        for (let k = 0; k < 3; k++) {
          const i = t * 3 + k
          pos.setZ(i, z0 + slope * (pos.getY(i) - y0))
          nrm.setXYZ(i, n.x, n.y, n.z)
        }
      }
      if (op.project) {
        // 앞에서 본 x·y를 대상 칸 전체로 펼친다 (마스크 무늬처럼 원래 UV와 상관없이 무늬를 입힐 때)
        const [tr, tc] = parseCell(op.project)
        const [x0, x1, y0, y1] = op.bounds
        for (let k = 0; k < 3; k++) {
          const i = t * 3 + k
          uv.setXY(i, (tc + clamp01((pos.getX(i) - x0) / (x1 - x0))) / COLS, (tr + clamp01(1 - (pos.getY(i) - y0) / (y1 - y0))) / ROWS)
        }
        continue
      }
      if (op.to && op.byHeight) {
        // 높이에 따라 칸의 위(밝음)→아래로 칠한다 — 원래 칸 위치의 얼룩이 남지 않고, 칸의 경계선이 곧은 수평선이 된다
        const [tr, tc] = parseCell(op.to), [y0, y1] = op.byHeight
        for (let k = 0; k < 3; k++) {
          const i = t * 3 + k
          uv.setXY(i, (tc + 0.4) / COLS, (tr + clamp01(1 - (pos.getY(i) - y0) / (y1 - y0))) / ROWS)
        }
        continue
      }
      if (op.to) {
        // 같은 칸 안의 위치를 유지한 채 다른 칸으로 옮긴다 (원래 경사 음영을 살린다)
        const [tr, tc] = parseCell(op.to)
        for (let k = 0; k < 3; k++) {
          const i = t * 3 + k
          uv.setXY(i, uv.getX(i) + (tc - col) / COLS, uv.getY(i) + (tr - row) / ROWS)
        }
      }
    }
  }

  for (const op of ops) {
    if (op.squeeze) {
      const [sx, sy, sz] = op.squeeze, [cx, cy, cz] = op.about ?? [0, 0, 0]
      for (let i = 0; i < pos.count; i++) {
        if (!match(op.where, [pos.getX(i), pos.getY(i), pos.getZ(i)])) continue
        pos.setXYZ(i, cx + (pos.getX(i) - cx) * sx, cy + (pos.getY(i) - cy) * sy, cz + (pos.getZ(i) - cz) * sz)
      }
    }
    if (op.cylinder) {
      // 세로축(x = cx, z = cz)에서 일정한 거리로 옮긴다 — 허벅지·종아리를 일자로
      const [cx, cz, R] = op.cylinder
      for (let i = 0; i < pos.count; i++) {
        if (!match(op.where, [pos.getX(i), pos.getY(i), pos.getZ(i)])) continue
        const dx = pos.getX(i) - cx, dz = pos.getZ(i) - cz, r = Math.hypot(dx, dz)
        if (r < 1e-6) continue
        pos.setX(i, cx + (dx / r) * R)
        pos.setZ(i, cz + (dz / r) * R)
        nrm.setXYZ(i, dx / r, 0, dz / r)
      }
    }
    if (op.tubeX) {
      // x축(팔)을 중심으로 (y, z) 평면에서 일정한 거리 — 소매를 곧은 원통으로
      const [cy, cz, R] = op.tubeX
      for (let i = 0; i < pos.count; i++) {
        if (!match(op.where, [pos.getX(i), pos.getY(i), pos.getZ(i)])) continue
        const dy = pos.getY(i) - cy, dz = pos.getZ(i) - cz, r = Math.hypot(dy, dz)
        if (r < 1e-6) continue
        pos.setY(i, cy + (dy / r) * R)
        pos.setZ(i, cz + (dz / r) * R)
        nrm.setXYZ(i, 0, dy / r, dz / r)
      }
    }
    if (op.fillZ) {
      // 얼굴 앞을 곡면 z = a − b·x² 까지 메운다 (마스크 아래 입 홈을 없앤다)
      const [a, b] = op.fillZ
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
        if (!match(op.where, [x, y, z])) continue
        const surface = a - b * x * x
        if (z < surface) pos.setZ(i, surface)
        const n = new THREE.Vector3(2 * b * x, 0, 1).normalize()
        nrm.setXYZ(i, n.x, n.y, n.z)
      }
    }
  }

  if (keep.includes(false)) {
    const next = new THREE.BufferGeometry()
    const kept = keep.filter(Boolean).length
    for (const [name, attr] of Object.entries(g.attributes)) {
      const size = attr.itemSize, src = attr.array
      const out = new src.constructor(kept * 3 * size)
      let w = 0
      for (let t = 0; t < tris; t++) {
        if (!keep[t]) continue
        out.set(src.subarray(t * 3 * size, (t + 1) * 3 * size), w)
        w += 3 * size
      }
      next.setAttribute(name, new THREE.BufferAttribute(out, size, attr.normalized))
    }
    g = next
  }
  g.computeBoundingSphere()
  mesh.geometry = g
}

/** 덧붙임 형상 (메시 공간) */
function pieceGeometry(piece) {
  let geo
  if (piece.type === 'ellipsoid') {
    geo = new THREE.SphereGeometry(1, 16, 12)
    geo.scale(...piece.radius)
  } else if (piece.type === 'cylinder') {
    geo = new THREE.CylinderGeometry(piece.radius, piece.radius, piece.height, 14)
  } else if (piece.type === 'cone') {
    geo = new THREE.ConeGeometry(piece.radius, piece.height, 14)
    geo.translate(0, piece.height / 2, 0)
  } else if (piece.type === 'box') {
    geo = new THREE.BoxGeometry(...piece.size)
    if (piece.rot) geo.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...piece.rot)))
  } else if (piece.type === 'ruff') {
    // 주름 칼라: 안쪽 고리에서 바깥 고리로 퍼지고, 바깥 끝이 위아래로 번갈아 접힌다
    const n = (piece.pleats ?? 14) * 2, [ri, ro] = piece.radius, h = piece.height
    const verts = []
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2
      const y0 = i % 2 === 0 ? h : -h, y1 = i % 2 === 0 ? -h : h
      const in0 = [Math.cos(a0) * ri, 0, Math.sin(a0) * ri], in1 = [Math.cos(a1) * ri, 0, Math.sin(a1) * ri]
      const out0 = [Math.cos(a0) * ro, y0, Math.sin(a0) * ro], out1 = [Math.cos(a1) * ro, y1, Math.sin(a1) * ro]
      verts.push(...in0, ...out0, ...in1, ...in1, ...out0, ...out1)
    }
    geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    geo.computeVertexNormals()
  } else if (piece.type === 'strip') {
    // 점들을 잇는 두께 있는 띠 (유도복 깃·띠): 바깥 방향은 몸 중심축에서 바깥으로, 양 끝은 막는다
    const pts = piece.points.map((q) => new THREE.Vector3(...q))
    const w = piece.width / 2, th = piece.thickness / 2
    const rings = pts.map((q, i) => {
      const t = pts[Math.min(pts.length - 1, i + 1)].clone().sub(pts[Math.max(0, i - 1)]).normalize()
      let out = new THREE.Vector3(q.x, 0, q.z).normalize()
      const side = new THREE.Vector3().crossVectors(t, out).normalize()
      out = new THREE.Vector3().crossVectors(side, t).normalize()
      side.multiplyScalar(w)
      out.multiplyScalar(th)
      return [q.clone().add(side).add(out), q.clone().sub(side).add(out), q.clone().sub(side).sub(out), q.clone().add(side).sub(out)]
    })
    const index = []
    for (let i = 0; i < rings.length - 1; i++) {
      for (let k = 0; k < 4; k++) {
        const a = i * 4 + k, b = i * 4 + ((k + 1) % 4), c = (i + 1) * 4 + k, d = (i + 1) * 4 + ((k + 1) % 4)
        index.push(a, b, c, c, b, d)
      }
    }
    const last = (rings.length - 1) * 4
    index.push(0, 1, 2, 0, 2, 3, last, last + 2, last + 1, last, last + 3, last + 2)
    geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(rings.flatMap((r) => r.flatMap((v) => v.toArray())), 3))
    geo.setIndex(index)
    geo.computeVertexNormals()
  } else if (piece.type === 'drop') {
    // 눈물방울: 위가 뾰족하고 아래가 둥근 회전체를 납작하게
    const prof = [[0, 1], [0.22, 0.55], [0.42, 0.22], [0.5, 0], [0.44, -0.24], [0.28, -0.42], [0, -0.5]].map(([r, y]) => new THREE.Vector2(r, y))
    geo = new THREE.LatheGeometry(prof, 12)
    geo.scale(...piece.size)
    if (piece.rot) geo.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...piece.rot)))
  } else {
    throw new Error(`모르는 덧붙임: ${piece.type}`)
  }
  if (piece.at) geo.translate(...piece.at)
  return geo
}

/** 뼈 하나(또는 높이별 뼈)에 붙는 덧붙임을 같은 뼈대로 스키닝한다 */
function addPiece(anchorMesh, piece, atlasMaterial) {
  const bones = anchorMesh.skeleton.bones
  const boneIndex = (name) => {
    const i = bones.findIndex((b) => b.name === name)
    if (i < 0) throw new Error(`뼈 없음: ${name}`)
    return i
  }
  const geo = pieceGeometry(piece)
  const count = geo.attributes.position.count
  const boneAt = (i) => {
    if (!piece.boneByHeight) return boneIndex(piece.bone)
    const y = geo.attributes.position.getY(i)
    for (const [threshold, name] of piece.boneByHeight) if (y >= threshold) return boneIndex(name)
    return boneIndex(piece.bone)
  }
  const joints = new Uint16Array(count * 4), weights = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    joints[i * 4] = boneAt(i)
    weights[i * 4] = 1
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(joints, 4))
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4))
  let material
  if (piece.atlasUV) {
    // 아틀라스의 한 점 색을 쓴다 (피부·바지처럼 본체와 정확히 같은 색이 필요할 때)
    const [cell, fu, fv] = piece.atlasUV
    const [tr, tc] = parseCell(cell)
    const uvs = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {
      uvs[i * 2] = (tc + fu) / COLS
      uvs[i * 2 + 1] = (tr + fv) / ROWS
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    material = atlasMaterial
  } else {
    material = new THREE.MeshStandardMaterial({ color: piece.color, roughness: 0.7, side: THREE.DoubleSide })
  }
  const mesh = new THREE.SkinnedMesh(geo, material)
  mesh.name = `piece_${piece.type}`
  mesh.bind(anchorMesh.skeleton, anchorMesh.bindMatrix)
  anchorMesh.parent.add(mesh)
  mesh.position.copy(anchorMesh.position)
  mesh.quaternion.copy(anchorMesh.quaternion)
  mesh.scale.copy(anchorMesh.scale)
}

/** 손잡이 뼈에 단단히 붙는 무기 (원본 칼과 같은 국소 좌표계: 날이 +y) */
function addWeapon(root, weapon) {
  const bone = root.getObjectByName(weapon.bone)
  if (!bone) throw new Error(`뼈 없음: ${weapon.bone}`)
  const group = new THREE.Group()
  group.name = 'weapon'
  for (const part of weapon.parts) {
    const geo = part.type === 'capsule' ? new THREE.CapsuleGeometry(part.radius, part.length, 6, 14) : new THREE.SphereGeometry(1, 16, 12)
    if (part.type === 'ellipsoid') geo.scale(...part.radius)
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: part.color, roughness: 0.28, metalness: 0.05 }))
    mesh.position.set(...part.at)
    group.add(mesh)
  }
  group.position.set(...weapon.position)
  group.quaternion.set(...weapon.quaternion)
  bone.add(group)
}

/**
 * 아틀라스 다시 칠하기. 칸 값의 종류:
 * - [밝은색, 어두운색]: 원래 밝기 순서를 살려 새 경사로
 * - { net, edge? }: 망사 무늬 (edge: 위쪽 일부를 피부색으로 + 솔기 선)
 * - { split }: 위는 경사, 아래는 다른 칸에서 뽑은 색 (높이로 칠하면 곧은 경계선)
 */
function recolorAtlas(image, cells = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const cw = image.width / COLS, ch = image.height / ROWS
  const sample = (cell, fv) => {
    const [sr, sc] = parseCell(cell)
    const px = ctx.getImageData(sc * cw + cw * 0.4, sr * ch + ch * fv, 1, 1).data
    return `rgb(${px[0]},${px[1]},${px[2]})`
  }
  for (const [cell, spec] of Object.entries(cells)) {
    const [row, col] = parseCell(cell)
    const x = col * cw, y = row * ch
    if (spec.split) {
      const [fraction, [light, dark], skinCell, skinV] = spec.split
      const grad = ctx.createLinearGradient(0, y, 0, y + ch * fraction)
      grad.addColorStop(0, light)
      grad.addColorStop(1, dark)
      ctx.fillStyle = grad
      ctx.fillRect(x, y, cw, ch * fraction)
      ctx.fillStyle = sample(skinCell, skinV)
      ctx.fillRect(x, y + ch * fraction, cw, ch * (1 - fraction))
      continue
    }
    if (spec.net) {
      const [base, line, spacing, width] = spec.net
      ctx.fillStyle = base
      ctx.fillRect(x, y, cw, ch)
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, cw, ch)
      ctx.clip()
      ctx.strokeStyle = line
      ctx.lineWidth = width
      for (let d = -ch; d < cw + ch; d += spacing) {
        ctx.beginPath(); ctx.moveTo(x + d, y); ctx.lineTo(x + d + ch * 0.5, y + ch); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(x + d, y); ctx.lineTo(x + d - ch * 0.5, y + ch); ctx.stroke()
      }
      ctx.restore()
      if (spec.edge) {
        const [fraction, skinCell, skinV, seam, seamWidth] = spec.edge
        ctx.fillStyle = sample(skinCell, skinV)
        ctx.fillRect(x, y, cw, ch * fraction)
        ctx.fillStyle = seam
        ctx.fillRect(x, y + ch * fraction - seamWidth / 2, cw, seamWidth)
      }
      continue
    }
    const [light, dark] = spec
    const data = ctx.getImageData(x, y, cw, ch)
    const px = data.data
    let min = 255, max = 0
    for (let i = 0; i < px.length; i += 4) {
      const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
      min = Math.min(min, l)
      max = Math.max(max, l)
    }
    const a = new THREE.Color(light), b = new THREE.Color(dark)
    for (let i = 0; i < px.length; i += 4) {
      const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
      const t = max > min ? (l - min) / (max - min) : 1
      px[i] = (b.r + (a.r - b.r) * t) * 255
      px[i + 1] = (b.g + (a.g - b.g) * t) * 255
      px[i + 2] = (b.b + (a.b - b.b) * t) * 255
    }
    ctx.putImageData(data, x, y)
  }
  return canvas
}

/** 레시피 하나를 적용한 캐릭터 장면을 만든다 (애니메이션 없음, 원래 단위) */
export function buildCharacter(gltf, recipe) {
  const root = cloneSkinned(gltf.scene)
  root.name = recipe.key
  const remove = recipe.remove ? new RegExp(recipe.remove) : null
  const doomed = []
  root.traverse((o) => {
    if (o.isMesh && remove?.test(o.name)) doomed.push(o)
  })
  for (const o of doomed) o.parent.remove(o)

  // 아틀라스 하나를 모든 메시가 함께 쓴다 (무기 포함)
  let source = null
  root.traverse((o) => {
    if (o.isMesh && !source) source = o.material
  })
  const texture = new THREE.CanvasTexture(recolorAtlas(source.map.image, recipe.recolor))
  for (const key of ['flipY', 'colorSpace', 'magFilter', 'minFilter', 'wrapS', 'wrapT']) texture[key] = source.map[key]
  texture.name = `${recipe.key}_atlas`
  const material = source.clone()
  material.name = `${recipe.key}_mat`
  material.map = texture
  root.traverse((o) => {
    if (o.isMesh) o.material = material
  })

  for (const edit of recipe.edits ?? []) {
    const re = new RegExp(edit.mesh)
    root.traverse((o) => {
      if (o.isMesh && re.test(o.name)) editMesh(o, edit.ops)
    })
  }
  for (const weapon of recipe.weapons ?? []) addWeapon(root, weapon)
  for (const piece of recipe.pieces ?? []) {
    let anchor = null
    root.traverse((o) => {
      if (!anchor && o.isSkinnedMesh && o.name === piece.anchor) anchor = o
    })
    if (!anchor) throw new Error(`기준 메시 없음: ${piece.anchor}`)
    addPiece(anchor, piece, material)
  }
  mergeByMaterial(root, recipe.key, material)
  return root
}

/** 머티리얼 묶음 이름: 아틀라스는 하나로, 단색은 색·재질이 같은 것끼리 */
const materialKey = (m, atlas) => (m === atlas ? 'atlas' : `${m.color.getHexString()}|${m.roughness}|${m.metalness}|${m.side}`)

/**
 * 머티리얼이 같은 메시를 스킨드 메시 하나로 합친다 — 캐릭터마다 그리기 호출과 뼈대 갱신이 줄어든다.
 * 뼈에 단단히 붙은 메시(투구·망토·무기)는 그 뼈에 가중치 1로 스키닝해 함께 넣는다. 움직임은 그대로다.
 */
function mergeByMaterial(root, key, atlas) {
  root.updateMatrixWorld(true)
  const meshes = []
  root.traverse((o) => {
    if (o.isMesh) meshes.push(o)
  })
  const ref = meshes.find((m) => m.isSkinnedMesh)
  const { skeleton } = ref
  const bones = skeleton.bones
  const refBindInverse = ref.bindMatrix.clone().invert()
  const groups = new Map()
  for (const mesh of meshes) {
    const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry
    const count = src.attributes.position.count
    const joints = new Uint16Array(count * 4), weights = new Float32Array(count * 4)
    // 기준 메시의 바인드 공간으로 옮기는 변환
    const toRef = refBindInverse.clone()
    if (mesh.isSkinnedMesh) {
      toRef.multiply(mesh.bindMatrix)
      const si = src.attributes.skinIndex, sw = src.attributes.skinWeight
      for (let i = 0; i < count; i++) for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k)
        const j = bones.indexOf(mesh.skeleton.bones[si.getComponent(i, k)])
        if (j < 0 && w > 0) throw new Error(`${mesh.name}: 기준 뼈대에 없는 뼈`)
        joints[i * 4 + k] = Math.max(0, j)
        weights[i * 4 + k] = w
      }
    } else {
      let bone = mesh.parent
      while (bone && !bone.isBone) bone = bone.parent
      const j = bones.indexOf(bone)
      if (j < 0) throw new Error(`${mesh.name}: 뼈에 붙어 있지 않다`)
      // 바인드 자세에서 뼈 기준 위치 = 뼈의 바인드 역행렬의 역 × (뼈 → 메시)
      const local = bone.matrixWorld.clone().invert().multiply(mesh.matrixWorld)
      toRef.multiply(skeleton.boneInverses[j].clone().invert()).multiply(local)
      for (let i = 0; i < count; i++) {
        joints[i * 4] = j
        weights[i * 4] = 1
      }
    }
    const k = materialKey(mesh.material, atlas)
    const names = k === 'atlas' ? ['position', 'normal', 'uv'] : ['position', 'normal']
    const geo = new THREE.BufferGeometry()
    for (const name of names) {
      const attr = src.attributes[name]
      if (!attr) throw new Error(`${mesh.name}: ${name} 없음`)
      const out = new Float32Array(count * attr.itemSize)
      for (let i = 0; i < count; i++) for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c)
      geo.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize))
    }
    geo.applyMatrix4(toRef)
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(joints, 4))
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4))
    if (!groups.has(k)) groups.set(k, { material: mesh.material, geometries: [] })
    groups.get(k).geometries.push(geo)
  }
  const parent = ref.parent
  const emptied = []
  root.traverse((o) => {
    if (o.name === 'weapon') emptied.push(o)
  })
  for (const o of [...meshes, ...emptied]) o.parent.remove(o)
  let n = 0
  for (const [k, { material, geometries }] of groups) {
    const merged = new THREE.SkinnedMesh(mergeGeometries(geometries), material)
    merged.name = k === 'atlas' ? `${key}_body` : `${key}_part${++n}`
    if (k !== 'atlas') material.name = `${key}_${material.color.getHexString()}`
    parent.add(merged)
    merged.position.copy(ref.position)
    merged.quaternion.copy(ref.quaternion)
    merged.scale.copy(ref.scale)
    merged.bind(skeleton, ref.bindMatrix)
  }
}

/** 타격 시점을 재는 끝점 [뼈, 뼈 기준 위치]: 맨손은 주먹·발끝, 무기 공격(1H_*)은 칼끝 (손잡이에서 +y 1.3) */
const FISTS_AND_FEET = [['handslotl', [0, 0, 0]], ['handslotr', [0, 0, 0]], ['toesl', [0, 0, 0]], ['toesr', [0, 0, 0]]]
const BLADE = [['handslotr', [0, 1.3, 0]]]
const FEET = [['footl', [0, 0, 0]]]
const ANALYZE_FPS = 60
/** 처음 자세보다 이만큼(10cm) 앞에 있을 때만 타격으로 본다 — 칼을 들어 올리는 준비 동작을 거른다 */
const MIN_FORWARD = 0.1
const round = (v, digits) => Number(v.toFixed(digits))

/** 클립을 60fps로 재생하며 끝점들의 위치(메시 공간)를 모은다 */
function sampleEffectors(gltf, clip, effectors) {
  const root = cloneSkinned(gltf.scene)
  const mixer = new THREE.AnimationMixer(root)
  mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1).play().clampWhenFinished = true
  const bones = effectors.map(([name]) => {
    const bone = root.getObjectByName(name)
    if (!bone) throw new Error(`뼈 없음: ${name}`)
    return bone
  })
  const steps = Math.round(clip.duration * ANALYZE_FPS)
  const tracks = effectors.map(() => [])
  for (let s = 0; s <= steps; s++) {
    mixer.setTime(Math.min(clip.duration, s / ANALYZE_FPS))
    root.updateMatrixWorld(true)
    effectors.forEach(([, offset], k) => tracks[k].push(bones[k].localToWorld(new THREE.Vector3(...offset))))
  }
  return tracks
}

/**
 * 클립 길이를 재고, 공격 클립이면 타격 시점을, 이동 클립이면 원래 이동 속도(메시 단위/초)를 잰다.
 * - 타격 시점: 클라이언트가 공격 판정 프레임을 이 순간에 맞춰 재생한다. 끝점이 처음 자세보다 앞(+z)으로 나가 있으면서
 *   처음 자세에서 가장 멀리 뻗은 순간 (그 거리의 97%에 처음 닿는 때 — 뻗은 채 멈추는 동작도 뻗는 순간을 잡는다).
 *   뒤로 빼는 준비 동작과 가드로 돌아오는 손은 앞으로 나가지 않으므로 걸리지 않는다
 * - 이동 속도: 클라이언트가 실제 이동 속도에 맞춰 재생 속도를 정한다 (발이 덜 미끄러지게)
 */
export function analyzeClip(gltf, clip, { strike = false, locomotion = false } = {}) {
  const info = { duration: round(clip.duration, 4) }
  if (!strike && !locomotion) return info
  const effectors = locomotion ? FEET : clip.name.startsWith('1H_') ? BLADE : FISTS_AND_FEET
  const tracks = sampleEffectors(gltf, clip, effectors)
  if (locomotion) {
    // 제자리 걸음 클립: 디딘 발이 뒤로 쓸려 가는 거리(보폭)를 한 주기에 두 번 간다
    const z = tracks[0].map((q) => q.z)
    info.speed = round((2 * (Math.max(...z) - Math.min(...z))) / clip.duration, 3)
    return info
  }
  const reachAt = (track, s) => (track[s].z > track[0].z + MIN_FORWARD ? track[s].distanceTo(track[0]) : 0)
  let best = { reach: 0, k: 0 }
  tracks.forEach((track, k) => {
    for (let s = 0; s < track.length; s++) if (reachAt(track, s) > best.reach) best = { reach: reachAt(track, s), k }
  })
  let step = 0
  while (reachAt(tracks[best.k], step) < best.reach * 0.97) step++
  info.impact = round(step / ANALYZE_FPS, 4)
  info.effector = `${effectors[best.k][0]}${effectors === BLADE ? '+blade' : ''}`
  info.reach = round(best.reach, 3)
  return info
}

/** 뒤집은 클립의 표본 간격 (원본 클립과 같은 30fps) */
const MIRROR_FPS = 30
/** 기본 자세가 이만큼 넘게 어긋나면 좌우 대칭이 아니라고 본다 (메시 단위) */
const SYMMETRY_TOLERANCE = 1e-4

/**
 * 클립을 좌우로 뒤집는다 — 원본에 없는 왼손 동작을 만들 때 쓴다.
 * 뼈마다 기본 자세에서 움직인 양(모델 공간)을 x축으로 뒤집어 짝 뼈(이름 끝 l·r)에 주고, 부모 기준 변환으로 되돌린다.
 * 기본 자세가 좌우 대칭이어야 한다 (KayKit 뼈대는 1e-7까지 대칭 — 아니면 굽기를 멈춘다)
 */
export function mirrorClip(gltf, clip, name) {
  const root = cloneSkinned(gltf.scene)
  root.updateMatrixWorld(true)
  const bones = []
  root.traverse((o) => {
    if (o.isBone) bones.push(o)
  })
  const byName = new Map(bones.map((b) => [b.name, b]))
  const partner = (b) => {
    const n = b.name
    const other = n.endsWith('l') ? byName.get(`${n.slice(0, -1)}r`) : n.endsWith('r') ? byName.get(`${n.slice(0, -1)}l`) : undefined
    return other ?? b
  }
  const p = new THREE.Vector3(), q = new THREE.Vector3()
  for (const b of bones) {
    b.getWorldPosition(p)
    partner(b).getWorldPosition(q)
    if (Math.abs(p.x + q.x) > SYMMETRY_TOLERANCE || Math.abs(p.y - q.y) > SYMMETRY_TOLERANCE || Math.abs(p.z - q.z) > SYMMETRY_TOLERANCE) {
      throw new Error(`기본 자세가 좌우 대칭이 아니다: ${b.name}`)
    }
  }
  const rest = new Map(bones.map((b) => [b, b.matrixWorld.clone()]))
  const restInverse = new Map(bones.map((b) => [b, b.matrixWorld.clone().invert()]))
  const flip = new THREE.Matrix4().makeScale(-1, 1, 1)
  const mixer = new THREE.AnimationMixer(root)
  mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1).play().clampWhenFinished = true

  const steps = Math.max(1, Math.round(clip.duration * MIRROR_FPS))
  const times = []
  const tracks = new Map(bones.map((b) => [b, { position: [], quaternion: [] }]))
  const world = new Map()
  const local = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3()
  for (let i = 0; i <= steps; i++) {
    const t = (clip.duration * i) / steps
    mixer.setTime(t)
    root.updateMatrixWorld(true)
    times.push(t)
    for (const b of bones) {
      // 짝 뼈가 기본 자세에서 움직인 양 Δ = W·W₀⁻¹ 을 뒤집어(flip·Δ·flip) 이 뼈의 기본 자세 W₀에 준다
      const src = partner(b)
      world.set(b, flip.clone().multiply(src.matrixWorld).multiply(restInverse.get(src)).multiply(flip).multiply(rest.get(b)))
    }
    for (const b of bones) {
      const parentWorld = b.parent.isBone ? world.get(b.parent) : b.parent.matrixWorld
      local.copy(parentWorld).invert().multiply(world.get(b)).decompose(position, rotation, scale)
      const track = tracks.get(b)
      // 쿼터니언 부호를 앞 표본과 맞춘다 — 보간이 반대쪽으로 크게 돌지 않게
      const n = track.quaternion.length
      if (n && track.quaternion[n - 4] * rotation.x + track.quaternion[n - 3] * rotation.y + track.quaternion[n - 2] * rotation.z + track.quaternion[n - 1] * rotation.w < 0) {
        rotation.set(-rotation.x, -rotation.y, -rotation.z, -rotation.w)
      }
      track.position.push(position.x, position.y, position.z)
      track.quaternion.push(rotation.x, rotation.y, rotation.z, rotation.w)
    }
  }
  const keyframes = []
  for (const [b, { position: values, quaternion }] of tracks) {
    keyframes.push(new THREE.VectorKeyframeTrack(`${b.name}.position`, times, values))
    keyframes.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, quaternion))
  }
  return new THREE.AnimationClip(name, clip.duration, keyframes)
}
