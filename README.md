# 블라인드 채팅방 (사내 익명 채팅 POC)

비밀번호 입장 기반의 익명 사내 채팅방입니다. 회원가입/재직자 인증 없이 사용자용/관리자용 비밀번호로만 역할을 구분하고, 대화 내용과 최소한의 접속 기록(접속 시각, 세션ID) 외에는 기록을 남기지 않는 것을 원칙으로 합니다.

## 주요 기능

- 비밀번호 2종으로 사용자/관리자 입장 분리 (관리자는 닉네임 "ict" 고정 + 배지 표시)
- 랜덤 닉네임 자동 부여, 사용자가 직접 수정 가능 (예약어·욕설 필터 적용)
- 실시간 채팅 (WebSocket)
- 메시지 좋아요/싫어요, 댓글(답글)
- 관리자 메시지/댓글 삭제 (삭제자·삭제 시각 기록)
- 욕설/비방 필터 (메시지·닉네임 공통)
- 도배 방지용 최소 전송 간격 제한
- 최소 접속 기록만 저장 (세션ID, 접속 시각) — IP 등 개인 식별 정보 없음

## 스택

- Node.js + Express + `ws` (WebSocket)
- PostgreSQL (Neon 권장) — `pg` 드라이버
- 정적 프론트엔드 (프레임워크 없는 순수 HTML/CSS/JS)
- 배포: Render (Web Service)

## 로컬 실행

```bash
npm install
cp .env.example .env   # 값 채우기 (DATABASE_URL 등)
npm run migrate        # 테이블 생성 (최초 1회, 스키마 변경 시 다시 실행)
npm start
```

`http://localhost:3000` 접속.

## 환경변수

| 변수              | 설명                                    |
|-------------------|-----------------------------------------|
| `DATABASE_URL`    | Postgres 연결 문자열 (Neon 등)          |
| `USER_PASSWORD`   | 일반 사용자 입장 비밀번호               |
| `ADMIN_PASSWORD`  | 관리자 입장 비밀번호                    |
| `SESSION_SECRET`  | 세션 쿠키 서명용 비밀키 (운영 시 랜덤값으로 교체) |
| `PORT`            | 서버 포트 (Render는 자동 주입)          |

## 배포 (Render + Neon)

1. **Neon**: 프로젝트 생성 → 연결 문자열(`postgresql://...`) 복사
2. **Render**: New Web Service → 이 저장소 연결
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment: 위 환경변수 전부 등록 (`DATABASE_URL`은 Neon 연결 문자열)
3. 최초 배포 후 Render Shell(또는 로컬에서 `DATABASE_URL`을 Neon 것으로 바꿔) `npm run migrate` 1회 실행해 테이블 생성
4. Render 무료 플랜은 유휴 시 슬립되어 첫 접속이 느릴 수 있음 — 필요 시 유료 Starter 플랜 권장

## 운영 시 반드시 확인/보완할 것

- `server/filter.js`의 `BANNED_WORDS` 목록은 예시 수준입니다. 실제 운영 전 팀 상황에 맞게 목록을 크게 보강하세요.
- 세션은 서버 메모리에만 존재합니다(재시작 시 전원 재입장 필요) — "최소 기록" 원칙에 따른 의도된 설계입니다.
- 인스턴스를 여러 개로 스케일링할 경우 현재의 인메모리 세션·WebSocket 브로드캐스트 방식은 그대로 쓸 수 없습니다(현재 규모: 동접 10명 미만 기준으로는 단일 인스턴스로 충분).
- `SESSION_SECRET`, `USER_PASSWORD`, `ADMIN_PASSWORD`는 절대 기본값으로 배포하지 말고 실제 값으로 교체하세요.
