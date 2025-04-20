// api/next.js
import { sessions } from './_lib';

export default function handler(req, res) {
  const { sessionId } = req.query;
  const s = sessions[sessionId];
  if (!s) return res.status(404).json({ error: 'Invalid session ID' });
  if (s.idx >= s.questions.length) return res.json({ question: null });
  res.json({ question: s.questions[s.idx] });
}
