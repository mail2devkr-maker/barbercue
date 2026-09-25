#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { request } from 'node:https';
import * as zlib from 'node:zlib';

const DEFAULT_URL =
  'https://barbercuebackend-production.up.railway.app/api/v1/cities/all';
const target = new URL(process.env.FASTQUE_COMPRESSION_TEST_URL || DEFAULT_URL);
const timeoutMs = Number(process.env.FASTQUE_COMPRESSION_TEST_TIMEOUT_MS || 20000);

const cases = [
  { label: 'zstd', accept: 'zstd', expected: 'zstd' },
  { label: 'brotli', accept: 'br', expected: 'br' },
  { label: 'gzip', accept: 'gzip', expected: 'gzip' },
  { label: 'identity', accept: 'identity', expected: null },
  {
    label: 'priority',
    accept: 'gzip;q=1, br;q=1, zstd;q=1',
    expected: 'zstd',
  },
  {
    label: 'zstd-opt-out',
    accept: 'zstd;q=0, br;q=1, gzip;q=0.5',
    expected: 'br',
  },
];

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function rawRequest(acceptEncoding) {
  return new Promise((resolve, reject) => {
    const req = request(
      target,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': acceptEncoding,
          'User-Agent': 'FastQue-Compression-Certifier/1.0',
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            wireBody: Buffer.concat(chunks),
          });
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs} ms`));
    });
    req.on('error', reject);
    req.end();
  });
}

function decode(body, contentEncoding) {
  if (!contentEncoding || contentEncoding === 'identity') return body;
  if (contentEncoding === 'gzip') return zlib.gunzipSync(body);
  if (contentEncoding === 'br') return zlib.brotliDecompressSync(body);
  if (contentEncoding === 'zstd') {
    if (typeof zlib.zstdDecompressSync !== 'function') {
      throw new Error(
        'This Node runtime cannot decode Zstd. Use Node 22.15+ for the certification script.',
      );
    }
    return zlib.zstdDecompressSync(body);
  }
  throw new Error(`Unexpected Content-Encoding: ${contentEncoding}`);
}

function hasVaryAcceptEncoding(vary) {
  return String(vary || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .includes('accept-encoding');
}

const rows = [];
let referenceHash = null;
let failed = false;

for (const testCase of cases) {
  try {
    const response = await rawRequest(testCase.accept);
    const contentEncodingHeader = response.headers['content-encoding'];
    const contentEncoding = Array.isArray(contentEncodingHeader)
      ? contentEncodingHeader[0]
      : contentEncodingHeader || null;
    const decoded = decode(response.wireBody, contentEncoding);
    const decodedHash = sha256(decoded);
    const contentType = String(response.headers['content-type'] || '');
    const statusOk = response.status >= 200 && response.status < 300;
    const encodingOk = contentEncoding === testCase.expected;
    const varyOk = hasVaryAcceptEncoding(response.headers.vary);
    const jsonOk = contentType.includes('application/json') && (() => {
      try {
        JSON.parse(decoded.toString('utf8'));
        return true;
      } catch {
        return false;
      }
    })();

    if (testCase.label === 'identity' && statusOk && jsonOk) {
      referenceHash = decodedHash;
    }

    const row = {
      case: testCase.label,
      accept: testCase.accept,
      expected: testCase.expected || 'identity',
      actual: contentEncoding || 'identity',
      status: response.status,
      wireBytes: response.wireBody.byteLength,
      decodedBytes: decoded.byteLength,
      vary: response.headers.vary || '',
      decodedHash,
      statusOk,
      encodingOk,
      varyOk,
      jsonOk,
    };
    rows.push(row);
  } catch (error) {
    failed = true;
    rows.push({
      case: testCase.label,
      accept: testCase.accept,
      expected: testCase.expected || 'identity',
      actual: 'ERROR',
      status: 0,
      wireBytes: 0,
      decodedBytes: 0,
      vary: '',
      decodedHash: '',
      statusOk: false,
      encodingOk: false,
      varyOk: false,
      jsonOk: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

if (!referenceHash) {
  failed = true;
}

for (const row of rows) {
  row.payloadMatchesIdentity =
    Boolean(referenceHash) && row.decodedHash === referenceHash;
  row.pass =
    row.statusOk &&
    row.encodingOk &&
    row.varyOk &&
    row.jsonOk &&
    row.payloadMatchesIdentity;

  if (!row.pass) failed = true;
}

console.table(
  rows.map((row) => ({
    case: row.case,
    expected: row.expected,
    actual: row.actual,
    status: row.status,
    wireBytes: row.wireBytes,
    decodedBytes: row.decodedBytes,
    vary: row.varyOk ? 'PASS' : 'FAIL',
    payload: row.payloadMatchesIdentity ? 'PASS' : 'FAIL',
    result: row.pass ? 'PASS' : 'FAIL',
  })),
);

for (const row of rows) {
  if (row.error) console.error(`[${row.case}] ${row.error}`);
}

console.log('');
console.log(`Target: ${target.toString()}`);
console.log(
  failed
    ? 'FASTQUE COMPRESSION CERTIFICATION: FAIL'
    : 'FASTQUE COMPRESSION CERTIFICATION: PASS',
);

process.exitCode = failed ? 1 : 0;
