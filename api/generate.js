// api/generate.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { topic, difficulty, count } = req.body;

  const topicLabels = {
    all: 'gene regulation, mutations, and cytoplasmic inheritance (lectures 12-14)',
    reg: 'gene regulation, the genetic code, operons, and epigenetics (lecture 12)',
    mut: 'chromosomal mutations and gene/point mutations (lecture 13)',
    cyt: 'cytoplasmic inheritance — maternal effects, extrachromosomal inheritance, organelles (lecture 14)'
  };

  const prompt = `You are a genetics professor. Generate EXACTLY ${count} multiple-choice questions about ${topicLabels[topic] || topicLabels.all}.
Difficulty: ${difficulty}.

Return ONLY a valid JSON object. Do not include markdown formatting or backticks.
Schema:
{"questions":[{"question":"...","options":["A","B","C","D"],"answer":0,"explanation":"..."}]}

Rules:
- "answer" is the index (0-3) of the correct option.
- 4 options per question.
- Every question must have a short explanation.`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://your-project.vercel.app',
        'X-Title': 'Genetics Quiz'
      },
      body: JSON.stringify({
        model: 'baidu/ernie-5.5-flash-preview:free',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 8192,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenRouter API Error ${response.status}: ${err}`);
    }

    const data = await response.json();
    
    // Check if choices and message exist
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error("Invalid response structure from OpenRouter.");
    }

    const raw = data.choices[0].message.content;
    
    // THE FIX: Check if raw is null before calling .replace()
    if (!raw) {
      throw new Error("The AI model returned an empty response. Please try again.");
    }

    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    const questions = parsed.questions || parsed;

    res.status(200).json({ questions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}