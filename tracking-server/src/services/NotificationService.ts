/**
 * Notification Service
 * Orchestrates the notification system using Observer and Strategy patterns
 */

import { logger } from '../utils/logger';
import { query } from '../config/database';
import { notificationQueue } from './NotificationQueue';
import { sseService } from './SseService';
import { subjectRegistry, ShipmentSubject } from '../patterns/observer/Subject';
import { BaseTrackingObserver } from '../patterns/observer/TrackingObserver';
import { strategyContext, NotificationStrategyContext } from '../patterns/strategy/NotificationStrategy';
import { EmailStrategy } from '../patterns/strategy/EmailStrategy';
import { SmsStrategy } from '../patterns/strategy/SmsStrategy';
import { PushStrategy } from '../patterns/strategy/PushStrategy';
import { WebhookStrategy } from '../patterns/strategy/WebhookStrategy';

import {
  Notification,
  CreateNotificationDto,
  NotificationChannel,
  NotificationType,
  NotificationPriority,
  NotificationStatus,
  NotificationPreferences,
  DeliveryResult,
  generateNotificationTitle,
  getPriorityForType,
  getChannelsForEventType,
  shouldScheduleNotification,
  isInQuietHours,
} from '../models/Notification';

import { TrackingEvent, isSignificantStatusChange } from '../models/TrackingEvent';
import { ShipmentStatus, getStatusLabel } from '../models/Shipment';

// Initialize strategies
const emailStrategy = new EmailStrategy();
const smsStrategy = new SmsStrategy();
const pushStrategy = new PushStrategy();
const webhookStrategy = new WebhookStrategy();

strategyContext.registerStrategy(emailStrategy);
strategyContext.registerStrategy(smsStrategy);
strategyContext.registerStrategy(pushStrategy);
strategyContext.registerStrategy(webhookStrategy);

/**
 * Tracking observer that triggers notifications on tracking events
 */
class NotificationTrackingObserver extends BaseTrackingObserver {
  constructor() {
    super('NotificationTrackingObserver');
  }

  async update(event: TrackingEvent): Promise<void> {
    // Only notify on significant status changes
    if (!isSignificantStatusChange(event)) {
      return;
    }

    try {
      // Get shipment subscribers
      const subscribers = await notificationService.getShipmentSubscribers(event.shipmentId);

      // Determine notification type
      const type = this.mapStatusToNotificationType(event.status as ShipmentStatus);

      // Send notifications to each subscriber
      for (const userId of subscribers) {
        await notificationService.triggerNotification(userId, event.shipmentId, type, {
          status: event.status,
          previousStatus: event.previousStatus,
          description: event.description,
          location: event.location,
        });
      }

      // Broadcast to SSE clients
      const shipment = await query(
        'SELECT tracking_number FROM shipments WHERE id = $1',
        [event.shipmentId]
      );

      if (shipment.rows.length > 0) {
        sseService.broadcastTrackingEvent(shipment.rows[0].tracking_number, event);
      }
    } catch (error) {
      logger.error('Notification observer failed', {
        error: (error as Error).message,
        eventId: event.id,
      });
    }
  }

  private mapStatusToNotificationType(status: ShipmentStatus): NotificationType {
    switch (status) {
      case ShipmentStatus.DELIVERED:
        return NotificationType.DELIVERED;
      case ShipmentStatus.DELAYED:
        return NotificationType.DELAY;
      case ShipmentStatus.EXCEPTION:
        return NotificationType.EXCEPTION;
      case ShipmentStatus.OUT_FOR_DELIVERY:
        return NotificationType.DELIVERY_ATTEMPT;
      default:
        return NotificationType.STATUS_CHANGE;
    }
  }
}

export class NotificationService {
  private initialized = false;
  private notificationObserver: NotificationTrackingObserver;

  constructor() {
    this.notificationObserver = new NotificationTrackingObserver();
  }

  /**
   * Initialize the notification service
   */
  initialize(): void {
    if (this.initialized) return;

    // Set up queue processor
    notificationQueue.process(5, async (job) => {
      const { notification } = job.data;
      return await this.sendNotification(notification);
    });

    this.initialized = true;
    logger.info('Notification service initialized');
  }

