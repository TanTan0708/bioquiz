import fs from 'fs';
import path from 'path';
import { PDFParse } from 'pdf-parse';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { topic, difficulty, count, materialFile } = req.body;

  let materialContent = '';
  let imagesPayload = [];

  // 1. Process the Material File (PDF or MD)
  if (materialFile) {
    try {
      const filePath = path.join(process.cwd(), 'Materials', materialFile);
      if (fs.existsSync(filePath)) {
        
        if (materialFile.toLowerCase().endsWith('.pdf')) {
          const dataBuffer = fs.readFileSync(filePath);
          const parser = new PDFParse({ data: dataBuffer });
          
          // Extract Text
          const textResult = await parser.getText();
          materialContent = textResult.text;
          
          // Extract Images
          const imageResult = await parser.getImage();
          
          if (imageResult && imageResult.pages) {
            let imageCount = 0;
            // Loop through pages and images
            for (const page of imageResult.pages) {
              if (page.images) {
                for (const img of page.images) {
                  // Limit to 10 images so we don't blow up the token limit
                  if (imageCount >= 10) break; 
                  
                  const base64Data = img.data.toString('base64');
                  // Determine mime type
                  let mimeType = 'image/png';
                  if (img.kind && img.kind.toLowerCase().includes('jpeg')) mimeType = 'image/jpeg';
                  if (img.kind && img.kind.toLowerCase().includes('jpg')) mimeType = 'image/jpeg';
                  
                  imagesPayload.push({
                    type: 'image_url',
                    image_url: { url: `data:${mimeType};base64,${base64Data}` }
                  });
                  imageCount++;
                }
              }
            }
          }
        } else {
          // If it's a markdown or text file, just read it normally
          materialContent = fs.readFileSync(filePath, 'utf8');
        }
      }
    } catch (e) {
      console.error("Could not read material file:", e);
    }
  }

  // 2. Build the Prompt
  const topicLabels = {
    all: 'gene regulation, mutations, and cytoplasmic inheritance (lectures 12-14)',
    reg: 'gene regulation, the genetic code, operons, and epigenetics (lecture 12)',
    mut: 'chromosomal mutations and gene/point mutations (lecture 13)',
    cyt: 'cytoplasmic inheritance — maternal effects, extrachromosomal inheritance, organelles (lecture 14)'
  };

  let prompt = '';

  // If it's a materials file, use the strict material prompt
  if (materialFile) {
    prompt = `You are a genetics professor. Generate EXACTLY ${count} multiple-choice questions based on the provided material.
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
      // Truncate text to avoid blowing past the AI's context window
      prompt = `Read the following text material:\n---\n${materialContent.substring(0, 40000)}\n---\n\n${prompt}`;
    }
  } else {
    // If it's just the built-in topics
    prompt = `You are a genetics professor. Generate EXACTLY ${count} multiple-choice questions about ${topicLabels[topic] || topicLabels.all}.
Difficulty: ${difficulty}.

Return ONLY a valid JSON object. Do not include markdown formatting or backticks.
Schema:
{"questions":[{"question":"...","options":["A","B","C","D"],"answer":0,"explanation":"..."}]}

Rules:
- "answer" is the index (0-3) of the correct option.
- 4 options per question.
- Every question must have a short explanation.`;
  }

  // 3. Construct the API Payload
  const contentPayload = [{ type: 'text', text: prompt }];
  
  // If we found images in the PDF, add them to the payload
  if (imagesPayload.length > 0) {
    contentPayload.push(...imagesPayload);
  }

  // 4. Call the Vision Model
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
        // ⚠️ Must be a Vision Model to process the images
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