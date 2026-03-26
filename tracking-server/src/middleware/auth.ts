/**
 * Authentication Middleware
 * API key and JWT authentication
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      apiKey?: string;
      isAdmin?: boolean;
    }
  }
}

const API_KEY_SECRET = process.env.API_KEY_SECRET || 'dev-secret';

/**
 * Middleware to validate API key
 */
export function validateApiKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey) {
    return res.status(401).json({
      error: 'API key is required',
    });
  }

  // Simple validation - in production, validate against database
  if (!isValidApiKey(apiKey)) {
    logger.warn('Invalid API key used', {
      ip: req.ip,
      apiKey: apiKey.substring(0, 8) + '...',
    });
    return res.status(401).json({
      error: 'Invalid API key',
    });
  }

  req.apiKey = apiKey;
  req.userId = getUserIdFromApiKey(apiKey);
  
  next();
}

/**
 * Middleware for optional authentication
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] as string;
  
  if (apiKey && isValidApiKey(apiKey)) {
    req.apiKey = apiKey;
    req.userId = getUserIdFromApiKey(apiKey);
  }
  
  next();
}

/**
 * Middleware to check admin role
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.apiKey) {
    return res.status(401).json({
      error: 'Authentication required',
    });
  }

  if (!isAdminKey(req.apiKey)) {
    return res.status(403).json({
      error: 'Admin access required',
    });
  }

  req.isAdmin = true;
  next();
}

/**
 * Validate webhook signature
 */
export function validateWebhookSignature(
  secret: string,
  signatureHeader: string = 'x-webhook-signature'
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const signature = req.headers[signatureHeader] as string;
    
    if (!signature) {
      return res.status(401).json({
        error: 'Webhook signature is required',
      });
    }

    // In production, implement HMAC signature verification
    // const expectedSignature = crypto
    //   .createHmac('sha256', secret)
    //   .update(JSON.stringify(req.body))
    //   .digest('hex');
    
    // if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    //   return res.status(401).json({ error: 'Invalid signature' });
    // }

    // For demo, accept all signatures
    next();
  };
}

/**
 * Check if API key is valid
 */
function isValidApiKey(apiKey: string): boolean {
  // In production, check against database
  // For demo, accept keys starting with 'jpmt_' or use demo key
  return apiKey.startsWith('jpmt_') || apiKey === 'demo-api-key';
}

/**
 * Get user ID from API key
 */
function getUserIdFromApiKey(apiKey: string): string {
  // In production, lookup in database
  if (apiKey === 'demo-api-key') {
    return 'demo-user';
  }
  // Extract from key format: jpmt_userId_random
  const parts = apiKey.split('_');
  return parts[1] || 'unknown';
}

/**
 * Check if API key has admin privileges
 */
function isAdminKey(apiKey: string): boolean {
  return apiKey.includes('admin') || apiKey === 'demo-api-key';
}

export default {
  validateApiKey,
  optionalAuth,
  requireAdmin,
  validateWebhookSignature,
};
