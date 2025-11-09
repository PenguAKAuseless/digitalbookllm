import { Request, Response, NextFunction } from 'express';

export interface ApiError extends Error {
    statusCode?: number;
}

export const errorHandler = (
    err: ApiError,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal Server Error';

    console.error('Error:', {
        message,
        stack: err.stack,
        path: req.path,
        method: req.method,
    });

    res.status(statusCode).json({
        success: false,
        error: message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
};

export const notFound = (req: Request, res: Response) => {
    res.status(404).json({
        success: false,
        error: `Route ${req.originalUrl} not found`,
    });
};
