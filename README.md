# 식스체크 (SikCheck)

Figma 기획서를 정답지로, **기획서 자체**와 **실제로 만든 사이트**를 함께 검수하는 도구예요.
AI가 근거를 인용해 문제를 찾고, 사람은 애매한 것만 판정하면 표준 양식 결과서(엑셀)가 나와요.

## 할 수 있는 것

| 검수 종류 | 입력 | 보는 것 |
|---|---|---|
| **기획 검수** | Figma 링크 | 화면 ↔ 디스크립션 불일치, 누락된 설명·상태, 정책 충돌, 용어 혼용, 오탈자, 열린 항목 |
| **구현 검수** | Figma 링크 + 사이트 주소 | 기획대로 만들어졌는지 (문구·필드·탭·버튼·배치), 콘솔 오류 |
| **변경 검수** | 이전 회차 연결 | 기획대로 변경 / 근거 없는 변경 / 반영 누락 (AI 비용 없음) |

- **검토함**: 검수 기록별로 발견을 판정(문제 맞음 · 기획 변경 · 문제 아님)하고 질문에 답해요
- **대화**: "용어 지적은 전부 문제 아님으로", "AWP만 다시 봐줘"처럼 말로 지시해요
- **결과서**: 요약 · 결함 목록 · 화면별 결과 · 커버리지 · 변경점 · 질문/결정 로그 엑셀
- 답한 내용은 **프로젝트 지식**이 돼서 다음 검수부터 기준으로 써요

## 안전

- 사이트는 **읽기만** 해요. 로그인 뒤에는 조회(GET) 외의 요청을 모두 막고, 저장·삭제·신청·발송 같은 버튼은 누르지 않아요.
- 키와 계정은 내 PC의 `.env`에만 있어요. AI에는 판정에 필요한 화면 텍스트와 이미지만 보내요.
- 그래도 운영 서버보다는 **개발·스테이징 서버**에 쓰는 걸 권해요.

## 설치 (Windows · macOS)

준비물: [Node.js 22 이상](https://nodejs.org), Git

```bash
git clone <저장소 주소> sikcheck
cd sikcheck
npm install
npx playwright install chromium   # 사이트 검수용 브라우저 (약 150MB)
cp .env.example .env               # Windows: copy .env.example .env
```

`.env`를 메모장으로 열어 채워요.

| 항목 | 받는 곳 |
|---|---|
| `FIGMA_TOKEN` | figma.com → Settings → Security → Personal access tokens (권한: File content Read-only). `figd_`로 시작 |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys → Create Key. 만들 때 한 번만 보이는 `sk-ant-` 전체를 복사 |
| `TARGET_BASE_URL` 등 | 구현 검수할 사이트 주소와 테스트 계정 (기획 검수만 쓰면 비워도 돼요) |

```bash
npm run dev
```

브라우저에서 http://localhost:3100 을 열고, **설정 → 지금 확인**으로 키가 정상인지 확인해요.

## 비용

AI 호출 비용은 각자의 Anthropic 계정으로 나가요. 실행 전에 견적을 보여주고, 실행당 상한(기본 $1)을 넘으면 멈춰요.
처음 측정 기준(Opus 5.5): 기획 검수 화면당 약 $0.05, 구현 검수 화면당 약 $0.09. 설정에서 Sonnet·Haiku로 바꾸면 더 싸져요.

## 서버에 올리기 (팀이 같이 쓸 때)

```bash
docker build -t sikcheck .
docker run -p 3100:3100 --env-file .env -v sikcheck-data:/app/data sikcheck
```

`data/` 폴더(검수 기록 DB와 스냅샷)는 볼륨으로 유지해요. 로그인 기능이 붙기 전까지는 사내망 안에서만 쓰세요.

---
만든 사람: 정윤식 · 이름은 '윤식'의 **식** + check
