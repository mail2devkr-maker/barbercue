# FastQue Edge Reverse Proxy & Compression Certification

## Target architecture

```text
Browser / Mobile
       |
       v
Cloudflare Edge (reverse proxy)
  - TLS termination
  - DDoS/WAF edge protection
  - HTTP/2 + HTTP/3
  - response compression: Zstd -> Brotli -> Gzip -> identity
       |
       v
Railway FastQue origin
  - api.fastque.com -> backend:8080
  - fastque.com -> web:3001
       |
       v
FastQue backend adaptive compression
  - Zstd -> Brotli -> Gzip -> identity
```

## Railway origin preparation

The production backend has the custom domain `api.fastque.com` attached to port `8080`.
Railway requires the DNS CNAME below before ownership can validate:

- Host: `api.fastque.com`
- Type: `CNAME`
- Target: `k1fpl165.up.railway.app`

Keep the generated Railway backend domain available as an emergency origin until the Cloudflare path is physically certified.

## Cloudflare configuration

Use the orange-cloud proxy for `api.fastque.com`.

Recommended response compression rule:

1. Match the default compressible content types (or all responses where Cloudflare permits compression).
2. Compression mode: Custom.
3. Algorithm order:
   1. Zstandard
   2. Brotli
   3. Gzip

Cloudflare will select the first algorithm the client advertises in `Accept-Encoding`. Unsupported clients therefore fall back automatically.

Railway's current guidance for proxied custom domains requires Cloudflare SSL/TLS mode `Full` rather than `Full (Strict)`.

Do not cache authenticated FastQue API responses globally. Any future API caching must be endpoint-specific and prove that the response is public and user-independent.

## Production wire certification

Run from Node 22.15+:

```bash
npm run certify:compression
```

To test the Cloudflare edge after `api.fastque.com` is live:

```bash
FASTQUE_COMPRESSION_TEST_URL=https://api.fastque.com/api/v1/cities/all npm run certify:compression
```

The certification performs raw HTTPS requests so the HTTP stack does not transparently hide the wire encoding. It verifies:

- `Accept-Encoding: zstd` -> `Content-Encoding: zstd`
- `Accept-Encoding: br` -> `Content-Encoding: br`
- `Accept-Encoding: gzip` -> `Content-Encoding: gzip`
- `Accept-Encoding: identity` -> no compressed content encoding
- equal q-values -> FastQue prefers Zstd
- `zstd;q=0` -> Brotli fallback
- `Vary: Accept-Encoding`
- each compressed payload decompresses successfully
- all decoded bodies have the same SHA-256 as the identity response
- decoded response is valid JSON

The script exits non-zero if any check fails.
