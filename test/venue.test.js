const fs = require('fs');
const path = require('path');

test('venue.config.json exists and has required fields', () => {
  const configPath = path.join(__dirname, '../venue.config.json');
  expect(fs.existsSync(configPath)).toBe(true);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  expect(config).toHaveProperty('venueName');
  expect(config).toHaveProperty('capacity');
  expect(config).toHaveProperty('zones');
  expect(Array.isArray(config.zones)).toBe(true);
  expect(config.capacity).toBeGreaterThan(0);
});

test('venue capacity is a valid number', () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../venue.config.json'), 'utf8')
  );
  expect(typeof config.capacity).toBe('number');
  expect(config.capacity).toBeGreaterThan(10000);
});

test('venue has at least one zone', () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../venue.config.json'), 'utf8')
  );
  expect(config.zones.length).toBeGreaterThan(0);
});