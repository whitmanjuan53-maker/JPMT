/**
 * Shipment domain models and type definitions
 */

// Shipment status enum
export enum ShipmentStatus {
  CREATED = 'created',
  PICKED_UP = 'picked_up',
  IN_TRANSIT = 'in_transit',
  OUT_FOR_DELIVERY = 'out_for_delivery',
  DELIVERED = 'delivered',
  DELAYED = 'delayed',
  EXCEPTION = 'exception',
  RETURNED = 'returned',
  CANCELLED = 'cancelled',
}

// Carrier type enum
export enum CarrierType {
  DHL = 'dhl',
  FEDEX = 'fedex',
  UPS = 'ups',
  USPS = 'usps',
  JPMT_FLEET = 'jpmt_fleet',
  CUSTOM = 'custom',
}

// Geolocation coordinates
export interface GeoCoordinates {
  latitude: number;
  longitude: number;
}

// Address interface
export interface Address {
  address: string;
  city?: string;
  state?: string;
  zip?: string;
  country: string;
  coordinates?: GeoCoordinates;
}

// Package dimensions
export interface PackageDimensions {
  length: number; // inches
  width: number; // inches
  height: number; // inches
  weight: number; // lbs
}

// Shipment entity
export interface Shipment {
  id: string;
  trackingNumber: string;
  carrierId: string;
  carrierType: CarrierType;
  carrierName: string;
  carrierTrackingNumber?: string;
  
  // Status
  status: ShipmentStatus;
  previousStatus?: ShipmentStatus;
  statusUpdatedAt: Date;
  
  // Locations
  origin: Address;
  destination: Address;
  currentLocation?: {
    address?: string;
    coordinates?: GeoCoordinates;
    updatedAt?: Date;
  };
  
  // Delivery estimates
  estimatedDelivery?: Date;
  estimatedDeliveryUpdatedAt?: Date;
  actualDelivery?: Date;
  
  // Package details
  packageDetails?: PackageDimensions;
  serviceType?: string;
  
  // Metadata
  referenceNumber?: string;
  description?: string;
  metadata?: Record<string, any>;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// Create shipment DTO
export interface CreateShipmentDto {
  trackingNumber: string;
  carrierType: CarrierType;
  origin: Address;
  destination: Address;
  packageDetails?: PackageDimensions;
  serviceType?: string;
  referenceNumber?: string;
  description?: string;
  estimatedDelivery?: Date;
  metadata?: Record<string, any>;
}

// Update shipment DTO
export interface UpdateShipmentDto {
  status?: ShipmentStatus;
  currentLocation?: {
    address?: string;
    coordinates?: GeoCoordinates;
  };
  estimatedDelivery?: Date;
  actualDelivery?: Date;
  metadata?: Record<string, any>;
}

// Shipment with events
export interface ShipmentWithEvents extends Shipment {
  events: TrackingEvent[];
}

// Shipment filter options
export interface ShipmentFilter {
  status?: ShipmentStatus[];
  carrierType?: CarrierType;
  createdAfter?: Date;
  createdBefore?: Date;
  searchQuery?: string;
  limit?: number;
  offset?: number;
}

// Import TrackingEvent from its model
import { TrackingEvent } from './TrackingEvent';

// Valid status transitions
export const validStatusTransitions: Record<ShipmentStatus, ShipmentStatus[]> = {
  [ShipmentStatus.CREATED]: [
    ShipmentStatus.PICKED_UP,
    ShipmentStatus.CANCELLED,
  ],
  [ShipmentStatus.PICKED_UP]: [
    ShipmentStatus.IN_TRANSIT,
    ShipmentStatus.EXCEPTION,
  ],
  [ShipmentStatus.IN_TRANSIT]: [
    ShipmentStatus.OUT_FOR_DELIVERY,
    ShipmentStatus.DELAYED,
    ShipmentStatus.EXCEPTION,
    ShipmentStatus.RETURNED,
  ],
  [ShipmentStatus.OUT_FOR_DELIVERY]: [
    ShipmentStatus.DELIVERED,
    ShipmentStatus.DELAYED,
    ShipmentStatus.EXCEPTION,
  ],
  [ShipmentStatus.DELIVERED]: [],
  [ShipmentStatus.DELAYED]: [
    ShipmentStatus.IN_TRANSIT,
    ShipmentStatus.OUT_FOR_DELIVERY,
  ],
  [ShipmentStatus.EXCEPTION]: [
    ShipmentStatus.IN_TRANSIT,
    ShipmentStatus.RETURNED,
    ShipmentStatus.DELIVERED,
  ],
  [ShipmentStatus.RETURNED]: [
    ShipmentStatus.DELIVERED,
  ],
  [ShipmentStatus.CANCELLED]: [],
};

/**
 * Check if a status transition is valid
 */
export function isValidStatusTransition(
  from: ShipmentStatus,
  to: ShipmentStatus
): boolean {
  if (from === to) return true;
  const validTransitions = validStatusTransitions[from] || [];
  return validTransitions.includes(to);
}

/**
 * Get human-readable status label
 */
export function getStatusLabel(status: ShipmentStatus): string {
  const labels: Record<ShipmentStatus, string> = {
    [ShipmentStatus.CREATED]: 'Created',
    [ShipmentStatus.PICKED_UP]: 'Picked Up',
    [ShipmentStatus.IN_TRANSIT]: 'In Transit',
    [ShipmentStatus.OUT_FOR_DELIVERY]: 'Out for Delivery',
    [ShipmentStatus.DELIVERED]: 'Delivered',
    [ShipmentStatus.DELAYED]: 'Delayed',
    [ShipmentStatus.EXCEPTION]: 'Exception',
    [ShipmentStatus.RETURNED]: 'Returned',
    [ShipmentStatus.CANCELLED]: 'Cancelled',
  };
  return labels[status] || status;
}

/**
 * Check if shipment is active (not delivered/cancelled/returned)
 */
export function isShipmentActive(status: ShipmentStatus): boolean {
  return ![
    ShipmentStatus.DELIVERED,
    ShipmentStatus.CANCELLED,
    ShipmentStatus.RETURNED,
  ].includes(status);
}
