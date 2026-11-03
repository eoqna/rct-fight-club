# Fight Club (가칭)

브라우저에서 여러 명이 실시간으로 싸우는 3D 난투 게임.

## 구조

| 폴더 | 내용 |
|---|---|
| `client/` | 웹 클라이언트 (Vite + React) |
| `server/` | 게임 서버 (Colyseus) |
| `shared/` | 클라이언트·서버 공용 코드 (상수, 프로토콜, 시뮬레이션) |
| `docs/` | [요구사항](docs/requirements.md) · [설계](docs/design.md) · [플레이테스트 안내](docs/playtest.md) · [출시 점검표](docs/release-checklist.md) |
| `deploy/` | [배포](deploy/README.md) — Caddy·Docker Compose 구성과 배포·되돌리기·로컬 스테이징 스크립트 |
| `claudedocs/` | [구현 워크플로](claudedocs/workflow_fight-club.md) · [에셋·라이선스 기록](claudedocs/assets_fight-club.md) |
| `tools/assets/` | 캐릭터·애니메이션·효과음 에셋 파이프라인 (결과는 `client/public/assets/`) |

## 시작하기

Node 22.12 이상이 필요하다.

```sh
npm install
npm run dev   # 게임 서버(:2567)와 클라이언트(:5173)를 함께 실행
```

시작 화면 → 캐릭터 선택(🎲로 이름 다시 뽑기) → 입장 순서로 들어간다. 브라우저 탭을 두 개 열면 두 명이 같은 경기장(사람이 많은 곳 우선, 정원 16)에 들어간다.
개발 모드에서는 주소에 `?play`를 붙이면 시작·선택을 건너뛰고 바로 들어간다 (`?play&character=2`처럼 캐릭터 지정).

## 조작

| 키 | 동작 |
|---|---|
| ← ↑ → ↓ | 이동 |
| Shift | 달리기 |
| Space | 점프 |
| A / S | 기본 공격 / 특수 공격 (더 세지만 느리다) |
| D | 발차기 — 쿨타임 3초 (날아차기와 같이 쓴다) |
| F (누르는 동안) | 가드 — 정면 140°의 공격을 피해 ×0.2·넉백 ×0.3으로 막는다 |
| G | 잡기 — 잡은 뒤 방향키로 그쪽으로 던진다 (0.6초 동안 안 누르면 바라보는 쪽). 쿨타임 5초 (헛잡아도) |
| M | 소리 켜기/끄기 (설정은 다음 방문에도 남는다) |
| H | 조작법 열기/닫기 (처음 입장할 때 한 번 뜬다) |
| `` ` `` | 디버그 패널 켜기/끄기 (개발 모드) |

- 달리면서 A·S·D = 돌진 공격, 점프 중 D = 날아차기. 공격 후딜 마지막 6프레임 안에 누른 공격은 바로 이어서 나간다.
- 화면 아래 왼쪽에 A·S·D·F·G, 오른쪽에 방향키 그림이 있고, 누르면 눌린 모습이 된다. 쿨타임 중인 D·G에는 남은 초가 보인다.
- 앞선 피격에서 1.5초가 지나기 전에 계속 맞아 4번째 피격이 되면 다운되고, 일어나면 1초 동안 무적이다. 입장하면 3초 동안 무적이다 (공격·잡기를 하면 풀린다).
- HP가 0이 되거나 경기장 밖으로 떨어지면 탈락하고 결과 화면이 뜬다. **다시 입장**을 누르면 새로 들어간다. 맞고 5초 안에 떨어지면 마지막으로 때린 사람이 킬을 얻는다.
- 캐릭터는 5종(전사·곰전사·삐에로·유도가·닌자)이고 능력치는 모두 같다. 같은 캐릭터끼리는 옷 색이 달라진다. 이름은 "[형용사] [자연 명사][어미구]"로 만들어진다 (같은 경기장에서 겹치면 다시 뽑는다).
- 게임 화면: 왼쪽 위 HP·킬·생존 시간, 가운데 위 `경기장 #번호 · 사람 수/16 · 핑`, 오른쪽 위 킬 피드와 순위표(상위 5명 + 내 순위), 캐릭터 머리 위에 이름과 HP 바.
- 품질 단계는 자동으로 고른다 (터치 기기는 모바일). 주소에 `?quality=mobile` 또는 `?quality=pc`를 붙이면 강제로 고른다. 디버그 패널 맨 위에 화면 갱신(fps)과 해상도 배율이 나온다.

## 넷코드 시험 (개발 모드)

- 디버그 패널의 0 / 150 / 300ms 버튼으로 서버에 왕복 지연을 넣는다. 값이 바뀌면 모든 탭이 자동으로 다시 접속한다 (Colyseus는 수신 지연을 입장할 때 연결에 묶기 때문).
- 서버를 시작할 때부터 지연을 주려면 `COLYSEUS_LATENCY=150 npm run dev`.
- 혼자 시험할 때는 패널의 **샌드백**(서 있음)·**왕복 샌드백**(좌우로 움직임) 버튼으로 내 앞에 대상을 세운다. **치우기**로 모두 없앤다. 지연을 바꾸면 다시 접속하므로 샌드백도 다시 세워야 한다.
- 패널의 "공격 명중: 내 화면 N · 서버 확정 M"이 같으면 "보이는 대로 맞는" 상태다. 초록 상자는 서버가 본 내 위치, 빨간 구는 내 공격 판정, 보라 구는 잡기 판정이다.
- 샌드백은 탈락하지 않는다. 떨어지거나 HP가 0이 되면 제자리로 돌아온다.

