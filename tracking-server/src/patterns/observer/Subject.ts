/**
 * Observer Pattern - Subject Interface
 * Defines the contract for observable subjects
 */

import { TrackingEvent } from '../../models/TrackingEvent';
import { TrackingObserver } from './TrackingObserver';

/**
 * Subject interface for the Observer pattern
 */
export interface Subject {
  /**
   * Attach an observer to the subject
   */
  attach(observer: TrackingObserver): void;

  /**
   * Detach an observer from the subject
   */
  detach(observer: TrackingObserver): void;

  /**
   * Notify all observers about an event
   */
  notify(event: TrackingEvent): void;
}

/**
 * ShipmentSubject - Concrete implementation of Subject
 * Manages shipment state changes and notifies observers
 */
export class ShipmentSubject implements Subject {
  private observers: Set<TrackingObserver> = new Set();
  private shipmentId: string;

  constructor(shipmentId: string) {
    this.shipmentId = shipmentId;
  }

  /**
   * Attach an observer
   */
  attach(observer: TrackingObserver): void {
    this.observers.add(observer);
    observer.onAttach?.(this.shipmentId);
  }

  /**
   * Detach an observer
   */
  detach(observer: TrackingObserver): void {
    this.observers.delete(observer);
    observer.onDetach?.(this.shipmentId);
  }

  /**
   * Detach all observers
   */
  detachAll(): void {
    for (const observer of this.observers) {
      this.detach(observer);
    }
  }

  /**
   * Notify all observers about a tracking event
   */
  notify(event: TrackingEvent): void {
    for (const observer of this.observers) {
      try {
        observer.update(event);
      } catch (error) {
        // Log error but don't stop other observers
        console.error(`Observer update failed for shipment ${this.shipmentId}:`, error);
      }
    }
  }

  /**
   * Get number of attached observers
   */
  getObserverCount(): number {
    return this.observers.size;
  }

  /**
   * Get list of observer names (for debugging)
   */
  getObserverNames(): string[] {
    return Array.from(this.observers).map((o) => o.getName?.() || 'Anonymous');
  }
}

/**
 * Subject registry for managing multiple shipment subjects
 */
export class SubjectRegistry {
  private subjects: Map<string, ShipmentSubject> = new Map();

  /**
   * Get or create a subject for a shipment
   */
  getSubject(shipmentId: string): ShipmentSubject {
    if (!this.subjects.has(shipmentId)) {
      this.subjects.set(shipmentId, new ShipmentSubject(shipmentId));
    }
    return this.subjects.get(shipmentId)!;
  }

  /**
   * Remove a subject from registry
   */
  removeSubject(shipmentId: string): void {
    const subject = this.subjects.get(shipmentId);
    if (subject) {
      subject.detachAll();
      this.subjects.delete(shipmentId);
    }
  }

  /**
   * Get all subject IDs
   */
  getSubjectIds(): string[] {
    return Array.from(this.subjects.keys());
  }

  /**
   * Get total observer count across all subjects
   */
  getTotalObserverCount(): number {
    let count = 0;
    for (const subject of this.subjects.values()) {
      count += subject.getObserverCount();
    }
    return count;
  }

  /**
   * Clear all subjects
   */
  clear(): void {
    for (const [shipmentId] of this.subjects) {
      this.removeSubject(shipmentId);
    }
  }
}

// Global registry instance
export const subjectRegistry = new SubjectRegistry();

export default Subject;
