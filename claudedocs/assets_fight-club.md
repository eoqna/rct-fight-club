# 🎨 Fight Club — 에셋·라이선스 기록 (P3)

조사일: 2026-11-02 · 기준: 같은 뼈대를 쓰는 캐릭터 4~6종, 필요한 애니메이션 약 24종, CC0 계열 우선 (design §7.5·§7.7, §11 S2)

## 1. 캐릭터 후보 비교 (P3-1)

| 후보 | 라이선스 | 캐릭터 | 뼈대 | 싸움 동작 | 받는 곳 | 확인 |
|---|---|---|---|---|---|---|
| **KayKit Adventurers 1.0** (Kay Lousberg) | CC0 (저장소 `LICENSE.txt`) | 5종: Knight · Barbarian · Mage · Rogue · Rogue_Hooded | 공통 41관절 | 맨손 펀치 A/B · 발차기 · 한손 무기 공격 4종 · 막기 · 피격 · 눕기/일어나기 · 죽음 · 던지기 포함 (76클립) | [GitHub 공식 저장소](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) | ✅ 파일을 받아 클립·뼈대·폴리곤 확인, 렌더링 미리보기 |
| KayKit Adventurers 2.0 + Character Animations 1.1 | CC0 | 무료판 5종 (+ Ranger) | Rig_Medium | 150개 이상 (손 흔들기·환호 포함) | [itch.io](https://kaylousberg.itch.io/kaykit-adventurers) · [애니메이션](https://kaylousberg.itch.io/kaykit-character-animations) | ⚠️ 설명만 확인. itch.io는 자동 다운로드가 막혀 있어 직접 받아야 한다 |
| Quaternius Universal Animation Library 2 + 기본 캐릭터 | CC0 | 기본 인체형 | 범용 인체 뼈대 | 130개 이상, 근접 연속기 포함 (맨손 펀치·발차기 여부 미확인) | [quaternius.com](https://quaternius.com/packs/universalanimationlibrary2.html) | ⚠️ 설명만 확인 (itch.io) |
| Kenney Mini Characters | CC0 | 12종 | 미확인 | 미확인 (32클립, 싸움 동작 언급 없음) | [kenney.nl](https://kenney.nl/assets/mini-characters-1) | ⚠️ 설명만 확인 |

## 2. 확정 로스터 (2026-11-02 사용자 승인)

KayKit Adventurers 1.0 원본 5종을 레시피(`tools/assets/recipes.js`)로 고쳐 만든 5종. 배열 순서가 `PlayerState.characterId`다.
레시피는 원본의 바인드 자세 공간에서 아틀라스 칸(8×4) 다시 칠하기, 부위 편집(칠하기·지우기·평면 누르기·원기둥 펴기), 뼈에 붙인 덧붙임, 손잡이 뼈에 단 무기를 적용한다.

| 번호 | 캐릭터 | 원본 | 모습 | 무기 | A / S / 돌진 동작 |
|---|---|---|---|---|---|
| 0 | 전사 | Knight | 투구·망토 그대로 | 한손 장검 | 가로 베기 / 찌르기 / 찌르기 |
| 1 | 곰전사 | Barbarian | 곰 모자·망토 | 한손 도끼 | 내려찍기 / 대각선 베기 / 찌르기 |
| 2 | 삐에로 | Mage 몸 | 하얀 얼굴·큰 빨간 코·양 눈 아래 파란 눈물, 고깔모자(방울), 주름 칼라, 보라·노랑 반반 옷, 금색 버클 벨트, 큰 구두 | 풍선검 | 대각선 베기 / 찌르기 / 찌르기 |
| 3 | 유도가(여) | Rogue 몸 | 흰 유도복(V넥 깃·곧은 긴소매·긴바지), 한 바퀴 검은 띠와 매듭, 맨손·맨발 | 없음 | 왼손 정권찌르기 / 오른손 어퍼컷 / 오른손 정권찌르기 |
| 4 | 닌자(여) | Rogue_Hooded | 네이비 두건·옷, 눈 아래까지 회색 망사 마스크(입 없음), 붉은 허리띠, 바지는 신발 안으로 | 단검 | 찌르기 / 가로 베기 / 찌르기 |

- 무기를 든 캐릭터는 무기 동작을 하지만 **판정 거리·피해는 모두 같다** (FR-07, 사용자 결정). 발차기(D)와 날아차기는 모두 같은 발차기 동작.
- 크기: 모두 원본 몸 키 2.2 → 게임 1.8m (`MODEL_SCALE`).

## 3. 동작 ↔ 클립 (client/src/game/animation.ts)

| 게임 동작 (`Action`) | 클립 | 재생 위치 |
|---|---|---|
| Idle | `Idle`(무기) · `Unarmed_Idle`(유도가) | 반복 |
| Walk / Run | `Walking_A` / `Running_A` | 반복, 실제 속도 ÷ 클립 원래 속도(0.62·1.23m/s)를 0.6~1.8배로 제한 — 게임 이동이 훨씬 빨라 발은 조금 미끄러진다 |
| Air · Falling | 오르는 중 `Jump_Start`, 내려가면 `Jump_Idle` | 한 번 / 반복 |
| Jab · Straight · Dash | 캐릭터별 (§2) | **타격 시점 → 판정 첫 프레임** (아래) |
| Kick | `Unarmed_Melee_Attack_Kick` | 〃 |
| FlyingKick → Landing | 발차기 (판정 동안 뻗은 다리 유지) → `Jump_Land` | 후딜에 맞춰 |
| Guard / GuardStun | `Blocking` / `Block_Hit` | 반복 / 프레임대로 |
| GrabTry / Holding | `Interact` | 타격 시점 → 판정 첫 프레임 / 뻗은 자세 유지 |
| Throwing | `Interact` (잡은 자세 그대로) + 허리 숙이기 | 엎어치기: 척추·가슴 뼈를 앞으로 숙여 놓은 직후(13프레임) 가장 깊고(80°), 후딜이 끝나면 선다 |
| Grabbed | `Hit_B` | 젖혀진 자세 유지. 잡은 쪽을 마주 보고, 던지는 동작이 시작되면 그 등 뒤로 돌아가 업힌다 (화면 연출) |
| Thrown | `Hit_B` → 떨어지면 `Lie_Idle` | 엎어치기 (화면 연출): 공중 30프레임 동안 던진 쪽 등 뒤에서 머리 위(약 2.1m)를 넘어 앞으로 3/4바퀴 돌고, 던진 쪽으로 머리를 두고 등을 대고 떨어진다. 던진 쪽을 모를 때는 포물선(1.3m) + 뒤로 한 바퀴 |
| Hitstun | `Hit_A` | 경직 길이에 맞춰 |
| Knockdown | `Lie_Idle` → 끝 28프레임 `Lie_StandUp` (0.45~2.1초 구간) | 등을 대고 누웠다가 일어나 앉아 선다. 엎어치기로 떨어졌으면 일어나면서 원래 바라보던 방향으로 돈다 |
| KO | `Death_A` | 끝에서 멈춤 |
| 이모트 | — | P5 (손 흔들기·도발·춤은 원본에 없음, `Cheer`만 있음) |

**좌우로 뒤집은 클립**: 원본에는 왼손 펀치가 없어서, 굽기 단계(`mirrorClip`)가 오른손 정권찌르기를 좌우로 뒤집어 왼손 정권찌르기를 만든다. 뼈마다 기본 자세에서 움직인 양을 모델 공간에서 x축으로 뒤집어 짝 뼈(이름 끝 l·r)에 준다. KayKit 뼈대의 기본 자세는 1e-7까지 좌우 대칭이라 정확한 거울상이 된다 (판정 첫 프레임에 왼 주먹 0.82m, 오른손 정권과 같은 거리).

**타격 시점 맞추기**: 굽기 단계에서 클립마다 "끝점(맨손은 주먹·발끝, 무기 공격은 칼끝)이 처음 자세보다 10cm 넘게 앞으로 나가 있으면서 처음 자세에서 가장 멀리 뻗은 순간"을 잰다 (`tools/assets/bake/edit.js` `analyzeClip`).
선딜은 그 앞부분을 최대 2배속, 판정은 제 속도, 후딜은 최대 2배속으로 재생해 클립의 타격 시점이 판정 첫 프레임에 온다. 원격 캐릭터는 보간 지연만큼 늦은 동작 프레임(소수)으로 같은 계산을 하므로 프레임 단위로 맞는다 (브라우저 점검).

| 클립 | 길이 | 타격 시점 | 끝점 |
|---|---|---|---|
| Unarmed_Melee_Attack_Punch_A (오른손 정권찌르기) | 1.47초 | 0.50초 | 오른 주먹 |
| Unarmed_Melee_Attack_Punch_B (오른손 어퍼컷) | 1.67초 | 0.53초 | 오른 주먹 |
| Unarmed_Melee_Attack_Punch_Left (왼손 정권찌르기 — Punch_A를 좌우로 뒤집어 굽는다) | 1.47초 | 0.50초 | 왼 주먹 |
| Unarmed_Melee_Attack_Kick | 0.93초 | 0.37초 | 오른 발끝 |
| 1H_Melee_Attack_Slice_Horizontal | 1.07초 | 0.27초 | 칼끝 |
| 1H_Melee_Attack_Slice_Diagonal | 1.00초 | 0.40초 | 칼끝 |
| 1H_Melee_Attack_Stab | 1.60초 | 0.47초 | 칼끝 |
| 1H_Melee_Attack_Chop | 1.07초 | 0.67초 | 칼끝 |
| Interact (잡기) | 1.30초 | 0.40초 | 오른손 |

## 4. 색상 변형 (FR-08, design §6.6)

같은 캐릭터를 고른 사람들 사이에서 가장 적게 쓰인 변형(0~3)을 서버가 준다. 0은 원래 색.
아틀라스 머티리얼은 셰이더가 옷 부위(UV 사각형)만 색을 돌리거나(hue) 곱하고(tint), 단색 덧붙임은 머티리얼 색을 바꾼다.

| 캐릭터 | 바뀌는 부위 | 변형 1 / 2 / 3 |
|---|---|---|
| 전사 | 갑옷 (tint) + 망토·장미 (hue) | 청강 + 파란 망토 / 금 + 초록 망토 / 흑철 + 보라 망토 |
| 곰전사 | 털 (tint) + 조끼·팔 띠 (hue) | 흑곰 / 꿀색 / 회색 |
| 삐에로 | 반반 옷·고깔모자 (hue) | 120° / 240° / 60° 회전 |
| 유도가 | 유도복 상·하의·깃 (tint, 발 피부는 제외) | 파랑 / 분홍 / 노랑 |
| 닌자 | 두건·옷 (hue) | 자주 / 초록 / 보라 |

## 5. 에셋 파이프라인 (P3-2, `npm run assets:build`)

1. **받기** `tools/assets/fetch.mjs` — 고정 커밋의 원본 GLB 5개를 받아 SHA-256 확인 → `tools/assets/.cache/src/` (커밋하지 않음)
2. **굽기** `tools/assets/bake.mjs` — 헤드리스 Chrome에서 `bake/index.html`이 레시피를 적용하고, 머티리얼이 같은 메시를 스킨드 메시 하나로 합친 뒤(투구·망토·무기는 그 뼈에 가중치 1로 스키닝) GLTFExporter로 내보낸다. 클립 길이·타격 시점·이동 속도도 잰다. 결과가 승인 미리보기와 픽셀 단위로 같다 (144만 픽셀 중 1~10픽셀 경계 차이)
3. **압축** `tools/assets/optimize.mjs` — 캐릭터: dedup·weld·prune·meshopt(medium). 애니메이션: 기사 파일에서 쓰는 클립 25개만 남기고, 클립 내내 기본 자세와 같은 트랙 2254개를 지운 뒤 meshopt(high: 회전 16비트·이동 12비트). `client/src/game/assets.gen.ts`(캐릭터 목록·변형 부위·클립 정보) 생성
4. **효과음 합성** `tools/assets/sfx.mjs` — §6
5. **용량 검사** `tools/assets/check-budget.mjs` (`npm run assets:check`) — 하나라도 예산을 넘으면 실패

빌드는 결정적이다 (다시 빌드해도 바이트 단위로 같은 파일). 결과는 `client/public/assets/`에 커밋한다.

| 파일 | 크기 | 예산 (§7.7) |
|---|---|---|
| characters/knight·bear·pierrot·judoka·ninja.glb | 140 · 138 · 172 · 134 · 133KB (그리기 호출 1 · 1 · 8 · 4 · 1) | 각 1.2MB |
| animations.glb (클립 25개) | 337KB (원본 3.5MB) | 2MB |
| sfx/sfx.wav | 186KB | 1.5MB |
| 경기장 | 0 (절차적으로 생성) | 1.5MB |

## 6. 효과음 (P3-6)

내려받은 소리가 없다. `tools/assets/sfx.mjs`가 사인파·필터 잡음으로 10종을 합성해 22.05kHz 16비트 모노 WAV 스프라이트 하나로 묶는다:
타격 · 강타 · 가드(쇳소리) · 휘두름 · 던지기 · 점프 · 착지 · 잡기 · KO · 낙하. 녹음한 소리로 바꾸려면 같은 이름·위치로 WAV만 다시 만들면 된다.
재생은 Howler.js (첫 클릭·터치·키 입력에서 오디오 잠금 해제), 내 캐릭터에서 멀수록 작게(18m까지)·좌우로 나누어, 같은 소리는 35ms 안에 겹치지 않게. 음소거(M)는 localStorage에 저장.

## 7. 라이선스 기록

| 에셋 | 저작자 | 라이선스 | 출처 | 받은 날 |
|---|---|---|---|---|
| KayKit Character Pack: Adventurers 1.0 | Kay Lousberg (kaylousberg.com) | CC0 1.0 — 상업적 사용 가능, 출처 표기 의무 없음 (표기 권장) | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 (커밋 `672074b`) | 2026-11-02 |
| 효과음 10종 | 이 프로젝트 (합성) | 프로젝트 소유 | `tools/assets/sfx.mjs` | — |
| 경기장 텍스처 (돌 타일·경고 띠·구름) | 이 프로젝트 (절차 생성) | 프로젝트 소유 | `client/src/scene/arenaTextures.ts` | — |

README의 크레딧에 "Characters: KayKit by Kay Lousberg (CC0)"를 넣었다. `example/`의 유도복 사진은 참고용(뉴스 사진)이라 저장소에 넣지 않는다.
