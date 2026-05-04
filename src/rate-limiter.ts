import pLimit from 'p-limit';

export class RateLimiter {
  private limit: ReturnType<typeof pLimit>;
  private requestCount: number = 0;
  private lastResetTime: number = Date.now();
  private readonly maxRequestsPerMinute: number;
  private readonly resetIntervalMs: number = 60000; // 1 minute

  constructor(maxRequestsPerMinute: number = 10) {
    this.maxRequestsPerMinute = maxRequestsPerMinute;
    this.limit = pLimit(5); // Max 5 concurrent requests
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return this.limit(async () => {
      const now = Date.now();
      if (now - this.lastResetTime >= this.resetIntervalMs) {
        this.requestCount = 0;
        this.lastResetTime = now;
      }

      if (this.requestCount >= this.maxRequestsPerMinute) {
        const waitTime = this.resetIntervalMs - (now - this.lastResetTime);
        throw new Error(`Rate limit exceeded. Please wait ${Math.ceil(waitTime / 1000)} seconds.`);
      }

      this.requestCount++;
      return fn();
    });
  }

  getStatus(): { requestCount: number; maxRequests: number; resetTime: number } {
    return {
      requestCount: this.requestCount,
      maxRequests: this.maxRequestsPerMinute,
      resetTime: this.lastResetTime + this.resetIntervalMs,
    };
  }
} 
