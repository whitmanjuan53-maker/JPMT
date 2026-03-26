/**
 * Rate Limiting Middleware
 * Prevents API abuse and ensures fair usage
 */

import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';

// General API rate limiter
export const apiRateLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args: string[]) => redis.call(...args) as any,
  }),
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10), // 1 minute
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10), // 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests, please try again later',
    retryAfter: '60',
  },
  handler: (req, res, next, options) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      path: req.path,
    });
    res.status(429).json(options.message);
  },
});

// Stricter rate limiter for sensitive endpoints
export const strictRateLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args: string[]) => redis.call(...args) as any,
  }),
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests, please try again later',
  },
});

// SSE connection rate limiter
export const sseRateLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args: string[]) => redis.call(...args) as any,
  }),
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 SSE connections per minute
  keyGenerator: (req) => req.ip || 'unknown',
  message: {
    error: 'Too many SSE connections',
  },
});

// Webhook rate limiter (higher limits for carriers)
export const webhookRateLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args: string[]) => redis.call(...args) as any,
  }),
  windowMs: 60 * 1000, // 1 minute
  max: 1000, // 1000 webhook requests per minute
  keyGenerator: (req) => req.params.carrier || 'unknown',
  skip: (req) => {
    // Skip rate limiting for specific trusted IPs if configured
    const trustedIps = process.env.TRUSTED_WEBHOOK_IPS?.split(',') || [];
    return trustedIps.includes(req.ip || '');
  },
});

// Per-user rate limiter (requires authentication)
export const userRateLimiter = (maxRequests: number = 1000) => rateLimit({
  store: new RedisStore({
    sendCommand: (...args: string[]) => redis.call(...args) as any,
  }),
  windowMs: 60 * 1000, // 1 minute
  max: maxRequests,
  keyGenerator: (req) => {
    // Use API key or user ID from request
    return (req.headers['x-api-key'] as string) || 
           (req.headers['x-user-id'] as string) || 
           req.ip || 
           'unknown';
  },
  message: {
    error: 'API rate limit exceeded',
  },
});

export default {
  apiRateLimiter,
  strictRateLimiter,
  sseRateLimiter,
  webhookRateLimiter,
  userRateLimiter,
};
