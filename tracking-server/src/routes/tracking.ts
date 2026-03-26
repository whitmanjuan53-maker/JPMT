/**
 * Tracking API Routes
 * REST endpoints for shipment tracking
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { trackingService } from '../services/TrackingService';
import { etaCalculationService } from '../services/EtaCalculationService';
import { sseService } from '../services/SseService';
import { carrierFactory } from '../carriers/CarrierFactory';
import { logger } from '../utils/logger';
import { ShipmentStatus, CarrierType, CreateShipmentDto } from '../models/Shipment';
import { calculateETA } from '../utils/geospatial';

const router = Router();

// Validation schemas
const createShipmentSchema = z.object({
  trackingNumber: z.string().min(3),
  carrierType: z.nativeEnum(CarrierType),
  origin: z.object({
    address: z.string(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    country: z.string().default('US'),
    coordinates: z.object({
      latitude: z.number(),
      longitude: z.number(),
    }).optional(),
  }),
  destination: z.object({
    address: z.string(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    country: z.string().default('US'),
    coordinates: z.object({
      latitude: z.number(),
      longitude: z.number(),
    }).optional(),
  }),
  packageDetails: z.object({
    weight: z.number(),
    length: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  }).optional(),
  serviceType: z.string().optional(),
  referenceNumber: z.string().optional(),
  description: z.string().optional(),
  estimatedDelivery: z.string().datetime().optional(),
});

const updateStatusSchema = z.object({
  status: z.nativeEnum(ShipmentStatus),
  description: z.string().optional(),
  location: z.object({
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
  }).optional(),
  eventCode: z.string().optional(),
});

const updateLocationSchema = z.object({
  coordinates: z.object({
    latitude: z.number(),
    longitude: z.number(),
  }),
  address: z.string().optional(),
});

/**
 * GET /api/tracking/:trackingNumber
 * Get shipment details with events
 */
router.get('/:trackingNumber', async (req: Request, res: Response) => {
  try {
    const { trackingNumber } = req.params;
    
    const shipment = await trackingService.getShipmentWithEvents(trackingNumber);
    
    if (!shipment) {
      return res.status(404).json({
        error: 'Shipment not found',
        trackingNumber,
      });
    }

    // Calculate ETA if shipment is active
    let eta = null;
    if (shipment.status !== ShipmentStatus.DELIVERED && 
        shipment.status !== ShipmentStatus.CANCELLED &&
        shipment.currentLocation?.coordinates) {
      try {
        eta = await etaCalculationService.getShipmentETA(shipment);
      } catch (error) {
        logger.warn('ETA calculation failed', { trackingNumber, error: (error as Error).message });
      }
    }

    res.json({
      success: true,
      data: {
        ...shipment,
        eta,
      },
    });
  } catch (error) {
    logger.error('Get shipment failed', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to retrieve shipment',
      message: (error as Error).message,
    });
  }
});

/**
 * GET /api/tracking/:trackingNumber/stream
 * SSE endpoint for real-time updates
 */
router.get('/:trackingNumber/stream', async (req: Request, res: Response) => {
  try {
    const { trackingNumber } = req.params;
    const lastEventId = req.headers['last-event-id'] as string | undefined;

    // Verify shipment exists
    const shipment = await trackingService.getShipment(trackingNumber);
    if (!shipment) {
      return res.status(404).json({
        error: 'Shipment not found',
        trackingNumber,
      });
    }

    // Subscribe client to SSE
    const clientId = sseService.subscribe(trackingNumber, res, lastEventId);

    logger.debug('SSE connection established', { clientId, trackingNumber });
  } catch (error) {
    logger.error('SSE subscription failed', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to establish SSE connection',
    });
  }
});

/**
 * GET /api/tracking/:trackingNumber/eta
 * Get ETA calculation for shipment
 */
router.get('/:trackingNumber/eta', async (req: Request, res: Response) => {
  try {
    const { trackingNumber } = req.params;
    
    const shipment = await trackingService.getShipment(trackingNumber);
    
    if (!shipment) {
      return res.status(404).json({
        error: 'Shipment not found',
        trackingNumber,
      });
    }

    if (!shipment.currentLocation?.coordinates || !shipment.destination.coordinates) {
      return res.status(400).json({
        error: 'Insufficient location data for ETA calculation',
      });
    }

    const eta = await etaCalculationService.calculateETA({
      origin: shipment.origin.coordinates!,
      destination: shipment.destination.coordinates!,
      currentLocation: shipment.currentLocation.coordinates,
      carrierType: shipment.carrierType,
      serviceType: shipment.serviceType,
    });

    res.json({
      success: true,
      data: eta,
    });
  } catch (error) {
    logger.error('ETA calculation failed', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to calculate ETA',
      message: (error as Error).message,
    });
  }
});

