import rateLimit from 'express-rate-limit';

export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    // The SPA polls ingestion status every few seconds and a single reader
    // page load makes several calls, so 100/15min was hit in normal use.
    max: parseInt(process.env.API_RATE_LIMIT_PER_15MIN || '1000'),
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

export const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // Limit uploads to 10 per hour
    message: 'Too many uploads from this IP, please try again later.',
});
