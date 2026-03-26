/**
 * SMS Notification Strategy
 * Sends notifications via Twilio
 */

import twilio from 'twilio';
import { BaseNotificationStrategy } from './NotificationStrategy';
import {
  NotificationChannel,
  CreateNotificationDto,
  Notification,
  DeliveryResult,
} from '../../models/Notification';
import { logger } from '../../utils/logger';

// Twilio configuration
const twilioConfig = {
  accountSid: process.env.TWILIO_ACCOUNT_SID || '',
  authToken: process.env.TWILIO_AUTH_TOKEN || '',
  phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
};

export class SmsStrategy extends BaseNotificationStrategy {
  readonly channel = NotificationChannel.SMS;
  private client: twilio.Twilio | null = null;
  private healthy = false;

  constructor() {
    super('SmsStrategy');
    this.initializeClient();
  }

  private initializeClient(): void {
    if (!twilioConfig.accountSid || !twilioConfig.authToken) {
      logger.warn('SMS strategy disabled - Twilio credentials not configured');
      this.healthy = false;
      return;
    }

    try {
      this.client = twilio(twilioConfig.accountSid, twilioConfig.authToken);
      this.healthy = true;
      logger.info('Twilio client initialized');
    } catch (error) {
      logger.error('Failed to initialize Twilio client', { error: (error as Error).message });
      this.healthy = false;
    }
  }

  async send(
    notification: CreateNotificationDto | Notification
  ): Promise<DeliveryResult> {
    if (!this.client) {
      return this.createFailureResult('Twilio client not initialized');
    }

    try {
      const to = (notification as any).phoneNumber || notification.data?.phone;
      if (!to) {
        return this.createFailureResult('No phone number provided');
      }

      // Format phone number to E.164
      const formattedPhone = this.formatPhoneNumber(to);
      if (!formattedPhone) {
        return this.createFailureResult('Invalid phone number format');
      }

      // Truncate message to 1600 chars (Twilio limit)
      const message = this.formatMessage(notification);

      const result = await this.client.messages.create({
        body: message,
        from: twilioConfig.phoneNumber,
        to: formattedPhone,
      });

      logger.debug('SMS sent', {
        messageSid: result.sid,
        to: formattedPhone,
        status: result.status,
      });

      return this.createSuccessResult(result.sid);
    } catch (error) {
      logger.error('Failed to send SMS', {
        error: (error as Error).message,
        to: (notification as any).phoneNumber || notification.data?.phone,
      });
      return this.createFailureResult((error as Error).message);
    }
  }

  validate(notification: CreateNotificationDto | Notification): boolean {
    const phone = (notification as any).phoneNumber || notification.data?.phone;
    if (!phone) return false;

    return this.formatPhoneNumber(phone) !== null;
  }

  getHealth(): { healthy: boolean; message?: string } {
    return {
      healthy: this.healthy,
      message: this.healthy ? 'Connected' : 'Twilio not configured',
    };
  }

  /**
   * Format phone number to E.164
   */
  private formatPhoneNumber(phone: string): string | null {
    // Remove all non-numeric characters
    const cleaned = phone.replace(/\D/g, '');

    // US/Canada numbers
    if (cleaned.length === 10) {
      return `+1${cleaned}`;
    }

    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      return `+${cleaned}`;
    }

    // International numbers (must start with country code)
    if (cleaned.length > 10) {
      return `+${cleaned}`;
    }

    return null;
  }

  /**
   * Format message for SMS (concise)
   */
  private formatMessage(
    notification: CreateNotificationDto | Notification
  ): string {
    const trackingNumber = notification.data?.trackingNumber;
    const status = notification.data?.status;

    let message = notification.message;

    // Add tracking info if available
    if (trackingNumber) {
      message += ` Track: ${trackingNumber}`;
    }

    if (status) {
      message += ` Status: ${status}`;
    }

    // Truncate if too long
    if (message.length > 1600) {
      message = message.substring(0, 1597) + '...';
    }

    return message;
  }
}

export default SmsStrategy;
