# RequestManager

`@jaseeey/request-manager` is a small TypeScript library that **de-duplicates concurrent HTTP requests** made through [Axios](https://axios-http.com/).

If several parts of your application call the same endpoint at the same time (same Axios client instance, method, and URL), only **one** network request is made. Every caller receives the **same shared promise** and resolves or rejects together.

It is intentionally focused: not a full HTTP client, cache layer, or request queue. Use it when concurrent duplicate in-flight calls are the problem you need to solve.

---

## Table of contents

- [When to use it](#when-to-use-it)
- [Related tools](#related-tools)
- [Installation](#installation)
- [Quick start](#quick-start)
- [How de-duplication works](#how-de-duplication-works)
- [Choosing a manager instance](#choosing-a-manager-instance)
- [API reference](#api-reference)
- [Effective usage patterns](#effective-usage-patterns)
- [TypeScript tips](#typescript-tips)
- [CommonJS](#commonjs)
- [FAQ](#faq)
- [Known limitations](#known-limitations)
- [Background and scope](#background-and-scope)
- [Contributing](#contributing)
- [License](#license)

---

## When to use it

**Good fit**

- Multiple components mount at once and each load the same resource (`GET /users/me`, `GET /config`, …).
- A user double-clicks a button and you want a single in-flight `POST`/`PUT` until it finishes.
- You already use Axios (or an Axios-compatible `request()` surface) and want de-duplication without rewriting your client.

**Usually not the right tool**

- You need response **caching** after the request has finished (this library only de-duplicates **in-flight** requests).
- You need keys based on **body, headers, or query objects** rather than the full URL string (see [Known limitations](#known-limitations)).
- You need automatic retries, offline queues, or GraphQL batching.

## Related tools

Libraries such as **TanStack Query**, **SWR**, and **Vue Query** solve a broader problem: server-state caching, background revalidation, stale-while-revalidate UX, and often retries.

RequestManager is narrower:

| Concern | RequestManager | Query libraries (typical) |
|---------|----------------|---------------------------|
| Collapse concurrent identical in-flight HTTP calls | Yes | Sometimes, as part of a larger cache model |
| Keep a cache after the request finishes | No | Yes |
| Revalidate on focus / interval | No | Yes |
| Requires Axios | Yes (client with `request`) | Usually `fetch` or pluggable clients |

You can use both: a query library for cache and lifecycle, and RequestManager underneath an Axios-based API module when multiple non-query call sites still risk duplicate in-flight requests. Do not expect RequestManager alone to replace a query library.

---

## Installation

```bash
npm install @jaseeey/request-manager
```

Peer-style dependency: you must have **Axios** available in your project. Install it if you do not already:

```bash
npm install axios
```

Requires **Node.js 18+** for development tooling; the published package is plain ESM/CJS JavaScript for bundlers and Node.

---

## Quick start

### ESM (recommended)

```typescript
import axios from 'axios';
import requestManager from '@jaseeey/request-manager';

const client = axios.create({
    baseURL: 'https://api.example.com',
    timeout: 10_000
});

// Only one HTTP request is sent; both callers share the result.
const [a, b] = await Promise.all([
    requestManager.call(client, 'GET', '/users/me'),
    requestManager.call(client, 'GET', '/users/me')
]);

console.log(a === b); // true (same resolved value / same shared completion)
```

### Return response data only

```typescript
import axios from 'axios';
import requestManager from '@jaseeey/request-manager';

const client = axios.create({ baseURL: 'https://api.example.com' });

const user = await requestManager.call(
    client,
    'GET',
    '/users/me',
    undefined,
    undefined,
    (response) => response.data // non-undefined return becomes the promise result
);
```

### Handle errors without throwing

```typescript
import axios from 'axios';
import requestManager from '@jaseeey/request-manager';

const client = axios.create({ baseURL: 'https://api.example.com' });

const result = await requestManager.call(
    client,
    'GET',
    '/users/me',
    undefined,
    undefined,
    undefined,
    (error) => {
        console.error('Load failed', error);
        // Promise resolves to undefined instead of rejecting
    }
);
```

---

## How de-duplication works

### Request key

Each in-flight request is stored under a key built from:

1. **Axios client instance** (identity, not config equality)
2. **HTTP method** (compared case-insensitively, e.g. `GET` and `get` match)
3. **URL string** (exact string match of the `url` argument—not Axios's fully resolved URL)

```text
key = `${clientId}:${method.toLowerCase()}:${url}`
```

See also [`baseURL` is not part of the key](#baseurl-is-not-part-of-the-key).

### Lifecycle

1. First `call()` for a key creates the Axios request and stores its promise.
2. Further `call()`s with the same key **while the request is still in flight** return the **existing processed promise**.
3. When the request settles (success or failure), the key is removed from the active map.
4. A later `call()` with the same key starts a **new** network request.

There is **no cache** of completed responses. De-duplication applies only to concurrent in-flight work.

### What is not part of the key

These do **not** create separate requests if client, method, and URL string match:

| Input | De-duplicated? | Notes |
|--------|----------------|--------|
| Different `data` bodies | Yes (same key) | Body is **not** in the key |
| Different Axios `config` (headers, timeout, …) | Yes (same key) | Config is **not** in the key |
| Different query objects passed only via `config.params` | Yes (same key) | Prefer encoding query in the URL string if it should distinguish calls |
| Same path, different full URL strings | No | `'/users?id=1'` and `'/users?id=2'` are different keys |
| Different Axios instances | No | Separate clients never share de-duplication |
| Different methods | No | `GET` and `POST` to the same URL are independent |

### Shared promise and callbacks

When a second caller joins an in-flight request:

- It receives the **same** processed promise as the first caller.
- Only the **first** caller’s `onSuccess` / `onError` run for that network attempt.
- Callbacks passed by later callers are **ignored** for that in-flight request.

If you need per-caller side effects, prefer:

```typescript
const response = await requestManager.call(client, 'GET', url);
// each caller runs its own logic after await
updateUi(response.data);
```

Joiners also share **promise identity**: concurrent callers for the same key receive the same `Promise` instance, not merely the same eventual value.

```typescript
const p1 = requestManager.call(client, 'GET', '/users/me');
const p2 = requestManager.call(client, 'GET', '/users/me');
console.log(p1 === p2); // true while the request is in flight
```

### Axios interceptors run once

Request and response interceptors on the Axios client run for the **single** underlying `client.request(...)`. Joined callers do not re-enter interceptors.

That is usually what you want for auth headers, logging, and token refresh: one network attempt, one interceptor chain, many awaiters.

---

## Choosing a manager instance

### Default shared instance (most apps)

```typescript
import requestManager from '@jaseeey/request-manager';
```

Use this when you want app-wide de-duplication for a given Axios client and endpoint. This is the recommended default in browser single-page apps.

The default export is a **module-level singleton**: one shared `RequestManager` for the entire JavaScript realm that loaded the module (typically one per browser tab, or one per Node process).

### Isolated managers

```typescript
import { RequestManager } from '@jaseeey/request-manager';

const billingRequests = new RequestManager();
const adminRequests = new RequestManager();
```

Each instance has its **own** active-request map. The same client/method/URL can run in parallel across different manager instances.

Use isolated managers when:

- You need separate de-duplication domains (e.g. multi-tenant tabs, micro-frontends).
- Tests should not share state with the default singleton (or clear `activeRequests` carefully).
- You run **SSR or multi-request Node** code and must not share in-flight maps across concurrent HTTP requests or users.

#### Server-side rendering and multi-request Node

On the server, the default export can be shared across concurrent incoming requests in the same process. That may incorrectly join unrelated users' in-flight calls if they hit the same client/method/URL key.

Prefer creating a manager (and often an Axios client) **per request** or per app context:

```typescript
import axios from 'axios';
import { RequestManager } from '@jaseeey/request-manager';

export function createRequestContext() {
    const api = axios.create({ baseURL: process.env.API_URL });
    const requests = new RequestManager();
    return { api, requests };
}

// inside a single incoming request handler / RSC context
const { api, requests } = createRequestContext();
await requests.call(api, 'GET', '/users/me');
```

In the browser, the default singleton is usually correct because one tab is one user session.

### Legacy static API

```typescript
import axios from 'axios';
import { RequestManager } from '@jaseeey/request-manager';

const client = axios.create();
await RequestManager.call(client, 'GET', 'https://example.com/health');
```

`RequestManager.call(...)` is a **deprecated** compatibility helper. It always delegates to the **default shared instance**, not to `new RequestManager()`. Prefer the default export.

---

## API reference

### Imports

| Import | Description |
|--------|-------------|
| `import requestManager from '@jaseeey/request-manager'` | Default shared instance |
| `import { RequestManager } from '@jaseeey/request-manager'` | Class for new instances / static legacy API |
| `import requestManager, { RequestManager } from '@jaseeey/request-manager'` | Both |
| `import … from '@jaseeey/request-manager/request-manager'` | Subpath export of the same surface |

### `requestManager.call(client, method, url, data?, config?, onSuccess?, onError?)`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `client` | `AxiosInstance` | required | Axios instance used to perform `client.request(...)` |
| `method` | `Method` | required | HTTP method (`'GET'`, `'POST'`, …) |
| `url` | `string` | required | Request URL (relative or absolute, as Axios expects) |
| `data` | `any` | `{}` | Request body (also used when `null`/`undefined` is passed → coerced to `{}`) |
| `config` | `AxiosRequestConfig \| null` | `{}` | Extra Axios config merged into the request (`null`/`undefined` → `{}`) |
| `onSuccess` | `((response) => T \| Promise<T \| undefined>) \| null` | — | Optional success hook; see below |
| `onError` | `((error) => void) \| null` | — | Optional error hook; see below |

**Return value**

- With no `onSuccess` (or `onSuccess` returns `undefined`): resolves to the full `AxiosResponse`.
- If `onSuccess` returns a value other than `undefined`: resolves to that value (may be async).
- If the request fails and `onError` is provided: `onError` is invoked and the promise **resolves to `undefined`** (does not rethrow).
- If the request fails and `onError` is omitted: the promise **rejects** with the error.

**Notes**

- `onSuccess` may return a `Promise`; it is awaited.
- `onError` is not awaited; keep it synchronous or fire-and-forget async work carefully.
- Method matching for de-duplication is case-insensitive.

### Instance fields

| Member | Description |
|--------|-------------|
| `activeRequests` | `Map` of in-flight entries. Public for inspection/testing. Keys are internal strings; prefer not to depend on key format in production code. |

Clearing the map mid-flight is not recommended except in tests.

### Constructor

```typescript
const manager = new RequestManager();
```

Creates an isolated manager. The generic type parameter on the class is historical; prefer generics on `call()` for response typing.

---

## Effective usage patterns

### 1. Central Axios client + default manager

```typescript
// api/client.ts
import axios from 'axios';

export const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL,
    withCredentials: true
});

api.interceptors.request.use((config) => {
    // attach auth headers, etc.
    return config;
});
```

```typescript
// api/users.ts
import requestManager from '@jaseeey/request-manager';
import { api } from './client';

export function fetchCurrentUser() {
    return requestManager.call(
        api,
        'GET',
        '/users/me',
        undefined,
        undefined,
        (res) => res.data
    );
}
```

Several UI components can call `fetchCurrentUser()` on mount safely; only one HTTP request runs at a time for that key.

### 2. Put distinguishing data in the URL string

Because query params in `config.params` are **not** part of the de-duplication key, encode them in the URL when they should distinguish requests:

```typescript
// Good: different keys
await requestManager.call(api, 'GET', `/items?id=${id}`);

// Risky: same key for all ids if path is identical
await requestManager.call(api, 'GET', '/items', undefined, { params: { id } });
```

### 3. Avoid accidental de-duplication of different POST bodies

Concurrent `POST`s to the same URL with different bodies currently share one request (first body wins for the network call; all callers share that outcome). If that is wrong for your API:

- Use distinct URLs, or
- Use separate manager instances, or
- Call Axios directly for those operations.

### 4. Prefer post-await logic over dual callbacks for multi-caller UI

```typescript
// Preferred when many callers may join one request
try {
    const res = await requestManager.call(api, 'GET', '/settings');
    applySettings(res.data);
}
catch (err) {
    showError(err);
}
```

### 5. Double-submit protection

```typescript
async function saveProfile(payload: Profile) {
    return requestManager.call(
        api,
        'PUT',
        '/profile',
        payload,
        undefined,
        (res) => res.data
    );
}

// Rapid repeated calls while the first is in flight share one PUT.
await Promise.all([saveProfile(data), saveProfile(data)]);
```

Remember: body is not in the key—only use this when concurrent calls are intentionally identical or the first body is acceptable for all joiners.

### 6. Testing

```typescript
import requestManager from '@jaseeey/request-manager';

afterEach(() => {
    requestManager.activeRequests.clear();
});
```

Or construct `new RequestManager()` per test file to avoid shared state.

### 7. Cancellation

This library does not cancel Axios requests. To cancel, pass an `AbortSignal` in `config` as you would with Axios. Joined callers still share the same promise; aborting affects the single underlying request.

```typescript
const controller = new AbortController();

const promise = requestManager.call(
    api,
    'GET',
    '/slow',
    undefined,
    { signal: controller.signal }
);

controller.abort();
```

---

## TypeScript tips

```typescript
import type { AxiosResponse } from 'axios';
import axios from 'axios';
import requestManager from '@jaseeey/request-manager';

interface User {
    id: string;
    name: string;
}

const client = axios.create();

// Full AxiosResponse
const response = await requestManager.call<User>(client, 'GET', '/users/me');
// response is AxiosResponse<User> when onSuccess is omitted

// Mapped result type via onSuccess return value
const user = await requestManager.call<User, User>(
    client,
    'GET',
    '/users/me',
    undefined,
    undefined,
    (res: AxiosResponse<User>) => res.data
);
```

---

## CommonJS

```javascript
const axios = require('axios');
const requestManager = require('@jaseeey/request-manager').default;
// or: const { RequestManager } = require('@jaseeey/request-manager');

const client = axios.create();

requestManager.call(client, 'GET', 'https://example.com').then((res) => {
    console.log(res.status);
});
```

Package exports:

- `require('@jaseeey/request-manager')` → CJS build
- `import … from '@jaseeey/request-manager'` → ESM build
- Types resolve from the ESM declaration entry

---

## FAQ

### Does RequestManager cache responses?

No. It only de-duplicates **in-flight** requests. After a call settles, the next `call()` with the same key performs a new network request. For caching, revalidation, and background refresh, use a data library (see [Related tools](#related-tools)) or your own cache.

### Why did two different POST bodies share one request?

The de-duplication key ignores `data`. Concurrent `POST`s to the same client, method, and URL string join the first request; later bodies are not sent separately. Use distinct URLs, separate manager instances, or call Axios directly when bodies must not merge. See [Avoid accidental de-duplication of different POST bodies](#3-avoid-accidental-de-duplication-of-different-post-bodies).

### Why didn't `config.params` create separate keys?

`config.params` is not part of the key. Encode distinguishing query data in the `url` string (for example `` `/items?id=${id}` ``), or the calls will join. See [Put distinguishing data in the URL string](#2-put-distinguishing-data-in-the-url-string).

### Can I use `fetch` instead of Axios?

Not with this package as-is. `call()` expects an Axios-like client with `request(config)`. You could wrap `fetch` behind a minimal `request()` adapter, but that is outside the supported surface.

### What if `onSuccess` returns `undefined`?

The promise still resolves to the full `AxiosResponse`. Only a **non-`undefined`** return value from `onSuccess` replaces the result.

### How can I see what is in flight?

Inspect `requestManager.activeRequests.size` (or the map itself) for debugging and tests. Treat key strings as internal; do not build application logic on the key format.

### Should I migrate off `RequestManager.call`?

Yes, when convenient. The static helper is deprecated and always uses the default shared instance:

```typescript
// Before
await RequestManager.call(client, 'GET', '/users/me');

// After
import requestManager from '@jaseeey/request-manager';
await requestManager.call(client, 'GET', '/users/me');
```

---

## Known limitations

### In-flight only (no response cache)

After a request completes, a new `call()` hits the network again. Add your own cache if you need longer-lived memoisation.

### First caller owns callbacks

Only the first in-flight caller’s `onSuccess` / `onError` execute. Joiners share the processed promise only.

### Key ignores body and config

De-duplication does not consider request bodies, headers, or `config.params`. Design URLs (and manager boundaries) accordingly.

### Exact URL string matching

`/users` and `/users/` are different keys. Relative URLs are not normalised against `baseURL` for keying—the string you pass is the key segment.

### `baseURL` is not part of the key

Axios may resolve a relative `url` against the client's `baseURL` when sending the request, but RequestManager keys only on the **`url` argument string**.

```typescript
const client = axios.create({ baseURL: 'https://api.example.com' });

// These share one in-flight request (same url string: '/users/me')
await Promise.all([
    requestManager.call(client, 'GET', '/users/me'),
    requestManager.call(client, 'GET', '/users/me')
]);

// This is a different key (different url string), even if it hits the same origin
await requestManager.call(client, 'GET', 'https://api.example.com/users/me');
```

Keep the `url` argument consistent across call sites (usually the same relative path) so de-duplication works as intended.

### Client identity, not configuration equality

Two `axios.create({ baseURL: 'https://api.example.com' })` instances are different clients and will not de-duplicate against each other.

### Lifecycle / unmount

If multiple components share one in-flight request, unmounting one should not cancel for all unless you coordinate abort signals carefully.

### `onError` is not awaited

Async work inside `onError` is not tracked by the returned promise.

### Default export is shared process-wide

The default `requestManager` is a single module-level instance for the whole realm. Use `new RequestManager()` when you need isolation—especially under SSR or multi-tenant Node servers (see [Server-side rendering and multi-request Node](#server-side-rendering-and-multi-request-node)).

---

## Background and scope

This library was written to solve a concrete problem: concurrent duplicate HTTP calls in application UIs. It is not intended as a general-purpose request framework.

Accepted trade-offs (key design, first-callback wins, in-flight-only) match that goal. If you need different behaviour, fork or wrap the class—`RequestManager` is small and MIT-licensed.

---

## Features summary

- De-duplicates concurrent requests per **Axios instance + method + URL**
- Shared promise for all joiners until the request settles
- Optional `onSuccess` / `onError` hooks (with documented join semantics)
- Default shared instance **and** constructible isolated managers
- TypeScript types, ESM + CJS builds
- Legacy `RequestManager.call` static helper (deprecated)

---

## Contributing

Contributions are welcome. Fork the repository, open a pull request, and keep changes focused. Run tests with:

```bash
npm ci
npm test
npm run build
```

---

## License

RequestManager is released under the [MIT License](LICENSE).
