# Security Headers

The API uses [Helmet](https://helmetjs.github.io/) to set HTTP security headers on all responses.

## Current Configuration

Helmet is applied in `packages/api/src/index.ts` with two options disabled for GraphQL compatibility:

```typescript
this.app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
```

## Headers Set by Default

Helmet enables the following headers out of the box:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Frame-Options` | `SAMEORIGIN` | Prevents clickjacking by blocking iframe embedding from other origins |
| `X-Content-Type-Options` | `nosniff` | Prevents MIME-type sniffing |
| `X-DNS-Prefetch-Control` | `off` | Disables DNS prefetching |
| `X-Download-Options` | `noopen` | Prevents IE from executing downloads in the site's context |
| `X-Permitted-Cross-Domain-Policies` | `none` | Restricts Adobe Flash/PDF cross-domain requests |
| `Referrer-Policy` | `no-referrer` | Suppresses the `Referer` header |
| `X-XSS-Protection` | `0` | Disables the legacy XSS filter (recommended — the filter itself has vulnerabilities) |

## Disabled Headers

### `contentSecurityPolicy: false`
CSP is disabled because Apollo Server's GraphQL Playground/Sandbox loads inline scripts and external resources that would be blocked by a default CSP. If you don't use the Playground in production (it's disabled when `NODE_ENV=production`), you can enable a restrictive CSP for production:

```typescript
this.app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
  crossOriginEmbedderPolicy: false,
}));
```

### `crossOriginEmbedderPolicy: false`
COEP is disabled to avoid breaking cross-origin resource loading in the GraphQL client. Enable only if you control all resources loaded by the frontend.

## Strict-Transport-Security (HSTS)

Helmet sets HSTS by default (`max-age=15552000; includeSubDomains`). This header is only meaningful when the API is served over HTTPS. In local development over HTTP, browsers ignore it.

For production, ensure the API is behind a TLS-terminating reverse proxy (nginx, AWS ALB, etc.) and that `NODE_ENV=production` is set.

## Enabling a Production CSP

If you want to add a Content-Security-Policy in production, configure it explicitly:

```typescript
this.app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production'
    ? {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      }
    : false,
  crossOriginEmbedderPolicy: false,
}));
```

## References

- [Helmet documentation](https://helmetjs.github.io/)
- [OWASP Secure Headers Project](https://owasp.org/www-project-secure-headers/)
