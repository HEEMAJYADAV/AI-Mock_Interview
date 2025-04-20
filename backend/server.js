
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const multer     = require('multer');
const pdfParse   = require('pdf-parse');
const { v4: uuidv4 } = require('uuid');
const fs         = require('fs');

// Gemini SDK
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI("AIzaSyBH95AelDLVHSkjI8-NedS9HW6I2PRjG8w");

// PDF generator
const FPDF = require('node-fpdf');

const app = express();
app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json());

const upload   = multer({ dest: 'uploads/' });
const sessions = {};
const PORT     = process.env.PORT || 4000;

// Extract up to 5 project descriptions from resume text
function extractProjects(text) {
  const parts = text.split(/Projects?|Experience?/i);
  if (parts.length < 2) return [];
  return parts[1]
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 20)
    .slice(0, 5);
}

// Generate up to 5 questions combining rounds + projects
async function generateInterviewQuestions(jobDescription, candidateType, projects) {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  let questions = [];

  // 2 each of Technical, Coding, HR
  for (const roundType of ['Technical', 'Coding', 'HR']) {
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
      .map(l => l.trim().replace(/^\d+\.\s*/, ''))
      .filter(l => l)
      .slice(0, 2);
    questions.push(...lines);
  }

  // 1 question per project
  for (const project of projects) {
    const prompt = `
Generate one concise question asking the candidate to explain 
their approach and challenges for this project:
"${project}"
`;
    const result = await model.generateContent([prompt]);
    const line = result.response.text().split('\n')[0].trim();
    if (line) questions.push(line);
  }

  return questions.slice(0, 5);
}

// 1) Start interview
app.post('/api/start', upload.single('resume'), async (req, res) => {
  try {
    const { jobDescription, candidateType = 'fresher' } = req.body;
    if (!jobDescription || !req.file) {
      return res.status(400).json({ error: 'Job description and resume required' });
    }

    // Parse resume PDF
    const { text } = await pdfParse(fs.readFileSync(req.file.path));
    fs.unlinkSync(req.file.path);

    // Extract & generate questions
    const projects  = extractProjects(text);
    const questions = await generateInterviewQuestions(jobDescription, candidateType, projects);

    const sessionId = uuidv4();
    sessions[sessionId] = { questions, answers: [], idx: 0 };

    res.json({ sessionId, total: questions.length });
  } catch (err) {
    console.error('❌ /api/start error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2) Next question
app.get('/api/next', (req, res) => {
  const s = sessions[req.query.sessionId];
  if (!s) return res.status(404).json({ error: 'Invalid session ID' });
  if (s.idx >= s.questions.length) return res.json({ question: null });
  res.json({ question: s.questions[s.idx] });
});

// 3) Submit answer & get feedback + score
app.post('/api/answer', async (req, res) => {
  try {
    const { sessionId, answer } = req.body;
    const s = sessions[sessionId];
    if (!s) return res.status(404).json({ error: 'Invalid session ID' });

    const question = s.questions[s.idx];
    const evalPrompt = `
You are an interviewer. Evaluate this candidate's answer.
Question: ${question}
Answer: ${answer}

Give short constructive FEEDBACK and a numerical SCORE (0–10).
Respond as:
FEEDBACK: ...
SCORE: ...
`;

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent([evalPrompt]);
    const raw = result.response.text();

    const feedbackLine = raw.split('\n').find(l => /^FEEDBACK:/i.test(l)) || '';
    const scoreLine    = raw.split('\n').find(l => /^SCORE:/i.test(l))    || 'SCORE: 0';

    const feedback = feedbackLine.split(':').slice(1).join(':').trim();
    let score = parseFloat(scoreLine.split(':')[1]);
    if (isNaN(score)) score = 0;
    score = Math.min(10, Math.max(0, score));

    s.answers.push({ answer, feedback, score });
    s.idx++;

    res.json({ feedback, score });
  } catch (err) {
    console.error('❌ /api/answer error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4) Final average score
app.get('/api/final', (req, res) => {
  const s = sessions[req.query.sessionId];
  if (!s) return res.status(404).json({ error: 'Invalid session ID' });
  const avg = s.answers.length
    ? +(s.answers.reduce((sum,a) => sum + a.score, 0) / s.answers.length).toFixed(2)
    : 0;
  res.json({ finalScore: avg });
});

// 5) Results: all Q/A/feedback/score
app.get('/api/results', (req, res) => {
  const s = sessions[req.query.sessionId];
  if (!s) return res.status(404).json({ error: 'Invalid session ID' });
  res.json({
    questions:  s.questions,
    answers:    s.answers,
    finalScore: s.answers.length
      ? +(s.answers.reduce((sum,a)=>sum+a.score,0)/s.answers.length).toFixed(2)
      : 0
  });
});

// 6) PDF report (optional)
app.post('/api/report', (req, res) => {
  const { sessionId } = req.body;
  const s = sessions[sessionId];
  if (!s) return res.status(404).json({ error: 'Invalid session ID' });

  const pdf = new FPDF('P','mm','A4');
  pdf.AddPage();
  pdf.SetFont('Arial','B',16);
  pdf.Cell(0,10,'Interview Report',0,1,'C');
  pdf.SetFont('Arial','',12);
  s.answers.forEach((ans,i) => {
    pdf.Ln(5);
    pdf.MultiCell(0,8,`Q${i+1}: ${s.questions[i]}`);
    pdf.MultiCell(0,8,`Answer: ${ans.answer}`);
    pdf.MultiCell(0,8,`Feedback: ${ans.feedback} | Score: ${ans.score}`);
  });

  if (!fs.existsSync('reports')) fs.mkdirSync('reports');
  const filePath = `reports/report_${Date.now()}.pdf`;
  pdf.Output('F', filePath);

  res.sendFile(filePath, { root: '.' });
});

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});
