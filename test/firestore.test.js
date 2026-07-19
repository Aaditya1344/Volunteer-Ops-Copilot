const firestoreService = require('../services/firestore');

test('isUsingLocalDb returns boolean', () => {
  expect(typeof firestoreService.isUsingLocalDb()).toBe('boolean');
});

test('getDb returns null before Firebase init', () => {
  // Before initFirestore is called with real creds, db is null
  expect(firestoreService.getDb()).toBe(null);
});

test('getLiveData returns object with type field', async () => {
  const data = await firestoreService.getLiveData();
  expect(data).toHaveProperty('type');
});

test('getHistory returns an array', async () => {
  const history = await firestoreService.getHistory();
  expect(Array.isArray(history)).toBe(true);
});

test('clearHistory does not throw', async () => {
  await expect(firestoreService.clearHistory()).resolves.not.toThrow();
});
