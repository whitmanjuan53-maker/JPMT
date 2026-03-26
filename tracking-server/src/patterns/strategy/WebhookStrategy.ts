/**
 * Webhook Notification Strategy
 * Sends notifications via HTTP POST to user-defined endpoints
 */

import axios from 'axios';
import { BaseNotificationStrategy } from './NotificationStrategy';
import {
  NotificationChannel,
  CreateNotificationDto,
  Notification,
  DeliveryResult,
  WebhookPayload,
} from '../../models/Notification';
import { logger } from '../../utils/logger';

// Webhook configuration
const webhookConfig = {
  timeout: 10000, // 10 seconds
  maxRedirects: 3,
  retries: 3,
};

export class WebhookStrategy extends BaseNotificationStrategy {
  readonly channel = NotificationChannel.WEBHOOK;
  private healthy = true;

  constructor() {
    super('WebhookStrategy');
  }

  async send(
    notification: CreateNotificationDto | Notification
  ): Promise<DeliveryResult> {
    try {
      const url = (notification as any).webhookUrl || notification.data?.webhookUrl;
      if (!url) {
        return this.createFailureResult('No webhook URL provided');
      }

      // Validate URL
      if (!this.isValidUrl(url)) {
        return this.createFailureResult('Invalid webhook URL');
      }

      const payload = this.createWebhookPayload(notification);

      const response = await axios.post(url, payload, {
        timeout: webhookConfig.timeout,
        maxRedirects: webhookConfig.maxRedirects,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'JPMT-Tracking-Server/1.0',
          'X-JPMT-Event': notification.type,
          'X-JPMT-Signature': this.generateSignature(payload),
        },
        validateStatus: (status) => status < 500, // Accept 2xx, 3xx, 4xx
      });

      logger.debug('Webhook sent', {
        url,
        status: response.status,
        event: notification.type,
      });

      // 4xx errors are considered delivery failures
      if (response.status >= 400) {
        return this.createFailureResult(`HTTP ${response.status}: ${response.statusText}`);
      }

      return this.createSuccessResult();
    } catch (error) {
      const axiosError = error as any;
      const errorMessage = axiosError.response
        ? `HTTP ${axiosError.response.status}: ${axiosError.response.statusText}`
        : axiosError.message;

      logger.error('Failed to send webhook', {
        url: (notification as any).webhookUrl || notification.data?.webhookUrl,
        error: errorMessage,
      });

      return this.createFailureResult(errorMessage);
    }
  }

  validate(notification: CreateNotificationDto | Notification): boolean {
    const url = (notification as any).webhookUrl || notification.data?.webhookUrl;
    if (!url) return false;

    return this.isValidUrl(url);
  }

  getHealth(): { healthy: boolean; message?: string } {
    return {
      healthy: this.healthy,
      message: this.healthy ? 'Ready' : 'Disabled',
    };
  }

  /**
   * Validate webhook URL
   */
  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      // Only allow HTTPS for security (or HTTP in development)
      if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
        return false;
      }
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  /**
   * Create webhook payload
   */
  private createWebhookPayload(
    notification: CreateNotificationDto | Notification
  ): WebhookPayload {
    return {
      event: notification.type,
      timestamp: new Date().toISOString(),
      trackingNumber: notification.data?.trackingNumber,
      status: notification.data?.status,
      previousStatus: notification.data?.previousStatus,
      location: notification.data?.location,
      estimatedDelivery: notification.data?.estimatedDelivery,
      data: {
        title: notification.title,
        message: notification.message,
        priority: notification.priority,
        ...notification.data,
      },
    };
  }

  /**
   * Generate signature for webhook verification
   * In production, use HMAC with a shared secret
   */
  private generateSignature(payload: WebhookPayload): string {
    // Simplified signature - in production use crypto.createHmac
    const secret = process.env.WEBHOOK_SECRET || 'default-secret';
    const data = JSON.stringify(payload);
    return `sha256=${Buffer.from(data + secret).toString('base64')}`;
  }
}

export default WebhookStrategy;
