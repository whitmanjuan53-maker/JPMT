/**
 * ETA Calculation Service
 * Provides intelligent delivery time predictions based on route, traffic, and historical data
 */

import { logger } from '../utils/logger';
import { GeoCoordinates, Shipment } from '../models/Shipment';
import {
  calculateDistance,
  calculateETA,
  estimateTravelTime,
  getCompassDirection,
  calculateBearing,
  interpolatePoint,
} from '../utils/geospatial';

// Historical route data (would come from database in production)
interface RouteMetrics {
  route: string; // origin-destination hash
  averageSpeed: number; // mph
  averageTransitTime: number; // minutes
  reliability95thPercentile: number; // 95% of deliveries within this time
  trafficAdjustmentFactor: number; // average traffic multiplier
  lastUpdated: Date;
}

interface ETACalculationInput {
  origin: GeoCoordinates;
  destination: GeoCoordinates;
  currentLocation: GeoCoordinates;
  carrierType: string;
  serviceType?: string;
  pickupTime?: Date;
}

interface ETACalculationResult {
  estimatedArrival: Date;
  confidence: 'low' | 'medium' | 'high';
  remainingDistance: number; // miles
  remainingTime: number; // minutes
  averageSpeed: number; // mph
  factors: {
    baseTime: number;
    trafficAdjustment: number;
    historicalAdjustment: number;
    weatherAdjustment: number;
  };
}

// Default speeds by carrier (mph)
const CARRIER_SPEEDS: Record<string, number> = {
  dhl: 45,
  fedex: 50,
  ups: 48,
  usps: 40,
  jpmt_fleet: 55,
  custom: 50,
};

// Service level multipliers
const SERVICE_MULTIPLIERS: Record<string, number> = {
  overnight: 1.5,
  express: 1.3,
  standard: 1.0,
  economy: 0.8,
};

export class EtaCalculationService {
  private historicalRoutes: Map<string, RouteMetrics> = new Map();
  private trafficApiEnabled: boolean;

  constructor() {
    this.trafficApiEnabled = !!process.env.GOOGLE_MAPS_API_KEY;
  }

