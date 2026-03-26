/**
 * Circuit Breaker Pattern Implementation
 * Prevents cascading failures when external services are down
 */

import { redis, cacheKeys } from '../config/redis';
import { logger } from './logger';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeout: number;
  halfOpenMaxCalls: number;
}

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number;
  nextAttemptTime: number;
}

const defaultOptions: CircuitBreakerOptions = {
  failureThreshold: 5,
  resetTimeout: 60000, // 1 minute
  halfOpenMaxCalls: 3,
};

export class CircuitBreaker {
  private serviceName: string;
  private options: CircuitBreakerOptions;

  constructor(serviceName: string, options: Partial<CircuitBreakerOptions> = {}) {
    this.serviceName = serviceName;
    this.options = { ...defaultOptions, ...options };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = await this.getState();

    if (state.state === 'OPEN') {
      if (Date.now() < state.nextAttemptTime) {
        throw new CircuitBreakerError(
          `Circuit breaker is OPEN for service: ${this.serviceName}`,
          this.serviceName,
          state.state
        );
      }
      // Transition to HALF_OPEN
      await this.transitionTo('HALF_OPEN');
    }

    if (state.state === 'HALF_OPEN' && state.successes >= this.options.halfOpenMaxCalls) {
      throw new CircuitBreakerError(
        `Circuit breaker HALF_OPEN limit reached for service: ${this.serviceName}`,
        this.serviceName,
        state.state
      );
    }

    try {
      const result = await fn();
      await this.onSuccess();
      return result;
    } catch (error) {
      await this.onFailure();
      throw error;
    }
  }

  /**
   * Get current circuit state from Redis
   */
  private async getState(): Promise<CircuitBreakerState> {
    const key = cacheKeys.circuitBreaker(this.serviceName);
    const data = await redis.get(key);
    
    if (data) {
      return JSON.parse(data);
    }

    return {
      state: 'CLOSED',
      failures: 0,
      successes: 0,
      lastFailureTime: 0,
      nextAttemptTime: 0,
    };
  }

  /**
   * Save circuit state to Redis
   */
  private async saveState(state: CircuitBreakerState): Promise<void> {
    const key = cacheKeys.circuitBreaker(this.serviceName);
    await redis.setex(key, 3600, JSON.stringify(state)); // 1 hour TTL
  }

  /**
   * Handle successful call
   */
  private async onSuccess(): Promise<void> {
    const state = await this.getState();

    if (state.state === 'HALF_OPEN') {
      state.successes++;
      
      if (state.successes >= this.options.halfOpenMaxCalls) {
        await this.transitionTo('CLOSED');
        logger.info(`Circuit breaker CLOSED for service: ${this.serviceName}`);
      } else {
        await this.saveState(state);
      }
    }
  }

  /**
   * Handle failed call
   */
  private async onFailure(): Promise<void> {
    const state = await this.getState();
    
    state.failures++;
    state.lastFailureTime = Date.now();

    if (state.state === 'HALF_OPEN' || state.failures >= this.options.failureThreshold) {
      await this.transitionTo('OPEN');
      logger.warn(`Circuit breaker OPENED for service: ${this.serviceName}`, {
        failures: state.failures,
        lastFailure: new Date(state.lastFailureTime).toISOString(),
      });
    } else {
      await this.saveState(state);
    }
  }

  /**
   * Transition to a new state
   */
  private async transitionTo(newState: CircuitState): Promise<void> {
    const state: CircuitBreakerState = {
      state: newState,
      failures: 0,
      successes: 0,
      lastFailureTime: 0,
      nextAttemptTime: 0,
    };

    if (newState === 'OPEN') {
      state.nextAttemptTime = Date.now() + this.options.resetTimeout;
    }

    await this.saveState(state);
  }

  /**
   * Get current state (for monitoring)
   */
  async getCurrentState(): Promise<{ state: CircuitState; healthy: boolean }> {
    const state = await this.getState();
    return {
      state: state.state,
      healthy: state.state === 'CLOSED',
    };
  }

  /**
   * Force reset the circuit (for manual recovery)
   */
  async reset(): Promise<void> {
    await this.transitionTo('CLOSED');
    logger.info(`Circuit breaker manually reset for service: ${this.serviceName}`);
  }
}

/**
 * Circuit breaker error
 */
export class CircuitBreakerError extends Error {
  public serviceName: string;
  public circuitState: CircuitState;

  constructor(message: string, serviceName: string, state: CircuitState) {
    super(message);
    this.name = 'CircuitBreakerError';
    this.serviceName = serviceName;
    this.circuitState = state;
  }
}

/**
 * Circuit breaker registry for managing multiple breakers
 */
export class CircuitBreakerRegistry {
  private breakers: Map<string, CircuitBreaker> = new Map();

  get(serviceName: string, options?: Partial<CircuitBreakerOptions>): CircuitBreaker {
    if (!this.breakers.has(serviceName)) {
      this.breakers.set(serviceName, new CircuitBreaker(serviceName, options));
    }
    return this.breakers.get(serviceName)!;
  }

  async getAllStates(): Promise<Record<string, { state: CircuitState; healthy: boolean }>> {
    const states: Record<string, { state: CircuitState; healthy: boolean }> = {};
    
    for (const [name, breaker] of this.breakers) {
      states[name] = await breaker.getCurrentState();
    }
    
    return states;
  }

  async resetAll(): Promise<void> {
    for (const breaker of this.breakers.values()) {
      await breaker.reset();
    }
  }
}

// Global registry instance
export const circuitBreakerRegistry = new CircuitBreakerRegistry();

export default CircuitBreaker;
