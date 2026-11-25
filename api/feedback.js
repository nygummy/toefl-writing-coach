// Vercel Serverless Function: /api/feedback
// 프론트엔드에서 보낸 토플 라이팅 답안을 받아 Gemini API로 첨삭 결과를 반환합니다.
// GEMINI_API_KEY는 반드시 Vercel 환경변수(또는 로컬 .env.local)로만 관리합니다.

const DAILY_LIMIT = 10;
// 기본 모델이 일시적 과부하(503)일 때 자동으로 다음 모델로 폴백합니다.
const GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
];

// IP별 일일 사용 횟수 저장소 (서버 메모리 기반)
// 참고: Vercel 서버리스 함수는 일정 시간 요청이 없으면 초기화(콜드 스타트)될 수 있습니다.
// 트래픽이 많아져 엄격한 횟수 제한이 필요해지면 추후 Upstash Redis(Vercel KV)로 교체할 수 있습니다.
const rateLimitStore = new Map();

/**
 * 한국 시간(KST) 기준 오늘 날짜 문자열 반환 (예: "2026-03-15")
 */
function getTodayKST() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * 요청자 IP 추출
 */
function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

/**
 * IP 기준 하루 10회 사용 제한 확인 및 카운트 증가
 */
function checkAndConsumeRateLimit(ip) {
  const today = getTodayKST();

  // 오래된 날짜 데이터 정리 (메모리 누수 방지)
  if (rateLimitStore.size > 2000) {
    for (const [key, value] of rateLimitStore.entries()) {
      if (value.date !== today) {
        rateLimitStore.delete(key);
      }
    }
  }

  const record = rateLimitStore.get(ip);
  if (!record || record.date !== today) {
    rateLimitStore.set(ip, { date: today, count: 1 });
    return { allowed: true, remaining: DAILY_LIMIT - 1, limit: DAILY_LIMIT };
  }

  if (record.count >= DAILY_LIMIT) {
    return { allowed: false, remaining: 0, limit: DAILY_LIMIT };
  }

  record.count += 1;
  rateLimitStore.set(ip, record);
  return {
    allowed: true,
    remaining: DAILY_LIMIT - record.count,
    limit: DAILY_LIMIT,
  };
}

/**
 * 일시적 API 오류로 실패한 경우 사용 횟수 1회 복구
 */
function refundRateLimit(ip) {
  const today = getTodayKST();
  const record = rateLimitStore.get(ip);
  if (record && record.date === today && record.count > 0) {
    record.count -= 1;
    rateLimitStore.set(ip, record);
  }
}

/**
 * Gemini API 호출 (503 과부하 등 일시 오류 시 다음 모델로 자동 폴백)
 */
async function callGeminiWithFallback(apiKey, fullPrompt) {
  let lastStatus = 500;
  let lastError = '';

  for (const model of GEMINI_MODELS) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: fullPrompt }],
            },
          ],
          generationConfig: {
            temperature: 0.4,
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      }
    );

    if (response.ok) {
      return { ok: true, data: await response.json(), model };
    }

    lastStatus = response.status;
    lastError = await response.text();
    console.error(`Gemini API 오류 (${model}):`, lastStatus, lastError);

    // 503(과부하), 429(요청 과다), 404(모델 미지원)이면 다음 폴백 모델 시도
    if (lastStatus !== 503 && lastStatus !== 429 && lastStatus !== 404) {
      break;
    }
  }

  return { ok: false, status: lastStatus, error: lastError };
}

/**
 * 과제 유형별 Gemini 프롬프트 생성
 */
function buildPrompt(taskType, promptText, essayText, wordCount) {
  const isEmail = taskType === 'email';

  const taskRubric = isEmail
    ? `
[과제 유형: Write an Email (2026 개정 토플 라이팅)]
중점 평가 기준:
1. 톤과 격식(Tone & Formality): 수신자(교수님, 담당자, 친구 등)와 상황에 맞는 자연스러운 어조와 예의를 갖추었는지
2. 요구사항 충족(Task Completion): 문제 지문에서 요구한 모든 질문·조건·세부 사항을 빠짐없이 다루었는지
3. 구성과 명확성(Organization & Clarity): 인사말-목적-본론-맺음말 흐름이 자연스럽고 전달력이 좋은지
4. 문법과 어휘(Language Use): 어색한 직역 표현, 문법 오류, 시제/관사/전치사 실수가 없는지`
    : `
[과제 유형: Academic Discussion (2026 개정 토플 라이팅)]
중점 평가 기준:
1. 의견의 명확성(Clear Stance): 교수님의 질문에 대한 자신의 입장이 분명하게 드러나는지
2. 다른 학생 의견과의 연결(Engagement): 지문에 나온 다른 학생의 의견을 자연스럽게 언급하고 동의/반박/확장하며 대화를 이어갔는지
3. 근거의 충분성(Support & Development): 자신의 주장을 뒷받침하는 구체적인 이유나 예시가 충분한지
4. 분량 및 언어 사용(Length & Language Use): 현재 답안 단어 수는 ${wordCount}단어입니다(권장 기준 100단어 이상). 문법, 어휘 다양성, 문장 연결이 자연스러운지`;

  return `당신은 친절하고 전문적인 2026 개정 TOEFL(토플) 라이팅 첨삭 선생님입니다.
한국인 수험생이 이해하기 쉽도록 모든 설명은 쉽고 부드러운 한국어(~해요 체)로 작성해 주세요.

${taskRubric}

[문제 지문]
${promptText}

[수험생 답안] (${wordCount}단어)
${essayText}

[작성 규칙]
1. score: 2026 개정 토플 라이팅 기준 1~6점 사이의 예상 점수를 0.5점 단위 숫자로 매겨 주세요 (예: 3.5, 4, 4.5, 5).
2. strengths: 잘한 점 2~3개를 한국어로 구체적으로 칭찬해 주세요.
3. improvements: 고치면 점수가 오를 핵심 개선점 2~3개를 한국어로 명확하게 알려 주세요.
4. corrections: 수험생 답안에서 수정이 필요하거나 더 자연스럽게 바꿀 수 있는 문장 3~5개를 골라주세요.
   - original: 수험생이 실제로 쓴 원문 문장 그대로
   - revised: 자연스럽고 정확한 영어로 고친 문장
   - reason: 왜 이렇게 고쳤는지 초보자도 이해할 수 있는 쉬운 한국어 설명
5. upgraded: 수험생의 원래 아이디어, 입장, 내용은 그대로 유지하면서 문법·어휘·흐름만 5.5~6점 수준으로 다듬은 업그레이드 영어 답안 전체를 작성해 주세요. (새로운 주장이나 지어낸 사실을 억지로 추가하지 마세요.)`;
}

