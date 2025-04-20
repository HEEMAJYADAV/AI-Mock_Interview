// api/_lib.js
import multer from 'multer';
import pdfParse from 'pdf-parse';
import { v4 as uuidv4 } from 'uuid';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const upload = multer(); // in‑memory
export const genAI  = new GoogleGenerativeAI("AIzaSyBH95AelDLVHSkjI8-NedS9HW6I2PRjG8w");
export const sessions = {};     // in‑memory store

// Pull up to 5 non‑trivial lines after "Projects" or "Experience"
export function extractProjects(text) {
  const parts = text.split(/Projects?|Experience?/i);
  if (parts.length < 2) return [];
  return parts[1]
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 20)
    .slice(0, 5);
}

// Generate 2 Technical, 2 Coding, 2 HR (→4) + 1 per project → slice(0,5)
export async function generateInterviewQuestions(jobDescription, candidateType, projects) {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  let qs = [];

  for (const roundType of ['Technical','Coding','HR']) {
    const prompt = `
You're an interviewer creating 2 short, clear ${roundType} questions 
for a ${candidateType} candidate applying for:
"${jobDescription}"

List them as:
1. ...
2. ...
`;
    const result = await model.generateContent([prompt]);
    const lines = result.response.text()
      .split('\n')
      .map(l => l.replace(/^\d+\.\s*/, '').trim())
      .filter(l => l)
      .slice(0,2);
    qs.push(...lines);
  }

  for (const project of projects) {
    const prompt = `
Generate one concise question about this project:
"${project}"
`;
    const res = await model.generateContent([prompt]);
    const line = res.response.text().split('\n')[0].trim();
    if (line) qs.push(line);
  }

  return qs.slice(0,5);
}