## 스크립트

| 명령 | 내용 |
|---|---|
| `npm run dev` | 서버·클라이언트 개발 모드 |
| `npm run build` | 프로덕션 빌드 |
| `npm run typecheck` | 전체 타입 검사 |
| `npm run lint` | ESLint |
| `npm test` | Vitest (shared·server·client) |
| `npm run test:e2e` | E2E — 시작 → 선택 → 입장 → 탈락 → 결과 → 다시 하기 (설치된 Chrome, 서버 2767·클라이언트 5373을 스스로 띄운다) |
| `npm run loadtest -- --url <주소> --admin <비밀번호>` | 부하 시험 — 가짜 플레이어 192명(기본)을 붙이고 서버 지표를 목표와 비교 ([배포 안내](deploy/README.md#부하-시험-p7-4)) |
| `npm run assets:build` | 에셋 다시 만들기: 원본 받기 → 캐릭터 굽기(설치된 Google Chrome 필요, 다른 경로면 `CHROME_PATH`) → 압축 → 효과음 합성 → 용량 검사 |
| `npm run assets:check` | 용량 예산 검사 (design §7.7) — 넘으면 실패 |

## 환경 변수

| 이름 | 위치 | 내용 |
|---|---|---|
| `PORT` | 서버 | 게임 서버 포트 (기본 2567) |
| `VITE_GAME_SERVER_URL` | 클라이언트 | 게임 서버 주소 (기본: 개발 중에는 현재 호스트의 2567 포트, 운영 빌드는 화면과 같은 주소) |
| `BOTS` | 서버 | `0`이면 봇을 넣지 않는다 (E2E·자동 점검처럼 정해진 사람끼리만 있어야 할 때) |
| `COLYSEUS_LATENCY` | 서버 | 개발용: 서버 시작부터 줄 지연 (ms) |
| `NODE_ENV` | 서버 | `production`이면 운영 설정: 같은 컴퓨터의 접속도 IP 제한을 받고, 입장 방식은 `joinOrCreate`만, 개발용 기능(샌드백·지연 주입)은 끈다 |
| `ALLOWED_ORIGINS` | 서버 | 게임 서버에 들어올 수 있는 웹 페이지 출처, 쉼표로 구분 (예: `https://fight.example.com`). **운영에서는 꼭 정한다** — 없으면 서버가 시작하지 않는다 |
| `TRUST_PROXY` | 서버 | 서버 앞에 둔 리버스 프록시 수 (Caddy 한 대면 `1`, 기본 `0`). 이만큼만 `X-Forwarded-For`를 믿는다 — 프록시 뒤에서 빠뜨리면 모든 사람이 프록시 주소 하나로 세어진다 |
| `ADMIN_PASSWORD` | 서버 | 있으면 `/admin` 운영 화면을 연다 (사용자 `admin`, 12자 이상) |
| `IP_LIMIT_EXEMPT` | 서버 | IP 제한에서 뺄 주소·대역, 쉼표로 구분 (예: `203.0.113.7,10.0.0.0/8`) — 부하 시험·플레이테스트 때만 |
| `LOG_LEVEL` | 서버 | 로그 수준 (기본 `info`, `debug`면 거절도 하나하나 남긴다) |

## 보안·운영

- **남용 방지**: 같은 IP에서 동시에 3명까지, 입장 요청은 1분에 10번까지, 한 연결의 메시지는 1초에 120개까지 받는다. 개발 모드에서는 같은 컴퓨터의 탭은 제한에서 뺀다 — 제한이 걸리는 모습을 보려면 `NODE_ENV=production ALLOWED_ORIGINS=http://localhost:5173 npm run dev -w @fight-club/server`처럼 운영 설정으로 띄운다.
- **로그**: 서버는 한 줄에 JSON 하나씩 남기고(입장·퇴장·탈락·오류), 1분마다 접속자·경기장·틱 처리 시간·패치 크기 지표를 남긴다. IP는 남기지 않는다.
- **운영 화면**: `ADMIN_PASSWORD`를 정하고 `/admin`(표) 또는 `/admin/metrics`(JSON)를 연다. 보기만 할 수 있다.
- 자세한 내용: [설계 §6.7 보안](docs/design.md) · §6.9 개인정보 점검표 · §8.3 관측

## 배포

한 대의 VM(AWS Lightsail 서울)에서 Caddy(자동 HTTPS·게임 화면)와 게임 서버를 Docker로 띄운다. 처음 준비부터 배포·되돌리기·로그·부하 시험까지 [deploy/README.md](deploy/README.md)에 있다.

```sh
deploy/local.sh up                       # 운영과 같은 구성을 이 컴퓨터에서 (https://localhost:8443, Docker 필요)
SSH_KEY=<키> deploy/ship.sh ubuntu@<IP>  # 커밋한 것을 운영 서버에 배포
```

공개 전 [플레이테스트 진행 안내](docs/playtest.md) · [출시 점검표](docs/release-checklist.md)

## 크레딧

- 캐릭터·애니메이션: [KayKit Character Pack: Adventurers 1.0](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) by Kay Lousberg (CC0) — 이 프로젝트의 레시피로 고쳐 썼다 (`tools/assets/recipes.js`)
- 효과음·경기장 텍스처: 이 프로젝트에서 직접 합성·생성 (`tools/assets/sfx.mjs`, `client/src/scene/arenaTextures.ts`)
