/**
 * UPS Carrier Adapter
 * Integrates with UPS Tracking API
 */

import axios from 'axios';
import { CarrierAdapter, TrackingInfo } from './CarrierAdapter';
import { ShipmentStatus } from '../models/Shipment';
import { logger } from '../utils/logger';
import { CircuitBreaker, circuitBreakerRegistry } from '../utils/circuitBreaker';

const UPS_API_URL = 'https://onlinetools.ups.com/track/v1/details';
const UPS_ACCESS_KEY = process.env.UPS_ACCESS_KEY || '';
const UPS_USER_ID = process.env.UPS_USER_ID || '';
const UPS_PASSWORD = process.env.UPS_PASSWORD || '';

export class UpsAdapter implements CarrierAdapter {
  readonly name = 'UPS';
  private circuitBreaker: CircuitBreaker;

  constructor() {
    this.circuitBreaker = circuitBreakerRegistry.get('ups', {
      failureThreshold: 5,
      resetTimeout: 60000,
    });
  }

  /**
   * Check if tracking number is supported
   * UPS: Typically starts with '1Z' followed by 16 alphanumeric chars
   */
  supports(trackingNumber: string): boolean {
    // UPS tracking: 1Z + 16 alphanumeric
    return /^1Z[A-Z0-9]{16}$/i.test(trackingNumber);
  }

  /**
   * Track a UPS shipment
   */
  async track(trackingNumber: string): Promise<TrackingInfo> {
    if (!UPS_ACCESS_KEY || !UPS_USER_ID || !UPS_PASSWORD) {
      return this.getMockTrackingInfo(trackingNumber);
    }

    return this.circuitBreaker.execute(async () => {
      try {
        const response = await axios.get(`${UPS_API_URL}/${trackingNumber}`, {
          headers: {
            'AccessLicenseNumber': UPS_ACCESS_KEY,
            'Username': UPS_USER_ID,
            'Password': UPS_PASSWORD,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        });

        return this.parseUpsResponse(response.data);
      } catch (error) {
        logger.error('UPS tracking failed', {
          trackingNumber,
          error: (error as Error).message,
        });
        throw error;
      }
    });
  }

  /**
   * Parse UPS API response
   */
  private parseUpsResponse(data: any): TrackingInfo {
    const shipment = data.trackResponse?.shipment?.[0];
    if (!shipment) {
      throw new Error('No shipment data found');
    }

    const package_ = shipment.package?.[0];
    const activities = package_?.activity || [];
    const latestActivity = activities[0];

    return {
      trackingNumber: shipment.inquiryNumber,
      status: this.mapUpsStatus(latestActivity?.status?.code),
      estimatedDelivery: package_?.deliveryDate?.[0]?.date
        ? new Date(package_.deliveryDate[0].date)
        : undefined,
      currentLocation: latestActivity?.location?.address?.city
        ? {
            address: `${latestActivity.location.address.city}, ${latestActivity.location.address.stateProvince}`,
            coordinates: undefined,
          }
        : undefined,
      events: activities.map((activity: any) => ({
        status: this.mapUpsStatus(activity.status?.code),
        timestamp: new Date(`${activity.date} ${activity.time}`),
        description: activity.status?.description || '',
        location: activity.location?.address
          ? {
              city: activity.location.address.city,
              state: activity.location.address.stateProvince,
              country: activity.location.address.country,
            }
          : undefined,
        eventCode: activity.status?.code,
      })),
    };
  }

  /**
   * Map UPS status codes to our status enum
   */
  private mapUpsStatus(upsStatus?: string): ShipmentStatus {
    const statusMap: Record<string, ShipmentStatus> = {
      'M': ShipmentStatus.CREATED,
      'P': ShipmentStatus.PICKED_UP,
      'I': ShipmentStatus.IN_TRANSIT,
      'O': ShipmentStatus.OUT_FOR_DELIVERY,
      'D': ShipmentStatus.DELIVERED,
      'X': ShipmentStatus.EXCEPTION,
      'RS': ShipmentStatus.RETURNED,
    };

    return statusMap[upsStatus || ''] || ShipmentStatus.IN_TRANSIT;
  }

  /**
   * Get mock tracking info for demo
   */
  private getMockTrackingInfo(trackingNumber: string): TrackingInfo {
    const now = new Date();

    return {
      trackingNumber,
      status: ShipmentStatus.DELIVERED,
      estimatedDelivery: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      currentLocation: {
        address: 'Front Porch, Chicago, IL',
        coordinates: { latitude: 41.8781, longitude: -87.6298 },
      },
      events: [
        {
          status: ShipmentStatus.DELIVERED,
          timestamp: new Date(now.getTime() - 2 * 60 * 60 * 1000),
          description: 'Delivered - Left at front porch',
          location: { city: 'Chicago', state: 'IL', country: 'US' },
          eventCode: 'D',
        },
        {
          status: ShipmentStatus.OUT_FOR_DELIVERY,
          timestamp: new Date(now.getTime() - 6 * 60 * 60 * 1000),
          description: 'Out for Delivery',
          location: { city: 'Chicago', state: 'IL', country: 'US' },
          eventCode: 'O',
        },
        {
          status: ShipmentStatus.IN_TRANSIT,
          timestamp: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          description: 'Arrived at Facility',
          location: { city: 'Chicago', state: 'IL', country: 'US' },
          eventCode: 'I',
        },
      ],
    };
  }

  getHealth(): { healthy: boolean; message?: string } {
    const hasCredentials = !!(UPS_ACCESS_KEY && UPS_USER_ID && UPS_PASSWORD);
    return {
      healthy: hasCredentials,
      message: hasCredentials ? 'Connected' : 'Using mock data (API credentials not configured)',
    };
  }
}

export default UpsAdapter;
