function extractNumbersFromData(liveData) {
  const numbers = new Set();
  if (!liveData || !Array.isArray(liveData.data)) return numbers;
  liveData.data.forEach(row => {
    Object.entries(row).forEach(([, val]) => {
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
  const liveData = { data: [{ gate: 'Gate A', queue_length: '850', capacity: '1000', inflow_rate_per_min: '45' }] };
  const numbers = extractNumbersFromData(liveData);
  expect(numbers.has(850)).toBe(true);
  expect(numbers.has(1000)).toBe(true);
  expect(numbers.has(45)).toBe(true);
});

test('calculates capacity percentage', () => {
  const liveData = { data: [{ queue_length: '900', capacity: '1000' }] };
  const numbers = extractNumbersFromData(liveData);
  expect(numbers.has(90)).toBe(true);
});

test('returns empty set for empty data', () => {
  const numbers = extractNumbersFromData({ data: [] });
  expect(numbers.size).toBe(0);
});

test('returns empty set for null input', () => {
  const numbers = extractNumbersFromData(null);
  expect(numbers.size).toBe(0);
});

test('extracts decimal numbers', () => {
  const liveData = { data: [{ rate: '42.5' }] };
  const numbers = extractNumbersFromData(liveData);
  expect(numbers.has(42.5)).toBe(true);
});

test('handles missing capacity gracefully', () => {
  const liveData = { data: [{ queue_length: '500' }] };
  expect(() => extractNumbersFromData(liveData)).not.toThrow();
});

test('handles multiple rows', () => {
  const liveData = { data: [{ queue_length: '100', capacity: '500' }, { queue_length: '400', capacity: '500' }] };
  const numbers = extractNumbersFromData(liveData);
  expect(numbers.has(100)).toBe(true);
  expect(numbers.has(400)).toBe(true);
});

test('handles zero capacity without dividing by zero', () => {
  const liveData = { data: [{ queue_length: '100', capacity: '0' }] };
  expect(() => extractNumbersFromData(liveData)).not.toThrow();
});
