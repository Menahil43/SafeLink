import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import { connectDatabase } from './utils/database';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';
import { initializeFirebase } from './services/firebase.service';
import { startTimerSweeper } from './services/timer.service';

// Routes
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import contactRoutes from './routes/contact.routes';
import emergencyRoutes from './routes/emergency.routes';
import journeyRoutes from './routes/journey.routes';
import aiRoutes from './routes/ai.routes';
import recordingRoutes from './routes/recording.routes';
import historyRoutes from './routes/history.routes';
import timerRoutes from './routes/timer.routes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Security Middleware ────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'exp://localhost:8081', // Expo dev
    /safelink:\/\/.*/,      // Deep links
  ],
  credentials: true,
}));

// ─── Rate Limiting ──────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many auth attempts, please try again later.' },
});

app.use(limiter);

// ─── Body Parsing ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Logging ────────────────────────────────────────────────────────────────
app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) },
}));

// ─── Health Check ───────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'SafeLink API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ─── API Routes ─────────────────────────────────────────────────────────────
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/emergencies', emergencyRoutes);
app.use('/api/journeys', journeyRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/recordings', recordingRoutes);
// Recording creation also has an emergency-scoped multipart path used by the
// Android recorder: POST /api/emergencies/:emergencyId/recordings.
app.use('/api', recordingRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/timers', timerRoutes);

// ─── 404 Handler ────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ─── Error Handler ──────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start Server ───────────────────────────────────────────────────────────
const startServer = async () => {
  try {
    // Firebase Admin powers ID-token verification on every authenticated route.
    // Guarded so the server still boots (e.g. /health) if credentials aren't set yet.
    try {
      initializeFirebase();
    } catch (err) {
      logger.error('⚠️  Firebase Admin not initialized — authenticated routes will reject requests until FIREBASE_* env vars are set.', err);
    }

    await connectDatabase();
    app.listen(PORT, () => {
      logger.info(`🚀 SafeLink API running on port ${PORT}`);
      logger.info(`📍 Environment: ${process.env.NODE_ENV}`);
    });

    // Server-side Safety Timer expiry/escalation — the authoritative clock that keeps
    // working even when a user's app is closed/backgrounded (see timer.service.ts).
    startTimerSweeper();
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

export default app;
