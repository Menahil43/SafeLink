import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

// ─── Dummy env so nothing tries to read real credentials ────────────────────
process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = 'test@test.iam.gserviceaccount.com';
process.env.FIREBASE_PRIVATE_KEY = 'dummy-key';
process.env.GOOGLE_MAPS_API_KEY = 'dummy-maps-key';

// ─── Module mocks: never hit the network during tests ───────────────────────
// Firebase: verifyIdToken treats the bearer token AS the firebase uid, so the
// REAL auth middleware still runs (401 / user-lookup logic exercised) but no
// Firebase Admin call is made. Multicast push is a no-op that reports success.
jest.mock('../src/services/firebase.service', () => ({
  initializeFirebase: jest.fn(),
  getFirebaseAdmin: jest.fn(),
  verifyIdToken: jest.fn(async (token: string) => {
    if (token === 'invalid') throw new Error('Token expired');
    return { uid: token };
  }),
  sendPushNotification: jest.fn(async () => 'mock-message-id'),
  sendMulticastNotification: jest.fn(async (tokens: string[]) => ({
    successCount: tokens.length,
    failureCount: 0,
    responses: tokens.map(() => ({ success: true })),
  })),
}));

// Maps: createEmergency fires a background reverse-geocode; stub it so no axios
// request escapes to Google (which would also leave a dangling handle).
jest.mock('../src/services/maps.service', () => ({
  getAddressFromCoords: jest.fn(async () => '123 Test Street, Testville'),
  calculateRoute: jest.fn(),
  haversineDistance: jest.fn(() => 0),
}));

// Logger: silence winston (avoids writing to logs/*.log and open file handles).
jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  await Promise.all(
    Object.values(collections).map((collection) => collection.deleteMany({}))
  );
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});
