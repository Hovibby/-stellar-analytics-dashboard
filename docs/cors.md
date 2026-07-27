# CORS Configuration

The API uses the [cors](https://github.com/expressjs/cors) middleware. Configuration is environment-driven.

## Current Configuration

```typescript
this.app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));
```

CORS is applied at the Express level. Apollo Server's own CORS handling is disabled (`cors: false` in `applyMiddleware`) to avoid double-processing.

## Environment Variable

| Variable | Default | Description |
|----------|---------|-------------|
| `CORS_ORIGIN` | `*` | Allowed origin(s). Use `*` for development, a specific URL for production. |

## Configuration by Environment

### Local Development

```env
CORS_ORIGIN=*
```

Allows requests from any origin. Fine for local development where the frontend runs on `localhost:5173`.

### Production

Set `CORS_ORIGIN` to the exact frontend URL:

```env
CORS_ORIGIN=https://your-frontend-domain.com
```

This restricts cross-origin requests to only that origin. The `credentials: true` option allows cookies and `Authorization` headers to be sent cross-origin, which is required for JWT authentication.

### Multiple Origins

The `cors` package supports a function for dynamic origin validation. If you need to allow multiple specific origins, update the middleware in `packages/api/src/index.ts`:

```typescript
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(o => o.trim());

this.app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`Origin ${origin} not allowed by CORS policy`));
  },
  credentials: true,
}));
```

Then set:

```env
CORS_ORIGIN=https://app.example.com,https://staging.example.com
```

## Preflight Requests

The `cors` middleware automatically handles `OPTIONS` preflight requests. No additional route configuration is needed.

## Credentials and Cookies

`credentials: true` is required when the frontend sends:
- `Authorization: Bearer <token>` headers
- Cookies (if cookie-based auth is added in future)

When using `credentials: true`, `origin` must **not** be `*` in production — browsers will reject credentialed requests to a wildcard origin. Always set a specific origin in production.

## Security Checklist

- [ ] `CORS_ORIGIN` is set to a specific URL in production (not `*`)
- [ ] The allowed origin uses HTTPS in production
- [ ] No sensitive endpoints are exposed without authentication regardless of CORS policy (CORS is not a substitute for auth)
