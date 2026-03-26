/**
 * Email Notification Strategy
 * Sends notifications via SMTP using Nodemailer
 */

import nodemailer from 'nodemailer';
import { BaseNotificationStrategy } from './NotificationStrategy';
import {
  NotificationChannel,
  CreateNotificationDto,
  Notification,
  DeliveryResult,
} from '../../models/Notification';
import { logger } from '../../utils/logger';

// SMTP configuration
const smtpConfig = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
  from: process.env.SMTP_FROM || 'noreply@jpmtlogistics.com',
};

export class EmailStrategy extends BaseNotificationStrategy {
  readonly channel = NotificationChannel.EMAIL;
  private transporter: nodemailer.Transporter | null = null;
  private healthy = false;

  constructor() {
    super('EmailStrategy');
    this.initializeTransporter();
  }

  private initializeTransporter(): void {
    if (!smtpConfig.auth.user || !smtpConfig.auth.pass) {
      logger.warn('Email strategy disabled - SMTP credentials not configured');
      this.healthy = false;
      return;
    }

    try {
      this.transporter = nodemailer.createTransporter({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure,
        auth: smtpConfig.auth,
        pool: true, // Use connection pooling
        maxConnections: 5,
      });

      this.healthy = true;
      logger.info('Email transporter initialized', { host: smtpConfig.host });
    } catch (error) {
      logger.error('Failed to initialize email transporter', { error: (error as Error).message });
      this.healthy = false;
    }
  }

  async send(
    notification: CreateNotificationDto | Notification
  ): Promise<DeliveryResult> {
    if (!this.transporter) {
      return this.createFailureResult('Email transporter not initialized');
    }

    try {
      const to = (notification as any).emailAddress || notification.data?.email;
      if (!to) {
        return this.createFailureResult('No email address provided');
      }

      const html = this.generateEmailTemplate(notification);

      const result = await this.transporter.sendMail({
        from: smtpConfig.from,
        to,
        subject: notification.title,
        text: notification.message,
        html,
      });

      logger.debug('Email sent', {
        messageId: result.messageId,
        to,
        subject: notification.title,
      });

      return this.createSuccessResult(result.messageId);
    } catch (error) {
      logger.error('Failed to send email', {
        error: (error as Error).message,
        to: (notification as any).emailAddress || notification.data?.email,
      });
      return this.createFailureResult((error as Error).message);
    }
  }

  validate(notification: CreateNotificationDto | Notification): boolean {
    const email = (notification as any).emailAddress || notification.data?.email;
    if (!email) return false;

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  getHealth(): { healthy: boolean; message?: string } {
    return {
      healthy: this.healthy,
      message: this.healthy ? 'Connected' : 'SMTP not configured',
    };
  }

  /**
   * Generate HTML email template
   */
  private generateEmailTemplate(
    notification: CreateNotificationDto | Notification
  ): string {
    const trackingNumber = notification.data?.trackingNumber || '';
    const status = notification.data?.status || '';

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${notification.title}</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #0f172a; color: white; padding: 20px; text-align: center; }
    .content { background: #f8fafc; padding: 20px; margin: 20px 0; }
    .tracking-box { background: white; border: 2px solid #0066FF; padding: 15px; margin: 15px 0; text-align: center; }
    .tracking-number { font-size: 24px; font-weight: bold; color: #0066FF; }
    .status { font-size: 18px; color: #22c55e; font-weight: bold; }
    .footer { text-align: center; color: #64748b; font-size: 12px; }
    .button { display: inline-block; background: #0066FF; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 0; }
  </style>
</head>
<body>
  <div class="header">
    <h1>JPMT Logistics</h1>
  </div>
  
  <div class="content">
    <h2>${notification.title}</h2>
    <p>${notification.message}</p>
    
    ${trackingNumber ? `
    <div class="tracking-box">
      <div>Tracking Number</div>
      <div class="tracking-number">${trackingNumber}</div>
      ${status ? `<div class="status">${status}</div>` : ''}
    </div>
    ` : ''}
    
    <p>
      <a href="https://jpmtlogistics.com/track?tn=${trackingNumber}" class="button">Track Shipment</a>
    </p>
  </div>
  
  <div class="footer">
    <p>This is an automated message from JPMT Logistics.</p>
    <p>© 2024 JPMT Logistics. All rights reserved.</p>
  </div>
</body>
</html>
    `;
  }
}

export default EmailStrategy;
