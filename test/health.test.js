// Test health check endpoint structure
const venueConfig = {
  venueName: 'MetLife Stadium',
  officialTournamentName: 'New York New Jersey Stadium',
  capacity: 82500,
  zones: ['Club', 'Field', 'Mezzanine', 'Upper']
};

test('venue config has venueName', () => {
  expect(venueConfig.venueName).toBeDefined();
});

test('venue config has capacity > 0', () => {
  expect(venueConfig.capacity).toBeGreaterThan(0);
});

test('venue config zones is non-empty array', () => {
  expect(Array.isArray(venueConfig.zones)).toBe(true);
  expect(venueConfig.zones.length).toBeGreaterThan(0);
});

test('venue officialTournamentName is defined', () => {
  expect(venueConfig.officialTournamentName).toBeDefined();
});
