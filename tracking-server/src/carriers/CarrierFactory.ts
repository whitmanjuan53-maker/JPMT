/**
 * Carrier Factory
 * Creates and manages carrier adapters
 */

import { CarrierAdapter } from './CarrierAdapter';
import { DhlAdapter } from './DhlAdapter';
import { FedexAdapter } from './FedexAdapter';
import { UpsAdapter } from './UpsAdapter';
import { UspsAdapter } from './UspsAdapter';
import { JpmtFleetAdapter } from './JpmtFleetAdapter';
import { CarrierType } from '../models/Shipment';

export class CarrierFactory {
  private adapters: Map<CarrierType, CarrierAdapter> = new Map();

  constructor() {
    this.registerAdapters();
  }

  private registerAdapters(): void {
    this.adapters.set(CarrierType.DHL, new DhlAdapter());
    this.adapters.set(CarrierType.FEDEX, new FedexAdapter());
    this.adapters.set(CarrierType.UPS, new UpsAdapter());
    this.adapters.set(CarrierType.USPS, new UspsAdapter());
    this.adapters.set(CarrierType.JPMT_FLEET, new JpmtFleetAdapter());
  }

  /**
   * Get adapter by carrier type
   */
  getAdapter(type: CarrierType): CarrierAdapter | undefined {
    return this.adapters.get(type);
  }

  /**
   * Get adapter by tracking number (auto-detect)
   */
  getAdapterByTrackingNumber(trackingNumber: string): CarrierAdapter | undefined {
    for (const adapter of this.adapters.values()) {
      if (adapter.supports(trackingNumber)) {
        return adapter;
      }
    }
    return undefined;
  }

  /**
   * Get all adapters
   */
  getAllAdapters(): CarrierAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Get health status for all adapters
   */
  getHealth(): Record<string, { healthy: boolean; message?: string }> {
    const health: Record<string, { healthy: boolean; message?: string }> = {};

    for (const [type, adapter] of this.adapters) {
      health[type] = adapter.getHealth();
    }

    return health;
  }

  /**
   * Detect carrier type from tracking number
   */
  detectCarrier(trackingNumber: string): CarrierType | undefined {
    const adapter = this.getAdapterByTrackingNumber(trackingNumber);
    if (!adapter) return undefined;

    for (const [type, a] of this.adapters) {
      if (a === adapter) {
        return type;
      }
    }

    return undefined;
  }
}

// Singleton instance
export const carrierFactory = new CarrierFactory();
export default CarrierFactory;
