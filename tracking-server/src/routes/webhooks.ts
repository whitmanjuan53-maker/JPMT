/**
 * Webhook Routes
 * Handles carrier webhook callbacks
 */

import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { trackingService } from '../services/TrackingService';
import { sseService } from '../services/SseService';
import { ShipmentStatus } from '../models/Shipment';

const router = Router();

/**
 * POST /webhooks/carriers/:carrier
 * Generic carrier webhook endpoint
 */
router.post('/carriers/:carrier', async (req: Request, res: Response) => {
  try {
    const { carrier } = req.params;
    const payload = req.body;

    logger.info('Carrier webhook received', {
      carrier,
      eventType: payload.eventType || payload.event,
    });

    // Verify webhook signature if configured
    // const signature = req.headers['x-webhook-signature'];
    // if (!verifyWebhookSignature(carrier, signature, req.body)) {
    //   return res.status(401).json({ error: 'Invalid signature' });
    // }

    // Process webhook based on carrier
    switch (carrier.toLowerCase()) {
      case 'dhl':
        await handleDhlWebhook(payload);
        break;
      case 'fedex':
        await handleFedexWebhook(payload);
        break;
      case 'ups':
        await handleUpsWebhook(payload);
        break;
      case 'usps':
        await handleUspsWebhook(payload);
        break;
      default:
        logger.warn('Unknown carrier webhook', { carrier });
        return res.status(400).json({ error: 'Unknown carrier' });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Webhook processing failed', { error: (error as Error).message });
    // Always return 200 to prevent retries (handle errors internally)
    res.json({ success: false, error: (error as Error).message });
  }
});

/**
 * Handle DHL webhook
 */
async function handleDhlWebhook(payload: any): Promise<void> {
  const trackingNumber = payload.trackingNumber || payload.shipment?.id;
  if (!trackingNumber) return;

  const shipment = await trackingService.getShipment(trackingNumber);
  if (!shipment) return;

  // Update status if changed
  if (payload.status) {
    const status = mapDhlStatus(payload.status);
    if (status !== shipment.status) {
      await trackingService.updateStatus(trackingNumber, status, {
        description: payload.description,
        location: payload.location,
      });
    }
  }
}

/**
 * Handle FedEx webhook
 */
async function handleFedexWebhook(payload: any): Promise<void> {
  const trackingNumber = payload.trackingNumber;
  if (!trackingNumber) return;

  const shipment = await trackingService.getShipment(trackingNumber);
  if (!shipment) return;

  const scanEvent = payload.scanEvent;
  if (scanEvent) {
    const status = mapFedexStatus(scanEvent.eventType);
    if (status !== shipment.status) {
      await trackingService.updateStatus(trackingNumber, status, {
        description: scanEvent.eventDescription,
        location: scanEvent.scanLocation,
        eventCode: scanEvent.eventType,
      });
    }
  }
}

/**
 * Handle UPS webhook
 */
async function handleUpsWebhook(payload: any): Promise<void> {
  const trackingNumber = payload.trackingNumber;
  if (!trackingNumber) return;

  const shipment = await trackingService.getShipment(trackingNumber);
  if (!shipment) return;

  const activity = payload.activity;
  if (activity) {
    const status = mapUpsStatus(activity.status?.code);
    if (status !== shipment.status) {
      await trackingService.updateStatus(trackingNumber, status, {
        description: activity.status?.description,
        location: activity.location,
        eventCode: activity.status?.code,
      });
    }
  }
}

/**
 * Handle USPS webhook
 */
async function handleUspsWebhook(payload: any): Promise<void> {
  const trackingNumber = payload.trackingNumber;
  if (!trackingNumber) return;

  const shipment = await trackingService.getShipment(trackingNumber);
  if (!shipment) return;

  const event = payload.event;
  if (event) {
    const status = mapUspsStatus(event.eventType);
    if (status !== shipment.status) {
      await trackingService.updateStatus(trackingNumber, status, {
        description: event.eventDescription,
        location: event.eventCity ? {
          city: event.eventCity,
          state: event.eventState,
        } : undefined,
        eventCode: event.eventType,
      });
    }
  }
}

/**
 * Status mapping functions
 */
function mapDhlStatus(status: string): ShipmentStatus {
  const map: Record<string, ShipmentStatus> = {
    'pre-transit': ShipmentStatus.CREATED,
    'transit': ShipmentStatus.IN_TRANSIT,
    'delivered': ShipmentStatus.DELIVERED,
    'failure': ShipmentStatus.EXCEPTION,
  };
  return map[status.toLowerCase()] || ShipmentStatus.IN_TRANSIT;
}

function mapFedexStatus(status: string): ShipmentStatus {
  const map: Record<string, ShipmentStatus> = {
    'OC': ShipmentStatus.CREATED,
    'PU': ShipmentStatus.PICKED_UP,
    'AR': ShipmentStatus.IN_TRANSIT,
    'DP': ShipmentStatus.IN_TRANSIT,
    'OD': ShipmentStatus.OUT_FOR_DELIVERY,
    'DL': ShipmentStatus.DELIVERED,
    'DE': ShipmentStatus.EXCEPTION,
  };
  return map[status] || ShipmentStatus.IN_TRANSIT;
}

function mapUpsStatus(status: string): ShipmentStatus {
  const map: Record<string, ShipmentStatus> = {
    'M': ShipmentStatus.CREATED,
    'P': ShipmentStatus.PICKED_UP,
    'I': ShipmentStatus.IN_TRANSIT,
    'O': ShipmentStatus.OUT_FOR_DELIVERY,
    'D': ShipmentStatus.DELIVERED,
    'X': ShipmentStatus.EXCEPTION,
  };
  return map[status] || ShipmentStatus.IN_TRANSIT;
}

function mapUspsStatus(status: string): ShipmentStatus {
  const map: Record<string, ShipmentStatus> = {
    'Pre-Shipment': ShipmentStatus.CREATED,
    'Accepted': ShipmentStatus.PICKED_UP,
    'In Transit': ShipmentStatus.IN_TRANSIT,
    'Out for Delivery': ShipmentStatus.OUT_FOR_DELIVERY,
    'Delivered': ShipmentStatus.DELIVERED,
    'Alert': ShipmentStatus.EXCEPTION,
  };
  return map[status] || ShipmentStatus.IN_TRANSIT;
}

export default router;
