# 토플 라이팅 AI 첨삭 (2026 개정)

2026 개정 TOEFL 라이팅(`Write an Email`, `Academic Discussion`) 답안을 Gemini API로 첨삭해 주는 심플·미니멀 웹앱입니다.

## 파일 구조

```
toefl-writing-coach/
├── index.html       # 화면 구조 (한 페이지 구성)
├── style.css        # 심플·미니멀 모바일 우선 디자인
├── app.js           # 탭 전환, 단어 수 계산, API 요청, 수정 하이라이트
├── api/
│   └── feedback.js  # Vercel 서버리스 함수 (Gemini API 호출 + 하루 10회 제한)
├── package.json     # Node.js 모듈 설정
├── .env.example     # 환경변수 예시 파일
└── .gitignore       # Git에 올리지 않을 파일 목록
```

## 배포 방법 (Vercel)

1. **Gemini API 키 발급**: [Google AI Studio](https://aistudio.google.com/apikey)에서 API 키를 발급받습니다.
2. **GitHub 업로드**: 이 폴더(`toefl-writing-coach`)를 새 GitHub 저장소에 올립니다.
3. **Vercel 연결**: [Vercel](https://vercel.com)에서 해당 저장소를 Import 합니다.
4. **환경변수 등록**: Vercel 프로젝트 설정 → `Settings` → `Environment Variables`에서
   - Name: `GEMINI_API_KEY`
   - Value: 발급받은 Gemini API 키
   를 추가한 뒤 **Deploy(또는 Redeploy)** 합니다.

## 로컬에서 테스트하기

```bash
# 1. .env.example을 복사해 .env.local을 만들고 실제 GEMINI_API_KEY 입력
# 2. Vercel CLI로 실행
npx vercel dev
```
