/**
 * Prometheus metrics collection
 */

import promClient from 'prom-client';
import { logger } from './logger';

// Create a Registry
export const register = new promClient.Registry();

// Add default metrics
promClient.collectDefaultMetrics({
  register,
  prefix: 'jpmt_',
});

// HTTP request duration histogram
export const httpRequestDuration = new promClient.Histogram({
  name: 'jpmt_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
});

// HTTP request total counter
export const httpRequestTotal = new promClient.Counter({
  name: 'jpmt_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

// SSE connections gauge
export const sseConnections = new promClient.Gauge({
  name: 'jpmt_sse_connections_active',
  help: 'Number of active SSE connections',
  labelNames: ['tracking_number'],
});

// Notification queue size
export const notificationQueueSize = new promClient.Gauge({
  name: 'jpmt_notification_queue_size',
  help: 'Number of pending notifications',
});

// Notification delivery counter
export const notificationDelivered = new promClient.Counter({
  name: 'jpmt_notifications_delivered_total',
  help: 'Total notifications delivered',
  labelNames: ['channel', 'status'],
});

// Database query duration
export const dbQueryDuration = new promClient.Histogram({
  name: 'jpmt_db_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['query_type', 'table'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
});

// Cache operations
export const cacheOperations = new promClient.Counter({
  name: 'jpmt_cache_operations_total',
  help: 'Total cache operations',
  labelNames: ['operation', 'result'],
});

// Carrier API calls
export const carrierApiCalls = new promClient.Counter({
  name: 'jpmt_carrier_api_calls_total',
  help: 'Total carrier API calls',
  labelNames: ['carrier', 'endpoint', 'status'],
});

// Carrier API latency
export const carrierApiLatency = new promClient.Histogram({
  name: 'jpmt_carrier_api_latency_seconds',
  help: 'Carrier API latency in seconds',
  labelNames: ['carrier', 'endpoint'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
});

// Circuit breaker states
export const circuitBreakerState = new promClient.Gauge({
  name: 'jpmt_circuit_breaker_state',
  help: 'Circuit breaker state (0=CLOSED, 1=HALF_OPEN, 2=OPEN)',
  labelNames: ['service'],
});

// Shipment status counts
export const shipmentStatusCount = new promClient.Gauge({
  name: 'jpmt_shipments_by_status',
  help: 'Number of shipments by status',
  labelNames: ['status'],
});

// Active tracking sessions
export const activeTrackingSessions = new promClient.Gauge({
  name: 'jpmt_active_tracking_sessions',
  help: 'Number of active tracking sessions',
});

// Register all metrics
register.registerMetric(httpRequestDuration);
register.registerMetric(httpRequestTotal);
register.registerMetric(sseConnections);
register.registerMetric(notificationQueueSize);
register.registerMetric(notificationDelivered);
register.registerMetric(dbQueryDuration);
register.registerMetric(cacheOperations);
register.registerMetric(carrierApiCalls);
register.registerMetric(carrierApiLatency);
register.registerMetric(circuitBreakerState);
register.registerMetric(shipmentStatusCount);
register.registerMetric(activeTrackingSessions);

/**
 * Metrics middleware for Express
 */
export function metricsMiddleware() {
  return (req: any, res: any, next: any) => {
    const start = Date.now();
    
    res.on('finish', () => {
      const duration = (Date.now() - start) / 1000;
      const route = req.route?.path || req.path || 'unknown';
      const method = req.method;
      const statusCode = res.statusCode.toString();
      
      httpRequestDuration.observe(
        { method, route, status_code: statusCode },
        duration
      );
      
      httpRequestTotal.inc({ method, route, status_code: statusCode });
    });
    
    next();
  };
}

/**
 * Update circuit breaker metric
 */
export function updateCircuitBreakerMetric(
  service: string,
  state: 'CLOSED' | 'HALF_OPEN' | 'OPEN'
): void {
  const stateValue = state === 'CLOSED' ? 0 : state === 'HALF_OPEN' ? 1 : 2;
  circuitBreakerState.set({ service }, stateValue);
}

/**
 * Update shipment status counts
 */
export async function updateShipmentMetrics(statusCounts: Record<string, number>): Promise<void> {
  for (const [status, count] of Object.entries(statusCounts)) {
    shipmentStatusCount.set({ status }, count);
  }
}

/**
 * Get metrics in Prometheus format
 */
export async function getMetrics(): Promise<string> {
  return await register.metrics();
}

/**
 * Reset all metrics (useful for testing)
 */
export function resetMetrics(): void {
  register.resetMetrics();
  logger.info('Metrics reset');
}

export default {
  register,
  httpRequestDuration,
  httpRequestTotal,
  sseConnections,
  notificationQueueSize,
  notificationDelivered,
  dbQueryDuration,
  cacheOperations,
  carrierApiCalls,
  carrierApiLatency,
  circuitBreakerState,
  shipmentStatusCount,
  activeTrackingSessions,
  metricsMiddleware,
  getMetrics,
  resetMetrics,
};
