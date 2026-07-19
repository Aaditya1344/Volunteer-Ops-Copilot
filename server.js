require('dotenv').config();

const compression = require('compression');
const helmet = require('helmet');
const morgan = require('morgan');

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Import security middleware
const { queryLimiter, uploadLimiter } = require('./middleware/rateLimit');
const { validateQuestion, validateFileUpload } = require('./middleware/inputvalidator');

const firestore = require('./services/firestore');
const gemini = require('./services/gemini');

// Initializing Firestore
firestore.initFirestore();

const { PDFParse } = require('pdf-parse');
const { translate } = require('google-translate-api-x');
const csv = require('csv-parser');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 8080;

// CORS configuration — tighter security
const corsOptions = {
  origin: [
    'http://localhost:8080',
    'http://localhost:3000',
    'https://vantage-ops.onrender.com'
  ],
  credentials: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
};

app.use(cors(corsOptions));

app.use(helmet({
  contentSecurityPolicy: false // disabled to allow inline scripts in public/
}));
app.use(compression());
app.use(morgan('combined'));

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Multer file upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['.csv', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only .csv and .pdf files are accepted.'));
    }
  }
});

// Load venue config
const VENUE_CONFIG_PATH = path.join(__dirname, 'venue.config.json');
let venueConfig = {
  venueName: "MetLife Stadium",
  officialTournamentName: "New York New Jersey Stadium",
  capacity: 82500,
  zones: ["Club", "Field", "Mezzanine", "Upper"],
  city: "East Rutherford"
};
if (fs.existsSync(VENUE_CONFIG_PATH)) {
  try {
    venueConfig = JSON.parse(fs.readFileSync(VENUE_CONFIG_PATH, 'utf8'));
    console.log('Loaded venue configuration:', venueConfig.venueName);
  } catch (err) {
    console.error('Failed to parse venue.config.json, using defaults:', err);
  }
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------------------------------------
// SOP Knowledge Base Configuration
// ----------------------------------------------------
const SOP_CONTEXT = [
  "1. Crowd Bottleneck: If a gate queue length exceeds 90% of capacity or the inflow rate exceeds 40 fans/min for 10+ minutes, redirect incoming fans to the nearest under-capacity gate in the same or adjacent zone and alert the central control room.",
  "2. Medical Incident: Escalate all medical reports to the on-site medical team (dispatch code MED-RED) within 3 minutes of report. Volunteers must not attempt direct treatment or administer medication. Keep the patient comfortable and clear a 5-meter path.",
  "3. Lost Child: Immediately escalate to venue staff and the central announcement team. Keep the reporting parent/fan at a fixed, well-lit location. Do not broadcast the child's name over public speakers (broadcast description only).",
  "4. Lost Item: Log the item description and location found at the nearest Guest Services Desk (locations at Section 124, 224, 324). Do not leave your post to search for lost items.",
  "5. Evacuation: In emergency situations, follow the posted zone evacuation routes. Keep fans calm, instruct them to walk (never run), and guide them toward the designated external parking lot assembly areas.",
  "6. Ticket Dispute: Direct fans with ticket scanning errors or seating conflicts to the nearest main Box Office or Guest Services Desk. Do not attempt to arbitrate disputes.",
  "7. Severe Weather: If lightning or high-winds alerts occur, instruct all fans in exposed upper sections (Upper/Mezzanine zones) to move to the covered concourses immediately. Secure loose operational signage.",
  "8. Unruly Fan Behavior: If a fan becomes physically aggressive or disruptive, do not engage. Signal stadium security immediately using dispatch code SEC-ORANGE and record details of the section, row, and seat.",
  "9. Suspicious Package: If an unattended, unusual bag is found, do not touch or move it. Quietly clear a 50-foot perimeter around the item and immediately notify the security supervisor (dispatch code SEC-BLACK).",
  "10. Power Outage: Instruct fans to remain seated. Use hand-held flashlights to guide fans along stairways only if immediate movement is deemed necessary by venue command.",
  "11. Gate Equipment Failure: Switch ticket scanning terminals to offline backup scan mode or visual check. Inform the technical support desk and redirect 25% of the queue to adjacent operational lines.",
  "12. VIP/VVIP Escort: Direct all credentialed VIP guests to the VIP lobby at the West Club Entrance. Ensure paths are clear of general spectator blockages.",
  "13. Disabled Access (ADA): Provide direct escorts or clear directions to elevator banks located at Sections 104, 124, 204, and 224 for any fan indicating mobility needs.",
  "14. Stretcher Request: Notify central medical dispatch immediately. Instruct nearby volunteers to clear a wide path from the nearest service tunnel to the incident location.",
  "15. Media Access: Direct unauthorized camera crews or reporters in restricted operational zones to the official Press Box (Level 4, Center). Do not answer stadium ops questions on camera.",
  "16. Alcohol Control: All concession alcohol sales must cease at the 75th minute. If a fan appears heavily intoxicated, refuse service, notify a supervisor, and monitor for potential medical/unruly behavior escalation."
].join("\n");

// ----------------------------------------------------
// CSV Parser & Auto-detection
// ----------------------------------------------------
function parseCSV(buffer) {
  return new Promise((resolve, reject) => {
    const results = [];
    const stream = Readable.from(buffer.toString());

    stream
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => {
        resolve(results);
      })
      .on('error', (error) => {
        reject(error);
      });
  });
}
async function parsePDF(buffer) {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return result.text.trim();
}

