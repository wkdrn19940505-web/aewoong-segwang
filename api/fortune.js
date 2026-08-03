// api/fortune.js
// 브라우저 대신 이 서버 함수가 Gemini API를 호출합니다.
// API 키는 여기(서버)에만 존재하고, 브라우저로는 절대 전달되지 않습니다.

export default async function handler(req, res) {
  // CORS 허용 (필요시)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
  }

  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: '서버에 GEMINI_API_KEY 환경변수가 설정되지 않았습니다.' });
  }

  const { promptText, imageBase64, mimeType, mode } = req.body || {};
  if (!promptText) {
    return res.status(400).json({ error: 'promptText가 필요합니다.' });
  }

  const isImageGen = mode === 'generate_image';

  // 이미지가 있으면 멀티모달(텍스트+이미지) 요청, 없으면 텍스트 전용 요청
  const parts = [{ text: promptText }];
  if (imageBase64) {
    parts.push({
      inline_data: {
        mime_type: mimeType || 'image/jpeg',
        data: imageBase64
      }
    });
  }

  // 이미지 생성 모드는 별도 모델(Nano Banana / gemini-2.5-flash-image) 사용
  const API_URL = isImageGen
    ? `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent`
    : `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent`;

  const requestBody = {
    contents: [{ parts }],
    ...(isImageGen ? { generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } } : {})
  };

  // 503(과부하)/429(한도초과) 에러는 최대 3회까지 서버에서 자동 재시도
  async function callGemini(attempt = 1) {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': API_KEY
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      if ((response.status === 503 || response.status === 429) && attempt <= 3) {
        const waitMs = attempt === 1 ? 2000 : 4000;
        await new Promise(r => setTimeout(r, waitMs));
        return callGemini(attempt + 1);
      }
      const errorBody = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorBody.substring(0, 300)}`);
    }
    return response.json();
  }

  try {
    const data = await callGemini();
    if (!data.candidates || data.candidates.length === 0) {
      return res.status(502).json({ error: `AI 응답에 candidates가 없습니다. 응답: ${JSON.stringify(data).substring(0, 300)}` });
    }

    const responseParts = data.candidates[0].content.parts;

    if (isImageGen) {
      let resultText = '';
      let imageData = null;
      let imageMime = null;
      for (const p of responseParts) {
        if (p.text) resultText += p.text;
        if (p.inlineData) {
          imageData = p.inlineData.data;
          imageMime = p.inlineData.mimeType;
        } else if (p.inline_data) {
          imageData = p.inline_data.data;
          imageMime = p.inline_data.mime_type;
        }
      }
      if (!imageData) {
        return res.status(502).json({ error: '이미지가 생성되지 않았습니다.' });
      }
      return res.status(200).json({ result: resultText, imageBase64: imageData, imageMime });
    }

    const result = responseParts[0].text;
    return res.status(200).json({ result });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
}
