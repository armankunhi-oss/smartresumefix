// server.js — SmartResumeFix (Razorpay + OpenAI + PDF generation)
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import Razorpay from 'razorpay';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import puppeteer from 'puppeteer';
import multer from 'multer';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Env vars (set these in Replit Secrets)
const {
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
  HOST_URL,
  EMAIL_SMTP_HOST,
  EMAIL_SMTP_PORT,
  EMAIL_SMTP_USER,
  EMAIL_SMTP_PASS,
  DELIVERY_EMAIL_FROM
} = process.env;

let razorpay = null;
if (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET
  });
} else {
  console.warn('WARNING: Razorpay keys not set. Payment will fail until you add keys.');
}

// Rule-based resume improver initialized
console.log('✅ Rule-based resume generation enabled – No API keys required');

// Storage for upload (if using file upload)
const upload = multer({ dest: 'uploads/' });

/* ========== Utilities ========== */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
ensureDir('resumes');

// Professional action verbs and phrases for resume enhancement
const actionVerbs = ['Achieved', 'Implemented', 'Designed', 'Led', 'Managed', 'Developed', 'Coordinated', 'Optimized', 'Streamlined', 'Automated', 'Improved', 'Enhanced', 'Executed', 'Spearheaded', 'Established', 'Pioneered'];
const strengthPhrases = ['detail-oriented', 'results-driven', 'proactive', 'team player', 'problem-solver', 'communicator', 'committed to excellence', 'adaptable', 'innovative thinker'];

