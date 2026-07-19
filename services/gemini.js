/*
 Calls Gemini API with exponential backoff retry on 503/429 errors
 @param {string} url - Gemini API endpoint URL
 @param {Object} apiBody - Request body for Gemini API
 @param {number} maxRetries - Maximum number of retry attempts (default: 2)
 @returns {Promise<Response>} - Fetch response object
 */
async function callGeminiWithRetry(url, apiBody, maxRetries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(apiBody)
    });

    if (response.ok) {
      return response;
    }

    if ((response.status === 503 || response.status === 429) && attempt < maxRetries) {
      const waitMs = 1000 * Math.pow(2, attempt);
      console.warn(`Gemini API returned ${response.status}, retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})...`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
      lastError = response;
      continue;
    }

    return response;
  }
  return lastError;
}

/*
 * Calls Groq API as fallback when Gemini is unavailable
 * @param {string} systemPrompt - System prompt for the AI
 * @param {string} userContent - User content including LIVE_DATA and question
 * @returns {Promise<Object>} - Parsed AI response JSON
 */

async function callGroq(systemPrompt, userContent) {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not configured.');

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API failed with status ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  const text = result.choices[0].message.content;
  return JSON.parse(text);
}
/*
 * Wraps a promise with a timeout — rejects if promise doesn't resolve within ms
 * @param {Promise} promise - Promise to wrap
 * @param {number} ms - Timeout in milliseconds
 * @returns {Promise} - Race between original promise and timeout
 */
function withTimeout(promise, ms) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Request timed out after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
}

module.exports = {
  callGeminiWithRetry,
  callGroq,
  withTimeout
};