function detectSchema(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return 'empty';
  }
  const firstRow = data[0];
  const keys = Object.keys(firstRow).map(k => k.toLowerCase().trim());

  if (keys.includes('gate') && (keys.includes('queue_length') || keys.includes('capacity') || keys.includes('inflow_rate_per_min'))) {
    return 'gate_status';
  }
  if (keys.includes('incident_type') || keys.includes('minutes_since_report') || keys.includes('location')) {
    return 'incident_log';
  }
  return 'generic';
}

// ----------------------------------------------------
// Helper to extract numeric values from LIVE_DATA
// ----------------------------------------------------
function extractNumbersFromData(liveData) {
  const numbers = new Set();
  if (!liveData || !Array.isArray(liveData.data)) return numbers;

  liveData.data.forEach(row => {
    Object.entries(row).forEach(([, val]) => {
      // Find all numbers in values
      if (typeof val === 'string' || typeof val === 'number') {
        const matches = String(val).match(/\b\d+(?:\.\d+)?\b/g);
        if (matches) {
          matches.forEach(numStr => {
            const num = parseFloat(numStr);
            if (!isNaN(num)) {
              numbers.add(num);
              // Also add integer if it has a trailing .0
              if (Number.isInteger(num)) {
                numbers.add(Math.floor(num));
              }
            }
          });
        }
      }
    });

    // Special calculated capacity percentages (e.g. queue_length / capacity)
    if (row.queue_length && row.capacity) {
      const q = parseFloat(row.queue_length);
      const cap = parseFloat(row.capacity);
      if (!isNaN(q) && !isNaN(cap) && cap > 0) {
        const pct = Math.round((q / cap) * 100);
        numbers.add(pct);
      }
    }
  });

  return numbers;
}

async function detectLanguage(text) {
  if (!text || text.trim().length < 3) return 'en';
  try {
    const result = await translate(text, { to: 'en' });
    const detected = result.raw?.src || result.from?.language?.iso || 'en';
    return detected;
  } catch (err) {
    console.warn('Language detection failed, defaulting to English:', err.message);
    return 'en';
  }
}

async function translateText(text, targetLangCode) {
  if (!text || !targetLangCode || targetLangCode === 'en') return null;
  try {
    const result = await translate(text, { to: targetLangCode });
    return result.text;
  } catch (err) {
    console.warn(`Translation failed for ${targetLangCode}:`, err.message);
    return null;
  }
}


