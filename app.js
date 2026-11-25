// 토플 라이팅 AI 첨삭 프론트엔드 스크립트
// 주의: API 키는 프론트엔드에 절대 넣지 않으며, /api/feedback 서버리스 함수만 호출합니다.

const SAMPLES = {
  email: {
    prompt:
      'You are taking a history seminar with Professor Miller. Because of a sudden family emergency, you will miss this Thursday’s class and cannot submit your short response paper on time. Write an email to Professor Miller to explain the situation, ask if you can submit the paper by Monday, and ask how you can catch up on the missed class discussion.',
    essay:
      'Hi Professor Miller,\n\nI am writing because I cannot come to class this Thursday. My family has an emergency suddenly so I have to go back to my hometown.\n\nBecause of this, I also cannot submit my response paper on Thursday. Is it okay to send it by Monday instead? And I want to know how I can catch up the class discussion that I will miss.\n\nThank you very much.\nBest,\nMinji',
  },
  discussion: {
    prompt:
      'Professor: Many universities are considering replacing traditional printed textbooks with digital textbooks for all courses. Do you think universities should switch completely to digital textbooks? Why or why not?\n\nClaire: I think digital textbooks are much better because they are cheaper and lighter to carry. Students can also search keywords instantly, which saves a lot of study time.\n\nDaniel: Printed textbooks are still necessary. Reading on screens for hours causes eye strain and makes it easier for students to get distracted by notifications.',
    essay:
      'I agree with Claire that universities should switch to digital textbooks, although Daniel makes a good point about eye strain. First, printed textbooks are way too expensive for many college students. Buying five or six books every semester creates a big financial burden, and digital versions usually cost much less. Second, digital textbooks are very convenient because students can carry all their materials on one tablet and search for important terms quickly while studying for exams. To reduce eye strain that Daniel mentioned, students can adjust screen brightness or take short breaks. Therefore, I believe moving to digital textbooks is a smarter choice for universities.',
  },
};

// 현재 상태
let currentTask = 'email'; // 'email' | 'discussion'
let lastResult = null;
const drafts = {
  email: { prompt: '', essay: '' },
  discussion: { prompt: '', essay: '' },
};

// DOM 요소
const tabButtons = document.querySelectorAll('.tab-btn');
const promptInput = document.getElementById('prompt-input');
const essayInput = document.getElementById('essay-input');
const sampleBtn = document.getElementById('sample-btn');
const wordCountBadge = document.getElementById('word-count-badge');
const wordGuide = document.getElementById('word-guide');
const wordGuideStatus = document.getElementById('word-guide-status');
const wordProgressBar = document.getElementById('word-progress-bar');
const emailGuide = document.getElementById('email-guide');
const errorBox = document.getElementById('error-box');
const submitBtn = document.getElementById('submit-btn');
const submitBtnText = submitBtn.querySelector('.btn-text');
const submitSpinner = submitBtn.querySelector('.spinner');
const usageInfo = document.getElementById('usage-info');

// 결과 카드 DOM 요소
const resultSection = document.getElementById('result-section');
const scoreValue = document.getElementById('score-value');
const scoreBars = document.getElementById('score-bars');
const strengthsList = document.getElementById('strengths-list');
const improvementsList = document.getElementById('improvements-list');
const correctionsList = document.getElementById('corrections-list');
const upgradedEssay = document.getElementById('upgraded-essay');
const copyBtn = document.getElementById('copy-btn');

/**
 * 단어 수 계산
 */
