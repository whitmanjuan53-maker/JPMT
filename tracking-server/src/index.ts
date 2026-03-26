/**
 * JPMT Tracking Server
 * Main entry point for the shipment tracking API
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import hpp from 'hpp';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

import { logger, requestLogger } from './utils/logger';
import { initializeDatabase, closePool } from './config/database';
import { redis, closeRedis } from './config/redis';
import { metricsMiddleware, getMetrics } from './utils/metrics';
import { notificationService } from './services/NotificationService';
import { sseService } from './services/SseService';
import { notificationQueue } from './services/NotificationQueue';

// Routes
import trackingRoutes from './routes/tracking';
import notificationRoutes from './routes/notifications';
import webhookRoutes from './routes/webhooks';

// Middleware
import { apiRateLimiter } from './middleware/rateLimiter';
import { optionalAuth } from './middleware/auth';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

/**
 * Initialize the application
 */
async function initialize() {
  try {
    // Initialize database
    await initializeDatabase();
    
    // Test Redis connection
    await redis.ping();
    logger.info('Redis connected');
    
    // Initialize notification service
    notificationService.initialize();
    
    logger.info('Services initialized');
  } catch (error) {
    logger.error('Initialization failed', { error: (error as Error).message });
    process.exit(1);
  }
}

/**
 * Configure Express middleware
 */
function configureMiddleware() {
  // Security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", '*'], // Allow SSE connections
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
  }));

  // CORS
  app.use(cors({
    origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000', 'http://localhost:3001'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'Last-Event-ID'],
  }));

  // Compression
  app.use(compression());

  // Prevent HTTP Parameter Pollution
  app.use(hpp());

  // Body parsing
  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: true, limit: '10kb' }));

  // Request logging
  app.use(requestLogger());

  // Metrics
  app.use(metricsMiddleware());
}

/**
 * Configure routes
 */
function configureRoutes() {
  // Health check
  app.get('/health', async (req, res) => {
    const dbHealth = await import('./config/database').then(m => m.checkHealth());
    const redisHealth = await import('./config/redis').then(m => m.checkRedisHealth());
    
    const healthy = dbHealth.healthy && redisHealth.healthy;
    
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealth,
        redis: redisHealth,
      },
    });
  });

  // Metrics endpoint (Prometheus)
  app.get('/metrics', async (req, res) => {
    try {
      const metrics = await getMetrics();
      res.set('Content-Type', 'text/plain');
      res.send(metrics);
    } catch (error) {
      res.status(500).send('Error collecting metrics');
    }
  });

  // API routes with rate limiting
  app.use('/api/tracking', apiRateLimiter, optionalAuth, trackingRoutes);
  app.use('/api/notifications', apiRateLimiter, optionalAuth, notificationRoutes);
  app.use('/webhooks', webhookRoutes);

  // API documentation endpoint
  app.get('/api', (req, res) => {
    res.json({
      name: 'JPMT Tracking API',
      version: '1.0.0',
      endpoints: {
        tracking: {
          'GET /api/tracking/:trackingNumber': 'Get shipment details',
          'GET /api/tracking/:trackingNumber/stream': 'SSE real-time updates',
          'GET /api/tracking/:trackingNumber/eta': 'Calculate ETA',
          'GET /api/tracking/:trackingNumber/route': 'Get route progress',
          'POST /api/tracking': 'Create shipment',
          'PUT /api/tracking/:trackingNumber/status': 'Update status',
          'PUT /api/tracking/:trackingNumber/location': 'Update location',
          'GET /api/tracking/carriers/detect/:trackingNumber': 'Detect carrier',
          'POST /api/tracking/carriers/track': 'Track via carrier API',
        },
        notifications: {
          'GET /api/notifications/preferences': 'Get preferences',
          'PUT /api/notifications/preferences': 'Update preferences',
          'GET /api/notifications/history': 'Get notification history',
          'POST /api/notifications/subscribe/:shipmentId': 'Subscribe to shipment',
          'DELETE /api/notifications/subscribe/:shipmentId': 'Unsubscribe',
        },
      },
    });
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      error: 'Not Found',
      path: req.path,
      method: req.method,
    });
  });

  // Error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error('Unhandled error', {
      error: err.message,
      stack: err.stack,
      path: req.path,
    });

    res.status(err.status || 500).json({
      error: process.env.NODE_ENV === 'production' 
        ? 'Internal Server Error' 
        : err.message,
    });
  });
}

/**
 * Graceful shutdown
 */
async function shutdown(signal: string) {
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  // Close SSE connections
  sseService.closeAllConnections();

  // Close notification queue
  await notificationQueue.close();

  // Close database connections
  await closePool();

  // Close Redis connections
  await closeRedis();

  logger.info('Graceful shutdown complete');
  process.exit(0);
}

// Configure middleware and routes
configureMiddleware();
configureRoutes();

// Initialize and start server
initialize().then(() => {
  app.listen(PORT, () => {
    logger.info(`JPMT Tracking Server running on port ${PORT}`, {
      port: PORT,
      env: process.env.NODE_ENV,
    });
  });
});

// Handle graceful shutdown
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
});

export default app;
