// api/answer.js
import { sessions, genAI } from './_lib';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { sessionId, answer } = req.body;
  const s = sessions[sessionId];
  if (!s) return res.status(404).json({ error: 'Invalid session ID' });

  const question = s.questions[s.idx];
  const evalPrompt = `
You are an interviewer. Evaluate the answer.
Q: ${question}
A: ${answer}

Give:
FEEDBACK: ...
SCORE: ...
`;
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const result = await model.generateContent([evalPrompt]);
  const raw = result.response.text();

  const fb = (raw.match(/^FEEDBACK:\s*(.*)$/mi) || [])[1] || '';
  let score = parseFloat((raw.match(/^SCORE:\s*([\d.]+)/mi)||[])[1])||0;
  score = Math.min(10, Math.max(0, score));

  s.answers.push({ answer, feedback: fb, score });
  s.idx++;

  res.json({ feedback: fb, score });
}