  /**
   * Calculate ETA for a shipment
   */
  async calculateETA(input: ETACalculationInput): Promise<ETACalculationResult> {
    const startTime = Date.now();
    
    try {
      // Calculate remaining distance
      const remainingDistance = calculateDistance(
        input.currentLocation,
        input.destination,
        'miles'
      );
      
      // Get base speed for carrier
      const baseSpeed = CARRIER_SPEEDS[input.carrierType] || 50;
      const serviceMultiplier = SERVICE_MULTIPLIERS[input.serviceType || 'standard'] || 1.0;
      const adjustedSpeed = baseSpeed * serviceMultiplier;
      
      // Calculate base travel time
      const baseTimeMinutes = estimateTravelTime(remainingDistance, adjustedSpeed, 1.0);
      
      // Get traffic adjustment
      const trafficAdjustment = await this.getTrafficAdjustment(
        input.currentLocation,
        input.destination
      );
      
      // Get historical adjustment
      const historicalAdjustment = this.getHistoricalAdjustment(input);
      
      // Weather adjustment (placeholder)
      const weatherAdjustment = 1.0; // Could integrate with weather API
      
      // Calculate total time with adjustments
      const adjustedTimeMinutes = Math.round(
        baseTimeMinutes * trafficAdjustment * historicalAdjustment * weatherAdjustment
      );
      
      // Calculate estimated arrival
      const estimatedArrival = new Date();
      estimatedArrival.setMinutes(estimatedArrival.getMinutes() + adjustedTimeMinutes);
      
      // Determine confidence based on data quality
      const confidence = this.calculateConfidence(
        remainingDistance,
        trafficAdjustment,
        historicalAdjustment
      );
      
      logger.debug('ETA calculated', {
        remainingDistance: remainingDistance.toFixed(2),
        estimatedMinutes: adjustedTimeMinutes,
        confidence,
        carrier: input.carrierType,
      });
      
      return {
        estimatedArrival,
        confidence,
        remainingDistance: Math.round(remainingDistance * 100) / 100,
        remainingTime: adjustedTimeMinutes,
        averageSpeed: adjustedSpeed,
        factors: {
          baseTime: baseTimeMinutes,
          trafficAdjustment,
          historicalAdjustment,
          weatherAdjustment,
        },
      };
    } catch (error) {
      logger.error('ETA calculation failed', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Get real-time traffic adjustment factor
   */
  private async getTrafficAdjustment(
    from: GeoCoordinates,
    to: GeoCoordinates
  ): Promise<number> {
    if (!this.trafficApiEnabled) {
      // Default traffic factor when no API available
      return this.estimateTrafficFactor(from, to);
    }
    
    try {
      // Google Maps Distance Matrix API call would go here
      // For now, return estimated factor
      return this.estimateTrafficFactor(from, to);
    } catch (error) {
      logger.warn('Traffic API failed, using estimate', { error: (error as Error).message });
      return this.estimateTrafficFactor(from, to);
    }
  }

  /**
   * Estimate traffic factor based on time of day and route
   */
  private estimateTrafficFactor(from: GeoCoordinates, to: GeoCoordinates): number {
    const hour = new Date().getHours();
    const dayOfWeek = new Date().getDay();
    
    // Weekend traffic is typically lighter
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    
    // Rush hour detection (rough estimate)
    const isRushHour = !isWeekend && ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19));
    
    // Urban area detection (simplified - would use geocoding in production)
    const isUrban = this.isLikelyUrbanArea(from) || this.isLikelyUrbanArea(to);
    
    if (isRushHour && isUrban) {
      return 1.4; // 40% slower during rush hour in cities
    } else if (isRushHour) {
      return 1.2; // 20% slower during rush hour
    } else if (isUrban) {
      return 1.15; // 15% slower in urban areas
    }
    
    return 1.0;
  }

  /**
   * Check if coordinates are likely in an urban area
   * (Simplified check based on major US metro areas)
   */
  private isLikelyUrbanArea(coords: GeoCoordinates): boolean {
    // Major metro bounding boxes (simplified)
    const urbanAreas = [
      // Chicago
      { minLat: 41.6, maxLat: 42.1, minLng: -88.0, maxLng: -87.4 },
      // New York
      { minLat: 40.4, maxLat: 40.9, minLng: -74.3, maxLng: -73.7 },
      // Los Angeles
      { minLat: 33.7, maxLat: 34.3, minLng: -118.7, maxLng: -117.8 },
      // Dallas
      { minLat: 32.6, maxLat: 33.0, minLng: -97.0, maxLng: -96.5 },
    ];
    
    return urbanAreas.some(
      (area) =>
        coords.latitude >= area.minLat &&
        coords.latitude <= area.maxLat &&
        coords.longitude >= area.minLng &&
        coords.longitude <= area.maxLng
    );
  }

  /**
   * Get historical adjustment based on past performance on this route
   */
  private getHistoricalAdjustment(input: ETACalculationInput): number {
    const routeKey = this.getRouteKey(input.origin, input.destination);
    const metrics = this.historicalRoutes.get(routeKey);
    
    if (!metrics) {
      return 1.0; // No historical data
    }
    
    // Check data freshness
    const dataAgeDays =
      (Date.now() - metrics.lastUpdated.getTime()) / (1000 * 60 * 60 * 24);
    
    if (dataAgeDays > 90) {
      return 1.0; // Data too old
    }
    
    // Calculate adjustment based on historical performance
    const historicalSpeed =
      metrics.averageTransitTime > 0
        ? calculateDistance(input.origin, input.destination, 'miles') /
          (metrics.averageTransitTime / 60)
        : 50;
    
    const baseSpeed = CARRIER_SPEEDS[input.carrierType] || 50;
    const adjustment = historicalSpeed / baseSpeed;
    
    // Clamp adjustment to reasonable range
    return Math.max(0.8, Math.min(1.3, adjustment));
  }

  /**
   * Calculate confidence level for ETA
   */
  private calculateConfidence(
    remainingDistance: number,
    trafficAdjustment: number,
    historicalAdjustment: number
  ): 'low' | 'medium' | 'high' {
    // Short distances are more predictable
    if (remainingDistance < 50) {
      return 'high';
    }
    
    // Long distances with significant adjustments reduce confidence
    const totalAdjustment = trafficAdjustment * historicalAdjustment;
    if (remainingDistance > 500 || totalAdjustment > 1.5) {
      return 'low';
    }
    
    return 'medium';
  }

  /**
   * Update historical route data with actual delivery time
   */
  async updateHistoricalData(
    origin: GeoCoordinates,
    destination: GeoCoordinates,
    actualTransitMinutes: number,
    carrierType: string
  ): Promise<void> {
    const routeKey = this.getRouteKey(origin, destination);
    const existing = this.historicalRoutes.get(routeKey);
    
    const distance = calculateDistance(origin, destination, 'miles');
    const actualSpeed = distance / (actualTransitMinutes / 60);
    
    if (existing) {
      // Update with exponential moving average
      const alpha = 0.3; // Weight for new data
      existing.averageTransitTime =
        (1 - alpha) * existing.averageTransitTime + alpha * actualTransitMinutes;
      existing.averageSpeed =
        (1 - alpha) * existing.averageSpeed + alpha * actualSpeed;
      existing.lastUpdated = new Date();
    } else {
      this.historicalRoutes.set(routeKey, {
        route: routeKey,
        averageSpeed: actualSpeed,
        averageTransitTime: actualTransitMinutes,
        reliability95thPercentile: actualTransitMinutes * 1.2, // Initial estimate
        trafficAdjustmentFactor: 1.0,
        lastUpdated: new Date(),
      });
    }
    
    logger.debug('Historical route data updated', {
      routeKey,
      actualSpeed: actualSpeed.toFixed(2),
      carrier: carrierType,
    });
  }

  /**
   * Generate route progress (for map visualization)
   */
  generateRouteProgress(
    origin: GeoCoordinates,
    destination: GeoCoordinates,
    currentLocation: GeoCoordinates
  ): {
    completed: number; // percentage
    remainingPath: GeoCoordinates[];
    direction: string;
  } {
    const totalDistance = calculateDistance(origin, destination, 'miles');
    const completedDistance = calculateDistance(origin, currentLocation, 'miles');
    const remainingDistance = calculateDistance(currentLocation, destination, 'miles');
    
    const completed = Math.min(100, Math.round((completedDistance / totalDistance) * 100));
    
    // Calculate bearing for direction indicator
    const bearing = calculateBearing(currentLocation, destination);
    const direction = getCompassDirection(bearing);
    
    // Generate remaining path points (simplified - would use actual route in production)
    const remainingPath: GeoCoordinates[] = [currentLocation];
    
    // Add intermediate points every 50 miles
    const numPoints = Math.floor(remainingDistance / 50);
    for (let i = 1; i <= numPoints; i++) {
      const fraction = i / (numPoints + 1);
      remainingPath.push(interpolatePoint(currentLocation, destination, fraction));
    }
    
    remainingPath.push(destination);
    
    return { completed, remainingPath, direction };
  }

  /**
   * Generate a unique key for a route
   */
  private getRouteKey(from: GeoCoordinates, to: GeoCoordinates): string {
    // Round coordinates to reduce precision for route grouping
    const precision = 2; // ~1km precision
    const fromLat = from.latitude.toFixed(precision);
    const fromLng = from.longitude.toFixed(precision);
    const toLat = to.latitude.toFixed(precision);
    const toLng = to.longitude.toFixed(precision);
    
    return `${fromLat},${fromLng}-${toLat},${toLng}`;
  }

  /**
   * Get ETA for a shipment (convenience method)
   */
  async getShipmentETA(shipment: Shipment): Promise<ETACalculationResult | null> {
    if (!shipment.currentLocation?.coordinates || !shipment.destination.coordinates) {
      return null;
    }
    
    return this.calculateETA({
      origin: shipment.origin.coordinates!,
      destination: shipment.destination.coordinates!,
      currentLocation: shipment.currentLocation.coordinates,
      carrierType: shipment.carrierType,
      serviceType: shipment.serviceType,
    });
  }
}

// Singleton instance
export const etaCalculationService = new EtaCalculationService();
export default etaCalculationService;
