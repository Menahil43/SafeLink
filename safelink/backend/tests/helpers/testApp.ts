import express, { Express } from 'express';
import emergencyRoutes from '../../src/routes/emergency.routes';
import timerRoutes from '../../src/routes/timer.routes';
import historyRoutes from '../../src/routes/history.routes';
import { errorHandler } from '../../src/middleware/errorHandler';

/**
 * Build a minimal Express app that mounts the routers under test, mirroring how
 * server.ts wires them (JSON body parsing + error handler) but WITHOUT calling
 * app.listen() or connecting to a real DB. The routers' real verifyFirebaseToken
 * middleware runs; only the Firebase SDK underneath is mocked (see tests/setup.ts),
 * so auth/authorization behaviour is exercised for real. The background Safety Timer
 * sweeper is NOT started here — tests invoke sweepTimers() directly for determinism.
 */
export const buildTestApp = (): Express => {
  const app = express();
  app.use(express.json());
  app.use('/api/emergencies', emergencyRoutes);
  app.use('/api/timers', timerRoutes);
  app.use('/api/history', historyRoutes);
  app.use(errorHandler);
  return app;
};
