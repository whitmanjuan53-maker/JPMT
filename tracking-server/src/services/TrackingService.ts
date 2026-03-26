/**
 * Core Tracking Service
 * Manages shipment lifecycle, status transitions, and tracking events
 */

import { query, withTransaction } from '../config/database';
import { redis, cacheShipment, invalidateShipmentCache, cacheTrackingEvents } from '../config/redis';
import { logger } from '../utils/logger';
import { dbQueryDuration } from '../utils/metrics';

import {
  Shipment,
  ShipmentStatus,
  CreateShipmentDto,
  UpdateShipmentDto,
  ShipmentFilter,
  ShipmentWithEvents,
  isValidStatusTransition,
  getStatusLabel,
  CarrierType,
} from '../models/Shipment';

import {
  TrackingEvent,
  CreateTrackingEventDto,
  classifyEvent,
  parseEventCode,
} from '../models/TrackingEvent';

export class TrackingService {
  /**
   * Create a new shipment
   */
  async createShipment(dto: CreateShipmentDto): Promise<Shipment> {
    const startTime = Date.now();
    
    return await withTransaction(async (client) => {
      // Get carrier ID
      const carrierResult = await client.query(
        'SELECT id FROM carriers WHERE type = $1 AND active = true LIMIT 1',
        [dto.carrierType]
      );
      
      if (carrierResult.rows.length === 0) {
        throw new Error(`Carrier not found: ${dto.carrierType}`);
      }
      
      const carrierId = carrierResult.rows[0].id;
      
      // Create shipment
      const result = await client.query(
        `INSERT INTO shipments (
          tracking_number, carrier_id, status,
          origin_address, origin_city, origin_state, origin_zip, origin_country, origin_coords,
          destination_address, destination_city, destination_state, destination_zip, destination_country, destination_coords,
          estimated_delivery, weight_lbs, service_type, reference_number, description, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        RETURNING *`,
        [
          dto.trackingNumber,
          carrierId,
          ShipmentStatus.CREATED,
          dto.origin.address,
          dto.origin.city,
          dto.origin.state,
          dto.origin.zip,
          dto.origin.country,
          dto.origin.coordinates
            ? `POINT(${dto.origin.coordinates.longitude} ${dto.origin.coordinates.latitude})`
            : null,
          dto.destination.address,
          dto.destination.city,
          dto.destination.state,
          dto.destination.zip,
          dto.destination.country,
          dto.destination.coordinates
            ? `POINT(${dto.destination.coordinates.longitude} ${dto.destination.coordinates.latitude})`
            : null,
          dto.estimatedDelivery,
          dto.packageDetails?.weight,
          dto.serviceType,
          dto.referenceNumber,
          dto.description,
          JSON.stringify(dto.metadata || {}),
        ]
      );
      
      const shipment = this.mapRowToShipment(result.rows[0]);
      
      // Create initial tracking event
      await client.query(
        `INSERT INTO tracking_events (shipment_id, status, description, event_timestamp)
         VALUES ($1, $2, $3, NOW())`,
        [shipment.id, ShipmentStatus.CREATED, 'Shipment created']
      );
      
      // Cache the shipment
      await cacheShipment(shipment.trackingNumber, shipment);
      
      dbQueryDuration.observe({ query_type: 'INSERT', table: 'shipments' }, (Date.now() - startTime) / 1000);
      
      logger.info('Shipment created', { 
        trackingNumber: shipment.trackingNumber,
        carrier: dto.carrierType,
      });
      
      return shipment;
    });
  }