/**
 * Gemini API 응답을 엄격한 JSON 구조로 받기 위한 스키마
 */
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    score: {
      type: 'NUMBER',
      description: '2026 개정 토플 라이팅 예상 점수 (1~6점, 0.5 단위)',
    },
    strengths: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: '잘한 점 2~3개 (한국어)',
    },
    improvements: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: '고칠 점 2~3개 (한국어)',
    },
    corrections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          original: { type: 'STRING', description: '수험생 원문 문장' },
          revised: { type: 'STRING', description: '수정된 문장' },
          reason: { type: 'STRING', description: '쉬운 한국어 수정 이유' },
        },
        required: ['original', 'revised', 'reason'],
      },
      description: '문장별 수정 목록',
    },
    upgraded: {
      type: 'STRING',
      description: '원래 아이디어를 유지한 업그레이드 영어 답안',
    },
  },
  required: ['score', 'strengths', 'improvements', 'corrections', 'upgraded'],
};

export default async function handler(req, res) {
  // POST 요청만 허용
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST 요청만 지원합니다.' });
  }

  // API 키 확인 (환경변수에서만 읽음)
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다.');
    return res.status(500).json({
      error: '서버 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요.',
    });
  }

  // 요청 바디 파싱
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: '잘못된 요청 형식입니다.' });
    }
  }

  const { taskType, prompt, essay } = body || {};

  // 입력값 검증
  if (taskType !== 'email' && taskType !== 'discussion') {
    return res.status(400).json({ error: '올바른 과제 유형을 선택해 주세요.' });
  }

  const cleanPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  const cleanEssay = typeof essay === 'string' ? essay.trim() : '';

  if (!cleanPrompt || !cleanEssay) {
    return res
      .status(400)
      .json({ error: '문제 지문과 내 답안을 모두 입력해 주세요.' });
  }

  if (cleanPrompt.length > 4000 || cleanEssay.length > 5000) {
    return res
      .status(400)
      .json({ error: '입력 글자 수가 너무 많습니다. 조금 줄여서 시도해 주세요.' });
  }

  // IP 기준 하루 10회 사용 제한 체크
  const clientIP = getClientIP(req);
  const rateLimit = checkAndConsumeRateLimit(clientIP);
  if (!rateLimit.allowed) {
    return res.status(429).json({
      error: `오늘 무료 첨삭 횟수(${DAILY_LIMIT}회)를 모두 사용했어요. 내일 다시 이용해 주세요!`,
      remaining: 0,
      limit: DAILY_LIMIT,
    });
  }

  const wordCount = cleanEssay.split(/\s+/).filter(Boolean).length;
  const fullPrompt = buildPrompt(taskType, cleanPrompt, cleanEssay, wordCount);

  try {
    const result = await callGeminiWithFallback(apiKey, fullPrompt);

    if (!result.ok) {
      refundRateLimit(clientIP);
      const isOverloaded = result.status === 503 || result.status === 429;
      return res.status(502).json({
        error: isOverloaded
          ? '현재 AI 서버에 요청이 몰려 있어요. 잠시 후 다시 눌러 주세요! (횟수는 차감되지 않았어요)'
          : 'AI 첨삭 요청 중 일시적인 오류가 발생했어요. 잠시 후 다시 시도해 주세요.',
      });
    }

    const data = result.data;
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      refundRateLimit(clientIP);
      console.error('Gemini 응답 비어 있음:', JSON.stringify(data));
      return res.status(502).json({
        error: 'AI 응답을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
      });
    }

    const feedback = JSON.parse(rawText);

    // 점수 범위 안전 보정 (1 ~ 6)
    const numericScore = Number(feedback.score);
    const clampedScore = Number.isFinite(numericScore)
      ? Math.min(6, Math.max(1, Math.round(numericScore * 2) / 2))
      : 3;

    return res.status(200).json({
      score: clampedScore,
      strengths: Array.isArray(feedback.strengths) ? feedback.strengths : [],
      improvements: Array.isArray(feedback.improvements)
        ? feedback.improvements
        : [],
      corrections: Array.isArray(feedback.corrections)
        ? feedback.corrections
        : [],
      upgraded: typeof feedback.upgraded === 'string' ? feedback.upgraded : '',
      remaining: rateLimit.remaining,
      limit: rateLimit.limit,
    });
  } catch (error) {
    console.error('서버 처리 오류:', error);
    return res.status(500).json({
      error: '첨삭 결과를 처리하는 중 문제가 발생했어요. 다시 시도해 주세요.',
    });
  }
}
