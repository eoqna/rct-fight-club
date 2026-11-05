# 배포 (P7)

한 대의 VM(AWS Lightsail 서울)에서 Docker로 두 컨테이너를 띄운다. 게임 화면과 게임 서버가 **한 주소**를 쓴다 (design §8.1).

```
브라우저 ──HTTPS·WSS──▶ web: Caddy ──▶ server: 게임 서버 (Node 22, 포트 2567은 밖으로 열지 않음)
                        · 인증서 자동 발급·갱신 (Let's Encrypt)
                        · 게임 화면 (빌드 결과, 미리 압축, 캐시 헤더, CSP)
                        · /matchmake · WebSocket · /api · /admin → 게임 서버
```

- 빌드는 **이 컴퓨터에서** 한다 (`deploy/package.sh`): 클라이언트 빌드 + 서버 번들(esbuild, 파일 하나). VM은 그 결과를 이미지로 감싸 띄우기만 하므로 npm이나 저장소 접근 권한이 필요 없다.
- 릴리스마다 커밋 이름으로 이미지 태그가 붙고 VM에 최근 5개가 남는다 → 되돌리기는 이전 릴리스로 다시 띄우기.
- 게임 서버를 바꿔 띄우면 경기 중인 사람에게 **"서버 점검으로 10초 뒤 연결이 끊깁니다"**가 뜨고, 10초 뒤 끊겨 선택 화면에서 "잠시 뒤 다시 들어와 주세요" 안내를 본다. 새 서버가 뜨기까지 대략 15~20초.

## 처음 한 번

