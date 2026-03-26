/**
 * Server-Sent Events (SSE) Service
 * Manages real-time connections and event broadcasting
 */

import { Response } from 'express';
import { logger } from '../utils/logger';
import { redis, subscribeToChannel } from '../config/redis';
import { sseConnections } from '../utils/metrics';
import { TrackingEvent } from '../models/TrackingEvent';
import { Shipment } from '../models/Shipment';

interface SseClient {
  id: string;
  res: Response;
  trackingNumber: string;
  lastEventId?: string;
  connectedAt: Date;
  heartbeatInterval?: NodeJS.Timeout;
}

interface SseEvent {
  id?: string;
  event?: string;
  data: any;
  retry?: number;
}

export class SseService {
  private clients: Map<string, SseClient[]> = new Map();
  private clientCounter = 0;
  private readonly heartbeatInterval = 30000; // 30 seconds
  private redisSubscriber: any;

  constructor() {
    this.setupRedisSubscription();
  }

  /**
   * Set up Redis pub/sub for cross-server broadcasting
   */
  private setupRedisSubscription(): void {
    subscribeToChannel('sse:broadcast', (message) => {
      try {
        const { trackingNumber, event } = JSON.parse(message);
        // Broadcast to local clients only (avoid duplicate broadcasts)
        const clients = this.clients.get(trackingNumber);
        if (clients) {
          clients.forEach((client) => {
            this.sendToClient(client, event);
          });
        }
      } catch (error) {
        logger.error('Failed to process Redis broadcast', { error: (error as Error).message });
      }
    });
  }

