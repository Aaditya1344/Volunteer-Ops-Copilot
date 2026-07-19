const { withTimeout, callGeminiWithRetry } = require('../services/gemini');

test('withTimeout resolves when promise resolves in time', async () => {
  const fast = Promise.resolve('done');
  const result = await withTimeout(fast, 5000);
  expect(result).toBe('done');
});

test('withTimeout rejects when promise exceeds timeout', async () => {
  const slow = new Promise(resolve => setTimeout(resolve, 5000));
  await expect(withTimeout(slow, 100)).rejects.toThrow('timed out');
});

test('callGeminiWithRetry is a function', () => {
  expect(typeof callGeminiWithRetry).toBe('function');
});

test('withTimeout is a function', () => {
  expect(typeof withTimeout).toBe('function');
});

test('callGroq throws when GROQ_API_KEY missing', async () => {
  const originalKey = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  const { callGroq } = require('../services/gemini');
  await expect(callGroq('system', 'user')).rejects.toThrow('GROQ_API_KEY not configured');
  process.env.GROQ_API_KEY = originalKey;
});