  /**
   * Get shipment by tracking number
   */
  async getShipment(trackingNumber: string): Promise<Shipment | null> {
    const startTime = Date.now();
    
    // Try cache first
    const cached = await redis.get(`shipment:${trackingNumber}`);
    if (cached) {
      dbQueryDuration.observe({ query_type: 'SELECT', table: 'cache' }, (Date.now() - startTime) / 1000);
      return JSON.parse(cached);
    }
    
    // Query database
    const result = await query(
      `SELECT s.*, c.name as carrier_name, c.type as carrier_type
       FROM shipments s
       JOIN carriers c ON s.carrier_id = c.id
       WHERE s.tracking_number = $1`,
      [trackingNumber]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const shipment = this.mapRowToShipment(result.rows[0]);
    
    // Cache for future requests
    await cacheShipment(trackingNumber, shipment);
    
    dbQueryDuration.observe({ query_type: 'SELECT', table: 'shipments' }, (Date.now() - startTime) / 1000);
    
    return shipment;
  }

  /**
   * Get shipment with all tracking events
   */
  async getShipmentWithEvents(trackingNumber: string): Promise<ShipmentWithEvents | null> {
    const shipment = await this.getShipment(trackingNumber);
    if (!shipment) return null;
    
    const events = await this.getTrackingEvents(shipment.id);
    
    return { ...shipment, events };
  }

  /**
   * Update shipment status
   */
  async updateStatus(
    trackingNumber: string,
    newStatus: ShipmentStatus,
    eventData?: {
      description?: string;
      location?: { address?: string; city?: string; state?: string };
      eventCode?: string;
    }
  ): Promise<Shipment> {
    const shipment = await this.getShipment(trackingNumber);
    if (!shipment) {
      throw new Error(`Shipment not found: ${trackingNumber}`);
    }
    
    // Validate status transition
    if (!isValidStatusTransition(shipment.status, newStatus)) {
      throw new Error(
        `Invalid status transition from ${shipment.status} to ${newStatus}`
      );
    }
    
    const startTime = Date.now();
    
    return await withTransaction(async (client) => {
      // Update shipment
      const updateResult = await client.query(
        `UPDATE shipments 
         SET status = $1, previous_status = $2, status_updated_at = NOW(),
             current_location_address = COALESCE($3, current_location_address),
             current_location_updated_at = CASE WHEN $3 IS NOT NULL THEN NOW() ELSE current_location_updated_at END
         WHERE tracking_number = $4
         RETURNING *`,
        [newStatus, shipment.status, eventData?.location?.address || null, trackingNumber]
      );
      
      // Create tracking event
      const description = eventData?.description || `Status updated to ${getStatusLabel(newStatus)}`;
      await client.query(
        `INSERT INTO tracking_events (shipment_id, status, previous_status, description, 
          location_address, location_city, location_state, event_code, event_timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          shipment.id,
          newStatus,
          shipment.status,
          description,
          eventData?.location?.address,
          eventData?.location?.city,
          eventData?.location?.state,
          eventData?.eventCode,
        ]
      );
      
      const updatedShipment = this.mapRowToShipment(updateResult.rows[0]);
      
      // Invalidate cache
      await invalidateShipmentCache(trackingNumber);
      
      dbQueryDuration.observe({ query_type: 'UPDATE', table: 'shipments' }, (Date.now() - startTime) / 1000);
      
      logger.info('Shipment status updated', {
        trackingNumber,
        from: shipment.status,
        to: newStatus,
      });
      
      return updatedShipment;
    });
  }

  /**
   * Update current location
   */
  async updateLocation(
    trackingNumber: string,
    location: {
      address?: string;
      coordinates: { latitude: number; longitude: number };
    }
  ): Promise<Shipment> {
    const shipment = await this.getShipment(trackingNumber);
    if (!shipment) {
      throw new Error(`Shipment not found: ${trackingNumber}`);
    }
    
    const startTime = Date.now();
    
    const result = await query(
      `UPDATE shipments 
       SET current_coords = POINT($1, $2),
           current_location_address = $3,
           current_location_updated_at = NOW()
       WHERE tracking_number = $4
       RETURNING *`,
      [location.coordinates.longitude, location.coordinates.latitude, location.address, trackingNumber]
    );
    
    const updatedShipment = this.mapRowToShipment(result.rows[0]);
    
    // Invalidate cache
    await invalidateShipmentCache(trackingNumber);
    
    dbQueryDuration.observe({ query_type: 'UPDATE', table: 'shipments' }, (Date.now() - startTime) / 1000);
    
    logger.debug('Shipment location updated', {
      trackingNumber,
      coordinates: location.coordinates,
    });
    
    return updatedShipment;
  }

  /**
   * Update estimated delivery
   */
  async updateEstimatedDelivery(
    trackingNumber: string,
    estimatedDelivery: Date
  ): Promise<Shipment> {
    const shipment = await this.getShipment(trackingNumber);
    if (!shipment) {
      throw new Error(`Shipment not found: ${trackingNumber}`);
    }
    
    const result = await query(
      `UPDATE shipments 
       SET estimated_delivery = $1, estimated_delivery_updated_at = NOW()
       WHERE tracking_number = $2
       RETURNING *`,
      [estimatedDelivery, trackingNumber]
    );
    
    const updatedShipment = this.mapRowToShipment(result.rows[0]);
    
    // Invalidate cache
    await invalidateShipmentCache(trackingNumber);
    
    logger.info('Estimated delivery updated', {
      trackingNumber,
      estimatedDelivery,
    });
    
    return updatedShipment;
  }

  /**
   * Get tracking events for a shipment
   */
  async getTrackingEvents(shipmentId: string): Promise<TrackingEvent[]> {
    // Try cache
    const cached = await redis.get(`shipment:${shipmentId}:events`);
    if (cached) {
      return JSON.parse(cached);
    }
    
    const result = await query(
      `SELECT * FROM tracking_events 
       WHERE shipment_id = $1 
       ORDER BY event_timestamp DESC, sequence_number DESC`,
      [shipmentId]
    );
    
    const events = result.rows.map(this.mapRowToTrackingEvent);
    
    // Cache events
    await cacheTrackingEvents(shipmentId, events);
    
    return events;
  }

  /**
   * Add a tracking event
   */
  async addTrackingEvent(dto: CreateTrackingEventDto): Promise<TrackingEvent> {
    const result = await query(
      `INSERT INTO tracking_events (
        shipment_id, status, previous_status, description,
        location_address, location_city, location_state, location_zip,
        location_coords, event_code, event_data, event_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        dto.shipmentId,
        dto.status,
        dto.previousStatus,
        dto.description,
        dto.location?.address,
        dto.location?.city,
        dto.location?.state,
        dto.location?.zip,
        dto.location?.coordinates
          ? `POINT(${dto.location.coordinates.longitude} ${dto.location.coordinates.latitude})`
          : null,
        dto.eventCode,
        JSON.stringify(dto.eventData || {}),
        dto.eventTimestamp || new Date(),
      ]
    );
    
    const event = this.mapRowToTrackingEvent(result.rows[0]);
    
    // Invalidate events cache
    await redis.del(`shipment:${dto.shipmentId}:events`);
    
    logger.debug('Tracking event added', {
      shipmentId: dto.shipmentId,
      status: dto.status,
      eventCode: dto.eventCode,
    });
    
    return event;
  }

  /**
   * List shipments with filters
   */
  async listShipments(filter: ShipmentFilter = {}): Promise<Shipment[]> {
    let sql = `
      SELECT s.*, c.name as carrier_name, c.type as carrier_type
      FROM shipments s
      JOIN carriers c ON s.carrier_id = c.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;
    
    if (filter.status && filter.status.length > 0) {
      sql += ` AND s.status = ANY($${paramIndex})`;
      params.push(filter.status);
      paramIndex++;
    }
    
    if (filter.carrierType) {
      sql += ` AND c.type = $${paramIndex}`;
      params.push(filter.carrierType);
      paramIndex++;
    }
    
    if (filter.createdAfter) {
      sql += ` AND s.created_at >= $${paramIndex}`;
      params.push(filter.createdAfter);
      paramIndex++;
    }
    
    if (filter.createdBefore) {
      sql += ` AND s.created_at <= $${paramIndex}`;
      params.push(filter.createdBefore);
      paramIndex++;
    }
    
    if (filter.searchQuery) {
      sql += ` AND (
        s.tracking_number ILIKE $${paramIndex} OR
        s.reference_number ILIKE $${paramIndex} OR
        s.destination_city ILIKE $${paramIndex}
      )`;
      params.push(`%${filter.searchQuery}%`);
      paramIndex++;
    }
    
    sql += ` ORDER BY s.created_at DESC`;
    
    if (filter.limit) {
      sql += ` LIMIT $${paramIndex}`;
      params.push(filter.limit);
      paramIndex++;
    }
    
    if (filter.offset) {
      sql += ` OFFSET $${paramIndex}`;
      params.push(filter.offset);
      paramIndex++;
    }
    
    const result = await query(sql, params);
    return result.rows.map(this.mapRowToShipment);
  }

  /**
   * Get active shipments count by status
   */
  async getStatusCounts(): Promise<Record<string, number>> {
    const result = await query(
      `SELECT status, COUNT(*) as count 
       FROM shipments 
       GROUP BY status`
    );
    
    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      counts[row.status] = parseInt(row.count, 10);
    }
    
    return counts;
  }

  /**
   * Delete shipment (soft delete not implemented - hard delete)
   */
  async deleteShipment(trackingNumber: string): Promise<void> {
    await query('DELETE FROM shipments WHERE tracking_number = $1', [trackingNumber]);
    await invalidateShipmentCache(trackingNumber);
    
    logger.info('Shipment deleted', { trackingNumber });
  }

  /**
   * Map database row to Shipment object
   */
  private mapRowToShipment(row: any): Shipment {
    return {
      id: row.id,
      trackingNumber: row.tracking_number,
      carrierId: row.carrier_id,
      carrierType: row.carrier_type as CarrierType,
      carrierName: row.carrier_name,
      carrierTrackingNumber: row.carrier_tracking_number,
      status: row.status as ShipmentStatus,
      previousStatus: row.previous_status,
      statusUpdatedAt: new Date(row.status_updated_at),
      origin: {
        address: row.origin_address,
        city: row.origin_city,
        state: row.origin_state,
        zip: row.origin_zip,
        country: row.origin_country,
        coordinates: row.origin_coords
          ? {
              longitude: parseFloat(row.origin_coords.x),
              latitude: parseFloat(row.origin_coords.y),
            }
          : undefined,
      },
      destination: {
        address: row.destination_address,
        city: row.destination_city,
        state: row.destination_state,
        zip: row.destination_zip,
        country: row.destination_country,
        coordinates: row.destination_coords
          ? {
              longitude: parseFloat(row.destination_coords.x),
              latitude: parseFloat(row.destination_coords.y),
            }
          : undefined,
      },
      currentLocation: row.current_coords
        ? {
            address: row.current_location_address,
            coordinates: {
              longitude: parseFloat(row.current_coords.x),
              latitude: parseFloat(row.current_coords.y),
            },
            updatedAt: row.current_location_updated_at
              ? new Date(row.current_location_updated_at)
              : undefined,
          }
        : undefined,
      estimatedDelivery: row.estimated_delivery
        ? new Date(row.estimated_delivery)
        : undefined,
      estimatedDeliveryUpdatedAt: row.estimated_delivery_updated_at
        ? new Date(row.estimated_delivery_updated_at)
        : undefined,
      actualDelivery: row.actual_delivery ? new Date(row.actual_delivery) : undefined,
      packageDetails: row.weight_lbs
        ? {
            weight: parseFloat(row.weight_lbs),
            length: parseFloat(row.dimensions_length_in) || 0,
            width: parseFloat(row.dimensions_width_in) || 0,
            height: parseFloat(row.dimensions_height_in) || 0,
          }
        : undefined,
      serviceType: row.service_type,
      referenceNumber: row.reference_number,
      description: row.description,
      metadata: row.metadata || {},
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Map database row to TrackingEvent object
   */
  private mapRowToTrackingEvent(row: any): TrackingEvent {
    return {
      id: row.id,
      shipmentId: row.shipment_id,
      status: row.status as ShipmentStatus,
      previousStatus: row.previous_status,
      description: row.description,
      location: row.location_address
        ? {
            address: row.location_address,
            city: row.location_city,
            state: row.location_state,
            zip: row.location_zip,
            coordinates: row.location_coords
              ? {
                  longitude: parseFloat(row.location_coords.x),
                  latitude: parseFloat(row.location_coords.y),
                }
              : undefined,
          }
        : undefined,
      eventCode: row.event_code,
      eventData: row.event_data || {},
      eventTimestamp: new Date(row.event_timestamp),
      createdAt: new Date(row.created_at),
    };
  }
}

// Singleton instance
export const trackingService = new TrackingService();
export default trackingService;
