# JPMT Tracking Server

Production-ready shipment tracking system with real-time updates and proactive notifications.

## Features

- **Real-Time Tracking**: GPS coordinates with live map visualization
- **Shipment Status Pipeline**: Created → Picked Up → In Transit → Out for Delivery → Delivered (with exception states)
- **ETA Calculation**: Dynamic delivery time prediction based on route, traffic, and historical data
- **Multi-Carrier Support**: DHL, FedEx, UPS, USPS, and custom JPMT fleet
- **Proactive Notifications**: Email, SMS, Push, Webhooks with smart delivery (quiet hours, rate limiting)
- **Real-Time Updates**: Server-Sent Events (SSE) with polling fallback

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│  API (Express)│────▶│ PostgreSQL  │
│  (SSE/Poll) │◀────│   (Node.js)  │◀────│  (Primary)  │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
                    ┌──────┴──────┐
                    │    Redis    │
                    │ (Cache/Queue)│
                    └─────────────┘
```

## Quick Start

### Using Docker Compose (Recommended)

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f api

# Stop services
docker-compose down
```

### Manual Setup

1. **Install dependencies**
```bash
npm install
```

2. **Set up environment variables**
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. **Set up database**
```bash
# Start PostgreSQL and Redis
# Then run migrations (if using TypeORM/Prisma)
npm run db:migrate
```

4. **Build and start**
```bash
npm run build
npm start
```

5. **Development mode**
```bash
npm run dev
```

## API Endpoints

### Tracking
- `GET /api/tracking/:trackingNumber` - Get shipment details
- `GET /api/tracking/:trackingNumber/stream` - SSE real-time updates
- `GET /api/tracking/:trackingNumber/eta` - Calculate ETA
- `POST /api/tracking` - Create shipment
- `PUT /api/tracking/:trackingNumber/status` - Update status

### Notifications
- `GET /api/notifications/preferences` - Get preferences
- `PUT /api/notifications/preferences` - Update preferences
- `POST /api/notifications/subscribe/:shipmentId` - Subscribe to shipment

### Webhooks
- `POST /webhooks/carriers/:carrier` - Carrier webhook callbacks

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `development` |
| `PORT` | API server port | `3001` |
| `DATABASE_URL` | PostgreSQL connection string | - |
| `REDIS_URL` | Redis connection string | - |
| `API_KEY_SECRET` | Secret for API key validation | - |
| `JWT_SECRET` | Secret for JWT signing | - |
| `DHL_API_KEY` | DHL API key | - |
| `FEDEX_API_KEY` | FedEx API key | - |
| `UPS_ACCESS_KEY` | UPS API key | - |
| `TWILIO_ACCOUNT_SID` | Twilio SID for SMS | - |
| `SMTP_HOST` | SMTP server for email | - |

## Design Patterns

### Observer Pattern
Used for event-driven notifications when shipment status changes.

```typescript
// Subject (Observable)
class ShipmentSubject {
  attach(observer: TrackingObserver): void
  detach(observer: TrackingObserver): void
  notify(event: TrackingEvent): void
}

// Observer
interface TrackingObserver {
  update(event: TrackingEvent): void
}
```

### Strategy Pattern
Used for flexible notification channels.

```typescript
interface NotificationStrategy {
  send(notification: Notification): Promise<DeliveryResult>
  supports(channel: Channel): boolean
}

// Implementations: EmailStrategy, SmsStrategy, PushStrategy, WebhookStrategy
```

### Circuit Breaker
Prevents cascading failures when external APIs are down.

```typescript
const result = await circuitBreaker.execute(() => 
  carrierApi.track(trackingNumber)
)
```

## Testing

```bash
# Run tests
npm test

# Run with coverage
npm run test:coverage

# Run linting
npm run lint
```

## Monitoring

- **Health Check**: `GET /health`
- **Metrics**: `GET /metrics` (Prometheus format)
- **Logs**: Winston structured logging

## License

UNLICENSED - JPMT Logistics Internal Use Only
