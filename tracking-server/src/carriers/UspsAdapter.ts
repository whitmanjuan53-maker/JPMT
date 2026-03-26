/**
 * USPS Carrier Adapter
 * Integrates with USPS Tracking API
 */

import axios from 'axios';
import { CarrierAdapter, TrackingInfo } from './CarrierAdapter';
import { ShipmentStatus } from '../models/Shipment';
import { logger } from '../utils/logger';
import { CircuitBreaker, circuitBreakerRegistry } from '../utils/circuitBreaker';

const USPS_API_URL = 'https://api.usps.com/tracking/v3';
const USPS_USER_ID = process.env.USPS_USER_ID || '';

export class UspsAdapter implements CarrierAdapter {
  readonly name = 'USPS';
  private circuitBreaker: CircuitBreaker;

  constructor() {
    this.circuitBreaker = circuitBreakerRegistry.get('usps', {
      failureThreshold: 5,
      resetTimeout: 60000,
    });
  }

  /**
   * Check if tracking number is supported
   * USPS: 20-22 digits typically
   */
  supports(trackingNumber: string): boolean {
    // USPS tracking: 20-22 digits
    return /^\d{20,22}$/.test(trackingNumber) || /^[A-Z]{2}\d{9}[A-Z]{2}$/i.test(trackingNumber);
  }

  /**
   * Track a USPS shipment
   */
  async track(trackingNumber: string): Promise<TrackingInfo> {
    if (!USPS_USER_ID) {
      return this.getMockTrackingInfo(trackingNumber);
    }

    return this.circuitBreaker.execute(async () => {
      try {
        const response = await axios.get(
          `${USPS_API_URL}/tracking/${trackingNumber}`,
          {
            headers: {
              'Authorization': `Bearer ${await this.getAccessToken()}`,
            },
            timeout: 10000,
          }
        );

        return this.parseUspsResponse(response.data);
      } catch (error) {
        logger.error('USPS tracking failed', {
          trackingNumber,
          error: (error as Error).message,
        });
        throw error;
      }
    });
  }

  /**
   * Get OAuth access token
   */
  private async getAccessToken(): Promise<string> {
    // USPS uses API keys directly for some endpoints
    // This would be implemented with proper OAuth for production
    return USPS_USER_ID;
  }

  /**
   * Parse USPS API response
   */
  private parseUspsResponse(data: any): TrackingInfo {
    const trackingNumber = data.trackingNumber;
    const status = data.status;
    const events = data.trackEvents || [];

    return {
      trackingNumber,
      status: this.mapUspsStatus(status),
      estimatedDelivery: data.expectedDelivery
        ? new Date(data.expectedDelivery)
        : undefined,
      currentLocation: events[0]?.eventCity
        ? {
            address: `${events[0].eventCity}, ${events[0].eventState}`,
            coordinates: undefined,
          }
        : undefined,
      events: events.map((event: any) => ({
        status: this.mapUspsStatus(event.eventType),
        timestamp: new Date(event.eventDate),
        description: event.eventDescription || '',
        location: event.eventCity
          ? {
              city: event.eventCity,
              state: event.eventState,
              country: 'US',
            }
          : undefined,
        eventCode: event.eventType,
      })),
    };
  }

  /**
   * Map USPS status to our status enum
   */
  private mapUspsStatus(uspsStatus?: string): ShipmentStatus {
    const statusMap: Record<string, ShipmentStatus> = {
      'Pre-Shipment': ShipmentStatus.CREATED,
      'Accepted': ShipmentStatus.PICKED_UP,
      'In Transit': ShipmentStatus.IN_TRANSIT,
      'Out for Delivery': ShipmentStatus.OUT_FOR_DELIVERY,
      'Delivered': ShipmentStatus.DELIVERED,
      'Alert': ShipmentStatus.EXCEPTION,
      'Forwarded': ShipmentStatus.IN_TRANSIT,
      'Returned to Sender': ShipmentStatus.RETURNED,
    };

    return statusMap[uspsStatus || ''] || ShipmentStatus.IN_TRANSIT;
  }

  /**
   * Get mock tracking info for demo
   */
  private getMockTrackingInfo(trackingNumber: string): TrackingInfo {
    const now = new Date();

    return {
      trackingNumber,
      status: ShipmentStatus.IN_TRANSIT,
      estimatedDelivery: new Date(now.getTime() + 48 * 60 * 60 * 1000),
      currentLocation: {
        address: 'Regional Distribution Center, Des Moines, IA',
        coordinates: { latitude: 41.5868, longitude: -93.625 },
      },
      events: [
        {
          status: ShipmentStatus.IN_TRANSIT,
          timestamp: new Date(now.getTime() - 12 * 60 * 60 * 1000),
          description: 'In Transit to Next Facility',
          location: { city: 'Des Moines', state: 'IA', country: 'US' },
          eventCode: 'InTransit',
        },
        {
          status: ShipmentStatus.IN_TRANSIT,
          timestamp: new Date(now.getTime() - 36 * 60 * 60 * 1000),
          description: 'Arrived at USPS Regional Facility',
          location: { city: 'Omaha', state: 'NE', country: 'US' },
          eventCode: 'Processed',
        },
        {
          status: ShipmentStatus.PICKED_UP,
          timestamp: new Date(now.getTime() - 60 * 60 * 60 * 1000),
          description: 'USPS picked up item',
          location: { city: 'Denver', state: 'CO', country: 'US' },
          eventCode: 'Accept',
        },
      ],
    };
  }

  getHealth(): { healthy: boolean; message?: string } {
    return {
      healthy: !!USPS_USER_ID,
      message: USPS_USER_ID ? 'Connected' : 'Using mock data (API key not configured)',
    };
  }
}

export default UspsAdapter;
