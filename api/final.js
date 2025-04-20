// api/final.js
import { sessions } from './_lib';

export default function handler(req, res) {
  const { sessionId } = req.query;
  const s = sessions[sessionId];
  if (!s) return res.status(404).json({ error: 'Invalid session ID' });

  const avg = s.answers.length
    ? +(s.answers.reduce((sum,a)=>sum+a.score,0)/s.answers.length).toFixed(2)
    : 0;
  res.json({ finalScore: avg });
}