1. **Lightsail 인스턴스 만들기** — 리전 서울(ap-northeast-2), Linux 운영 체제(예전 화면: Linux/Unix → OS Only) → **Ubuntu 24.04 LTS**, 요금제는 2 vCPU·메모리 2GB 이상(부하 시험 결과를 보고 정한다, 아래 '부하 시험'), SSH 키 페어(기본 키를 내려받아 둔다).
   - 2026년 10월부터 바뀐 가입 방식(AWS Settings·프로젝트)으로 만든 계정은 리전이 연락처의 나라로 정해지고(한국 → 시드니) 리전 메뉴가 없다. 서울을 쓰려면 ① 유료 플랜으로 업그레이드 → ② 고급 기능 활성화 → ③ 조직 정책(SCP)의 `RegionFloor`에 `ap-northeast-2`를 추가한다 ([AWS 안내](https://docs.aws.amazon.com/accounts/latest/reference/activate-advanced-features.html)). ①·②는 되돌릴 수 없고 ②를 하면 지출 한도가 없어진다 — 예산 알림(Budgets)을 걸어 둔다. 남은 크레딧은 그대로 사용료에 먼저 쓰인다.
2. **고정 IP** — Networking → Create static IP → 이 인스턴스에 붙인다 (붙어 있는 동안 무료).
3. **방화벽** — 인스턴스 → Networking → IPv4 Firewall: SSH(22)·HTTP(80)는 기본으로 열려 있다. **HTTPS(443, TCP)를 추가**한다. (선택) UDP 443을 열면 HTTP/3도 쓴다. IPv6 방화벽에도 같은 규칙.
4. **무료 도메인** (공개 전에 정식 도메인으로 바꾼다)
   - DuckDNS: https://www.duckdns.org 에 로그인 → 하위 도메인 만들기(예: `fightclub` → `fightclub.duckdns.org`) → current ip에 고정 IP를 넣고 update ip.
   - 또는 가입 없이: `<고정 IP의 점을 -로>.sslip.io` (예: 고정 IP가 3.38.12.34면 `3-38-12-34.sslip.io`). 단 sslip.io는 공개 접미사 목록(Public Suffix List)에 없어서 Let's Encrypt 발급 한도(같은 도메인에 주 50장)를 전 세계 사용자와 함께 쓴다 — 인증서를 못 받을 수 있으니 DuckDNS를 먼저 쓴다.
5. **서버 준비** (이 컴퓨터에서)
   ```sh
   KEY=~/Downloads/LightsailDefaultKey-ap-northeast-2.pem   # 내려받은 키
   chmod 600 $KEY
   scp -i $KEY deploy/vm-setup.sh ubuntu@<고정 IP>:
   ssh -i $KEY ubuntu@<고정 IP> 'bash vm-setup.sh'
   ```
6. **설정 파일** — 예시를 올리고 서버에서 고친다
   ```sh
   scp -i $KEY deploy/env.example ubuntu@<고정 IP>:fight-club/.env
   ssh -i $KEY ubuntu@<고정 IP>
   nano ~/fight-club/.env        # SITE, ALLOWED_ORIGINS, ADMIN_PASSWORD
   openssl rand -base64 18       # ADMIN_PASSWORD로 쓸 긴 비밀번호 만들기
   ```
7. **첫 배포** (이 컴퓨터에서, 커밋한 뒤)
   ```sh
   SSH_KEY=$KEY deploy/ship.sh ubuntu@<고정 IP>
   ```
   `✅ 배포 완료: https://<SITE>` 가 나오면 브라우저로 열어 본다. 첫 배포 때는 Caddy가 인증서를 받느라 몇 초 더 걸린다.

## 평소에

| 할 일 | 명령 (이 컴퓨터에서, `SSH_KEY=$KEY`를 앞에 붙인다) |
|---|---|
| 배포 | 커밋 → `deploy/ship.sh ubuntu@<IP>` |
| 되돌리기 | `deploy/rollback.sh ubuntu@<IP>` (목록) → `deploy/rollback.sh ubuntu@<IP> <릴리스>` |
| `.env` 바꾼 것 반영 | `deploy/rollback.sh ubuntu@<IP> <지금 릴리스>` — 같은 릴리스로 다시 띄우면 바뀐 설정으로 서버를 새로 띄운다 |
| 로그 | `deploy/logs.sh ubuntu@<IP>` (게임 서버, JSON 한 줄씩) · `deploy/logs.sh ubuntu@<IP> web` (Caddy) |
| 운영 화면 | `https://<SITE>/admin` — 사용자 `admin`, 비밀번호는 `.env`의 `ADMIN_PASSWORD` (5초마다 새로 고침) |

1분마다 남는 `"event":"metrics"` 로그 줄에 접속자·경기장·틱 처리 시간(p95)·CPU·패치 크기가 있다. 틱 처리 p95가 4ms를 넘거나 CPU가 70%를 넘으면 `"level":40`(warn)으로 남는다.

## 로컬 스테이징 — 운영과 같은 구성을 이 컴퓨터에서

Docker Desktop을 켜고:

```sh
deploy/local.sh up     # https://localhost:8443 (Caddy가 만든 로컬 인증서라 브라우저가 한 번 경고한다)
deploy/local.sh logs
deploy/local.sh down   # 내리고 지운다
```

설정은 `deploy/local.env` (운영 설정 그대로 — 같은 IP 동시 접속 3명 제한도 걸린다).

## 부하 시험 (P7-4)

목표 (design §9): 경기장 12개 × 16명에서 **경기장 틱 처리 p95 < 1ms**, **서버 CPU < 70%** (코어 하나 = 100%).

1. 부하를 보낼 컴퓨터의 공인 IP를 확인해 (`curl -s https://checkip.amazonaws.com`) 서버 `.env`의 `IP_LIMIT_EXEMPT`에 넣고 반영한다 (위 '`.env` 바꾼 것 반영'). 같은 IP에서 수백 명이 들어가야 하므로 IP 제한에서 뺀다.
2. 이 컴퓨터에서:
   ```sh
   npm run loadtest -- --url https://<SITE> --admin <ADMIN_PASSWORD> --players 192 --seconds 300
   ```
   5초마다 연결 수·1인당 받는 양·서버 지표를 찍고, 끝나면 목표와 비교해 ✅/❌를 보여 준다.
3. **Lightsail의 CPU는 버스트형**이다 — 짧게는 높게 쓸 수 있지만, 요금제마다 정해진 '지속 가능' 사용률보다 오래 높게 쓰면 느려진다. 콘솔의 인스턴스 → Metrics → CPU utilization에서 지속 가능 영역(sustainable zone)을 넘는지 함께 본다. 넘으면 한 단계 큰 요금제로 바꾼다 (스냅숏 → 새 인스턴스, 고정 IP를 옮겨 붙이면 주소는 그대로).
4. 끝나면 `IP_LIMIT_EXEMPT`를 지우고 다시 반영한다.

이 컴퓨터(M3 Pro)에서 잰 기준값: 192명·경기장 12개에서 틱 처리 p95 0.12ms, 서버 CPU 평균 32%, 한 사람이 받는 양 약 8KB/s (design §9).

## 보안 메모

- 서버 접속은 SSH 키로만 한다 (Lightsail 기본). 키 파일은 잃어버리지 않게 따로 보관한다.
- `.env`는 서버에만 둔다 — 저장소에 올리지 않는다. `ADMIN_PASSWORD`는 길게(위의 `openssl rand`).
- 게임 서버 포트(2567)는 밖으로 열지 않는다 — Caddy만 80·443을 연다.
- 운영체제 보안 업데이트는 자동으로 설치된다 (`vm-setup.sh`의 unattended-upgrades). Docker 베이스 이미지(`node:22-alpine`, `caddy:2-alpine`)는 배포할 때마다 새로 받아 빌드한다 (`ship.sh`의 `build --pull`).
- 접속 기록(IP)은 Caddy도 게임 서버도 남기지 않는다 (NFR-10). Caddy는 게임 서버에 닿지 못할 때 오류 로그에 요청 정보를 남기는데, 그중 IP·헤더 필드는 지우도록 해 두었다 (`Caddyfile`의 `log` 필터).