function improveResume(resumeText, resumeType = 'Modern Professional', targetRole = '') {
  if (!resumeText || resumeText.trim().length === 0) {
    throw new Error('Resume text cannot be empty');
  }

  // Extract name (look for common patterns)
  let name = 'Applicant';
  const nameMatch = resumeText.match(/(?:Name|name)[\s:]*([A-Za-z\s]+?)(?:\n|,|$)/);
  if (nameMatch && nameMatch[1]) {
    name = nameMatch[1].trim();
  }

  // Extract email
  let contact = '';
  const emailMatch = resumeText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) contact = emailMatch[1];

  // Extract phone (if present)
  const phoneMatch = resumeText.match(/(\+?\d{1,3}[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9})/);
  if (phoneMatch) contact = contact ? contact + ' | ' + phoneMatch[1] : phoneMatch[1];

  // Extract skills
  let skillsRaw = '';
  const skillsMatch = resumeText.match(/(?:Skills|skills)[\s:]*([^]*?)(?=\n(?:Experience|Education|Languages|Objective|$))/i);
  if (skillsMatch) skillsRaw = skillsMatch[1];
  const skills = skillsRaw
    .split(/[,;]|\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .slice(0, 12)
    .join('\n• ');

  // Extract education
  let educationRaw = '';
  const eduMatch = resumeText.match(/(?:Education|education)[\s:]*([^]*?)(?=\n(?:Skills|Experience|Languages|$))/i);
  if (eduMatch) educationRaw = eduMatch[1];
  const education = educationRaw
    .split('\n')
    .filter(s => s.trim().length > 0)
    .slice(0, 3)
    .join('\n• ');

  // Extract experience
  let experienceRaw = '';
  const expMatch = resumeText.match(/(?:Experience|experience)[\s:]*([^]*?)(?=\n(?:Education|Skills|Languages|$))/i);
  if (expMatch) experienceRaw = expMatch[1];
  const experience = experienceRaw
    .split(/\n(?=[A-Z])/g)
    .filter(s => s.trim().length > 0)
    .slice(0, 5)
    .map(exp => {
      const lines = exp.trim().split('\n');
      return lines.map((line, idx) => {
        if (idx === 0 && line.length > 0) return '• ' + line;
        return (line.startsWith('•') ? line : '  - ' + line);
      }).join('\n');
    })
    .join('\n');

  // Extract languages
  let languagesRaw = '';
  const langMatch = resumeText.match(/(?:Languages|languages)[\s:]*([^]*?)(?=\n(?:Skills|Experience|Education|$))/i);
  if (langMatch) languagesRaw = langMatch[1];
  const languages = languagesRaw
    .split(/[,;]|\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .join(', ');

  // Generate professional summary
  let summary = `Dedicated professional with strong expertise in ${targetRole || 'multiple areas'}.`;
  if (resumeText.match(/(?:Objective|objective|Summary|summary)[\s:]*([^]*?)(?=\n)/i)) {
    const objMatch = resumeText.match(/(?:Objective|objective|Summary|summary)[\s:]*([^]*?)(?=\n)/i);
    if (objMatch && objMatch[1].length > 5) {
      summary = objMatch[1].trim();
    }
  }
  
  // Add career goal to summary
  if (!summary.includes('role') && targetRole) {
    summary += ` Seeking ${targetRole} role to apply technical skills and contribute to organizational growth.`;
  }

  // Build formatted resume
  let improvedResume = `NAME: ${name || 'Applicant'}\n`;
  improvedResume += contact ? `CONTACT: ${contact}\n` : '';
  improvedResume += `PROFESSIONAL SUMMARY: ${summary}\n`;
  improvedResume += skills ? `SKILLS: ${skills}\n` : '';
  improvedResume += experience ? `WORK EXPERIENCE: ${experience}\n` : '';
  improvedResume += education ? `EDUCATION: ${education}\n` : '';
  improvedResume += languages ? `LANGUAGES: ${languages}\n` : '';

  console.log(`Resume improved successfully for: ${name}`);
  return improvedResume;
}

function renderHtmlFromAiText(aiText) {
  // aiText expected to include labeled sections; we'll do a simple parse
  const getSection = (label) => {
    const re = new RegExp(`${label}:[\\s\\S]*?(?=\\n[A-Z]+:|$)`, 'i');
    const match = aiText.match(re);
    return match ? match[0].replace(new RegExp(`${label}:`, 'i'), '').trim() : '';
  };
  const name = getSection('NAME') || 'Applicant';
  const contact = getSection('CONTACT') || '';
  const summary = getSection('SUMMARY') || '';
  const experience = getSection('EXPERIENCE') || '';
  const education = getSection('EDUCATION') || '';
  const skills = getSection('SKILLS') || '';

  return `
  <!doctype html>
  <html>
  <head>
    <meta charset="utf-8"/>
    <title>${name} - Resume</title>
    <style>
      body{font-family:Arial,Helvetica,sans-serif; max-width:800px; margin:24px auto; color:#111}
      h1{font-size:20px;margin:0}
      .contact{margin-bottom:14px;color:#555}
      .section{margin-top:12px}
      .section h2{font-size:14px;border-bottom:1px solid #eee;padding-bottom:6px;color:#333}
      .bullet{margin-left:18px}
      pre{white-space:pre-wrap;font-family:inherit}
    </style>
  </head>
  <body>
    <h1>${name}</h1>
    <div class="contact">${contact}</div>
    <div class="section"><h2>Professional Summary</h2><pre>${summary}</pre></div>
    <div class="section"><h2>Experience</h2><pre>${experience}</pre></div>
    <div class="section"><h2>Education</h2><pre>${education}</pre></div>
    <div class="section"><h2>Skills</h2><pre>${skills}</pre></div>
  </body>
  </html>
  `;
}

async function htmlToPdfBuffer(html) {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox','--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '20mm', bottom: '20mm' } });
  await browser.close();
  return pdfBuffer;
}

/* ========== Endpoints ========== */

// Health
app.get('/health', (req, res) => res.json({ ok: true }));

