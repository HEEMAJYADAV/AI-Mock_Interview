// api/start.js
import { upload, sessions, extractProjects, generateInterviewQuestions } from './_lib';
import pdfParse from 'pdf-parse';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Parse multipart/form-data
  await new Promise((resolve, reject) => {
    upload.single('resume')(req, {}, err => err ? reject(err) : resolve());
  });

  const { jobDescription, candidateType='fresher' } = req.body;
  if (!jobDescription || !req.file) {
    return res.status(400).json({ error: 'Job description and resume required' });
  }

  // Transcribe PDF from buffer
  const { text } = await pdfParse(req.file.buffer);
  const projects = extractProjects(text);
  const questions = await generateInterviewQuestions(jobDescription, candidateType, projects);

  const sessionId = crypto.randomUUID ? crypto.randomUUID() : require('uuid').v4();
  sessions[sessionId] = { questions, answers: [], idx: 0 };

  res.json({ sessionId, total: questions.length });
}
