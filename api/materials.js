// api/materials.js
import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  try {
    const dir = path.join(process.cwd(), 'Materials');
    if (!fs.existsSync(dir)) {
      return res.status(200).json({ topics: [] });
    }
    
    // Cycle through the folder and get all .md files
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    res.status(200).json({ topics: files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}