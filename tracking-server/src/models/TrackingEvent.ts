/**
 * Tracking Event domain models
 */

import { ShipmentStatus, GeoCoordinates } from './Shipment';

// Tracking event entity
export interface TrackingEvent {
  id: string;
  shipmentId: string;
  
  // Status information
  status: ShipmentStatus;
  previousStatus?: ShipmentStatus;
  description: string;
  
  // Location
  location?: {
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    coordinates?: GeoCoordinates;
  };
  
  // Event metadata
  eventCode?: string;
  eventData?: Record<string, any>;
  
  // Timestamps
  eventTimestamp: Date;
  createdAt: Date;
}

// Create tracking event DTO
export interface CreateTrackingEventDto {
  shipmentId: string;
  status: ShipmentStatus;
  previousStatus?: ShipmentStatus;
  description: string;
  location?: {
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    coordinates?: GeoCoordinates;
  };
  eventCode?: string;
  eventData?: Record<string, any>;
  eventTimestamp?: Date;
}

// Event type classification
export enum EventType {
  STATUS_CHANGE = 'status_change',
  LOCATION_UPDATE = 'location_update',
  DELAY = 'delay',
  DELIVERY_ATTEMPT = 'delivery_attempt',
  EXCEPTION = 'exception',
  CUSTOMS_CLEARANCE = 'customs_clearance',
}

// Event severity
export enum EventSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

// Event with severity classification
export interface ClassifiedEvent extends TrackingEvent {
  type: EventType;
  severity: EventSeverity;
}

/**
 * Classify an event by its status and code
 */
export function classifyEvent(event: TrackingEvent): ClassifiedEvent {
  let type = EventType.STATUS_CHANGE;
  let severity = EventSeverity.INFO;
  
  // Determine event type
  if (event.status === 'delayed') {
    type = EventType.DELAY;
    severity = EventSeverity.WARNING;
  } else if (event.status === 'exception') {
    type = EventType.EXCEPTION;
    severity = EventSeverity.ERROR;
  } else if (event.eventCode?.includes('DELIVERY_ATTEMPT')) {
    type = EventType.DELIVERY_ATTEMPT;
  } else if (event.eventCode?.includes('CUSTOMS')) {
    type = EventType.CUSTOMS_CLEARANCE;
  } else if (event.location?.coordinates) {
    type = EventType.LOCATION_UPDATE;
  }
  
  // Adjust severity based on event data
  if (event.eventData?.isCritical) {
    severity = EventSeverity.CRITICAL;
  }
  
  return {
    ...event,
    type,
    severity,
  };
}

/**
 * Event codes mapping for common carrier events
 */
export const carrierEventCodes: Record<string, { description: string; severity: EventSeverity }> = {
  // DHL
  'PU': { description: 'Picked Up', severity: EventSeverity.INFO },
  'PL': { description: 'Processed at Location', severity: EventSeverity.INFO },
  'AF': { description: 'Arrived at Facility', severity: EventSeverity.INFO },
  'DF': { description: 'Departed Facility', severity: EventSeverity.INFO },
  'OD': { description: 'Out for Delivery', severity: EventSeverity.INFO },
  'OK': { description: 'Delivered', severity: EventSeverity.INFO },
  
  // FedEx
  'OC': { description: 'Shipment information sent to FedEx', severity: EventSeverity.INFO },
  'PX': { description: 'Picked up', severity: EventSeverity.INFO },
  'AR': { description: 'Arrived at FedEx location', severity: EventSeverity.INFO },
  'DP': { description: 'Departed FedEx location', severity: EventSeverity.INFO },
  'OD': { description: 'On FedEx vehicle for delivery', severity: EventSeverity.INFO },
  'DL': { description: 'Delivered', severity: EventSeverity.INFO },
  
  // UPS
  'MP': { description: 'Manifest Pickup', severity: EventSeverity.INFO },
  'OR': { description: 'Origin Scan', severity: EventSeverity.INFO },
  'DS': { description: 'Departure Scan', severity: EventSeverity.INFO },
  'AR': { description: 'Arrival Scan', severity: EventSeverity.INFO },
  'OF': { description: 'Out for Delivery', severity: EventSeverity.INFO },
  'DL': { description: 'Delivered', severity: EventSeverity.INFO },
  
  // USPS
  'Accept': { description: 'Accepted at Post Office', severity: EventSeverity.INFO },
  'Processed': { description: 'Processed through facility', severity: EventSeverity.INFO },
  'InTransit': { description: 'In Transit', severity: EventSeverity.INFO },
  'OutForDelivery': { description: 'Out for Delivery', severity: EventSeverity.INFO },
  'Delivered': { description: 'Delivered', severity: EventSeverity.INFO },
};

/**
 * Parse carrier event code to get description
 */
export function parseEventCode(
  code: string,
  carrier?: string
): { description: string; severity: EventSeverity } {
  const key = `${carrier?.toUpperCase()}_${code}`;
  return carrierEventCodes[code] || carrierEventCodes[key] || {
    description: code,
    severity: EventSeverity.INFO,
  };
}

/**
 * Format event for display
 */
export function formatEventForDisplay(event: TrackingEvent): string {
  const location = event.location
    ? [event.location.city, event.location.state].filter(Boolean).join(', ')
    : '';
  
  return `${event.description}${location ? ` - ${location}` : ''}`;
}

/**
 * Sort events by timestamp (newest first)
 */
export function sortEventsByTimestamp(
  events: TrackingEvent[],
  ascending: boolean = false
): TrackingEvent[] {
  return [...events].sort((a, b) => {
    const comparison = new Date(a.eventTimestamp).getTime() - new Date(b.eventTimestamp).getTime();
    return ascending ? comparison : -comparison;
  });
}

/**
 * Get latest event from a list
 */
export function getLatestEvent(events: TrackingEvent[]): TrackingEvent | undefined {
  if (events.length === 0) return undefined;
  return sortEventsByTimestamp(events)[0];
}

/**
 * Check if event represents a significant status change
 */
export function isSignificantStatusChange(event: TrackingEvent): boolean {
  const significantStatuses = [
    ShipmentStatus.PICKED_UP,
    ShipmentStatus.IN_TRANSIT,
    ShipmentStatus.OUT_FOR_DELIVERY,
    ShipmentStatus.DELIVERED,
    ShipmentStatus.DELAYED,
    ShipmentStatus.EXCEPTION,
  ];
  
  return significantStatuses.includes(event.status as ShipmentStatus);
}
