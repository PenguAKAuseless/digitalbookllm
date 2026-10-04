import { Request, Response, NextFunction } from 'express';

export interface ApiError extends Error {
    statusCode?: number;
    status?: number;
}

export const errorHandler = (
    err: ApiError,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    // Multer rejects oversized or malformed uploads without an HTTP status.
    const multerCode = err.name === 'MulterError' ? (err as ApiError & { code?: string }).code : undefined;
    const statusCode = err.status || err.statusCode || (multerCode === 'LIMIT_FILE_SIZE' ? 413 : multerCode ? 400 : 500);
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
