/**
 * Notification domain models
 */

import { ShipmentStatus } from './Shipment';

// Notification channel enum
export enum NotificationChannel {
  EMAIL = 'email',
  SMS = 'sms',
  PUSH = 'push',
  WEBHOOK = 'webhook',
  IN_APP = 'in_app',
}

// Notification type enum
export enum NotificationType {
  STATUS_CHANGE = 'status_change',
  DELAY = 'delay',
  DELIVERY_ATTEMPT = 'delivery_attempt',
  EXCEPTION = 'exception',
  GEOFENCE_ENTER = 'geofence_enter',
  GEOFENCE_EXIT = 'geofence_exit',
  ETA_UPDATE = 'eta_update',
  DELIVERED = 'delivered',
}

// Notification priority enum
export enum NotificationPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  CRITICAL = 'critical',
}

// Notification status enum
export enum NotificationStatus {
  PENDING = 'pending',
  QUEUED = 'queued',
  SENT = 'sent',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

// Notification entity
export interface Notification {
  id: string;
  userId?: string;
  shipmentId?: string;
  
  // Content
  type: NotificationType;
  channel: NotificationChannel;
  priority: NotificationPriority;
  title: string;
  message: string;
  data?: Record<string, any>;
  
  // Delivery tracking
  status: NotificationStatus;
  sentAt?: Date;
  deliveredAt?: Date;
  failedAt?: Date;
  failureReason?: string;
  retryCount: number;
  
  // Scheduling
  scheduledFor?: Date;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// Create notification DTO
export interface CreateNotificationDto {
  userId?: string;
  shipmentId?: string;
  type: NotificationType;
  channel: NotificationChannel;
  priority?: NotificationPriority;
  title: string;
  message: string;
  data?: Record<string, any>;
  scheduledFor?: Date;
}

// Notification preferences
export interface NotificationPreferences {
  id: string;
  userId: string;
  
  // Channel settings
  emailEnabled: boolean;
  emailAddress?: string;
  smsEnabled: boolean;
  smsPhone?: string;
  pushEnabled: boolean;
  webhookEnabled: boolean;
  webhookUrl?: string;
  
  // Quiet hours
  quietHoursStart?: string; // HH:mm format
  quietHoursEnd?: string;
  quietHoursTimezone: string;
  
  // Event type preferences
  notifyStatusChange: boolean;
  notifyDelays: boolean;
  notifyDeliveryAttempts: boolean;
  notifyExceptions: boolean;
  notifyGeofence: boolean;
  notifyEtaUpdates: boolean;
  
  // Rate limiting
  maxNotificationsPerHour: number;
  
  updatedAt: Date;
}

// Update notification preferences DTO
export interface UpdateNotificationPreferencesDto {
  emailEnabled?: boolean;
  emailAddress?: string;
  smsEnabled?: boolean;
  smsPhone?: string;
  pushEnabled?: boolean;
  webhookEnabled?: boolean;
  webhookUrl?: string;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  quietHoursTimezone?: string;
  notifyStatusChange?: boolean;
  notifyDelays?: boolean;
  notifyDeliveryAttempts?: boolean;
  notifyExceptions?: boolean;
  notifyGeofence?: boolean;
  notifyEtaUpdates?: boolean;
  maxNotificationsPerHour?: number;
}

// Delivery result
export interface DeliveryResult {
  success: boolean;
  messageId?: string;
  error?: string;
  timestamp: Date;
}

// Webhook payload
export interface WebhookPayload {
  event: string;
  timestamp: string;
  trackingNumber?: string;
  status?: ShipmentStatus;
  previousStatus?: ShipmentStatus;
  location?: {
    city?: string;
    state?: string;
    coordinates?: { lat: number; lng: number };
  };
  estimatedDelivery?: string;
  data?: Record<string, any>;
}

// Push notification payload
export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  requireInteraction?: boolean;
  actions?: Array<{ action: string; title: string }>;
  data?: Record<string, any>;
}

/**
 * Check if current time is within quiet hours
 */
export function isInQuietHours(
  preferences: NotificationPreferences,
  timezone: string = 'America/Chicago'
): boolean {
  if (!preferences.quietHoursStart || !preferences.quietHoursEnd) {
    return false;
  }
  
  const now = new Date();
  const currentTime = now.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    timeZone: preferences.quietHoursTimezone || timezone,
  });
  
  const start = preferences.quietHoursStart;
  const end = preferences.quietHoursEnd;
  
  // Handle overnight quiet hours (e.g., 22:00 - 07:00)
  if (start > end) {
    return currentTime >= start || currentTime <= end;
  }
  
  return currentTime >= start && currentTime <= end;
}

/**
 * Determine which channels to use for a notification type
 */
