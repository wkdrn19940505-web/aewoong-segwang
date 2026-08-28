const { kv } = require('@vercel/kv');

const ROLES = [
  '여주인공', '남주인공', '베스트프렌드', '든든한 조연',
  '서브 주인공', '반전 카메오', '귀여운 빌런', '인생 멘토'
];

function makeSlug() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return text.trim();
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const { action, slug } = req.query;
      if (action === 'board') {
        if (!slug) return res.status(400).json({ error: 'slug가 필요해요.' });
        const owner = await kv.get(`casting:${slug}:owner`);
        if (!owner) return res.status(404).json({ error: '존재하지 않는 링크예요.' });
        const responses = (await kv.get(`casting:${slug}:responses`)) || [];
        return res.status(200).json({ owner, responses });
      }
      return res.status(400).json({ error: '알 수 없는 요청이에요.' });
    }

    if (req.method === 'POST') {
      const { action } = req.body;

      if (action === 'create') {
        const { name, birth } = req.body;
        if (!name || !birth) return res.status(400).json({ error: '이름과 생일을 입력해주세요.' });
        const slug = makeSlug();
        await kv.set(`casting:${slug}:owner`, { name, birth });
        await kv.set(`casting:${slug}:responses`, []);
        return res.status(200).json({ slug });
      }

      if (action === 'join') {
        const { slug, friendName, friendBirth } = req.body;
        if (!slug || !friendName || !friendBirth) {
          return res.status(400).json({ error: '정보를 모두 입력해주세요.' });
        }
        const owner = await kv.get(`casting:${slug}:owner`);
        if (!owner) return res.status(404).json({ error: '존재하지 않는 링크예요.' });

        const prompt = `너는 재미로 캐스팅 결과를 알려주는 사주 캐릭터야.
        ${owner.name}(생일 ${owner.birth})의 인생을 드라마라고 생각했을 때,
        ${friendName}(생일 ${friendBirth})이라는 친구가 그 드라마에서 어떤 역할일지
        다음 8개 역할 중 하나만 골라서 정해줘: ${ROLES.join(', ')}.
        JSON 형식으로만 답해줘. 다른 텍스트는 절대 포함하지 마.
        형식: {"role": "역할명", "reason": "왜 이 역할인지 재미있고 따뜻한 톤으로 2문장 이내 설명"}`;

        let role = ROLES[Math.floor(Math.random() * ROLES.length)];
        let reason = `${friendName}님과 ${owner.name}님의 기운이 잘 어울려서 이 역할로 캐스팅됐어요!`;

        try {
          const raw = await callGemini(prompt);
          const cleaned = raw.replace(/```json|```/g, '').trim();
          const parsed = JSON.parse(cleaned);
          if (parsed.role && parsed.reason) {
            role = parsed.role;
            reason = parsed.reason;
          }
        } catch (e) {
          // Gemini 실패 시 위의 기본값(랜덤 역할) 사용
        }

        const responses = (await kv.get(`casting:${slug}:responses`)) || [];
        responses.push({ friendName, role, reason });
        await kv.set(`casting:${slug}:responses`, responses);

        return res.status(200).json({ role, reason });
      }

      return res.status(400).json({ error: '알 수 없는 요청이에요.' });
    }

    return res.status(405).json({ error: '허용되지 않는 방식이에요.' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: '서버 오류가 발생했어요.' });
  }
};
