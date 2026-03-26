/**
 * Observer Pattern - Observer Interface
 * Defines the contract for tracking observers
 */

import { TrackingEvent } from '../../models/TrackingEvent';

/**
 * Observer interface for the Observer pattern
 */
export interface TrackingObserver {
  /**
   * Called when a tracking event occurs
   */
  update(event: TrackingEvent): void | Promise<void>;

  /**
   * Called when the observer is attached to a subject
   */
  onAttach?(shipmentId: string): void;

  /**
   * Called when the observer is detached from a subject
   */
  onDetach?(shipmentId: string): void;

  /**
   * Get observer name (for debugging)
   */
  getName?(): string;
}

/**
 * Abstract base class for tracking observers
 */
export abstract class BaseTrackingObserver implements TrackingObserver {
  protected name: string;

  constructor(name: string) {
    this.name = name;
  }

  abstract update(event: TrackingEvent): void | Promise<void>;

  getName(): string {
    return this.name;
  }

  onAttach?(shipmentId: string): void {
    // Default no-op
  }

  onDetach?(shipmentId: string): void {
    // Default no-op
  }
}

/**
 * Composite observer that delegates to multiple observers
 */
export class CompositeTrackingObserver implements TrackingObserver {
  private observers: TrackingObserver[] = [];

  addObserver(observer: TrackingObserver): void {
    this.observers.push(observer);
  }

  removeObserver(observer: TrackingObserver): void {
    const index = this.observers.indexOf(observer);
    if (index !== -1) {
      this.observers.splice(index, 1);
    }
  }

  async update(event: TrackingEvent): Promise<void> {
    // Execute all observers in parallel
    await Promise.all(
      this.observers.map(async (observer) => {
        try {
          await observer.update(event);
        } catch (error) {
          console.error(`Observer ${observer.getName?.() || 'unknown'} failed:`, error);
        }
      })
    );
  }

  getName(): string {
    return `Composite(${this.observers.map((o) => o.getName?.() || '?').join(', ')})`;
  }
}

export default TrackingObserver;