export function getChannelsForEventType(
  type: NotificationType,
  preferences: NotificationPreferences
): NotificationChannel[] {
  const channels: NotificationChannel[] = [];
  
  // Always include in-app
  channels.push(NotificationChannel.IN_APP);
  
  // Check event type preferences
  const shouldNotify = {
    [NotificationType.STATUS_CHANGE]: preferences.notifyStatusChange,
    [NotificationType.DELAY]: preferences.notifyDelays,
    [NotificationType.DELIVERY_ATTEMPT]: preferences.notifyDeliveryAttempts,
    [NotificationType.EXCEPTION]: preferences.notifyExceptions,
    [NotificationType.GEOFENCE_ENTER]: preferences.notifyGeofence,
    [NotificationType.GEOFENCE_EXIT]: preferences.notifyGeofence,
    [NotificationType.ETA_UPDATE]: preferences.notifyEtaUpdates,
    [NotificationType.DELIVERED]: true, // Always notify on delivery
  };
  
  if (!shouldNotify[type]) {
    return channels; // Only in-app
  }
  
  // Add enabled channels
  if (preferences.emailEnabled) {
    channels.push(NotificationChannel.EMAIL);
  }
  if (preferences.smsEnabled) {
    channels.push(NotificationChannel.SMS);
  }
  if (preferences.pushEnabled) {
    channels.push(NotificationChannel.PUSH);
  }
  if (preferences.webhookEnabled && preferences.webhookUrl) {
    channels.push(NotificationChannel.WEBHOOK);
  }
  
  return channels;
}

/**
 * Generate notification title based on type
 */
export function generateNotificationTitle(
  type: NotificationType,
  trackingNumber?: string
): string {
  const titles: Record<NotificationType, string> = {
    [NotificationType.STATUS_CHANGE]: `Shipment Status Update${trackingNumber ? `: ${trackingNumber}` : ''}`,
    [NotificationType.DELAY]: `Shipment Delayed${trackingNumber ? `: ${trackingNumber}` : ''}`,
    [NotificationType.DELIVERY_ATTEMPT]: `Delivery Attempt${trackingNumber ? `: ${trackingNumber}` : ''}`,
    [NotificationType.EXCEPTION]: `Shipment Exception${trackingNumber ? `: ${trackingNumber}` : ''}`,
    [NotificationType.GEOFENCE_ENTER]: `Shipment Entered Area${trackingNumber ? `: ${trackingNumber}` : ''}`,
    [NotificationType.GEOFENCE_EXIT]: `Shipment Left Area${trackingNumber ? `: ${trackingNumber}` : ''}`,
    [NotificationType.ETA_UPDATE]: `Delivery Time Updated${trackingNumber ? `: ${trackingNumber}` : ''}`,
    [NotificationType.DELIVERED]: `Shipment Delivered${trackingNumber ? `: ${trackingNumber}` : ''}`,
  };
  
  return titles[type] || 'Shipment Update';
}

/**
 * Get priority for notification type
 */
export function getPriorityForType(type: NotificationType): NotificationPriority {
  const priorities: Record<NotificationType, NotificationPriority> = {
    [NotificationType.STATUS_CHANGE]: NotificationPriority.NORMAL,
    [NotificationType.DELAY]: NotificationPriority.HIGH,
    [NotificationType.DELIVERY_ATTEMPT]: NotificationPriority.HIGH,
    [NotificationType.EXCEPTION]: NotificationPriority.CRITICAL,
    [NotificationType.GEOFENCE_ENTER]: NotificationPriority.LOW,
    [NotificationType.GEOFENCE_EXIT]: NotificationPriority.LOW,
    [NotificationType.ETA_UPDATE]: NotificationPriority.NORMAL,
    [NotificationType.DELIVERED]: NotificationPriority.HIGH,
  };
  
  return priorities[type] || NotificationPriority.NORMAL;
}

/**
 * Should schedule notification for later (respecting quiet hours)
 */
export function shouldScheduleNotification(
  preferences: NotificationPreferences
): { shouldSchedule: boolean; scheduledFor?: Date } {
  if (!isInQuietHours(preferences)) {
    return { shouldSchedule: false };
  }
  
  // Schedule for end of quiet hours
  const now = new Date();
  const tz = preferences.quietHoursTimezone || 'America/Chicago';
  
  // Parse quiet hours end time
  const [hours, minutes] = (preferences.quietHoursEnd || '07:00').split(':').map(Number);
  
  const scheduledFor = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  scheduledFor.setHours(hours, minutes, 0, 0);
  
  // If scheduled time has passed today, it will be tomorrow
  if (scheduledFor <= now) {
    scheduledFor.setDate(scheduledFor.getDate() + 1);
  }
  
  return { shouldSchedule: true, scheduledFor };
}