  /**
   * Get notification preferences for a user
   */
  async getPreferences(userId: string): Promise<NotificationPreferences | null> {
    const result = await query(
      'SELECT * FROM notification_preferences WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToPreferences(result.rows[0]);
  }

  /**
   * Update notification preferences
   */
  async updatePreferences(
    userId: string,
    updates: Partial<NotificationPreferences>
  ): Promise<NotificationPreferences> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      // Map camelCase to snake_case
      const column = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      fields.push(`${column} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }

    fields.push(`updated_at = NOW()`);

    const result = await query(
      `INSERT INTO notification_preferences (user_id, ${Object.keys(updates).map(k => k.replace(/([A-Z])/g, '_$1').toLowerCase()).join(', ')})
       VALUES ($1, ${Object.keys(updates).map((_, i) => `$${i + 2}`).join(', ')})
       ON CONFLICT (user_id) 
       DO UPDATE SET ${fields.join(', ')}
       RETURNING *`,
      [userId, ...Object.values(updates)]
    );

    return this.mapRowToPreferences(result.rows[0]);
  }

  /**
   * Trigger a notification for a user
   */
  async triggerNotification(
    userId: string,
    shipmentId: string,
    type: NotificationType,
    data: Record<string, any> = {}
  ): Promise<void> {
    // Get user preferences
    const preferences = await this.getPreferences(userId);
    
    // Use defaults if no preferences set
    const prefs = preferences || this.getDefaultPreferences();

    // Check quiet hours
    if (isInQuietHours(prefs)) {
      const schedule = shouldScheduleNotification(prefs);
      if (schedule.shouldSchedule && schedule.scheduledFor) {
        await this.scheduleNotification(userId, shipmentId, type, data, schedule.scheduledFor);
      }
      return;
    }

    // Get channels for this event type
    const channels = getChannelsForEventType(type, prefs);

    // Create and send notifications for each channel
    for (const channel of channels) {
      await this.createAndQueue(userId, shipmentId, type, channel, data, prefs);
    }
  }

  /**
   * Create and queue a notification
   */
  private async createAndQueue(
    userId: string,
    shipmentId: string,
    type: NotificationType,
    channel: NotificationChannel,
    data: Record<string, any>,
    preferences: NotificationPreferences
  ): Promise<void> {
    // Get shipment info
    const shipmentResult = await query(
      'SELECT tracking_number, status, estimated_delivery FROM shipments WHERE id = $1',
      [shipmentId]
    );

    const trackingNumber = shipmentResult.rows[0]?.tracking_number;
    const status = shipmentResult.rows[0]?.status;

    // Build notification
    const notification: CreateNotificationDto = {
      userId,
      shipmentId,
      type,
      channel,
      priority: getPriorityForType(type),
      title: generateNotificationTitle(type, trackingNumber),
      message: this.generateMessage(type, status, data),
      data: {
        trackingNumber,
        status,
        estimatedDelivery: shipmentResult.rows[0]?.estimated_delivery,
        ...data,
      },
    };

    // Add channel-specific data
    if (channel === NotificationChannel.EMAIL) {
      (notification as any).emailAddress = preferences.emailAddress;
    } else if (channel === NotificationChannel.SMS) {
      (notification as any).phoneNumber = preferences.smsPhone;
    } else if (channel === NotificationChannel.PUSH) {
      // Get push subscription
      const userResult = await query(
        'SELECT push_subscription FROM users WHERE id = $1',
        [userId]
      );
      (notification as any).pushSubscription = userResult.rows[0]?.push_subscription;
    } else if (channel === NotificationChannel.WEBHOOK) {
      (notification as any).webhookUrl = preferences.webhookUrl;
    }

    // Queue the notification
    await notificationQueue.add(notification, {
      priority: notification.priority === NotificationPriority.CRITICAL ? 1 : 5,
    });

    logger.debug('Notification queued', {
      userId,
      type,
      channel,
      trackingNumber,
    });
  }

  /**
   * Schedule a notification for later delivery
   */
  private async scheduleNotification(
    userId: string,
    shipmentId: string,
    type: NotificationType,
    data: Record<string, any>,
    scheduledFor: Date
  ): Promise<void> {
    // Similar to triggerNotification but with scheduling
    // Implementation would queue with delay
    logger.debug('Notification scheduled for quiet hours', {
      userId,
      type,
      scheduledFor,
    });
  }

  /**
   * Send a notification immediately (called by queue processor)
   */
  private async sendNotification(
    notification: CreateNotificationDto
  ): Promise<DeliveryResult> {
    return await strategyContext.execute(notification);
  }

  /**
   * Register a shipment for notifications
   */
  async registerShipment(shipmentId: string): Promise<void> {
    const subject = subjectRegistry.getSubject(shipmentId);
    subject.attach(this.notificationObserver);

    logger.debug('Shipment registered for notifications', { shipmentId });
  }

  /**
   * Unregister a shipment from notifications
   */
  async unregisterShipment(shipmentId: string): Promise<void> {
    subjectRegistry.removeSubject(shipmentId);

    logger.debug('Shipment unregistered from notifications', { shipmentId });
  }

  /**
   * Get subscribers for a shipment
   */
  async getShipmentSubscribers(shipmentId: string): Promise<string[]> {
    const result = await query(
      'SELECT user_id FROM shipment_subscriptions WHERE shipment_id = $1 AND active = true',
      [shipmentId]
    );

    return result.rows.map((row) => row.user_id);
  }

  /**
   * Subscribe a user to a shipment
   */
  async subscribeToShipment(userId: string, shipmentId: string): Promise<void> {
    await query(
      `INSERT INTO shipment_subscriptions (user_id, shipment_id, active)
       VALUES ($1, $2, true)
       ON CONFLICT (user_id, shipment_id) 
       DO UPDATE SET active = true`,
      [userId, shipmentId]
    );

    // Register shipment if not already registered
    await this.registerShipment(shipmentId);

    logger.info('User subscribed to shipment', { userId, shipmentId });
  }

  /**
   * Unsubscribe a user from a shipment
   */
  async unsubscribeFromShipment(userId: string, shipmentId: string): Promise<void> {
    await query(
      'UPDATE shipment_subscriptions SET active = false WHERE user_id = $1 AND shipment_id = $2',
      [userId, shipmentId]
    );

    logger.info('User unsubscribed from shipment', { userId, shipmentId });
  }

  /**
   * Get notification history for a user
   */
  async getNotificationHistory(
    userId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<Notification[]> {
    const result = await query(
      `SELECT n.*, s.tracking_number 
       FROM notifications n
       LEFT JOIN shipments s ON n.shipment_id = s.id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, options.limit || 50, options.offset || 0]
    );

