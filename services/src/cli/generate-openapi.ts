import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Container } from '../container.js';
import { createHealthRouter } from '../http/health.routes.js';
import { createRoutes } from '../routes/index.js';

type HttpMethod = 'delete' | 'get' | 'patch' | 'post' | 'put';

interface RouterLayer {
  readonly handle?: { readonly stack?: readonly RouterLayer[] };
  readonly matchers?: readonly ((value: string) => false | { readonly path: string })[];
  readonly route?: {
    readonly path: string;
    readonly methods: Readonly<Record<string, boolean>>;
  };
}

interface Endpoint {
  readonly method: HttpMethod;
  readonly path: string;
}

interface DeepStub {
  (...arguments_: unknown[]): DeepStub;
  readonly [key: string]: DeepStub;
}

const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outputPath = resolve(serviceRoot, 'openapi.json');
const knownMounts = ['/auth/platform', '/platform', '/admin', '/public'] as const;
const methods = new Set<string>(['delete', 'get', 'patch', 'post', 'put']);

function stubTarget(): DeepStub {
  return deepStub;
}

function cast<T>(value: unknown): T {
  return value as T;
}

const deepStub: DeepStub = new Proxy(cast<DeepStub>(stubTarget), {
  get: (): DeepStub => deepStub,
  apply: (): DeepStub => deepStub,
});

function isHttpMethod(value: string): value is HttpMethod {
  return methods.has(value);
}

function mountPath(layer: RouterLayer): string {
  const match = layer.matchers?.[0];
  if (!match) return '';
  for (const candidate of knownMounts) {
    const result = match(`${candidate}/__contract_probe__`);
    if (result && result.path) return result.path.replace(/\/$/, '');
  }
  const root = match('/');
  if (root && (root.path === '' || root.path === '/')) return '';
  throw new Error('The route registry contains an unknown mount path. Add it to knownMounts.');
}

function collectRoutes(stack: readonly RouterLayer[], prefix = ''): Endpoint[] {
  const endpoints: Endpoint[] = [];
  for (const layer of stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        if (isHttpMethod(method)) {
          endpoints.push({ method, path: `${prefix}${layer.route.path}` });
        }
      }
    } else if (layer.handle?.stack) {
      endpoints.push(...collectRoutes(layer.handle.stack, `${prefix}${mountPath(layer)}`));
    }
  }
  return endpoints;
}

function applicationEndpoints(): Endpoint[] {
  const settings = {
    qrResolveRateLimit: { windowMs: 1, max: 1 },
    platformLoginRateLimit: { windowMs: 1, max: 1 },
  };
  const routeRouter = cast<{ stack: RouterLayer[] }>(
    createRoutes(cast<Container>(deepStub), settings),
  );
  const healthRouter = cast<{ stack: RouterLayer[] }>(createHealthRouter([]));
  const endpoints = [
    ...collectRoutes(healthRouter.stack),
    ...collectRoutes(routeRouter.stack),
  ].sort(
    (left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method),
  );
  const keys = endpoints.map(({ method, path }) => `${method} ${path}`);
  if (new Set(keys).size !== keys.length)
    throw new Error('The route registry has duplicate endpoints.');
  return endpoints;
}

async function filesBelow(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const child = resolve(path, entry.name);
      return entry.isDirectory() ? filesBelow(child) : [child];
    }),
  );
  return files.flat();
}

async function sourceFingerprint(): Promise<{ hash: string; files: string[] }> {
  const sourceFiles = await filesBelow(resolve(serviceRoot, 'src'));
  const files = sourceFiles
    .filter(
      (path) =>
        path.endsWith('.routes.ts') ||
        path.endsWith('.schemas.ts') ||
        ['src/app.ts', 'src/http/crud.ts', 'src/routes/index.ts'].includes(
          relative(serviceRoot, path),
        ),
    )
    .sort();
  const hash = createHash('sha256');
  for (const path of files) {
    hash.update(relative(serviceRoot, path));
    hash.update('\0');
    hash.update(await readFile(path));
    hash.update('\0');
  }
  return { hash: hash.digest('hex'), files: files.map((path) => relative(serviceRoot, path)) };
}