// ----------------------------------------------------
// API Route Handlers
// ----------------------------------------------------

// Upload Endpoint
app.post('/api/upload',  uploadLimiter, upload.single('file'), validateFileUpload, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    let liveDataSnapshot;

    if (ext === '.pdf') {
      const extractedText = await parsePDF(req.file.buffer);
      if (!extractedText) {
        return res.status(400).json({ error: 'PDF contained no extractable text.' });
      }
      liveDataSnapshot = {
        type: 'pdf_text',
        timestamp: new Date().toISOString(),
        filename: req.file.originalname,
        rawText: extractedText,
        data: [] // kept for consistency with CSV shape; grounding guard checks 'data'
      };
    } else {
      const rawData = await parseCSV(req.file.buffer);
      const type = detectSchema(rawData);
      liveDataSnapshot = {
        type: type,
        timestamp: new Date().toISOString(),
        filename: req.file.originalname,
        data: rawData
      };
    }

    await firestore.setLiveData(liveDataSnapshot);
    await firestore.clearHistory();

    res.json({
      success: true,
      type: liveDataSnapshot.type,
      recordCount: liveDataSnapshot.data ? liveDataSnapshot.data.length : 0,
      filename: req.file.originalname
    });
  } catch (err) {
    console.error('Upload parsing failed:', err);
    res.status(500).json({ error: 'Failed to parse file: ' + err.message });
  }
});
app.use((err, req, res) => {
  console.error('Unhandled error:', err.message);
  if (!res.headersSent) {
    res.status(400).json({ error: err.message || 'An unexpected error occurred.' });
  }
});


// Get all venues + currently active one
app.get('/api/venue-config', (req, res) => {
  res.json(venueConfig);
});

// Health check endpoint — used by Render for uptime monitoring
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    venue: venueConfig.venueName,
    firebase: !firestore.isUsingLocalDb() ? 'connected' : 'local_fallback',
    uptime: Math.floor(process.uptime()) + 's'
  });
});