  /**
   * Subscribe a client to a tracking number
   */
  subscribe(
    trackingNumber: string,
    res: Response,
    lastEventId?: string
  ): string {
    const clientId = `${trackingNumber}-${++this.clientCounter}`;
    
    const client: SseClient = {
      id: clientId,
      res,
      trackingNumber,
      lastEventId,
      connectedAt: new Date(),
    };

    // Initialize SSE response
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Send initial connection event
    this.sendToClient(client, {
      event: 'connected',
      data: {
        clientId,
        trackingNumber,
        timestamp: new Date().toISOString(),
      },
    });

    // Add to clients map
    if (!this.clients.has(trackingNumber)) {
      this.clients.set(trackingNumber, []);
    }
    this.clients.get(trackingNumber)!.push(client);

    // Set up heartbeat
    client.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat(client);
    }, this.heartbeatInterval);

    // Handle client disconnect
    res.on('close', () => {
      this.unsubscribe(clientId);
    });

    res.on('error', (error) => {
      logger.error('SSE connection error', { clientId, error: error.message });
      this.unsubscribe(clientId);
    });

    // Update metrics
    sseConnections.inc({ tracking_number: trackingNumber });
    
    logger.info('SSE client connected', {
      clientId,
      trackingNumber,
      lastEventId,
    });

    return clientId;
  }

  /**
   * Unsubscribe a client
   */
  unsubscribe(clientId: string): void {
    for (const [trackingNumber, clients] of this.clients) {
      const index = clients.findIndex((c) => c.id === clientId);
      if (index !== -1) {
        const client = clients[index];
        
        // Clear heartbeat
        if (client.heartbeatInterval) {
          clearInterval(client.heartbeatInterval);
        }

        // Remove from list
        clients.splice(index, 1);
        
        // Clean up empty tracking number entries
        if (clients.length === 0) {
          this.clients.delete(trackingNumber);
        }

        // Update metrics
        sseConnections.dec({ tracking_number: trackingNumber });

        logger.info('SSE client disconnected', {
          clientId,
          trackingNumber,
          duration: Date.now() - client.connectedAt.getTime(),
        });
        
        return;
      }
    }
  }

  /**
   * Broadcast an event to all clients tracking a shipment
   */
  broadcast(trackingNumber: string, event: SseEvent): void {
    const clients = this.clients.get(trackingNumber);
    if (!clients || clients.length === 0) {
      return; // No clients to broadcast to
    }

    // Send to local clients
    clients.forEach((client) => {
      this.sendToClient(client, event);
    });

    // Publish to Redis for other server instances
    redis.publish(
      'sse:broadcast',
      JSON.stringify({ trackingNumber, event })
    );

    logger.debug('Event broadcasted', {
      trackingNumber,
      eventType: event.event,
      clientCount: clients.length,
    });
  }

  /**
   * Broadcast tracking event update
   */
  broadcastTrackingEvent(trackingNumber: string, event: TrackingEvent): void {
    this.broadcast(trackingNumber, {
      id: event.id,
      event: 'tracking_update',
      data: {
        type: 'tracking_event',
        trackingNumber,
        status: event.status,
        description: event.description,
        location: event.location,
        timestamp: event.eventTimestamp.toISOString(),
      },
    });
  }

  /**
   * Broadcast shipment status change
   */
  broadcastStatusChange(
    trackingNumber: string,
    shipment: Shipment,
    previousStatus: string
  ): void {
    this.broadcast(trackingNumber, {
      event: 'status_change',
      data: {
        type: 'status_change',
        trackingNumber,
        status: shipment.status,
        previousStatus,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Broadcast location update
   */
  broadcastLocationUpdate(
    trackingNumber: string,
    location: {
      coordinates: { latitude: number; longitude: number };
      address?: string;
    },
    progress?: { completed: number; remainingDistance: number }
  ): void {
    this.broadcast(trackingNumber, {
      event: 'location_update',
      data: {
        type: 'location_update',
        trackingNumber,
        location,
        progress,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Broadcast ETA update
   */
  broadcastETAUpdate(
    trackingNumber: string,
    estimatedDelivery: Date,
    confidence: string
  ): void {
    this.broadcast(trackingNumber, {
      event: 'eta_update',
      data: {
        type: 'eta_update',
        trackingNumber,
        estimatedDelivery: estimatedDelivery.toISOString(),
        confidence,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Send event to a specific client
   */
  private sendToClient(client: SseClient, event: SseEvent): void {
    try {
      let message = '';
      
      if (event.id) {
        message += `id: ${event.id}\n`;
      }
      
      if (event.event) {
        message += `event: ${event.event}\n`;
      }
      
      if (event.retry) {
        message += `retry: ${event.retry}\n`;
      }
      
      message += `data: ${JSON.stringify(event.data)}\n\n`;
      
      client.res.write(message);
    } catch (error) {
      logger.error('Failed to send SSE event', {
        clientId: client.id,
        error: (error as Error).message,
      });
      this.unsubscribe(client.id);
    }
  }

  /**
   * Send heartbeat to keep connection alive
   */
  private sendHeartbeat(client: SseClient): void {
    try {
      client.res.write(':heartbeat\n\n');
    } catch (error) {
      logger.debug('Heartbeat failed, removing client', { clientId: client.id });
      this.unsubscribe(client.id);
    }
  }

  /**
   * Get missed events for reconnection
   */
  async getMissedEvents(
    trackingNumber: string,
    lastEventId: string
  ): Promise<SseEvent[]> {
    // In production, this would query the database for events after the lastEventId
    // For now, return empty array - client will do initial fetch
    return [];
  }

  /**
   * Get connection stats
   */
  getStats(): {
    totalConnections: number;
    trackingNumbers: number;
    connectionsByTrackingNumber: Record<string, number>;
  } {
    const connectionsByTrackingNumber: Record<string, number> = {};
    let totalConnections = 0;

    for (const [trackingNumber, clients] of this.clients) {
      connectionsByTrackingNumber[trackingNumber] = clients.length;
      totalConnections += clients.length;
    }

    return {
      totalConnections,
      trackingNumbers: this.clients.size,
      connectionsByTrackingNumber,
    };
  }

  /**
   * Close all connections (for shutdown)
   */
  closeAllConnections(): void {
    for (const [trackingNumber, clients] of this.clients) {
      clients.forEach((client) => {
        if (client.heartbeatInterval) {
          clearInterval(client.heartbeatInterval);
        }
        
        try {
          client.res.write('event: close\ndata: Server shutting down\n\n');
          client.res.end();
        } catch (error) {
          // Ignore errors during shutdown
        }
      });
    }
    
    this.clients.clear();
    logger.info('All SSE connections closed');
  }
}

// Singleton instance
export const sseService = new SseService();
export default sseService;
