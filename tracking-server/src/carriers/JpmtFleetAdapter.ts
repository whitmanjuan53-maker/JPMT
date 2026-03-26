/**
 * JPMT Fleet Carrier Adapter
 * Internal fleet tracking integration
 */

import { CarrierAdapter, TrackingInfo } from './CarrierAdapter';
import { ShipmentStatus, Shipment } from '../models/Shipment';
import { logger } from '../utils/logger';
import { query } from '../config/database';
import { getCachedLocation } from '../config/redis';

export class JpmtFleetAdapter implements CarrierAdapter {
  readonly name = 'JPMT Fleet';

  /**
   * Check if tracking number is supported
   * JPMT tracking: JPMT- prefix + alphanumeric
   */
  supports(trackingNumber: string): boolean {
    // JPMT tracking numbers start with JPMT-
    return /^JPMT-[A-Z0-9]{6,12}$/i.test(trackingNumber);
  }

  /**
   * Track a JPMT fleet shipment
   */
  async track(trackingNumber: string): Promise<TrackingInfo> {
    try {
      // Get shipment from database
      const result = await query(
        `SELECT s.*, c.name as carrier_name
         FROM shipments s
         JOIN carriers c ON s.carrier_id = c.id
         WHERE s.tracking_number = $1 AND c.type = 'jpmt_fleet'`,
        [trackingNumber]
      );

      if (result.rows.length === 0) {
        // Return mock data for demo
        return this.getMockTrackingInfo(trackingNumber);
      }

      const shipment = result.rows[0];

      // Get latest location from cache (GPS updates)
      const cachedLocation = await getCachedLocation(shipment.id);

      // Get tracking events
      const eventsResult = await query(
        `SELECT * FROM tracking_events 
         WHERE shipment_id = $1 
         ORDER BY event_timestamp DESC`,
        [shipment.id]
      );

      const events = eventsResult.rows.map((row) => ({
        status: row.status as ShipmentStatus,
        timestamp: new Date(row.event_timestamp),
        description: row.description,
        location: row.location_city
          ? {
              city: row.location_city,
              state: row.location_state,
              country: 'US',
            }
          : undefined,
        eventCode: row.event_code,
      }));

      return {
        trackingNumber,
        status: shipment.status as ShipmentStatus,
        estimatedDelivery: shipment.estimated_delivery
          ? new Date(shipment.estimated_delivery)
          : undefined,
        currentLocation: cachedLocation
          ? {
              address: shipment.current_location_address,
              coordinates: {
                latitude: cachedLocation.lat,
                longitude: cachedLocation.lng,
              },
            }
          : shipment.current_coords
            ? {
                address: shipment.current_location_address,
                coordinates: {
                  latitude: parseFloat(shipment.current_coords.y),
                  longitude: parseFloat(shipment.current_coords.x),
                },
              }
            : undefined,
        events: events.length > 0 ? events : this.getDefaultEvents(shipment),
      };
    } catch (error) {
      logger.error('JPMT fleet tracking failed', {
        trackingNumber,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Create a shipment in JPMT fleet
   */
  async createShipment(shipment: Partial<Shipment>): Promise<{ trackingNumber: string; label?: string }> {
    // Generate tracking number
    const trackingNumber = `JPMT-${Date.now().toString(36).toUpperCase()}`;

    logger.info('JPMT fleet shipment created', { trackingNumber });

    return { trackingNumber };
  }

  /**
   * Get default events for a shipment
   */
  private getDefaultEvents(shipment: any): TrackingInfo['events'] {
    const events: TrackingInfo['events'] = [
      {
        status: shipment.status as ShipmentStatus,
        timestamp: new Date(shipment.status_updated_at),
        description: `Status: ${shipment.status}`,
      },
    ];

    if (shipment.status !== 'created') {
      events.push({
        status: ShipmentStatus.CREATED,
        timestamp: new Date(shipment.created_at),
        description: 'Shipment created',
      });
    }

    return events;
  }

  /**
   * Get mock tracking info for demo
   */
  private getMockTrackingInfo(trackingNumber: string): TrackingInfo {
    const now = new Date();

    return {
      trackingNumber,
      status: ShipmentStatus.IN_TRANSIT,
      estimatedDelivery: new Date(now.getTime() + 6 * 60 * 60 * 1000),
      currentLocation: {
        address: 'I-80 West, near Davenport, IA',
        coordinates: { latitude: 41.5236, longitude: -90.5776 },
      },
      events: [
        {
          status: ShipmentStatus.IN_TRANSIT,
          timestamp: new Date(now.getTime() - 30 * 60 * 1000),
          description: 'Driver checked in - On schedule',
          location: { city: 'Davenport', state: 'IA', country: 'US' },
        },
        {
          status: ShipmentStatus.IN_TRANSIT,
          timestamp: new Date(now.getTime() - 4 * 60 * 60 * 1000),
          description: 'Departed Chicago Terminal',
          location: { city: 'Chicago', state: 'IL', country: 'US' },
        },
        {
          status: ShipmentStatus.PICKED_UP,
          timestamp: new Date(now.getTime() - 8 * 60 * 60 * 1000),
          description: 'Shipment picked up by driver John M.',
          location: { city: 'Chicago', state: 'IL', country: 'US' },
        },
        {
          status: ShipmentStatus.CREATED,
          timestamp: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          description: 'Shipment created and assigned to route',
        },
      ],
    };
  }

  getHealth(): { healthy: boolean; message?: string } {
    return {
      healthy: true,
      message: 'Internal fleet - Active',
    };
  }
}

export default JpmtFleetAdapter;
