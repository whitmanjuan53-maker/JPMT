/**
 * DHL Carrier Adapter
 * Integrates with DHL Express API
 */

import axios from 'axios';
import { CarrierAdapter, TrackingInfo } from './CarrierAdapter';
import { ShipmentStatus, CarrierType } from '../models/Shipment';
import { logger } from '../utils/logger';
import { CircuitBreaker, circuitBreakerRegistry } from '../utils/circuitBreaker';

const DHL_API_URL = 'https://api-eu.dhl.com/track/shipments';
const DHL_API_KEY = process.env.DHL_API_KEY || '';

export class DhlAdapter implements CarrierAdapter {
  readonly name = 'DHL Express';
  private circuitBreaker: CircuitBreaker;

  constructor() {
    this.circuitBreaker = circuitBreakerRegistry.get('dhl', {
      failureThreshold: 5,
      resetTimeout: 60000,
    });
  }

  /**
   * Check if tracking number is supported
   * DHL tracking numbers are typically 10-11 digits
   */
  supports(trackingNumber: string): boolean {
    // DHL tracking: 10 or 11 digits
    return /^\d{10,11}$/.test(trackingNumber);
  }

  /**
   * Track a DHL shipment
   */
  async track(trackingNumber: string): Promise<TrackingInfo> {
    if (!DHL_API_KEY) {
      // Return mock data for demo
      return this.getMockTrackingInfo(trackingNumber);
    }

    return this.circuitBreaker.execute(async () => {
      try {
        const response = await axios.get(DHL_API_URL, {
          headers: {
            'DHL-API-Key': DHL_API_KEY,
          },
          params: {
            trackingNumber,
          },
          timeout: 10000,
        });

        return this.parseDhlResponse(response.data);
      } catch (error) {
        logger.error('DHL tracking failed', {
          trackingNumber,
          error: (error as Error).message,
        });
        throw error;
      }
    });
  }

  /**
   * Parse DHL API response
   */
  private parseDhlResponse(data: any): TrackingInfo {
    const shipment = data.shipments?.[0];
    if (!shipment) {
      throw new Error('No shipment data found');
    }

    const events = shipment.events || [];
    const latestEvent = events[0];

    return {
      trackingNumber: shipment.id,
      status: this.mapDhlStatus(latestEvent?.statusCode),
      estimatedDelivery: shipment.estimatedTimeOfDelivery
        ? new Date(shipment.estimatedTimeOfDelivery)
        : undefined,
      currentLocation: latestEvent?.location?.address
        ? {
            address: this.formatAddress(latestEvent.location.address),
            coordinates: undefined, // DHL doesn't always provide coordinates
          }
        : undefined,
      events: events.map((event: any) => ({
        status: this.mapDhlStatus(event.statusCode),
        timestamp: new Date(event.timestamp),
        description: event.description || '',
        location: event.location?.address
          ? {
              city: event.location.address.addressLocality,
              state: event.location.address.addressRegion,
              country: event.location.address.addressCountryCode,
            }
          : undefined,
        eventCode: event.statusCode,
      })),
    };
  }

  /**
   * Map DHL status codes to our status enum
   */
  private mapDhlStatus(dhlStatus?: string): ShipmentStatus {
    const statusMap: Record<string, ShipmentStatus> = {
      'pre-transit': ShipmentStatus.CREATED,
      'transit': ShipmentStatus.IN_TRANSIT,
      'delivered': ShipmentStatus.DELIVERED,
      'failure': ShipmentStatus.EXCEPTION,
      'notfound': ShipmentStatus.EXCEPTION,
    };

    return statusMap[dhlStatus?.toLowerCase() || ''] || ShipmentStatus.IN_TRANSIT;
  }

  /**
   * Format DHL address
   */
  private formatAddress(address: any): string {
    const parts = [
      address.streetAddress,
      address.addressLocality,
      address.addressRegion,
      address.addressCountryCode,
    ].filter(Boolean);
    return parts.join(', ');
  }

  /**
   * Get mock tracking info for demo
   */
  private getMockTrackingInfo(trackingNumber: string): TrackingInfo {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    return {
      trackingNumber,
      status: ShipmentStatus.IN_TRANSIT,
      estimatedDelivery: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      currentLocation: {
        address: 'Memphis, TN',
        coordinates: { latitude: 35.1495, longitude: -90.049 },
      },
      events: [
        {
          status: ShipmentStatus.IN_TRANSIT,
          timestamp: yesterday,
          description: 'Arrived at DHL facility in Memphis',
          location: { city: 'Memphis', state: 'TN', country: 'US' },
          eventCode: 'AR',
        },
        {
          status: ShipmentStatus.IN_TRANSIT,
          timestamp: twoDaysAgo,
          description: 'Departed DHL facility in Chicago',
          location: { city: 'Chicago', state: 'IL', country: 'US' },
          eventCode: 'DF',
        },
        {
          status: ShipmentStatus.PICKED_UP,
          timestamp: new Date(twoDaysAgo.getTime() - 12 * 60 * 60 * 1000),
          description: 'Shipment picked up',
          location: { city: 'Chicago', state: 'IL', country: 'US' },
          eventCode: 'PU',
        },
      ],
    };
  }

  getHealth(): { healthy: boolean; message?: string } {
    return {
      healthy: !!DHL_API_KEY,
      message: DHL_API_KEY ? 'Connected' : 'Using mock data (API key not configured)',
    };
  }
}

export default DhlAdapter;
