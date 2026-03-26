import winston from 'winston';

const { combine, timestamp, json, errors, printf, colorize } = winston.format;

// Determine log level from environment
const logLevel = process.env.LOG_LEVEL || 'info';
const isDevelopment = process.env.NODE_ENV === 'development';

// Custom format for development
const devFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${message}`;
  if (Object.keys(metadata).length > 0) {
    msg += ` ${JSON.stringify(metadata)}`;
  }
  return msg;
});

// Create Winston logger
export const logger = winston.createLogger({
  level: logLevel,
  defaultMeta: {
    service: 'jpmt-tracking-server',
    environment: process.env.NODE_ENV || 'development',
  },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: isDevelopment
        ? combine(
            colorize(),
            timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            devFormat
          )
        : combine(
            timestamp(),
            json(),
            errors({ stack: true })
          ),
    }),
  ],
  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.Console({
      format: combine(timestamp(), json()),
    }),
  ],
  // Handle unhandled promise rejections
  rejectionHandlers: [
    new winston.transports.Console({
      format: combine(timestamp(), json()),
    }),
  ],
});

// Add file transport in production
if (process.env.NODE_ENV === 'production') {
  logger.add(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: combine(timestamp(), json()),
    })
  );
  logger.add(
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: combine(timestamp(), json()),
    })
  );
}

// Request logger middleware
export function requestLogger() {
  return (req: any, res: any, next: any) => {
    const start = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info('HTTP Request', {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
    });
    
    next();
  };
}

export default logger;
