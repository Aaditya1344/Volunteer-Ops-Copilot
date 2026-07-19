// Test the grounding guard logic
function extractNumbersFromData(liveData) {
  const numbers = new Set();
  if (!liveData || !Array.isArray(liveData.data)) return numbers;
  liveData.data.forEach(row => {
    Object.entries(row).forEach(([key, val]) => {
      const matches = String(val).match(/\b\d+(?:\.\d+)?\b/g);
      if (matches) matches.forEach(n => numbers.add(parseFloat(n)));
    });
    if (row.queue_length && row.capacity) {
      const q = parseFloat(row.queue_length);
      const cap = parseFloat(row.capacity);
      if (!isNaN(q) && !isNaN(cap) && cap > 0) {
        numbers.add(Math.round((q / cap) * 100));
      }
    }
  });
  return numbers;
}

test('extracts numbers from gate status data', () => {
  const liveData = {
    data: [{ gate: 'Gate A', queue_length: '850', capacity: '1000', inflow_rate_per_min: '45' }]
  };
  const numbers = extractNumbersFromData(liveData);
  expect(numbers.has(850)).toBe(true);
  expect(numbers.has(1000)).toBe(true);
  expect(numbers.has(45)).toBe(true);
});

test('calculates capacity percentage', () => {
  const liveData = {
    data: [{ queue_length: '900', capacity: '1000' }]
  };
  const numbers = extractNumbersFromData(liveData);
  expect(numbers.has(90)).toBe(true); // 90% capacity
});

test('returns empty set for empty data', () => {
  const numbers = extractNumbersFromData({ data: [] });
  expect(numbers.size).toBe(0);
});

test('returns empty set for null input', () => {
  const numbers = extractNumbersFromData(null);
  expect(numbers.size).toBe(0);
});