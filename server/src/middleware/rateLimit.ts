import rateLimit from "express-rate-limit";

export interface RateLimitConfig {
  windowMs: number;
  limit: number;
}

export const AUTH_RATE_LIMITS = {
  login: { windowMs: 15 * 60 * 1000, limit: 10 },
  register: { windowMs: 60 * 60 * 1000, limit: 20 },
} as const satisfies Record<string, RateLimitConfig>;

export function createRateLimiter(config: RateLimitConfig) {
  return rateLimit({
    windowMs: config.windowMs,
    limit: config.limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        code: "rate_limited",
        message: "Too many requests. Please try again later.",
      });
    },
  });
}
