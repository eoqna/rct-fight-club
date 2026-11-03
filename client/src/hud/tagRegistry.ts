import { Vector3, type Camera } from 'three'
import { MAX_HP } from '@fight-club/shared'
import { createPose, type GameSession } from '../game/session.ts'

/** 이름표를 띄우는 높이 (발에서, m) */
const TAG_HEIGHT = 2.15

const pose = createPose()
const point = new Vector3()

/** 플레이어 id → 이름표 요소. DOM 층이 등록하고, 캔버스 안의 투영기가 매 프레임 화면 좌표로 옮긴다 */
export class TagRegistry {
  private readonly tags = new Map<string, HTMLElement>()

  add(id: string, el: HTMLElement) {
    this.tags.set(id, el)
  }

  remove(id: string) {
    this.tags.delete(id)
  }

  /** 이름표를 캐릭터 머리 위로 옮기고, HP가 바뀌었으면 바를 고친다 */
  place(session: GameSession, camera: Camera, width: number, height: number) {
    for (const [id, el] of this.tags) {
      if (!session.pose(id, pose)) {
        el.style.visibility = 'hidden'
        continue
      }
      point.set(pose.x, pose.y + TAG_HEIGHT, pose.z).project(camera)
      const visible = point.z < 1 && Math.abs(point.x) < 1.2 && Math.abs(point.y) < 1.2
      el.style.visibility = visible ? 'visible' : 'hidden'
      if (!visible) continue
      const x = ((point.x + 1) / 2) * width
      const y = ((1 - point.y) / 2) * height
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`
      const hp = String(session.hpOf(id))
      if (el.dataset.hp !== hp) {
        el.dataset.hp = hp
        el.style.setProperty('--hp', String(Number(hp) / MAX_HP))
      }
    }
  }
}

