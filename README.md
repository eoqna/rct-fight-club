# Fight Club (가칭)

브라우저에서 여러 명이 실시간으로 싸우는 3D 난투 게임.

## 구조

| 폴더 | 내용 |
|---|---|
| `client/` | 웹 클라이언트 (Vite + React) |
| `server/` | 게임 서버 (Colyseus) |
| `shared/` | 클라이언트·서버 공용 코드 (상수, 프로토콜, 시뮬레이션) |
| `docs/` | [요구사항](docs/requirements.md) · [설계](docs/design.md) |
| `claudedocs/` | [구현 워크플로](claudedocs/workflow_fight-club.md) |

## 시작하기

Node 22.12 이상이 필요하다.

```sh
npm install
npm run dev   # 게임 서버(:2567)와 클라이언트(:5173)를 함께 실행
```

## 스크립트

| 명령 | 내용 |
|---|---|
| `npm run dev` | 서버·클라이언트 개발 모드 |
| `npm run build` | 프로덕션 빌드 |
| `npm run typecheck` | 전체 타입 검사 |
| `npm run lint` | ESLint |
| `npm test` | Vitest (shared·server) |

## 환경 변수

| 이름 | 위치 | 내용 |
|---|---|---|
| `PORT` | 서버 | 게임 서버 포트 (기본 2567) |
| `VITE_GAME_SERVER_URL` | 클라이언트 | 게임 서버 주소 (기본: 현재 호스트의 2567 포트) |
