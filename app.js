document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const fileInput = document.getElementById('file-input');
  const uploadZone = document.getElementById('upload-zone');
  const btnClear = document.getElementById('btn-clear');
  
  const metaFilename = document.getElementById('meta-filename');
  const metaType = document.getElementById('meta-type');
  const metaCount = document.getElementById('meta-count');
  const metaTimestamp = document.getElementById('meta-timestamp');
  
  const tableHeaders = document.getElementById('table-headers');
  const tableBody = document.getElementById('table-body');
  
  const queryForm = document.getElementById('query-form');
  const volunteerQuestion = document.getElementById('volunteer-question');
  const targetLang = document.getElementById('target-lang');
  const btnSubmit = document.getElementById('btn-submit');
  
  const responseLoading = document.getElementById('response-loading');
  const responseEmpty = document.getElementById('response-empty');
  const responseCard = document.getElementById('response-card');
  const responseConsole = document.getElementById('response-console');
  
  const urgencyBadge = document.getElementById('urgency-badge');
  const urgencyIcon = document.getElementById('urgency-icon');
  const urgencyText = document.getElementById('urgency-text');
  
  const resultRecommendation = document.getElementById('result-recommendation');
  const resultReasoning = document.getElementById('result-reasoning');
  const translationBlock = document.getElementById('translation-block');
  const translationTitle = document.getElementById('translation-title');
  const resultTranslation = document.getElementById('result-translation');
  
  const logTableBody = document.getElementById('log-table-body');
  const headerStatusPanel = document.getElementById('header-status-panel');

  // Base API URL
  const API_BASE = '';

  // Initial Load
  refreshStatus();
  refreshHistory();

  // Drag and Drop handlers
  ['dragenter', 'dragover'].forEach(eventName => {
    uploadZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      uploadZone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    uploadZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      uploadZone.classList.remove('dragover');
    }, false);
  });

  uploadZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      uploadFile(files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (fileInput.files.length > 0) {
      uploadFile(fileInput.files[0]);
    }
  });

  // Query Submit Handler
  queryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = volunteerQuestion.value.trim();
    const language = targetLang.value;

    if (!question) return;

    // UI Feedback state
    btnSubmit.disabled = true;
    responseEmpty.classList.add('hidden');
    responseCard.classList.add('hidden');
    responseLoading.classList.remove('hidden');
    responseConsole.setAttribute('aria-busy', 'true');

    try {
      const response = await fetch(`${API_BASE}/api/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, targetLanguage: language })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Server error occurred');
      }

      const result = await response.json();
      displayAIResponse(result);
      refreshHistory();
    } catch (err) {
      alert(`Query failed: ${err.message}`);
      responseEmpty.classList.remove('hidden');
    } finally {
      btnSubmit.disabled = false;
      responseLoading.classList.add('hidden');
      responseConsole.setAttribute('aria-busy', 'false');
    }
  });

  // Clear Handler
  btnClear.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to clear the active live data snapshot and history logs?')) return;
    try {
      const response = await fetch(`${API_BASE}/api/clear`, { method: 'POST' });
      if (response.ok) {
        refreshStatus();
        refreshHistory();
        resetAIConsole();
      }
    } catch (err) {
      console.error('Clear failed:', err);
    }
  });

  // Upload File Logic
  async function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${API_BASE}/api/upload`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to upload CSV');
      }

      const data = await response.json();
      alert(`Success! File "${data.filename}" parsed as "${data.type}" schema with ${data.recordCount} rows.`);
      refreshStatus();
    } catch (err) {
      alert(`Upload failed: ${err.message}`);
    }
  }

  // Refresh status and populate table
  async function refreshStatus() {
    try {
      const response = await fetch(`${API_BASE}/api/status`);
      const status = await response.json();

      if (status.type !== 'empty') {
        // Update header indicator
        headerStatusPanel.innerHTML = `<span class="status-dot online"></span><span class="status-text">Active: ${status.filename} (${status.type})</span>`;
        
        // Update metadata card
        metaFilename.textContent = status.filename || 'Unknown';
        metaType.textContent = formatSchemaType(status.type);
        metaCount.textContent = status.recordCount;
        metaTimestamp.textContent = new Date(status.timestamp).toLocaleTimeString();
        
        // Populate records table
        renderTable(status.data);
      } else {
        headerStatusPanel.innerHTML = `<span class="status-dot offline"></span><span class="status-text">No active snapshot</span>`;
        metaFilename.textContent = '—';
        metaType.textContent = '—';
        metaCount.textContent = '—';
        metaTimestamp.textContent = '—';
        
        tableHeaders.innerHTML = `<th scope="col">No data loaded</th>`;
        tableBody.innerHTML = `<tr><td>Please upload a CSV dataset to view real-time records.</td></tr>`;
      }
    } catch (err) {
      console.error('Status check failed:', err);
    }
  }

  // Refresh Ops Intelligence Feed History
  async function refreshHistory() {
    try {
      const response = await fetch(`${API_BASE}/api/history`);
      const history = await response.json();

      if (!history || history.length === 0) {
        logTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted">No historical inquiries logged yet.</td></tr>`;
        return;
      }

      logTableBody.innerHTML = history.map(entry => {
        const timeStr = new Date(entry.timestamp).toLocaleTimeString();
        const transHtml = entry.fan_facing_translation 
          ? `<div class="log-trans"><strong>Translated (${entry.targetLanguage}):</strong> ${entry.fan_facing_translation}</div>`
          : '';

        return `
          <tr>
            <td class="log-time">${timeStr}</td>
            <td>
              <div class="log-query">${escapeHtml(entry.question)}</div>
            </td>
            <td><span class="meta-label">${escapeHtml(entry.datasetFilename)}</span></td>
            <td>
              <span class="badge ${entry.urgency}">${entry.urgency.toUpperCase()}</span>
            </td>
            <td>
              <div class="log-rec">${escapeHtml(entry.recommendation)}</div>
              <div class="log-reason">${escapeHtml(entry.reasoning)}</div>
              ${transHtml}
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  }

  // Helpers
  function formatSchemaType(type) {
    if (type === 'gate_status') return 'Stadium Gate Status';
    if (type === 'incident_log') return 'Active Incident Log';
    return 'Generic CSV Dataset';
  }

  function resetAIConsole() {
    responseCard.classList.add('hidden');
    responseEmpty.classList.remove('hidden');
  }

  function displayAIResponse(ai) {
    // Recommendation & Reasoning
    resultRecommendation.textContent = ai.recommendation;
    resultReasoning.textContent = ai.reasoning;

    // Urgency styling: icon + text + class
    urgencyBadge.className = `urgency-badge ${ai.urgency}`;
    urgencyText.textContent = ai.urgency;
    if (ai.urgency === 'high') {
      urgencyIcon.textContent = '🚨';
    } else if (ai.urgency === 'medium') {
      urgencyIcon.textContent = '⚠️';
    } else {
      urgencyIcon.textContent = 'ℹ️';
    }

    // Translation block
    if (ai.fan_facing_translation) {
      translationBlock.classList.remove('hidden');
      translationTitle.textContent = `Translation for Fan (${targetLang.value}):`;
      resultTranslation.textContent = ai.fan_facing_translation;
    } else {
      translationBlock.classList.add('hidden');
    }

    responseCard.classList.remove('hidden');
  }

  function renderTable(data) {
    if (!Array.isArray(data) || data.length === 0) return;
    
    // Extract headers dynamically from object keys
    const headers = Object.keys(data[0]);
    tableHeaders.innerHTML = headers.map(h => `<th scope="col">${escapeHtml(h)}</th>`).join('');

    tableBody.innerHTML = data.map(row => {
      return `<tr>${headers.map(h => `<td>${escapeHtml(row[h] || '')}</td>`).join('')}</tr>`;
    }).join('');
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
