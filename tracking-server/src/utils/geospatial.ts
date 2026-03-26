/**
 * Geospatial utility functions for shipment tracking
 */

import { GeoCoordinates } from '../models/Shipment';

// Earth's radius in miles
const EARTH_RADIUS_MILES = 3959;
const EARTH_RADIUS_KM = 6371;

/**
 * Calculate distance between two coordinates using Haversine formula
 */
export function calculateDistance(
  from: GeoCoordinates,
  to: GeoCoordinates,
  unit: 'miles' | 'km' = 'miles'
): number {
  const R = unit === 'miles' ? EARTH_RADIUS_MILES : EARTH_RADIUS_KM;
  
  const lat1Rad = toRadians(from.latitude);
  const lat2Rad = toRadians(to.latitude);
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLng = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) *
    Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Convert radians to degrees
 */
function toDegrees(radians: number): number {
  return radians * (180 / Math.PI);
}

/**
 * Calculate bearing (direction) between two points
 */
export function calculateBearing(from: GeoCoordinates, to: GeoCoordinates): number {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const lng1 = toRadians(from.longitude);
  const lng2 = toRadians(to.longitude);

  const y = Math.sin(lng2 - lng1) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1);

  let bearing = toDegrees(Math.atan2(y, x));
  bearing = (bearing + 360) % 360; // Normalize to 0-360

  return bearing;
}

/**
 * Get compass direction from bearing
 */
export function getCompassDirection(bearing: number): string {
  const directions = [
    'N', 'NNE', 'NE', 'ENE',
    'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW',
    'W', 'WNW', 'NW', 'NNW',
  ];
  const index = Math.round(bearing / 22.5) % 16;
  return directions[index];
}

/**
 * Calculate intermediate point along a great circle route
 */
export function interpolatePoint(
  from: GeoCoordinates,
  to: GeoCoordinates,
  fraction: number
): GeoCoordinates {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const lng1 = toRadians(from.longitude);
  const lng2 = toRadians(to.longitude);

  const a = Math.sin((1 - fraction) * angularDistance(from, to)) / Math.sin(angularDistance(from, to));
  const b = Math.sin(fraction * angularDistance(from, to)) / Math.sin(angularDistance(from, to));

  const x = a * Math.cos(lat1) * Math.cos(lng1) + b * Math.cos(lat2) * Math.cos(lng2);
  const y = a * Math.cos(lat1) * Math.sin(lng1) + b * Math.cos(lat2) * Math.sin(lng2);
  const z = a * Math.sin(lat1) + b * Math.sin(lat2);

  const lat = toDegrees(Math.atan2(z, Math.sqrt(x * x + y * y)));
  const lng = toDegrees(Math.atan2(y, x));

  return { latitude: lat, longitude: lng };
}

/**
 * Calculate angular distance between two points
 */
function angularDistance(from: GeoCoordinates, to: GeoCoordinates): number {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLng = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Check if a point is within a geofence
 */
export function isWithinGeofence(
  point: GeoCoordinates,
  center: GeoCoordinates,
  radiusMeters: number
): boolean {
  const distance = calculateDistance(point, center, 'km') * 1000; // Convert to meters
  return distance <= radiusMeters;
}

/**
 * Calculate estimated travel time
 */
export function estimateTravelTime(
  distance: number, // miles
  averageSpeed: number = 55, // mph
  trafficFactor: number = 1.0
): number {
  // Time in hours
  const time = distance / (averageSpeed * trafficFactor);
  return Math.round(time * 60); // Return minutes
}

/**
 * Calculate ETA based on current position and destination
 */
export function calculateETA(
  currentPosition: GeoCoordinates,
  destination: GeoCoordinates,
  averageSpeed: number = 55,
  trafficFactor: number = 1.0
): Date {
  const distance = calculateDistance(currentPosition, destination, 'miles');
  const travelTimeMinutes = estimateTravelTime(distance, averageSpeed, trafficFactor);
  
  const eta = new Date();
  eta.setMinutes(eta.getMinutes() + travelTimeMinutes);
  
  return eta;
}

/**
 * Decode polyline (Google Maps encoded polyline format)
 */
export function decodePolyline(encoded: string): GeoCoordinates[] {
  const points: GeoCoordinates[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte;

    // Decode latitude
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    // Decode longitude
    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    points.push({
      latitude: lat / 1e5,
      longitude: lng / 1e5,
    });
  }

  return points;
}

/**
 * Encode polyline (Google Maps encoded polyline format)
 */
export function encodePolyline(points: GeoCoordinates[]): string {
  let encoded = '';
  let lastLat = 0;
  let lastLng = 0;

  for (const point of points) {
    const lat = Math.round(point.latitude * 1e5);
    const lng = Math.round(point.longitude * 1e5);

    encoded += encodeNumber(lat - lastLat);
    encoded += encodeNumber(lng - lastLng);

    lastLat = lat;
    lastLng = lng;
  }

  return encoded;
}

function encodeNumber(num: number): string {
  let encoded = '';
  num = num < 0 ? ~(num << 1) : num << 1;

  while (num >= 0x20) {
    encoded += String.fromCharCode((0x20 | (num & 0x1f)) + 63);
    num >>= 5;
  }

  encoded += String.fromCharCode(num + 63);
  return encoded;
}

/**
 * Bounding box for a point with radius
 */
export function getBoundingBox(
  center: GeoCoordinates,
  radiusMiles: number
): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} {
  // Approximate degrees per mile
  const milesPerDegreeLat = 69;
  const milesPerDegreeLng = 69 * Math.cos(toRadians(center.latitude));

  const latDelta = radiusMiles / milesPerDegreeLat;
  const lngDelta = radiusMiles / milesPerDegreeLng;

  return {
    minLat: center.latitude - latDelta,
    maxLat: center.latitude + latDelta,
    minLng: center.longitude - lngDelta,
    maxLng: center.longitude + lngDelta,
  };
}

/**
 * Format coordinates for display
 */
export function formatCoordinates(coords: GeoCoordinates, precision: number = 6): string {
  return `${coords.latitude.toFixed(precision)}, ${coords.longitude.toFixed(precision)}`;
}

/**
 * Validate coordinates
 */
export function isValidCoordinates(coords: GeoCoordinates): boolean {
  return (
    coords.latitude >= -90 &&
    coords.latitude <= 90 &&
    coords.longitude >= -180 &&
    coords.longitude <= 180
  );
}

/**
 * Parse coordinates from string
 */
export function parseCoordinates(input: string): GeoCoordinates | null {
  const match = input.match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
  if (match) {
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    const coords = { latitude: lat, longitude: lng };
    return isValidCoordinates(coords) ? coords : null;
  }
  return null;
}
