# Volunteer Ops Copilot — FIFA World Cup 2026 (MetLife Stadium)

Volunteer Ops Copilot is a reasoning-based GenAI assistant for volunteers on the ground at New York New Jersey Stadium (MetLife Stadium) during the FIFA World Cup 2026. The app enables real-time operational decision-making by reasoning over live CSV uploads and a built-in Standard Operating Procedures (SOP) database.

## Design Narrative & Scope

> "One reasoning engine, driven by a unified SOP knowledge base, handles multiple operational categories (crowd flow, medical, safety, security, accessibility) — the app is intentionally scoped to one persona (volunteers) and one reasoning core, not a multi-app suite."

## Key Features

1. **True AI Reasoning over Live Data**: The backend feeds active CSV data directly into Gemini alongside 16 World Cup SOP protocols. The AI explains its recommendation by citing specific metrics.
2. **Schema Auto-detection**: Automatically detects whether an uploaded file is a `gate_status.csv` or an `incident_log.csv` without needing manual schema selection.
3. **Safety Grounding Guard**: Enforces code-level validation on the backend to verify that Gemini's reasoning citing contains actual numbers from the live dataset snapshot.
4. **Ops Activity Log**: Automatically records every query and reasoning outcome in a centralized history feed (backed by Firestore, with a local-file fallback).
5. **Accessibility Built-in**: Full compliance with keyboard focus indicators, skip links, semantic grid headers, and `aria-live` screen reader announcements.

---

## Local Setup & Run

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher) installed on your machine.

### 2. Install Dependencies
Initialize and install project dependencies:
```bash
npm install
```

### 3. Environment Configuration
Create a `.env` file in the project root:
```env
PORT=8080
GEMINI_API_KEY=AIzaSy...your_gemini_api_key...
```

*Note: If no Google Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`) are found, the app automatically switches to the `local_db.json` database fallback, meaning you do not need complex GCP settings to run/test locally.*

### 4. Run the Dev Server
Start the Express server:
```bash
npm start
```
Open [http://localhost:8080](http://localhost:8080) in your browser.

---

## Cloud Run Deployment

You can package and deploy this application as a single Cloud Run service using Google Cloud Build:

```bash
# Build & Deploy
gcloud run deploy volunteer-ops-copilot \
  --source . \
  --region us-east1 \
  --allow-unauthenticated \
  --set-env-vars="GEMINI_API_KEY=your_key_here"
```

---

## Verification Test Cases

### Test 1: Grounding Citation Verification (Gate Congestion)
1. In the app, upload a CSV containing this record:
   ```csv
   timestamp,gate,queue_length,capacity,inflow_rate_per_min,zone
   2026-07-09T18:40:00Z,Gate C - Mezzanine,850,1000,42,Mezzanine
   ```
2. Ask: *"Is Gate C crowded?"* with translation set to **Spanish**.
3. Verify that:
   - The returned response contains the numbers `850` and `1000` (or `85%`) in its reasoning.
   - The urgency status is flagged as **medium** (due to high queue capacity/inflow rate exceeding threshold).
   - A correct Spanish translation is supplied for the fan.