// Create a Razorpay order (client will call this to open checkout)
app.post('/api/create-order', async (req, res) => {
  try {
    if (!razorpay) {
      return res.status(503).json({ success: false, error: 'Payment system not configured. Please contact support.' });
    }
    const { amount_in_paise = 4900 } = req.body;
    const options = { amount: amount_in_paise, currency: 'INR', receipt: `srfix_${Date.now()}`, payment_capture: 1 };
    const order = await razorpay.orders.create(options);
    res.json({ success: true, order, keyId: RAZORPAY_KEY_ID });
  } catch (err) {
    console.error('create-order error', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Razorpay webhook endpoint — configure this URL in Razorpay Dashboard
app.post('/webhook/razorpay', bodyParser.json({ type: '*/*' }), async (req, res) => {
  try {
    const payload = req.body;
    if (payload.event === 'payment.captured' && payload.payload && payload.payload.payment && payload.payload.payment.entity) {
      const payment = payload.payload.payment.entity;
      console.log('Payment captured:', payment.id, payment.amount);
    }
    res.status(200).send('ok');
  } catch (err) {
    console.error('webhook error', err);
    res.status(500).send('error');
  }
});

// Generate resume endpoint (client calls after receiving payment success client-side)
app.post('/api/generate', upload.none(), async (req, res) => {
  try {
    const { provider, payment_id, order_id, resume_text, resume_type = 'Modern Professional', email, name, target_role } = req.body;
    if (!payment_id || !resume_text) return res.status(400).json({ success: false, error: 'Missing payment_id or resume_text' });

    // Verify payment with Razorpay API
    let verified = false;
    try {
      const url = `https://api.razorpay.com/v1/payments/${payment_id}`;
      const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
      const r = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
      const j = await r.json();
      if (j && (j.status === 'captured' || j.status === 'authorized')) verified = true;
    } catch (err) {
      console.error('payment verify error', err);
    }
    if (!verified) return res.status(400).json({ success: false, error: 'Payment not verified' });

    // Improve the resume using rule-based system
    const aiText = improveResume(resume_text, resume_type, target_role || '');

    // Render HTML and generate PDF
    const html = renderHtmlFromAiText(aiText);
    const pdfBuffer = await htmlToPdfBuffer(html);

    // Store PDF on server
    const fileName = `${Date.now()}_${uuidv4()}.pdf`;
    const filePath = path.join('resumes', fileName);
    fs.writeFileSync(filePath, pdfBuffer);

    // Optional: send email with attachment (if SMTP configured)
    if (EMAIL_SMTP_HOST && EMAIL_SMTP_USER && EMAIL_SMTP_PASS && email) {
      const transporter = nodemailer.createTransport({
        host: EMAIL_SMTP_HOST,
        port: Number(EMAIL_SMTP_PORT) || 587,
        secure: false,
        auth: { user: EMAIL_SMTP_USER, pass: EMAIL_SMTP_PASS }
      });
      const mailOptions = {
        from: DELIVERY_EMAIL_FROM || EMAIL_SMTP_USER,
        to: email,
        subject: 'Your Improved Resume — SmartResumeFix',
        text: 'Thanks for your order. Your improved resume is attached.',
        attachments: [{ filename: 'resume.pdf', path: filePath }]
      };
      transporter.sendMail(mailOptions).catch(err => console.error('email send error', err));
    }

    const downloadUrl = `${HOST_URL.replace(/\/$/, '')}/download/${fileName}`;
    res.json({ success: true, downloadUrl });

  } catch (err) {
    console.error('generate error', err.message);
    let userMessage = 'Resume generation failed. Please try again.';
    if (err.message.includes('empty')) {
      userMessage = 'Please paste your resume text to proceed.';
    } else if (err.message.includes('Payment not verified')) {
      userMessage = 'Payment verification failed. Please try again.';
    }
    res.status(500).json({ success: false, error: userMessage });
  }
});

// Serve generated resumes
app.get('/download/:file', (req, res) => {
  const file = path.join('resumes', req.params.file);
  if (fs.existsSync(file)) {
    res.download(file);
  } else res.status(404).send('Not found');
});

// Test endpoint for resume generation (no payment required)
app.post('/api/test-generate', upload.none(), async (req, res) => {
  try {
    const { resume_text, resume_type = 'Modern Professional', target_role = '' } = req.body;
    if (!resume_text) {
      return res.status(400).json({ success: false, error: 'Missing resume_text' });
    }
    
    const improvedText = improveResume(resume_text, resume_type, target_role);
    res.json({ success: true, aiText: improvedText });
  } catch (err) {
    console.error('test-generate error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`SmartResumeFix backend running on port ${PORT}`));