// Status Endpoint
app.get('/api/status', async (req, res) => {
  try {
    const liveData = await firestore.getLiveData();
    res.json({
      type: liveData.type || 'empty',
      timestamp: liveData.timestamp || null,
      filename: liveData.filename || null,
      recordCount: liveData.data ? liveData.data.length : 0,
      data: liveData.data || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Query Endpoint
app.post('/api/query', queryLimiter, validateQuestion, async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    const liveData = await firestore.getLiveData();
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY environment variable is not configured.' });
    }

    // Prepare live data JSON for prompt
    const liveDataJsonString = liveData.type === 'pdf_text'
      ? JSON.stringify({ type: 'pdf_text', filename: liveData.filename, extractedText: liveData.rawText }, null, 2)
      : JSON.stringify(liveData, null, 2);
    const systemPrompt = `You are the Volunteer Ops Copilot for ${venueConfig.officialTournamentName} (${venueConfig.venueName}), a FIFA World Cup 2026 host venue (capacity ${venueConfig.capacity.toLocaleString()}; zones: ${venueConfig.zones.join(', ')}).
You will receive:
1. LIVE_DATA — a JSON snapshot of current stadium conditions (gate queue lengths, crowd inflow rates, incident logs, timestamps), parsed from a file uploaded by an organizer or judge. Always reason from whatever LIVE_DATA is given, never from memory of a previous request.
2. SOP_CONTEXT — standard operating procedures for common situations (bottlenecks, medical incidents, lost items, lost children, evacuation, ticket disputes).
3. 3. A volunteer's question, possibly in any language, possibly on behalf of a fan.
Rules:
- Always respond in English regardless of the language of the question. The recommendation, reasoning, and urgency must always be in English. Translation is handled separately after your response.
- Every recommendation must cite specific numbers/fields from LIVE_DATA and explain why in the "reasoning" field. Never give generic advice.
- Never claim you lack real-time data — reason from the snapshot given, and state assumptions if data is incomplete.
- If LIVE_DATA is empty or malformed, say so in "reasoning" and give the most honest, useful guidance available, with urgency "low" unless the question itself signals danger.
- Flag urgency clearly (medical, safety, crowd crush, lost child = high) and recommend escalation per SOP_CONTEXT.
- Do not invent SOP rules not present in SOP_CONTEXT.

Respond with ONLY this JSON shape, no markdown, no extra text:
{
  "recommendation": "<short, actionable instruction>",
  "reasoning": "<why, citing specific LIVE_DATA fields>",
  "urgency": "low" | "medium" | "high",
  "fan_facing_translation": null
}

Few-shot Example 1:
LIVE_DATA:
{
  "type": "gate_status",
  "timestamp": "2026-07-09T18:40:00Z",
  "data": [
    { "gate": "Gate A - Club Level", "queue_length": "850", "capacity": "1000", "inflow_rate_per_min": "45", "zone": "Club" }
  ]
}
SOP_CONTEXT: (Bottleneck: redirection if capacity > 90% or inflow > 40/min)
Question: "Is Gate A crowded?" (Target Language: Spanish)
Response:
{
  "recommendation": "Redirect incoming fans from Gate A to the nearest under-capacity gate.",
  "reasoning": "Gate A queue length is at 850 (85% of its 1000 capacity) and inflow rate is 45 fans/min, which exceeds the 40/min limit defined in SOP rule 1. Urgency is medium.",
  "urgency": "medium",
  "fan_facing_translation": "Por favor, diríjase a otra puerta de acceso menos congestionada."
}

Few-shot Example 2:
LIVE_DATA:
{
  "type": "incident_log",
  "timestamp": "2026-07-09T18:38:00Z",
  "data": [
    { "timestamp": "2026-07-09T18:38:00Z", "incident_type": "medical", "location": "Section 128 Mezzanine", "status": "reported", "minutes_since_report": "2" }
  ]
}
SOP_CONTEXT: (Medical: escalate inside 3 mins)
Question: "Help, someone near Section 128 collapsed!" (Target Language: Spanish)
Response:
{
  "recommendation": "Escalate to the medical team immediately using code MED-RED and clear a 5-meter path.",
  "reasoning": "A medical incident at Section 128 Mezzanine was reported 2 minutes ago (minutes_since_report=2). According to SOP rule 2, all medical incidents must be escalated immediately within 3 minutes.",
  "urgency": "high",
  "fan_facing_translation": "El equipo médico está en camino. Por favor, mantenga la calma y deje espacio despejado."
}
`;

    const userContent = `LIVE_DATA:
    ${liveDataJsonString}

    SOP_CONTEXT:
    ${SOP_CONTEXT}

    Volunteer Question: "${question}"
    `;

    // Construct body for Gemini API Call
    const apiBody = {
      contents: [
        {
          role: 'user',
          parts: [{ text: `${systemPrompt}\n\nNow process the following:\n${userContent}` }]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            recommendation: { type: 'STRING' },
            reasoning: { type: 'STRING' },
            urgency: { type: 'STRING', enum: ['low', 'medium', 'high'] },
            fan_facing_translation: { type: 'STRING', nullable: true }
          },
          required: ['recommendation', 'reasoning', 'urgency', 'fan_facing_translation']
        }
      }
    };

    let aiResponse;
    let usedProvider = 'gemini';

    try {
      // --- Try Gemini first ---
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
      const geminiResponse = await gemini.withTimeout(
        gemini.callGeminiWithRetry(geminiUrl, apiBody),
        45000 // 45 seconds — adjust to 30000 or 60000 if needed
      );

      if (!geminiResponse.ok) {
        await geminiResponse.text();
        console.warn(`Gemini failed (${geminiResponse.status}), falling back to Groq...`);
        throw new Error(`Gemini failed: ${geminiResponse.status}`);
      }

      const geminiResult = await geminiResponse.json();
      const textOutput = geminiResult.candidates[0].content.parts[0].text;
      aiResponse = JSON.parse(textOutput);

    } catch (geminiErr) {
      // --- Fallback to Groq ---
      console.warn('Switching to Groq fallback:', geminiErr.message);
      try {
        aiResponse = await gemini.callGroq(systemPrompt, userContent);
        usedProvider = 'groq';
        console.log('Groq fallback succeeded.');
      } catch (groqErr) {
        console.error('Both Gemini and Groq failed:', groqErr.message);
        return res.status(503).json({
          errorCode: 'copilot_busy',
          error: 'The AI service is experiencing high demand. Please try your question again in a few seconds.'
        });
      }
    }

    // Validate response shape (both providers should return the same shape)
    if (!aiResponse || !aiResponse.recommendation || !aiResponse.urgency) {
      console.error('Invalid AI response shape:', aiResponse);
      return res.status(500).json({
        errorCode: 'copilot_error',
        error: 'Something went wrong processing that question. Please try again.'
      });
    }
    // Auto-detect question language and translate recommendation back if non-English
    const detectedLang = await detectLanguage(question);
    if (detectedLang && detectedLang !== 'en') {
      aiResponse.fan_facing_translation = await translateText(aiResponse.recommendation, detectedLang);
      aiResponse.detectedLanguage = detectedLang;
    } else {
      aiResponse.fan_facing_translation = null;
      aiResponse.detectedLanguage = 'en';
    }

    console.log(`[INFO] Response generated by: ${usedProvider}`);

    // ----------------------------------------------------
    // Code-Level Grounding Guard (Backend Safeguard)
    // ----------------------------------------------------
    if (liveData && liveData.data && liveData.data.length > 0) {
      const numbersInCsv = extractNumbersFromData(liveData);
      const reasoningText = aiResponse.reasoning || '';

      // Find all numbers cited in reasoning
      const numbersInReasoning = reasoningText.match(/\b\d+(?:\.\d+)?\b/g);
      let isGrounded = false;

      if (numbersInReasoning) {
        for (const numStr of numbersInReasoning) {
          const val = parseFloat(numStr);
          if (numbersInCsv.has(val)) {
            isGrounded = true;
            break;
          }
        }
      }

      aiResponse.isGrounded = isGrounded;

      if (!isGrounded) {
        console.warn(`[WARNING] Grounding safeguard failed: AI response reasoning does not cite any numeric data from the active LIVE_DATA snapshot. Reasoning given: "${reasoningText}"`);
      } else {
        console.log('[INFO] Grounding safeguard passed: AI response contains validated live data citation.');
      }
    } else {
      // No numeric data available to check against (e.g. empty snapshot, or a PDF)
      aiResponse.isGrounded = null;
    }

    // Add entry to history/ops log
    const historyEntry = {
      timestamp: new Date().toISOString(),
      question,
      detectedLanguage: aiResponse.detectedLanguage || 'en',
      recommendation: aiResponse.recommendation,
      reasoning: aiResponse.reasoning,
      urgency: aiResponse.urgency,
      fan_facing_translation: aiResponse.fan_facing_translation,
      datasetFilename: liveData.filename || 'No data uploaded',
      provider: usedProvider
    };

    await firestore.addHistoryEntry(historyEntry);

    res.json(aiResponse);
  } catch (err) {
    console.error('API query failed:', err);
    res.status(500).json({
      errorCode: 'copilot_error',
      error: 'Something went wrong processing that question. Please try again.'
    });
  }
});

// History Endpoint
app.get('/api/history', async (req, res) => {
  try {
    const history = await firestore.getHistory();
    res.json(Array.isArray(history) ? history : []);
  } catch (err) {
    console.error('[DEBUG] getHistory error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0' , () => {
  console.log(`Volunteer Ops Copilot server running on port ${PORT}`);
});
