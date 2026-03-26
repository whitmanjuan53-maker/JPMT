/**
 * Push Notification Strategy
 * Sends web push notifications using web-push
 */

import webPush from 'web-push';
import { BaseNotificationStrategy } from './NotificationStrategy';
import {
  NotificationChannel,
  CreateNotificationDto,
  Notification,
  DeliveryResult,
  PushNotificationPayload,
} from '../../models/Notification';
import { logger } from '../../utils/logger';

// VAPID configuration for web push
const vapidConfig = {
  publicKey: process.env.WEB_PUSH_VAPID_PUBLIC || '',
  privateKey: process.env.WEB_PUSH_VAPID_PRIVATE || '',
  subject: process.env.WEB_PUSH_SUBJECT || 'mailto:support@jpmtlogistics.com',
};

export class PushStrategy extends BaseNotificationStrategy {
  readonly channel = NotificationChannel.PUSH;
  private healthy = false;

  constructor() {
    super('PushStrategy');
    this.initializeWebPush();
  }

  private initializeWebPush(): void {
    if (!vapidConfig.publicKey || !vapidConfig.privateKey) {
      logger.warn('Push strategy disabled - VAPID keys not configured');
      this.healthy = false;
      return;
    }

    try {
      webPush.setVapidDetails(
        vapidConfig.subject,
        vapidConfig.publicKey,
        vapidConfig.privateKey
      );
      this.healthy = true;
      logger.info('Web Push initialized');
    } catch (error) {
      logger.error('Failed to initialize Web Push', { error: (error as Error).message });
      this.healthy = false;
    }
  }

  async send(
    notification: CreateNotificationDto | Notification
  ): Promise<DeliveryResult> {
    if (!this.healthy) {
      return this.createFailureResult('Web Push not initialized');
    }

    try {
      const subscription = (notification as any).pushSubscription || notification.data?.pushSubscription;
      if (!subscription) {
        return this.createFailureResult('No push subscription provided');
      }

      const payload = this.createPushPayload(notification);

      const result = await webPush.sendNotification(
        subscription,
        JSON.stringify(payload)
      );

      logger.debug('Push notification sent', {
        statusCode: result.statusCode,
      });

      return this.createSuccessResult();
    } catch (error) {
      const errorMessage = (error as Error).message;
      
      // Handle specific push errors
      if (errorMessage.includes('expired')) {
        logger.warn('Push subscription expired');
        return this.createFailureResult('Subscription expired');
      }

      logger.error('Failed to send push notification', { error: errorMessage });
      return this.createFailureResult(errorMessage);
    }
  }

  validate(notification: CreateNotificationDto | Notification): boolean {
    const subscription = (notification as any).pushSubscription || notification.data?.pushSubscription;
    if (!subscription) return false;

    // Validate subscription object structure
    return (
      subscription.endpoint &&
      subscription.keys?.p256dh &&
      subscription.keys?.auth
    );
  }

  getHealth(): { healthy: boolean; message?: string } {
    return {
      healthy: this.healthy,
      message: this.healthy ? 'Connected' : 'VAPID keys not configured',
    };
  }

  /**
   * Create push notification payload
   */
  private createPushPayload(
    notification: CreateNotificationDto | Notification
  ): PushNotificationPayload {
    const trackingNumber = notification.data?.trackingNumber;
    const status = notification.data?.status;

    // Determine icon and badge based on notification type
    let icon = '/images/logo.png';
    let badge = '/images/badge.png';

    if (status === 'delivered') {
      icon = '/images/delivered-icon.png';
    } else if (status === 'delayed' || status === 'exception') {
      icon = '/images/alert-icon.png';
    }

    return {
      title: notification.title,
      body: notification.message,
      icon,
      badge,
      tag: trackingNumber || 'general',
      requireInteraction: notification.priority === 'critical',
      actions: [
        {
          action: 'track',
          title: 'Track',
        },
        {
          action: 'dismiss',
          title: 'Dismiss',
        },
      ],
      data: {
        trackingNumber,
        status,
        url: trackingNumber
          ? `https://jpmtlogistics.com/track?tn=${trackingNumber}`
          : 'https://jpmtlogistics.com',
      },
    };
  }

  /**
   * Get VAPID public key for client subscription
   */
  getPublicKey(): string | null {
    return vapidConfig.publicKey || null;
  }
}

export default PushStrategy;