/**
 * GET /api/tracking/:trackingNumber/route
 * Get route progress for map visualization
 */
router.get('/:trackingNumber/route', async (req: Request, res: Response) => {
  try {
    const { trackingNumber } = req.params;
    
    const shipment = await trackingService.getShipment(trackingNumber);
    
    if (!shipment) {
      return res.status(404).json({
        error: 'Shipment not found',
        trackingNumber,
      });
    }

    if (!shipment.currentLocation?.coordinates || 
        !shipment.origin.coordinates || 
        !shipment.destination.coordinates) {
      return res.status(400).json({
        error: 'Insufficient location data for route',
      });
    }

    const progress = etaCalculationService.generateRouteProgress(
      shipment.origin.coordinates,
      shipment.destination.coordinates,
      shipment.currentLocation.coordinates
    );

    res.json({
      success: true,
      data: {
        origin: shipment.origin,
        destination: shipment.destination,
        currentLocation: shipment.currentLocation,
        progress,
      },
    });
  } catch (error) {
    logger.error('Route calculation failed', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to calculate route',
      message: (error as Error).message,
    });
  }
});

/**
 * POST /api/tracking
 * Create a new shipment
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const validation = createShipmentSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors,
      });
    }

    const dto: CreateShipmentDto = {
      ...validation.data,
      estimatedDelivery: validation.data.estimatedDelivery 
        ? new Date(validation.data.estimatedDelivery)
        : undefined,
    };

    const shipment = await trackingService.createShipment(dto);

    res.status(201).json({
      success: true,
      data: shipment,
    });
  } catch (error) {
    logger.error('Create shipment failed', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to create shipment',
      message: (error as Error).message,
    });
  }
});

/**
 * PUT /api/tracking/:trackingNumber/status
 * Update shipment status
 */
router.put('/:trackingNumber/status', async (req: Request, res: Response) => {
  try {
    const { trackingNumber } = req.params;
    
    const validation = updateStatusSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors,
      });
    }

    const { status, description, location, eventCode } = validation.data;

    const shipment = await trackingService.updateStatus(
      trackingNumber,
      status,
      { description, location, eventCode }
    );

    // Broadcast status change via SSE
    sseService.broadcastStatusChange(trackingNumber, shipment, shipment.previousStatus || '');

    res.json({
      success: true,
      data: shipment,
    });
  } catch (error) {
    logger.error('Update status failed', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to update status',
      message: (error as Error).message,
    });
  }
});

/**
 * PUT /api/tracking/:trackingNumber/location
 * Update current location
 */
router.put('/:trackingNumber/location', async (req: Request, res: Response) => {
  try {
    const { trackingNumber } = req.params;
    
    const validation = updateLocationSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors,
      });
    }

    const shipment = await trackingService.updateLocation(
      trackingNumber,
      validation.data
    );

    // Broadcast location update via SSE
    sseService.broadcastLocationUpdate(trackingNumber, {
      coordinates: validation.data.coordinates,
      address: validation.data.address,
    });

    res.json({
      success: true,
      data: shipment,
    });
  } catch (error) {
    logger.error('Update location failed', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to update location',
      message: (error as Error).message,
    });
  }
});

/**
 * GET /api/tracking/carriers/detect/:trackingNumber
 * Detect carrier from tracking number
 */
router.get('/carriers/detect/:trackingNumber', (req: Request, res: Response) => {
  try {
    const { trackingNumber } = req.params;
    const carrier = carrierFactory.detectCarrier(trackingNumber);

    if (!carrier) {
      return res.status(404).json({
        error: 'Carrier could not be detected',
        trackingNumber,
      });
    }

    const adapter = carrierFactory.getAdapter(carrier);

    res.json({
      success: true,
      data: {
        carrier,
        carrierName: adapter?.name,
      },
    });
  } catch (error) {
    logger.error('Carrier detection failed', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to detect carrier',
    });
  }
});

/**
 * POST /api/tracking/carriers/track
 * Track shipment via external carrier API
 */
router.post('/carriers/track', async (req: Request, res: Response) => {
  try {
    const { trackingNumber, carrier } = req.body;

    if (!trackingNumber) {
      return res.status(400).json({
        error: 'Tracking number is required',
      });
    }

    let adapter = carrier 
      ? carrierFactory.getAdapter(carrier as CarrierType)
      : carrierFactory.getAdapterByTrackingNumber(trackingNumber);

    if (!adapter) {
      return res.status(404).json({
        error: 'Could not detect carrier for tracking number',
        trackingNumber,
      });
    }

    const trackingInfo = await adapter.track(trackingNumber);

    res.json({
      success: true,
      data: trackingInfo,
    });
  } catch (error) {
    logger.error('Carrier tracking failed', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to track shipment',
      message: (error as Error).message,
    });
  }
});

export default router;