function countWords(text) {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

/**
 * 단어 수 및 Academic Discussion 100단어 기준선 UI 업데이트
 */
function updateWordCountUI() {
  const words = countWords(essayInput.value);
  wordCountBadge.textContent = `${words}단어`;

  if (currentTask === 'discussion') {
    wordGuide.classList.remove('hidden');
    emailGuide.classList.add('hidden');

    // 트랙 최대치를 130단어로 잡아 100단어 기준선(76.9%)을 시각적으로 표시
    const percentage = Math.min(100, (words / 130) * 100);
    wordProgressBar.style.width = `${percentage}%`;

    if (words >= 100) {
      wordCountBadge.classList.add('reached');
      wordGuideStatus.classList.add('reached');
      wordGuideStatus.textContent = `100단어 기준 충족 ✓ (${words}단어)`;
    } else {
      wordCountBadge.classList.remove('reached');
      wordGuideStatus.classList.remove('reached');
      wordGuideStatus.textContent = `100단어까지 ${100 - words}단어 남음`;
    }
  } else {
    wordGuide.classList.add('hidden');
    emailGuide.classList.remove('hidden');
    wordCountBadge.classList.remove('reached');
  }
}

/**
 * 탭 전환
 */
function switchTask(nextTask) {
  if (nextTask === currentTask) return;

  // 현재 탭 입력 내용 임시 저장
  drafts[currentTask].prompt = promptInput.value;
  drafts[currentTask].essay = essayInput.value;

  currentTask = nextTask;

  // 탭 버튼 활성화 스타일 변경
  tabButtons.forEach((btn) => {
    const isActive = btn.dataset.task === currentTask;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });

  // 새 탭의 입력 내용 복원 & 안내 문구 변경
  promptInput.value = drafts[currentTask].prompt;
  essayInput.value = drafts[currentTask].essay;

  if (currentTask === 'email') {
    promptInput.placeholder =
      '이메일 상황과 요구사항이 담긴 문제 지문을 붙여넣어 주세요.';
    essayInput.placeholder = '영어로 작성한 이메일 답안을 입력해 주세요.';
  } else {
    promptInput.placeholder =
      '교수님 질문과 다른 학생들의 의견이 담긴 문제 지문을 붙여넣어 주세요.';
    essayInput.placeholder =
      '영어로 작성한 Academic Discussion 답안을 입력해 주세요. (100단어 이상 권장)';
  }

  hideError();
  updateWordCountUI();
}

/**
 * 에러 표시 / 숨김
 */
function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

function hideError() {
  errorBox.textContent = '';
  errorBox.classList.add('hidden');
}

/**
 * 로딩 상태 전환
 */
function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitSpinner.classList.toggle('hidden', !isLoading);
  submitBtnText.textContent = isLoading
    ? 'AI가 답안을 분석하고 있어요...'
    : '첨삭받기';
}

/**
 * HTML 특수문자 이스케이프 (보안용)
 */
function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 원문과 수정문을 단어 단위로 비교(LCS)하여 변경 부분 하이라이트 HTML 생성
 */
function buildDiffHTML(original, revised) {
  const origWords = original.trim().split(/\s+/).filter(Boolean);
  const revWords = revised.trim().split(/\s+/).filter(Boolean);

  const m = origWords.length;
  const n = revWords.length;

  // DP 테이블 생성 (최장 공통 부분 수열)
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (origWords[i].toLowerCase() === revWords[j].toLowerCase()) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const origParts = [];
  const revParts = [];
  let i = 0;
  let j = 0;

  while (i < m && j < n) {
    if (origWords[i].toLowerCase() === revWords[j].toLowerCase()) {
      origParts.push(escapeHTML(origWords[i]));
      revParts.push(escapeHTML(revWords[j]));
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      origParts.push(`<span class="diff-del">${escapeHTML(origWords[i])}</span>`);
      i++;
    } else {
      revParts.push(`<span class="diff-add">${escapeHTML(revWords[j])}</span>`);
      j++;
    }
  }

  while (i < m) {
    origParts.push(`<span class="diff-del">${escapeHTML(origWords[i])}</span>`);
    i++;
  }
  while (j < n) {
    revParts.push(`<span class="diff-add">${escapeHTML(revWords[j])}</span>`);
    j++;
  }

  return {
    originalHTML: origParts.join(' '),
    revisedHTML: revParts.join(' '),
  };
}

/**
 * 1~6점 시각적 바 렌더링 (0.5점 단위 지원)
 */
function renderScoreBars(score) {
  scoreBars.innerHTML = '';
  for (let i = 1; i <= 6; i++) {
    const seg = document.createElement('div');
    seg.className = 'score-segment';

    const fill = document.createElement('div');
    fill.className = 'score-segment-fill';

    if (score >= i) {
      fill.style.width = '100%';
    } else if (score >= i - 0.5) {
      fill.style.width = '50%';
    } else {
      fill.style.width = '0%';
    }

    seg.appendChild(fill);
    scoreBars.appendChild(seg);
  }
}

/**
 * 결과 카드 렌더링
 */