function accessFor(path: string): 'guest' | 'platform' | 'public' | 'staff' {
  if (path.startsWith('/admin/')) return 'staff';
  if (path.startsWith('/platform/')) return 'platform';
  if (/^\/auth\/platform\/(me|logout|password)$/.test(path)) return 'platform';
  if (/^\/auth\/staff\/(me|logout|password)$/.test(path)) return 'staff';
  if (/^\/public\/(session|services|requests(?:\/|$))/.test(path)) return 'guest';
  return 'public';
}

function tagFor(path: string): string {
  if (path === '/' || path === '/health' || path === '/ready') return 'Health';
  if (path.startsWith('/auth/')) return 'Authentication';
  if (path.startsWith('/platform/')) return 'Platform';
  if (path.startsWith('/public/')) return 'Patient';
  const part = path.split('/')[2] ?? 'Admin';
  return part
    .split('-')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

function operationId(method: HttpMethod, path: string): string {
  return `${method}_${path.replace(/:([A-Za-z]+)/g, '_by_$1').replace(/[^A-Za-z0-9]+/g, '_')}`.replace(
    /^_|_$/g,
    '',
  );
}

function openApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function parametersFor(path: string) {
  return [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => ({
    in: 'path',
    name: match[1],
    required: true,
    schema: { type: 'string' },
  }));
}

async function document() {
  const fingerprint = await sourceFingerprint();
  const paths: Record<string, Record<string, unknown>> = {};
  for (const endpoint of applicationEndpoints()) {
    const access = accessFor(endpoint.path);
    const path = openApiPath(endpoint.path);
    paths[path] ??= {};
    paths[path][endpoint.method] = {
      operationId: operationId(endpoint.method, endpoint.path),
      summary: `${endpoint.method.toUpperCase()} ${path}`,
      tags: [tagFor(endpoint.path)],
      ...(access === 'public' ? {} : { security: [{ [`${access}Bearer`]: [] }] }),
      ...(parametersFor(endpoint.path).length ? { parameters: parametersFor(endpoint.path) } : {}),
      responses: {
        '2XX': { description: 'Successful endpoint-specific response' },
        default: { $ref: '#/components/responses/Error' },
      },
      'x-access': access,
    };
  }

  const errorResponse = (description: string) => ({
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
  });
  return {
    openapi: '3.1.0',
    info: {
      title: 'CARE QR API',
      version: '0.1.0',
      description:
        'Generated route inventory. Zod schemas remain the runtime authority for request fields.',
    },
    servers: [{ url: '/' }],
    paths,
    components: {
      securitySchemes: {
        staffBearer: { type: 'http', scheme: 'bearer', bearerFormat: 'opaque' },
        platformBearer: { type: 'http', scheme: 'bearer', bearerFormat: 'opaque' },
        guestBearer: { type: 'http', scheme: 'bearer', bearerFormat: 'opaque' },
      },
      schemas: {
        ErrorEnvelope: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message', 'requestId'],
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                requestId: { type: 'string' },
                fields: { type: 'object', additionalProperties: true },
              },
            },
          },
        },
      },
      responses: {
        Error: errorResponse(
          'Error envelope; common statuses are 400, 401, 403, 404, 409, 413, 429, 500, and 503.',
        ),
      },
    },
    'x-route-count': Object.values(paths).reduce(
      (count, operations) => count + Object.keys(operations).length,
      0,
    ),
    'x-source-files': fingerprint.files,
    'x-source-sha256': fingerprint.hash,
  };
}

const serialized = `${JSON.stringify(await document(), null, 2)}\n`;
if (process.argv.includes('--check')) {
  const current = await readFile(outputPath, 'utf8').catch(() => '');
  if (current !== serialized) {
    console.error('openapi.json is stale. Run npm run docs:api and commit the result.');
    process.exitCode = 1;
  } else {
    console.log('openapi.json matches the registered routes and schema sources.');
  }
} else {
  await writeFile(outputPath, serialized);
  console.log(`Wrote ${relative(process.cwd(), outputPath)}.`);
}
