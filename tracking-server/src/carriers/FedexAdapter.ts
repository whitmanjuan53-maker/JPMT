/**
 * FedEx Carrier Adapter
 * Integrates with FedEx Track API
 */

import axios from 'axios';
import { CarrierAdapter, TrackingInfo } from './CarrierAdapter';
import { ShipmentStatus } from '../models/Shipment';
import { logger } from '../utils/logger';
import { CircuitBreaker, circuitBreakerRegistry } from '../utils/circuitBreaker';

const FEDEX_API_URL = 'https://apis.fedex.com/track/v1/trackingnumbers';
const FEDEX_API_KEY = process.env.FEDEX_API_KEY || '';
const FEDEX_SECRET_KEY = process.env.FEDEX_SECRET_KEY || '';

export class FedexAdapter implements CarrierAdapter {
  readonly name = 'FedEx';
  private circuitBreaker: CircuitBreaker;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor() {
    this.circuitBreaker = circuitBreakerRegistry.get('fedex', {
      failureThreshold: 5,
      resetTimeout: 60000,
    });
  }

  /**
   * Check if tracking number is supported
   * FedEx: 12, 15, 20, or 34 digits
   */
  supports(trackingNumber: string): boolean {
    // FedEx tracking numbers: 12, 15, 20, or 34 digits
    return /^\d{12}$|^\d{15}$|^\d{20}$|^\d{34}$/.test(trackingNumber);
  }

  /**
   * Track a FedEx shipment
   */
  async track(trackingNumber: string): Promise<TrackingInfo> {
    if (!FEDEX_API_KEY || !FEDEX_SECRET_KEY) {
      return this.getMockTrackingInfo(trackingNumber);
    }

    return this.circuitBreaker.execute(async () => {
      try {
        const token = await this.getAccessToken();
        
        const response = await axios.post(
          FEDEX_API_URL,
          {
            trackingInfo: [
              {
                trackingNumberInfo: {
                  trackingNumber,
                },
              },
            ],
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          }
        );

        return this.parseFedexResponse(response.data);
      } catch (error) {
        logger.error('FedEx tracking failed', {
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
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.accessToken;
    }

    const response = await axios.post(
      'https://apis.fedex.com/oauth/token',
      {
        grant_type: 'client_credentials',
        client_id: FEDEX_API_KEY,
        client_secret: FEDEX_SECRET_KEY,
      },
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );

    this.accessToken = response.data.access_token;
    this.tokenExpiry = new Date(Date.now() + response.data.expires_in * 1000);

    return this.accessToken;
  }

  /**
   * Parse FedEx API response
   */
  private parseFedexResponse(data: any): TrackingInfo {
    const completeTrackResults = data.output?.completeTrackResults?.[0];
    const trackResult = completeTrackResults?.trackResults?.[0];

    if (!trackResult) {
      throw new Error('No tracking data found');
    }

    const scanEvents = trackResult.scanEvents || [];
    const latestEvent = scanEvents[0];

    return {
      trackingNumber: completeTrackResults.trackingNumber,
      status: this.mapFedexStatus(trackResult.latestStatusDetail?.code),
      estimatedDelivery: trackResult.standardTransitTimeWindow?.window?.ends
        ? new Date(trackResult.standardTransitTimeWindow.window.ends)
        : undefined,
      currentLocation: latestEvent?.scanLocation
        ? {
            address: `${latestEvent.scanLocation.city}, ${latestEvent.scanLocation.stateOrProvinceCode}`,
            coordinates: undefined,
          }
        : undefined,
      events: scanEvents.map((event: any) => ({
        status: this.mapFedexStatus(event.eventType),
        timestamp: new Date(event.date),
        description: event.eventDescription || '',
        location: event.scanLocation
          ? {
              city: event.scanLocation.city,
              state: event.scanLocation.stateOrProvinceCode,
              country: event.scanLocation.countryCode,
            }
          : undefined,
        eventCode: event.eventType,
      })),
    };
  }

  /**
   * Map FedEx status codes to our status enum
   */
  private mapFedexStatus(fedexStatus?: string): ShipmentStatus {
    const statusMap: Record<string, ShipmentStatus> = {
      'OC': ShipmentStatus.CREATED,
      'PU': ShipmentStatus.PICKED_UP,
      'AR': ShipmentStatus.IN_TRANSIT,
      'DP': ShipmentStatus.IN_TRANSIT,
      'OD': ShipmentStatus.OUT_FOR_DELIVERY,
      'DL': ShipmentStatus.DELIVERED,
      'DE': ShipmentStatus.EXCEPTION,
      'SE': ShipmentStatus.DELAYED,
    };

    return statusMap[fedexStatus || ''] || ShipmentStatus.IN_TRANSIT;
  }

  /**
   * Get mock tracking info for demo
   */
  private getMockTrackingInfo(trackingNumber: string): TrackingInfo {
    const now = new Date();
    
    return {
      trackingNumber,
      status: ShipmentStatus.OUT_FOR_DELIVERY,
      estimatedDelivery: new Date(now.getTime() + 4 * 60 * 60 * 1000),
      currentLocation: {
        address: 'Local Delivery Facility, Chicago, IL',
        coordinates: { latitude: 41.8781, longitude: -87.6298 },
      },
      events: [
        {
          status: ShipmentStatus.OUT_FOR_DELIVERY,
          timestamp: new Date(now.getTime() - 2 * 60 * 60 * 1000),
          description: 'On FedEx vehicle for delivery',
          location: { city: 'Chicago', state: 'IL', country: 'US' },
          eventCode: 'OD',
        },
        {
          status: ShipmentStatus.IN_TRANSIT,
          timestamp: new Date(now.getTime() - 18 * 60 * 60 * 1000),
          description: 'Arrived at FedEx location',
          location: { city: 'Chicago', state: 'IL', country: 'US' },
          eventCode: 'AR',
        },
        {
          status: ShipmentStatus.IN_TRANSIT,
          timestamp: new Date(now.getTime() - 36 * 60 * 60 * 1000),
          description: 'Departed FedEx location',
          location: { city: 'Indianapolis', state: 'IN', country: 'US' },
          eventCode: 'DP',
        },
      ],
    };
  }

  getHealth(): { healthy: boolean; message?: string } {
    const hasCredentials = !!(FEDEX_API_KEY && FEDEX_SECRET_KEY);
    return {
      healthy: hasCredentials,
      message: hasCredentials ? 'Connected' : 'Using mock data (API credentials not configured)',
    };
  }
}

export default FedexAdapter;