function renderResult(data) {
  lastResult = data;

  // 예상 점수
  scoreValue.textContent = String(data.score);
  renderScoreBars(data.score);

  // 잘한 점
  strengthsList.innerHTML = '';
  data.strengths.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    strengthsList.appendChild(li);
  });

  // 고칠 점
  improvementsList.innerHTML = '';
  data.improvements.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    improvementsList.appendChild(li);
  });

  // 문장별 수정
  correctionsList.innerHTML = '';
  if (data.corrections.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'helper-text';
    empty.textContent = '크게 수정할 문장이 없어요. 아주 깔끔하게 작성하셨어요!';
    correctionsList.appendChild(empty);
  } else {
    data.corrections.forEach((corr) => {
      const { originalHTML, revisedHTML } = buildDiffHTML(
        corr.original || '',
        corr.revised || ''
      );

      const card = document.createElement('div');
      card.className = 'correction-item';
      card.innerHTML = `
        <div class="correction-row">
          <span class="correction-tag">원문</span>
          <p class="correction-sentence">${originalHTML}</p>
        </div>
        <div class="correction-row">
          <span class="correction-tag revised">수정문</span>
          <p class="correction-sentence">${revisedHTML}</p>
        </div>
        <p class="correction-reason">${escapeHTML(corr.reason || '')}</p>
      `;
      correctionsList.appendChild(card);
    });
  }

  // 업그레이드 답안
  upgradedEssay.textContent = data.upgraded || '';

  // 남은 횟수 안내 업데이트
  if (typeof data.remaining === 'number' && typeof data.limit === 'number') {
    usageInfo.textContent = `오늘 남은 무료 첨삭 횟수: ${data.remaining} / ${data.limit}회`;
  }

  // 결과 영역 표시 및 부드러운 스크롤
  resultSection.classList.remove('hidden');
  resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * 결과 텍스트 포맷팅 (복사용)
 */
function formatResultForCopy(data) {
  const taskLabel =
    currentTask === 'email' ? 'Write an Email' : 'Academic Discussion';

  const lines = [
    `[토플 라이팅 AI 첨삭 결과 - ${taskLabel}]`,
    `참고용 AI 예상 점수: ${data.score} / 6`,
    '',
    '■ 잘한 점',
    ...data.strengths.map((s) => `- ${s}`),
    '',
    '■ 고칠 점',
    ...data.improvements.map((i) => `- ${i}`),
    '',
    '■ 문장별 수정',
    ...data.corrections.map(
      (c, idx) =>
        `${idx + 1}. 원문: ${c.original}\n   수정: ${c.revised}\n   이유: ${c.reason}`
    ),
    '',
    '■ 업그레이드 답안',
    data.upgraded,
  ];

  return lines.join('\n');
}

/**
 * 첨삭 요청 실행
 */
async function handleSubmit() {
  hideError();

  const prompt = promptInput.value.trim();
  const essay = essayInput.value.trim();

  if (!prompt) {
    showError('문제 지문을 입력해 주세요.');
    promptInput.focus();
    return;
  }

  if (!essay) {
    showError('내 답안을 입력해 주세요.');
    essayInput.focus();
    return;
  }

  setLoading(true);

  try {
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskType: currentTask,
        prompt,
        essay,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (typeof data.remaining === 'number' && typeof data.limit === 'number') {
        usageInfo.textContent = `오늘 남은 무료 첨삭 횟수: ${data.remaining} / ${data.limit}회`;
      }
      showError(
        data.error || '첨삭 요청에 실패했어요. 잠시 후 다시 시도해 주세요.'
      );
      return;
    }

    renderResult(data);
  } catch (err) {
    console.error(err);
    showError(
      '네트워크 오류가 발생했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.'
    );
  } finally {
    setLoading(false);
  }
}

/**
 * 결과 복사 버튼 핸들러
 */
async function handleCopy() {
  if (!lastResult) return;

  const text = formatResultForCopy(lastResult);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // 구형 모바일 브라우저 대비 폴백
    const temp = document.createElement('textarea');
    temp.value = text;
    temp.style.position = 'fixed';
    temp.style.opacity = '0';
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    document.body.removeChild(temp);
  }

  copyBtn.textContent = '복사 완료 ✓';
  copyBtn.classList.add('copied');
  setTimeout(() => {
    copyBtn.textContent = '결과 복사';
    copyBtn.classList.remove('copied');
  }, 2000);
}

// 이벤트 바인딩
tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => switchTask(btn.dataset.task));
});

essayInput.addEventListener('input', updateWordCountUI);

sampleBtn.addEventListener('click', () => {
  const sample = SAMPLES[currentTask];
  promptInput.value = sample.prompt;
  essayInput.value = sample.essay;
  hideError();
  updateWordCountUI();
});

submitBtn.addEventListener('click', handleSubmit);
copyBtn.addEventListener('click', handleCopy);

// 초기 상태 반영
updateWordCountUI();
