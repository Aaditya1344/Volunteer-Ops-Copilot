const express = require('express');
const cors = require('cors');
const multer = require('multer');
const csv = require('csv-parser');
const { Readable } = require('stream');
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for in-memory file handling
const upload = multer({ storage: multer.memoryStorage() });

// Local JSON File Database Fallback
const LOCAL_DB_PATH = path.join(__dirname, 'local_db.json');

// Initialize Local Store
let localDb = {
  liveData: { type: 'empty', timestamp: null, data: [] },
  history: []
};

// Load existing local database if present
if (fs.existsSync(LOCAL_DB_PATH)) {
  try {
    localDb = JSON.parse(fs.readFileSync(LOCAL_DB_PATH, 'utf8'));
    console.log('Loaded database from local storage.');
  } catch (err) {
    console.error('Failed to parse local_db.json, starting fresh:', err);
  }
}

// Write to Local DB helper
function saveLocalDb() {
  try {
    fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(localDb, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving local_db.json:', err);
  }
}

// Initialize Firestore with fallback
let db = null;
let useLocalDb = true;

if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_CONFIG) {
  try {
    admin.initializeApp();
    db = admin.firestore();
    useLocalDb = false;
    console.log('Firebase initialized successfully. Using Firestore.');
  } catch (e) {
    console.warn('Firebase failed to initialize. Falling back to local store.', e.message);
  }
} else {
  console.log('No Firebase credentials found. Running in local fallback mode (local_db.json).');
}

// Database CRUD Abstraction
async function getLiveData() {
  if (useLocalDb) {
    return localDb.liveData;
  }
  try {
    const doc = await db.collection('stadium_state').doc('live').get();
    if (doc.exists) {
      return doc.data();
    }
    return { type: 'empty', timestamp: null, data: [] };
  } catch (e) {
    console.error('Firestore getLiveData failed, using local fallback:', e);
    return localDb.liveData;
  }
}

async function setLiveData(liveData) {
  if (useLocalDb) {
    localDb.liveData = liveData;
    saveLocalDb();
    return;
  }
  try {
    await db.collection('stadium_state').doc('live').set(liveData);
  } catch (e) {
    console.error('Firestore setLiveData failed, saving local:', e);
    localDb.liveData = liveData;
    saveLocalDb();
  }
}

async function addHistoryEntry(entry) {
  entry.timestamp = entry.timestamp || new Date().toISOString();
  if (useLocalDb) {
    localDb.history.unshift(entry); // Prepend to show newest first
    // Cap at 100 entries
    if (localDb.history.length > 100) localDb.history.pop();
    saveLocalDb();
    return;
  }
  try {
    await db.collection('history').add(entry);
  } catch (e) {
    console.error('Firestore addHistoryEntry failed, saving local:', e);
    localDb.history.unshift(entry);
    saveLocalDb();
  }
}

async function getHistory() {
  if (useLocalDb) {
    return localDb.history;
  }
  try {
    const snapshot = await db.collection('history')
      .orderBy('timestamp', 'desc')
      .limit(50)
      .get();
    const history = [];
    snapshot.forEach(doc => {
      history.push(doc.data());
    });
    return history;
  } catch (e) {
    console.error('Firestore getHistory failed, using local:', e);
    return localDb.history;
  }
}

async function clearDatabase() {
  const emptyData = { type: 'empty', timestamp: null, data: [] };
  if (useLocalDb) {
    localDb.liveData = emptyData;
    localDb.history = [];
    saveLocalDb();
    return;
  }
  try {
    await db.collection('stadium_state').doc('live').set(emptyData);
    // Delete history collection documents
    const snapshot = await db.collection('history').get();
    const batch = db.batch();
    snapshot.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
  } catch (e) {
    console.error('Firestore clear failed, clearing local:', e);
    localDb.liveData = emptyData;
    localDb.history = [];
    saveLocalDb();
  }
}

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
    Object.entries(row).forEach(([key, val]) => {
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

// ----------------------------------------------------
// API Route Handlers
// ----------------------------------------------------

// Upload Endpoint
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const rawData = await parseCSV(req.file.buffer);
    const type = detectSchema(rawData);

    const liveDataSnapshot = {
      type: type,
      timestamp: new Date().toISOString(),
      filename: req.file.originalname,
      data: rawData
    };

    await setLiveData(liveDataSnapshot);

    res.json({
      success: true,
      type: type,
      recordCount: rawData.length,
      filename: req.file.originalname
    });
  } catch (err) {
    console.error('Upload parsing failed:', err);
    res.status(500).json({ error: 'Failed to parse CSV file: ' + err.message });
  }
});

// Status Endpoint
app.get('/api/status', async (req, res) => {
  try {
    const liveData = await getLiveData();
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

// Clear Endpoint
app.post('/api/clear', async (req, res) => {
  try {
    await clearDatabase();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Query Endpoint
app.post('/api/query', async (req, res) => {
  try {
    const { question, targetLanguage } = req.body;
    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    const liveData = await getLiveData();
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY environment variable is not configured.' });
    }

    // Prepare live data JSON for prompt
    const liveDataJsonString = JSON.stringify(liveData, null, 2);

    const systemPrompt = `You are the Volunteer Ops Copilot for New York New Jersey Stadium (MetLife Stadium), a FIFA World Cup 2026 host venue (capacity 82,500; zones: Club, Field, Mezzanine, Upper). You assist on-ground volunteers helping fans in real time.

You will receive:
1. LIVE_DATA — a JSON snapshot of current stadium conditions (gate queue lengths, crowd inflow rates, incident logs, timestamps), parsed from a file uploaded by an organizer or judge. Always reason from whatever LIVE_DATA is given, never from memory of a previous request.
2. SOP_CONTEXT — standard operating procedures for common situations (bottlenecks, medical incidents, lost items, lost children, evacuation, ticket disputes).
3. A volunteer's question, possibly in any language, possibly on behalf of a fan, possibly specifying a target language for a fan-facing reply.

Rules:
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
  "fan_facing_translation": "<translated recommendation, or null>"
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
${targetLanguage ? `Target Language for Translation: "${targetLanguage}"` : ''}
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

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apiBody)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API Request failed with status ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    const textOutput = result.candidates[0].content.parts[0].text;
    const aiResponse = JSON.parse(textOutput);

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

      if (!isGrounded) {
        console.warn(`[WARNING] Grounding safeguard failed: AI response reasoning does not cite any numeric data from the active LIVE_DATA snapshot. Reasoning given: "${reasoningText}"`);
      } else {
        console.log('[INFO] Grounding safeguard passed: AI response contains validated live data citation.');
      }
    }

    // Add entry to history/ops log
    const historyEntry = {
      timestamp: new Date().toISOString(),
      question,
      targetLanguage: targetLanguage || null,
      recommendation: aiResponse.recommendation,
      reasoning: aiResponse.reasoning,
      urgency: aiResponse.urgency,
      fan_facing_translation: aiResponse.fan_facing_translation,
      datasetFilename: liveData.filename || 'No data uploaded'
    };

    await addHistoryEntry(historyEntry);

    res.json(aiResponse);
  } catch (err) {
    console.error('API query failed:', err);
    res.status(500).json({ error: 'Failed to process question: ' + err.message });
  }
});

// History Endpoint
app.get('/api/history', async (req, res) => {
  try {
    const history = await getHistory();
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Volunteer Ops Copilot server running on port ${PORT}`);
});
