/**
 * Strategy Pattern - Notification Strategy Interface
 * Defines the contract for notification delivery strategies
 */

import {
  Notification,
  CreateNotificationDto,
  NotificationChannel,
  DeliveryResult,
} from '../../models/Notification';

/**
 * Strategy interface for notification delivery
 */
export interface NotificationStrategy {
  /**
   * The channel this strategy handles
   */
  readonly channel: NotificationChannel;

  /**
   * Send a notification
   */
  send(notification: CreateNotificationDto | Notification): Promise<DeliveryResult>;

  /**
   * Check if this strategy supports the given channel
   */
  supports(channel: NotificationChannel): boolean;

  /**
   * Validate the notification can be sent via this channel
   */
  validate(notification: CreateNotificationDto | Notification): boolean;

  /**
   * Get strategy name
   */
  getName(): string;

  /**
   * Get strategy health/status
   */
  getHealth?(): { healthy: boolean; message?: string };
}

/**
 * Abstract base class for notification strategies
 */
export abstract class BaseNotificationStrategy implements NotificationStrategy {
  abstract readonly channel: NotificationChannel;
  protected strategyName: string;

  constructor(name: string) {
    this.strategyName = name;
  }

  abstract send(
    notification: CreateNotificationDto | Notification
  ): Promise<DeliveryResult>;

  supports(channel: NotificationChannel): boolean {
    return channel === this.channel;
  }

  abstract validate(notification: CreateNotificationDto | Notification): boolean;

  getName(): string {
    return this.strategyName;
  }

  /**
   * Helper to create success result
   */
  protected createSuccessResult(messageId?: string): DeliveryResult {
    return {
      success: true,
      messageId,
      timestamp: new Date(),
    };
  }

  /**
   * Helper to create failure result
   */
  protected createFailureResult(error: string): DeliveryResult {
    return {
      success: false,
      error,
      timestamp: new Date(),
    };
  }
}

/**
 * Strategy context for executing notification strategies
 */
export class NotificationStrategyContext {
  private strategies: Map<NotificationChannel, NotificationStrategy> = new Map();

  /**
   * Register a strategy
   */
  registerStrategy(strategy: NotificationStrategy): void {
    this.strategies.set(strategy.channel, strategy);
  }

  /**
   * Unregister a strategy
   */
  unregisterStrategy(channel: NotificationChannel): void {
    this.strategies.delete(channel);
  }

  /**
   * Execute the appropriate strategy for a notification
   */
  async execute(
    notification: CreateNotificationDto | Notification
  ): Promise<DeliveryResult> {
    const strategy = this.strategies.get(notification.channel);

    if (!strategy) {
      return {
        success: false,
        error: `No strategy found for channel: ${notification.channel}`,
        timestamp: new Date(),
      };
    }

    // Validate before sending
    if (!strategy.validate(notification)) {
      return {
        success: false,
        error: `Notification validation failed for ${notification.channel}`,
        timestamp: new Date(),
      };
    }

    try {
      return await strategy.send(notification);
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Check if a strategy exists for a channel
   */
  hasStrategy(channel: NotificationChannel): boolean {
    return this.strategies.has(channel);
  }

  /**
   * Get all registered strategies
   */
  getStrategies(): NotificationStrategy[] {
    return Array.from(this.strategies.values());
  }

  /**
   * Get strategy health for all strategies
   */
  getHealth(): Record<string, { healthy: boolean; message?: string }> {
    const health: Record<string, { healthy: boolean; message?: string }> = {};

    for (const [channel, strategy] of this.strategies) {
      health[channel] = strategy.getHealth?.() || { healthy: true };
    }

    return health;
  }
}

// Global context instance
export const strategyContext = new NotificationStrategyContext();

export default NotificationStrategy;
