/**
 * Notifications API Routes
 * REST endpoints for notification management
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { notificationService } from '../services/NotificationService';
import { notificationQueue } from '../services/NotificationQueue';
import { logger } from '../utils/logger';
import { NotificationType, NotificationChannel } from '../models/Notification';

const router = Router();

// Validation schemas
const updatePreferencesSchema = z.object({
  emailEnabled: z.boolean().optional(),
  emailAddress: z.string().email().optional(),
  smsEnabled: z.boolean().optional(),
  smsPhone: z.string().optional(),
  pushEnabled: z.boolean().optional(),
  webhookEnabled: z.boolean().optional(),
  webhookUrl: z.string().url().optional(),
  quietHoursStart: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).optional(),
  quietHoursEnd: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).optional(),
  quietHoursTimezone: z.string().optional(),
  notifyStatusChange: z.boolean().optional(),
  notifyDelays: z.boolean().optional(),
  notifyDeliveryAttempts: z.boolean().optional(),
  notifyExceptions: z.boolean().optional(),
  notifyGeofence: z.boolean().optional(),
  notifyEtaUpdates: z.boolean().optional(),
  maxNotificationsPerHour: z.number().min(1).max(100).optional(),
});

const triggerNotificationSchema = z.object({
  type: z.nativeEnum(NotificationType),
  channel: z.nativeEnum(NotificationChannel).optional(),
  title: z.string().optional(),
  message: z.string().optional(),
  data: z.record(z.any()).optional(),
});

/**
 * GET /api/notifications/preferences
 * Get user's notification preferences
 */
router.get('/preferences', async (req: Request, res: Response) => {
  try {
    // In production, get userId from authenticated session
    const userId = req.headers['x-user-id'] as string || 'demo-user';

    const preferences = await notificationService.getPreferences(userId);

    if (!preferences) {
      return res.json({
        success: true,
        data: null,
        message: 'No preferences set, using defaults',
      });
    }

    res.json({
      success: true,
      data: preferences,
    });
  } catch (error) {
    logger.error('Get preferences failed', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to retrieve preferences',
    });
  }
});

/**
 * PUT /api/notifications/preferences
 * Update notification preferences
 */
router.put('/preferences', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string || 'demo-user';

    const validation = updatePreferencesSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors,
      });
    }

    const preferences = await notificationService.updatePreferences(
      userId,
      validation.data
    );

    res.json({
      success: true,
      data: preferences,
    });
  } catch (error) {
    logger.error('Update preferences failed', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to update preferences',
    });
  }
});

/**
 * GET /api/notifications/history
 * Get notification history for user
 */
router.get('/history', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string || 'demo-user';
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const notifications = await notificationService.getNotificationHistory(userId, {
      limit,
      offset,
    });

    res.json({
      success: true,
      data: notifications,
    });
  } catch (error) {
    logger.error('Get notification history failed', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to retrieve notification history',
    });
  }
});

/**
 * POST /api/notifications/subscribe/:shipmentId
 * Subscribe to shipment notifications
 */
router.post('/subscribe/:shipmentId', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string || 'demo-user';
    const { shipmentId } = req.params;

    await notificationService.subscribeToShipment(userId, shipmentId);

    res.json({
      success: true,
      message: 'Subscribed to shipment notifications',
    });
  } catch (error) {
    logger.error('Subscribe failed', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to subscribe',
    });
  }
});

/**
 * DELETE /api/notifications/subscribe/:shipmentId
 * Unsubscribe from shipment notifications
 */
router.delete('/subscribe/:shipmentId', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string || 'demo-user';
    const { shipmentId } = req.params;

    await notificationService.unsubscribeFromShipment(userId, shipmentId);

    res.json({
      success: true,
      message: 'Unsubscribed from shipment notifications',
    });
  } catch (error) {
    logger.error('Unsubscribe failed', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to unsubscribe',
    });
  }
});

/**
 * POST /api/notifications/trigger
 * Manually trigger a notification (admin only)
 */
router.post('/trigger', async (req: Request, res: Response) => {
  try {
    const userId = req.headers['x-user-id'] as string || 'demo-user';
    const shipmentId = req.body.shipmentId as string;

    const validation = triggerNotificationSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors,
      });
    }

    await notificationService.triggerNotification(
      userId,
      shipmentId,
      validation.data.type,
      validation.data.data
    );

    res.json({
      success: true,
      message: 'Notification triggered',
    });
  } catch (error) {
    logger.error('Trigger notification failed', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to trigger notification',
    });
  }
});

/**
 * GET /api/notifications/queue/stats
 * Get notification queue statistics
 */
router.get('/queue/stats', async (req: Request, res: Response) => {
  try {
    const stats = await notificationQueue.getStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error('Get queue stats failed', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to retrieve queue stats',
    });
  }
});

/**
 * GET /api/notifications/health
 * Get notification service health
 */
router.get('/health', (req: Request, res: Response) => {
  try {
    const health = notificationService.getHealth();

    res.json({
      success: true,
      data: health,
    });
  } catch (error) {
    logger.error('Get health failed', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to retrieve health status',
    });
  }
});

export default router;
