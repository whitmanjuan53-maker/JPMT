-- ============================================
-- JPMT Tracking Database Schema
-- Production-ready shipment tracking system
-- ============================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For fuzzy text search

-- ============================================
-- ENUM TYPES
-- ============================================

CREATE TYPE shipment_status AS ENUM (
  'created',
  'picked_up',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'delayed',
  'exception',
  'returned',
  'cancelled'
);

CREATE TYPE notification_channel AS ENUM (
  'email',
  'sms',
  'push',
  'webhook',
  'in_app'
);

CREATE TYPE notification_type AS ENUM (
  'status_change',
  'delay',
  'delivery_attempt',
  'exception',
  'geofence_enter',
  'geofence_exit',
  'eta_update',
  'delivered'
);

CREATE TYPE notification_priority AS ENUM (
  'low',
  'normal',
  'high',
  'critical'
);

CREATE TYPE carrier_type AS ENUM (
  'dhl',
  'fedex',
  'ups',
  'usps',
  'jpmt_fleet',
  'custom'
);

-- ============================================
-- CORE TABLES
-- ============================================

-- Users table (for notification preferences)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20),
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  push_subscription JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Carriers table
CREATE TABLE carriers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  type carrier_type NOT NULL,
  api_config JSONB DEFAULT '{}',
  webhook_secret VARCHAR(255),
  webhook_url VARCHAR(500),
  active BOOLEAN DEFAULT true,
  rate_limit_requests INTEGER DEFAULT 100,
  rate_limit_window INTEGER DEFAULT 60, -- seconds
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shipments table
CREATE TABLE shipments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tracking_number VARCHAR(100) UNIQUE NOT NULL,
  carrier_id UUID REFERENCES carriers(id),
  carrier_tracking_number VARCHAR(100),
  
  -- Status
  status shipment_status DEFAULT 'created',
  previous_status shipment_status,
  status_updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Addresses
  origin_address TEXT NOT NULL,
  origin_city VARCHAR(100),
  origin_state VARCHAR(50),
  origin_zip VARCHAR(20),
  origin_country VARCHAR(2) DEFAULT 'US',
  origin_coords GEOGRAPHY(POINT, 4326),
  
  destination_address TEXT NOT NULL,
  destination_city VARCHAR(100),
  destination_state VARCHAR(50),
  destination_zip VARCHAR(20),
  destination_country VARCHAR(2) DEFAULT 'US',
  destination_coords GEOGRAPHY(POINT, 4326),
  
  -- Current location
  current_coords GEOGRAPHY(POINT, 4326),
  current_location_address TEXT,
  current_location_updated_at TIMESTAMPTZ,
  
  -- ETA and delivery
  estimated_delivery TIMESTAMPTZ,
  estimated_delivery_updated_at TIMESTAMPTZ,
  actual_delivery TIMESTAMPTZ,
  
  -- Package details
  weight_lbs DECIMAL(10, 2),
  dimensions_length_in DECIMAL(8, 2),
  dimensions_width_in DECIMAL(8, 2),
  dimensions_height_in DECIMAL(8, 2),
  service_type VARCHAR(50),
  
  -- Metadata
  reference_number VARCHAR(100),
  description TEXT,
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tracking events table
CREATE TABLE tracking_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  
  -- Event details
  status shipment_status NOT NULL,
  previous_status shipment_status,
  description TEXT,
  
  -- Location
  location_address TEXT,
  location_city VARCHAR(100),
  location_state VARCHAR(50),
  location_zip VARCHAR(20),
  location_coords GEOGRAPHY(POINT, 4326),
  
  -- Event metadata
  event_code VARCHAR(50),
  event_data JSONB DEFAULT '{}',
  
  -- Timestamps
  event_timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- For ordering and deduplication
  sequence_number INTEGER GENERATED ALWAYS AS IDENTITY
);

-- Geofences table
CREATE TABLE geofences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  name VARCHAR(100),
  center_coords GEOGRAPHY(POINT, 4326) NOT NULL,
  radius_meters INTEGER NOT NULL DEFAULT 1000,
  trigger_events TEXT[] DEFAULT ARRAY['enter', 'exit'],
  active BOOLEAN DEFAULT true,
  triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notifications table
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  shipment_id UUID REFERENCES shipments(id),
  
  -- Notification details
  type notification_type NOT NULL,
  channel notification_channel NOT NULL,
  priority notification_priority DEFAULT 'normal',
  
  -- Content
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  
  -- Delivery tracking
  status VARCHAR(50) DEFAULT 'pending', -- pending, sent, delivered, failed
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_reason TEXT,
  retry_count INTEGER DEFAULT 0,
  
  -- Timestamps
  scheduled_for TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Notification preferences table
CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Channel preferences
  email_enabled BOOLEAN DEFAULT true,
  email_address VARCHAR(255),
  
  sms_enabled BOOLEAN DEFAULT false,
  sms_phone VARCHAR(20),
  
  push_enabled BOOLEAN DEFAULT true,
  
  webhook_enabled BOOLEAN DEFAULT false,
  webhook_url VARCHAR(500),
  
  -- Quiet hours (24h format)
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  quiet_hours_timezone VARCHAR(50) DEFAULT 'America/Chicago',
  
  -- Event type preferences
  notify_status_change BOOLEAN DEFAULT true,
  notify_delays BOOLEAN DEFAULT true,
  notify_delivery_attempts BOOLEAN DEFAULT true,
  notify_exceptions BOOLEAN DEFAULT true,
  notify_geofence BOOLEAN DEFAULT false,
  notify_eta_updates BOOLEAN DEFAULT false,
  
  -- Rate limiting
  max_notifications_per_hour INTEGER DEFAULT 10,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id)
);

-- Shipment subscriptions (users tracking shipments)
CREATE TABLE shipment_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, shipment_id)
);

-- ============================================
-- INDEXES
-- ============================================

-- Shipment indexes
CREATE INDEX idx_shipments_tracking_number ON shipments(tracking_number);
CREATE INDEX idx_shipments_status ON shipments(status);
CREATE INDEX idx_shipments_carrier ON shipments(carrier_id);
CREATE INDEX idx_shipments_created_at ON shipments(created_at);
CREATE INDEX idx_shipments_estimated_delivery ON shipments(estimated_delivery);
CREATE INDEX idx_shipments_user_search ON shipments USING gin(
  to_tsvector('english', 
    coalesce(tracking_number, '') || ' ' ||
    coalesce(reference_number, '') || ' ' ||
    coalesce(destination_city, '')
  )
);

-- Geospatial indexes
CREATE INDEX idx_shipments_origin_coords ON shipments USING gist(origin_coords);
CREATE INDEX idx_shipments_destination_coords ON shipments USING gist(destination_coords);
CREATE INDEX idx_shipments_current_coords ON shipments USING gist(current_coords);
CREATE INDEX idx_tracking_events_coords ON tracking_events USING gist(location_coords);
CREATE INDEX idx_geofences_center ON geofences USING gist(center_coords);

-- Event indexes
CREATE INDEX idx_tracking_events_shipment ON tracking_events(shipment_id);
CREATE INDEX idx_tracking_events_timestamp ON tracking_events(event_timestamp);
CREATE INDEX idx_tracking_events_status ON tracking_events(status);

-- Notification indexes
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_shipment ON notifications(shipment_id);
CREATE INDEX idx_notifications_status ON notifications(status);
CREATE INDEX idx_notifications_scheduled ON notifications(scheduled_for) WHERE status = 'pending';

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Update timestamp function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply update timestamp trigger to all tables
CREATE TRIGGER update_shipments_updated_at BEFORE UPDATE ON shipments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_carriers_updated_at BEFORE UPDATE ON carriers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_notifications_updated_at BEFORE UPDATE ON notifications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_notification_prefs_updated_at BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate distance between two points
CREATE OR REPLACE FUNCTION calculate_distance(
  lat1 DECIMAL,
  lon1 DECIMAL,
  lat2 DECIMAL,
  lon2 DECIMAL
)
RETURNS DECIMAL AS $$
BEGIN
  RETURN ST_DistanceSphere(
    ST_MakePoint(lon1, lat1)::geometry,
    ST_MakePoint(lon2, lat2)::geometry
  ) / 1609.344; -- Convert to miles
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- SEED DATA
-- ============================================

-- Insert default carriers
INSERT INTO carriers (name, type, active) VALUES
  ('DHL Express', 'dhl', true),
  ('FedEx', 'fedex', true),
  ('UPS', 'ups', true),
  ('USPS', 'usps', true),
  ('JPMT Fleet', 'jpmt_fleet', true);

-- ============================================
-- VIEWS
-- ============================================

-- Active shipments view
CREATE VIEW active_shipments AS
SELECT s.*, c.name as carrier_name, c.type as carrier_type
FROM shipments s
JOIN carriers c ON s.carrier_id = c.id
WHERE s.status NOT IN ('delivered', 'cancelled', 'returned');

-- Shipment timeline view
CREATE VIEW shipment_timeline AS
SELECT 
  s.tracking_number,
  s.status as current_status,
  te.status as event_status,
  te.description as event_description,
  te.location_city,
  te.location_state,
  te.event_timestamp,
  te.sequence_number
FROM shipments s
JOIN tracking_events te ON s.id = te.shipment_id
ORDER BY s.tracking_number, te.sequence_number;

-- Notification summary view
CREATE VIEW notification_summary AS
SELECT 
  n.user_id,
  n.shipment_id,
  s.tracking_number,
  COUNT(*) FILTER (WHERE n.status = 'pending') as pending_count,
  COUNT(*) FILTER (WHERE n.status = 'sent') as sent_count,
  COUNT(*) FILTER (WHERE n.status = 'failed') as failed_count,
  MAX(n.created_at) as last_notification_at
FROM notifications n
LEFT JOIN shipments s ON n.shipment_id = s.id
GROUP BY n.user_id, n.shipment_id, s.tracking_number;
