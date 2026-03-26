import Redis from 'ioredis';
import { logger } from '../utils/logger';

// Redis configuration
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB || '0', 10),
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: true,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
};

// Create Redis client
export const redis = new Redis(redisConfig);

// Redis event handlers
redis.on('connect', () => {
  logger.info('Redis client connected');
});

redis.on('ready', () => {
  logger.info('Redis client ready');
});

redis.on('error', (err) => {
  logger.error('Redis client error', { error: err.message });
});

redis.on('close', () => {
  logger.warn('Redis client connection closed');
});

redis.on('reconnecting', () => {
  logger.info('Redis client reconnecting');
});

/**
 * Cache key helpers
 */
export const cacheKeys = {
  shipment: (trackingNumber: string) => `shipment:${trackingNumber}`,
  shipmentEvents: (shipmentId: string) => `shipment:${shipmentId}:events`,
  shipmentLocation: (shipmentId: string) => `shipment:${shipmentId}:location`,
  activeShipments: () => 'shipments:active',
  carrierStatus: (carrierId: string) => `carrier:${carrierId}:status`,
  rateLimit: (key: string) => `ratelimit:${key}`,
  circuitBreaker: (service: string) => `circuit:${service}`,
  notificationQueue: 'notifications:queue',
  sseConnections: (trackingNumber: string) => `sse:${trackingNumber}:connections`,
};

/**
 * Cache TTL values (in seconds)
 */
export const cacheTTL = {
  shipment: 60 * 60 * 24, // 24 hours
  events: 60 * 60, // 1 hour
  location: 60 * 5, // 5 minutes (frequent updates)
  activeShipments: 60, // 1 minute
  rateLimit: 60, // 1 minute window
  circuitBreaker: 60, // 1 minute cooldown
};

/**
 * Get cached shipment data
 */
export async function getCachedShipment<T>(trackingNumber: string): Promise<T | null> {
  const key = cacheKeys.shipment(trackingNumber);
  const data = await redis.get(key);
  return data ? JSON.parse(data) : null;
}

/**
 * Cache shipment data
 */
export async function cacheShipment<T>(
  trackingNumber: string,
  data: T,
  ttl: number = cacheTTL.shipment
): Promise<void> {
  const key = cacheKeys.shipment(trackingNumber);
  await redis.setex(key, ttl, JSON.stringify(data));
}

/**
 * Invalidate shipment cache
 */
export async function invalidateShipmentCache(trackingNumber: string): Promise<void> {
  const key = cacheKeys.shipment(trackingNumber);
  await redis.del(key);
}

/**
 * Cache tracking events
 */
export async function cacheTrackingEvents<T>(
  shipmentId: string,
  events: T[],
  ttl: number = cacheTTL.events
): Promise<void> {
  const key = cacheKeys.shipmentEvents(shipmentId);
  await redis.setex(key, ttl, JSON.stringify(events));
}

/**
 * Get cached tracking events
 */
export async function getCachedTrackingEvents<T>(shipmentId: string): Promise<T[] | null> {
  const key = cacheKeys.shipmentEvents(shipmentId);
  const data = await redis.get(key);
  return data ? JSON.parse(data) : null;
}

/**
 * Update shipment location in cache (short TTL for real-time)
 */
export async function updateCachedLocation(
  shipmentId: string,
  location: { lat: number; lng: number; timestamp: string }
): Promise<void> {
  const key = cacheKeys.shipmentLocation(shipmentId);
  await redis.setex(key, cacheTTL.location, JSON.stringify(location));
}

/**
 * Get cached location
 */
export async function getCachedLocation(
  shipmentId: string
): Promise<{ lat: number; lng: number; timestamp: string } | null> {
  const key = cacheKeys.shipmentLocation(shipmentId);
  const data = await redis.get(key);
  return data ? JSON.parse(data) : null;
}

/**
 * Rate limiting check
 */
export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  const redisKey = cacheKeys.rateLimit(key);
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - windowSeconds;
  
  // Remove old entries
  await redis.zremrangebyscore(redisKey, 0, windowStart);
  
  // Count current requests
  const currentCount = await redis.zcard(redisKey);
  
  if (currentCount >= maxRequests) {
    const oldestEntry = await redis.zrange(redisKey, 0, 0, 'WITHSCORES');
    const resetTime = parseInt(oldestEntry[1]) + windowSeconds;
    return { allowed: false, remaining: 0, resetTime };
  }
  
  // Add current request
  await redis.zadd(redisKey, now, `${now}-${Math.random()}`);
  await redis.expire(redisKey, windowSeconds);
  
  return {
    allowed: true,
    remaining: maxRequests - currentCount - 1,
    resetTime: now + windowSeconds,
  };
}

/**
 * Circuit breaker state management
 */
export async function getCircuitBreakerState(
  service: string
): Promise<{ state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'; failures: number; lastFailure: number }> {
  const key = cacheKeys.circuitBreaker(service);
  const data = await redis.get(key);
  
  if (data) {
    return JSON.parse(data);
  }
  
  return { state: 'CLOSED', failures: 0, lastFailure: 0 };
}

export async function setCircuitBreakerState(
  service: string,
  state: { state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'; failures: number; lastFailure: number }
): Promise<void> {
  const key = cacheKeys.circuitBreaker(service);
  await redis.setex(key, cacheTTL.circuitBreaker, JSON.stringify(state));
}

/**
 * Publish event to a channel (for SSE broadcasting)
 */
export async function publishEvent(channel: string, data: any): Promise<void> {
  await redis.publish(channel, JSON.stringify(data));
}

/**
 * Subscribe to a channel
 */
export function subscribeToChannel(
  channel: string,
  callback: (message: string) => void
): void {
  const subscriber = new Redis(redisConfig);
  subscriber.subscribe(channel, (err) => {
    if (err) {
      logger.error(`Failed to subscribe to channel ${channel}`, { error: err.message });
    } else {
      logger.debug(`Subscribed to channel ${channel}`);
    }
  });
  
  subscriber.on('message', (ch, message) => {
    if (ch === channel) {
      callback(message);
    }
  });
}

/**
 * Check Redis health
 */
export async function checkRedisHealth(): Promise<{
  healthy: boolean;
  latency: number;
}> {
  const start = Date.now();
  try {
    await redis.ping();
    return {
      healthy: true,
      latency: Date.now() - start,
    };
  } catch (error) {
    return {
      healthy: false,
      latency: Date.now() - start,
    };
  }
}

/**
 * Close Redis connection
 */
export async function closeRedis(): Promise<void> {
  logger.info('Closing Redis connection');
  await redis.quit();
}

export default redis;
