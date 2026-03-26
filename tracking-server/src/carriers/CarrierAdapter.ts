/**
 * Carrier Adapter Interface
 * Defines the contract for carrier integrations
 */

import { Shipment, ShipmentStatus, TrackingEvent } from '../models/Shipment';

export interface TrackingInfo {
  trackingNumber: string;
  carrierTrackingNumber?: string;
  status: ShipmentStatus;
  estimatedDelivery?: Date;
  currentLocation?: {
    address?: string;
    coordinates?: { latitude: number; longitude: number };
  };
  events: Array<{
    status: ShipmentStatus;
    timestamp: Date;
    description: string;
    location?: {
      city?: string;
      state?: string;
      country?: string;
    };
    eventCode?: string;
  }>;
}

export interface CarrierAdapter {
  /**
   * Carrier name
   */
  readonly name: string;

  /**
   * Check if this adapter supports the given tracking number
   */
  supports(trackingNumber: string): boolean;

  /**
   * Track a shipment
   */
  track(trackingNumber: string): Promise<TrackingInfo>;

  /**
   * Create a shipment (if supported)
   */
  createShipment?(shipment: Partial<Shipment>): Promise<{ trackingNumber: string; label?: string }>;

  /**
   * Cancel a shipment (if supported)
   */
  cancelShipment?(trackingNumber: string): Promise<boolean>;

  /**
   * Validate credentials
   */
  validateCredentials?(): Promise<boolean>;

  /**
   * Get service health
   */
  getHealth(): { healthy: boolean; message?: string };
}

export default CarrierAdapter;
