/**
 * Notification Queue Service
 * Manages async notification processing using Bull and Redis
 */

import Queue from 'bull';
import { logger } from '../utils/logger';
import { redis } from '../config/redis';
import { notificationQueueSize, notificationDelivered } from '../utils/metrics';
import {
  Notification,
  CreateNotificationDto,
  NotificationChannel,
  NotificationStatus,
  NotificationPriority,
  DeliveryResult,
} from '../models/Notification';

// Queue configuration
const queueConfig = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 2000, // Start with 2s, then 4s, 8s, 16s, 32s
    },
    removeOnComplete: 100, // Keep last 100 completed jobs
    removeOnFail: 50, // Keep last 50 failed jobs
  },
};

// Job types
interface NotificationJob {
  notification: CreateNotificationDto;
  trackingNumber?: string;
}

interface BatchNotificationJob {
  notifications: CreateNotificationDto[];
  batchId: string;
}

export class NotificationQueue {
  private queue: Queue.Queue<NotificationJob>;
  private isProcessing = false;

  constructor() {
    this.queue = new Queue<NotificationJob>('notifications', queueConfig);
    this.setupEventHandlers();
  }

  /**
   * Set up queue event handlers
   */
  private setupEventHandlers(): void {
    // Job completed
    this.queue.on('completed', (job, result) => {
      logger.debug('Notification job completed', {
        jobId: job.id,
        channel: job.data.notification.channel,
        result,
      });
      
      notificationDelivered.inc({
        channel: job.data.notification.channel,
        status: 'success',
      });
    });

    // Job failed
    this.queue.on('failed', (job, error) => {
      logger.error('Notification job failed', {
        jobId: job.id,
        channel: job.data.notification.channel,
        attempts: job.attemptsMade,
        error: error.message,
      });
      
      notificationDelivered.inc({
        channel: job.data.notification.channel,
        status: 'failed',
      });
    });

    // Job progress
    this.queue.on('progress', (job, progress) => {
      logger.debug('Notification job progress', {
        jobId: job.id,
        progress,
      });
    });

    // Stalled job
    this.queue.on('stalled', (job) => {
      logger.warn('Notification job stalled', {
        jobId: job.id,
        channel: job.data.notification.channel,
      });
    });
  }

  /**
   * Add a notification to the queue
   */
  async add(
    notification: CreateNotificationDto,
    options: {
      delay?: number;
      priority?: number;
      jobId?: string;
    } = {}
  ): Promise<Queue.Job<NotificationJob>> {
    const job = await this.queue.add(
      { notification },
      {
        ...queueConfig.defaultJobOptions,
        delay: options.delay,
        priority: options.priority,
        jobId: options.jobId,
      }
    );

    logger.debug('Notification added to queue', {
      jobId: job.id,
      channel: notification.channel,
      type: notification.type,
      scheduledFor: options.delay ? new Date(Date.now() + options.delay).toISOString() : 'immediate',
    });

    await this.updateQueueSize();

    return job;
  }

  /**
   * Add multiple notifications as a batch
   */
  async addBatch(
    notifications: CreateNotificationDto[],
    options: { delay?: number } = {}
  ): Promise<Queue.Job[]> {
    const jobs: Queue.Job[] = [];

    for (const notification of notifications) {
      const job = await this.add(notification, options);
      jobs.push(job);
    }

    logger.info('Batch notifications added', {
      count: notifications.length,
      scheduledFor: options.delay ? new Date(Date.now() + options.delay).toISOString() : 'immediate',
    });

    return jobs;
  }

  /**
   * Schedule a notification for later delivery
   */
  async schedule(
    notification: CreateNotificationDto,
    scheduledFor: Date
  ): Promise<Queue.Job<NotificationJob>> {
    const now = new Date();
    const delay = Math.max(0, scheduledFor.getTime() - now.getTime());

    return this.add(notification, { delay });
  }

  /**
   * Get queue size
   */
  async getQueueSize(): Promise<number> {
    const [waiting, active, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getDelayedCount(),
    ]);

    return waiting + active + delayed;
  }

  /**
   * Update metrics with current queue size
   */
  private async updateQueueSize(): Promise<void> {
    const size = await this.getQueueSize();
    notificationQueueSize.set(size);
  }

  /**
   * Process jobs with a handler
   */
  process(
    concurrency: number,
    handler: (job: Queue.Job<NotificationJob>) => Promise<DeliveryResult>
  ): void {
    this.queue.process(concurrency, async (job) => {
      return await handler(job);
    });
    
    this.isProcessing = true;
    logger.info('Notification queue processor started', { concurrency });
  }

  /**
   * Pause queue processing
   */
  async pause(): Promise<void> {
    await this.queue.pause();
    this.isProcessing = false;
    logger.info('Notification queue paused');
  }

  /**
   * Resume queue processing
   */
  async resume(): Promise<void> {
    await this.queue.resume();
    this.isProcessing = true;
    logger.info('Notification queue resumed');
  }

  /**
   * Clean up old jobs
   */
  async cleanOldJobs(
    gracePeriod: number = 24 * 3600 * 1000 // 24 hours
  ): Promise<void> {
    await this.queue.clean(gracePeriod, 'completed');
    await this.queue.clean(gracePeriod, 'failed');
    logger.info('Old jobs cleaned from queue');
  }

  /**
   * Get job by ID
   */
  async getJob(jobId: string): Promise<Queue.Job<NotificationJob> | null> {
    return await this.queue.getJob(jobId);
  }

  /**
   * Remove job from queue
   */
  async removeJob(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (job) {
      await job.remove();
      logger.debug('Job removed from queue', { jobId });
    }
  }

  /**
   * Retry failed job
   */
  async retryJob(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (job) {
      await job.retry();
      logger.debug('Job retry initiated', { jobId });
    }
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: boolean;
  }> {
    const [waiting, active, completed, failed, delayed, isPaused] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
      this.queue.isPaused(),
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      paused: isPaused,
    };
  }

  /**
   * Empty the queue (use with caution)
   */
  async empty(): Promise<void> {
    await this.queue.empty();
    logger.warn('Notification queue emptied');
  }

  /**
   * Close queue connection
   */
  async close(): Promise<void> {
    await this.queue.close();
    logger.info('Notification queue closed');
  }

  /**
   * Check if queue is processing
   */
  isQueueProcessing(): boolean {
    return this.isProcessing;
  }
}

// Singleton instance
export const notificationQueue = new NotificationQueue();
export default notificationQueue;