    return result.rows.map(this.mapRowToNotification);
  }

  /**
   * Mark notification as read/delivered
   */
  async markAsDelivered(notificationId: string): Promise<void> {
    await query(
      `UPDATE notifications 
       SET status = $1, delivered_at = NOW()
       WHERE id = $2`,
      [NotificationStatus.DELIVERED, notificationId]
    );
  }

  /**
   * Get service health
   */
  getHealth(): {
    initialized: boolean;
    strategies: Record<string, { healthy: boolean; message?: string }>;
    queue: any;
  } {
    return {
      initialized: this.initialized,
      strategies: strategyContext.getHealth(),
      queue: notificationQueue.isQueueProcessing(),
    };
  }

  /**
   * Generate notification message
   */
  private generateMessage(
    type: NotificationType,
    status: string,
    data: Record<string, any>
  ): string {
    const statusLabel = getStatusLabel(status as ShipmentStatus);

    switch (type) {
      case NotificationType.DELIVERED:
        return `Your shipment has been delivered successfully.`;
      case NotificationType.DELAY:
        return `Your shipment has been delayed. ${data.description || ''}`;
      case NotificationType.EXCEPTION:
        return `There was an issue with your shipment. ${data.description || ''}`;
      case NotificationType.DELIVERY_ATTEMPT:
        return `We attempted to deliver your shipment. ${data.description || ''}`;
      case NotificationType.ETA_UPDATE:
        return `Your estimated delivery time has been updated.`;
      default:
        return `Your shipment status has been updated to: ${statusLabel}`;
    }
  }

  /**
   * Get default preferences
   */
  private getDefaultPreferences(): NotificationPreferences {
    return {
      id: '',
      userId: '',
      emailEnabled: true,
      smsEnabled: false,
      pushEnabled: true,
      webhookEnabled: false,
      quietHoursTimezone: 'America/Chicago',
      notifyStatusChange: true,
      notifyDelays: true,
      notifyDeliveryAttempts: true,
      notifyExceptions: true,
      notifyGeofence: false,
      notifyEtaUpdates: false,
      maxNotificationsPerHour: 10,
      updatedAt: new Date(),
    };
  }

  /**
   * Map database row to NotificationPreferences
   */
  private mapRowToPreferences(row: any): NotificationPreferences {
    return {
      id: row.id,
      userId: row.user_id,
      emailEnabled: row.email_enabled,
      emailAddress: row.email_address,
      smsEnabled: row.sms_enabled,
      smsPhone: row.sms_phone,
      pushEnabled: row.push_enabled,
      webhookEnabled: row.webhook_enabled,
      webhookUrl: row.webhook_url,
      quietHoursStart: row.quiet_hours_start,
      quietHoursEnd: row.quiet_hours_end,
      quietHoursTimezone: row.quiet_hours_timezone,
      notifyStatusChange: row.notify_status_change,
      notifyDelays: row.notify_delays,
      notifyDeliveryAttempts: row.notify_delivery_attempts,
      notifyExceptions: row.notify_exceptions,
      notifyGeofence: row.notify_geofence,
      notifyEtaUpdates: row.notify_eta_updates,
      maxNotificationsPerHour: row.max_notifications_per_hour,
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Map database row to Notification
   */
  private mapRowToNotification(row: any): Notification {
    return {
      id: row.id,
      userId: row.user_id,
      shipmentId: row.shipment_id,
      type: row.type,
      channel: row.channel,
      priority: row.priority,
      title: row.title,
      message: row.message,
      data: row.data || {},
      status: row.status,
      sentAt: row.sent_at ? new Date(row.sent_at) : undefined,
      deliveredAt: row.delivered_at ? new Date(row.delivered_at) : undefined,
      failedAt: row.failed_at ? new Date(row.failed_at) : undefined,
      failureReason: row.failure_reason,
      retryCount: row.retry_count,
      scheduledFor: row.scheduled_for ? new Date(row.scheduled_for) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

// Singleton instance
export const notificationService = new NotificationService();
export default notificationService;
