// api/generate.js
import fs from 'fs';
import path from 'path';
import pdf from 'pdf-parse';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { topic, difficulty, count, materialFile } = req.body;

  let materialContent = '';
  let imagesPayload = [];

  if (materialFile) {
    try {
      const dir = path.join(process.cwd(), 'Materials');
      const filePath = path.join(dir, materialFile);
      
      // 1. Read the text (PDF or MD)
      if (fs.existsSync(filePath)) {
        if (materialFile.toLowerCase().endsWith('.pdf')) {
          const dataBuffer = fs.readFileSync(filePath);
          const pdfData = await pdf(dataBuffer);
          materialContent = pdfData.text;
        } else {
          materialContent = fs.readFileSync(filePath, 'utf8');
        }
      }

      // 2. Find associated images (e.g., Lesson1.png, Lesson1-1.png)
      const baseName = materialFile.replace(/\.(pdf|md|txt)$/i, '');
      const files = fs.readdirSync(dir);
      
      const imageFiles = files.filter(f => {
        const ext = path.extname(f).toLowerCase();
        return ['.png', '.jpg', '.jpeg'].includes(ext) && f.startsWith(baseName);
      });

      // 3. Convert images to Base64 format for the AI
      for (const img of imageFiles) {
        const imgPath = path.join(dir, img);
        const ext = path.extname(img).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
        const base64 = fs.readFileSync(imgPath).toString('base64');
        
        imagesPayload.push({
          type: 'image_url',
          image_url: { url: `data:${mime};base64,${base64}` }
        });
      }

    } catch (e) {
      console.error("Could not read material files:", e);
    }
  }

  let prompt = `You are a genetics professor. Generate EXACTLY ${count} multiple-choice questions based on the provided material.
If there are images provided, analyze them closely (especially tables, diagrams, or charts) and generate questions based on the data inside them as well as the text.

Difficulty: ${difficulty}.

Return ONLY a valid JSON object. Do not include markdown formatting or backticks.
Schema:
{"questions":[{"question":"...","options":["A","B","C","D"],"answer":0,"explanation":"..."}]}

Rules:
- "answer" is the index (0-3) of the correct option.
- 4 options per question.
- Every question must have a short explanation.`;

  if (materialContent) {
    prompt = `Read the following text material:\n---\n${materialContent.substring(0, 40000)}\n---\n\n${prompt}`;
  }

  // Construct the message payload
  const contentPayload = [{ type: 'text', text: prompt }];
  if (imagesPayload.length > 0) {
    contentPayload.push(...imagesPayload);
  }

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
        // ⚠️ MUST BE A VISION MODEL
        model: 'inclusionai/ling-3.2-flash:free', 
        messages: [{ role: 'user', content: contentPayload }],
        temperature: 0.7,
        max_tokens: 8192,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenRouter API Error: ${errText}`);
    }

    const data = await response.json();
    const raw = data.choices[0].message.content;
    if (!raw) throw new Error("The AI model returned an empty response.");

    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    const questions = parsed.questions || parsed;

    res.status(200).json({ questions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}