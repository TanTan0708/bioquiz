// api/generate.js
import fs from 'fs';
import path from 'path';
import { PDFParse } from 'pdf-parse';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Set a timeout so Vercel doesn't kill the function silently
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50000); // 50 seconds max

  const { topic, difficulty, count, materialFile } = req.body;

  let materialContent = '';
  let imagesPayload = [];

  if (materialFile) {
    try {
      const filePath = path.join(process.cwd(), 'Materials', materialFile);
      if (fs.existsSync(filePath)) {
        if (materialFile.toLowerCase().endsWith('.pdf')) {
          const dataBuffer = fs.readFileSync(filePath);
          const parser = new PDFParse({ data: dataBuffer });
          
          try {
            const textResult = await parser.getText();
            materialContent = textResult.text || '';
          } catch (e) { console.log("Text extraction failed", e); }
          
          try {
            const imageResult = await parser.getImage();
            if (imageResult && imageResult.pages) {
              let imageCount = 0;
              for (const page of imageResult.pages) {
                if (page.images) {
                  for (const img of page.images) {
                    if (imageCount >= 4) break; // Strict limit to prevent token overflow
                    const base64Data = img.data.toString('base64');
                    imagesPayload.push({
                      type: 'image_url',
                      image_url: { url: `data:image/jpeg;base64,${base64Data}` }
                    });
                    imageCount++;
                  }
                }
              }
            }
          } catch (e) { console.log("Image extraction failed", e); }
        } else {
          materialContent = fs.readFileSync(filePath, 'utf8');
        }
      }
    } catch (e) {
      console.error("File read error:", e);
    }
  }

  const topicLabels = {
    all: 'gene regulation, mutations, and cytoplasmic inheritance (lectures 12-14)',
    reg: 'gene regulation, the genetic code, operons, and epigenetics (lecture 12)',
    mut: 'chromosomal mutations and gene/point mutations (lecture 13)',
    cyt: 'cytoplasmic inheritance — maternal effects, extrachromosomal inheritance, organelles (lecture 14)'
  };

  let prompt = '';

  if (materialFile) {
    prompt = `You are a genetics professor. Generate EXACTLY ${count} multiple-choice questions based on the provided material.
If images are provided, analyze them closely (tables, diagrams) and generate questions based on the data inside them.

Difficulty: ${difficulty}.

Return ONLY a valid JSON object. Do not include markdown formatting, backticks, or conversational text.
Schema:
{"questions":[{"question":"...","options":["A","B","C","D"],"answer":0,"explanation":"..."}]}

Rules:
- "answer" is the index (0-3) of the correct option.
- 4 options per question.
- Every question must have a short explanation.`;

    if (materialContent) {
      // Truncate aggressively to prevent crashing the AI
      prompt = `Read the following text material:\n---\n${materialContent.substring(0, 25000)}\n---\n\n${prompt}`;
    }
  } else {
    prompt = `You are a genetics professor. Generate EXACTLY ${count} multiple-choice questions about ${topicLabels[topic] || topicLabels.all}.
Difficulty: ${difficulty}.

Return ONLY a valid JSON object. Do not include markdown formatting, backticks, or conversational text.
Schema:
{"questions":[{"question":"...","options":["A","B","C","D"],"answer":0,"explanation":"..."}]}

Rules:
- "answer" is the index (0-3) of the correct option.
- 4 options per question.
- Every question must have a short explanation.`;
  }

  const contentPayload = [{ type: 'text', text: prompt }];
  if (imagesPayload.length > 0) {
    contentPayload.push(...imagesPayload);
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://your-project.vercel.app',
        'X-Title': 'Genetics Quiz'
      },
      body: JSON.stringify({
        // 🚀 SWITCHED TO GEMINI: The most reliable free model for JSON + Vision
        model: 'google/gemini-2.0-flash-lite-preview-02-05:free', 
        messages: [{ role: 'user', content: contentPayload }],
        temperature: 0.3, // Lower temperature = stricter adherence to JSON
        max_tokens: 4096,
      })
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenRouter API Error: ${response.status} - ${errText.substring(0, 100)}`);
    }

    const data = await response.json();
    let raw = data.choices[0].message.content;
    if (!raw) throw new Error("The AI model returned an empty response.");

    // Safe JSON extraction
    const startIdx = raw.indexOf('{');
    const endIdx = raw.lastIndexOf('}');
    
    if (startIdx === -1 || endIdx === -1) {
      console.error("RAW OUTPUT:", raw.substring(0, 500));
      throw new Error("The AI failed to return a valid JSON object.");
    }
    
    const jsonStr = raw.substring(startIdx, endIdx + 1);
    const parsed = JSON.parse(jsonStr);
    const questions = parsed.questions || parsed;

    if (!questions || questions.length === 0) {
      throw new Error("The AI returned 0 questions.");
    }

    res.status(200).json({ questions });
  } catch (err) {
    clearTimeout(timeout);
    console.error("Backend Error:", err);
    res.status(500).json({ error: err.message });
  }
}