import { AxiosInstance, AxiosRequestConfig, AxiosResponse, Method } from 'axios';

type RequestKey = string;
type MaybePromise<T> = T | Promise<T>;

/**
 * Human-readable identity of an in-flight request (used for inspection and hash input).
 */
export interface RequestIdentity {
    clientId: number;
    method: string;
    url: string;
    params: unknown;
    paramsSerialised: string;
}

/**
 * Active in-flight request entry stored in {@link RequestManager.activeRequests}.
 *
 * Map keys are SHA-256 hashes of the stable identity string. `original` and `processed`
 * remain available for callers that inspect in-flight entries.
 */
export interface ActiveRequest {
    hash: string;
    identity: RequestIdentity;
    original: Promise<AxiosResponse<unknown>>;
    processed: Promise<unknown>;
}

/**
 * RequestManager
 *
 * Manages and regulates HTTP requests to ensure that multiple requests to the same URL and method are not made
 * concurrently. When a request to a specific URL and method is in progress, subsequent requests to the same URL and
 * method will return the same promise, preventing duplicate requests.
 */
export class RequestManager<T = any> {
    /**
     * In-flight requests keyed by a short SHA-256 hash of the request identity.
     * Entry values expose `identity` for debugging plus `original` / `processed` promises.
     */
    activeRequests: Map<RequestKey, ActiveRequest> = new Map();
    private clientIds: WeakMap<AxiosInstance, number> = new WeakMap();
    private nextClientId = 1;

    /**
     * Backward-compatible static API that delegates to the shared singleton instance.
     *
     * @deprecated Prefer the default exported instance (`requestManager.call(...)`).
     */
    static call<TResponse = any, TSuccess = never>(
        client: AxiosInstance,
        method: Method,
        url: string,
        data: any = {},
        config: AxiosRequestConfig | null = {},
        onSuccess?: ((result: AxiosResponse<TResponse>) => MaybePromise<TSuccess | undefined>) | null,
        onError?: ((error: unknown) => void) | null
    ): Promise<AxiosResponse<TResponse> | TSuccess | void> {
        return requestManager.call(client, method, url, data, config, onSuccess, onError);
    }

    /**
     * Executes or retrieves an ongoing HTTP request based on the provided URL, method, payload, and configuration.
     *
     * Requests are de-duplicated when they target the same client instance, method, URL, and `config.params`.
     * Request bodies and other config fields (headers, timeout, signal, etc.) are not part of the key.
     * If `onSuccess` returns a non-`undefined` value, that value becomes the resolved result.
     *
     * @param client Axios client used to execute the request.
     * @param method HTTP method.
     * @param url Target request URL.
     * @param data Optional request payload.
     * @param config Optional Axios request configuration.
     * @param onSuccess Optional callback invoked on success. Returning a value overrides the resolved response.
     * @param onError Optional callback for request failures only. If it throws, the original request error is rethrown.
     */
    call<TResponse = T, TSuccess = never>(
        client: AxiosInstance,
        method: Method,
        url: string,
        data: any = {},
        config: AxiosRequestConfig | null = {},
        onSuccess?: ((result: AxiosResponse<TResponse>) => MaybePromise<TSuccess | undefined>) | null,
        onError?: ((error: unknown) => void) | null
    ): Promise<AxiosResponse<TResponse> | TSuccess | void> {
        if (typeof method !== 'string' || method.length === 0) {
            return Promise.reject(new TypeError('RequestManager.call requires a non-empty HTTP method string'));
        }
        if (typeof url !== 'string') {
            return Promise.reject(new TypeError('RequestManager.call requires a URL string'));
        }
        data ??= {};
        config ??= {};
        const identity = this.buildRequestIdentity(client, method, url, config.params);
        const hash = this.hashIdentity(identity);
        const existing = this.activeRequests.get(hash);
        if (existing) {
            return existing.processed as Promise<AxiosResponse<TResponse> | TSuccess | void>;
        }
        const processRequest = async (
            responsePromise: Promise<AxiosResponse<TResponse>>
        ): Promise<AxiosResponse<TResponse> | TSuccess | void> => {
            let requestResult: AxiosResponse<TResponse>;
            try {
                requestResult = await responsePromise;
            }
            catch (err) {
                if (onError && typeof onError === 'function') {
                    try {
                        onError(err);
                    }
                    catch {
                        throw err;
                    }
                    return;
                }
                throw err;
            }
            if (!(onSuccess && typeof onSuccess === 'function')) {
                return requestResult;
            }
            const callbackResult = await onSuccess(requestResult);
            return callbackResult !== undefined
                ? callbackResult
                : requestResult;
        };
        const requestPromise = client.request<TResponse>({ ...config, method, url, data }).finally(() => {
            this.activeRequests.delete(hash);
        });
        const processedPromise = processRequest(requestPromise);
        this.activeRequests.set(hash, {
            hash,
            identity,
            original: requestPromise,
            processed: processedPromise
        });
        return processedPromise;
    }

    /**
     * Builds the stable human-readable identity for an in-flight request.
     *
     * @param client Axios client instance used for the request.
     * @param method HTTP method.
     * @param url Request URL string as passed to `call`.
     * @param params Axios `config.params` value, if any.
     * @returns Identity fields used for hashing and inspection.
     */
    private buildRequestIdentity(
        client: AxiosInstance,
        method: Method,
        url: string,
        params: AxiosRequestConfig['params']
    ): RequestIdentity {
        let clientId = this.clientIds.get(client);
        if (!clientId) {
            clientId = this.nextClientId++;
            this.clientIds.set(client, clientId);
        }
        const normalisedMethod = method.toLowerCase();
        const paramsSerialised = this.serializeParams(params);
        return {
            clientId,
            method: normalisedMethod,
            url,
            params: params ?? null,
            paramsSerialised
        };
    }

    /**
     * Hashes a request identity into a fixed-length map key.
     *
     * @param identity Stable request identity.
     * @returns Lowercase hex SHA-256 digest of the identity string.
     */
    private hashIdentity(identity: RequestIdentity): string {
        const material = `${identity.clientId}:${identity.method}:${identity.url}:${identity.paramsSerialised}`;
        return sha256Hex(material);
    }

    /**
     * Serialises query params into a deterministic string for request keys.
     *
     * @param params Axios params value (`undefined`, plain object, array, or `URLSearchParams`).
     * @returns A stable serialisation, or an empty string when params are absent.
     */
    private serializeParams(params: AxiosRequestConfig['params']): string {
        if (params == null) {
            return '';
        }
        if (typeof URLSearchParams !== 'undefined' && params instanceof URLSearchParams) {
            if ([ ...params.keys() ].length === 0) {
                return '';
            }
            const asObject: Record<string, string[]> = {};
            for (const key of [ ...params.keys() ].sort()) {
                asObject[key] = params.getAll(key);
            }
            return this.stableStringify(asObject);
        }
        if (typeof params === 'object' && !Array.isArray(params) && Object.keys(params).length === 0) {
            return '';
        }
        return this.stableStringify(params);
    }

    /**
     * JSON-like serialisation with sorted object keys so param order does not affect identity.
     *
     * @param value Value to serialise.
     * @returns Deterministic string form of `value`.
     */
    private stableStringify(value: unknown): string {
        if (value === null || typeof value !== 'object') {
            return JSON.stringify(value);
        }
        if (Array.isArray(value)) {
            return `[${value.map(entry => this.stableStringify(entry)).join(',')}]`;
        }
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        return `{${keys.map(key => `${JSON.stringify(key)}:${this.stableStringify(record[key])}`).join(',')}}`;
    }
}

const requestManager = new RequestManager();

export default requestManager;

/**
 * Synchronous SHA-256 hex digest for browser and Node without async WebCrypto.
 *
 * @param message UTF-8 string to hash.
 * @returns Lowercase hex digest.
 */
function sha256Hex(message: string): string {
    const bytes = utf8ToBytes(message);
    const bitLength = bytes.length * 8;
    const withOne = new Uint8Array(((bytes.length + 9 + 63) & ~63));
    withOne.set(bytes);
    withOne[bytes.length] = 0x80;
    const view = new DataView(withOne.buffer);
    view.setUint32(withOne.length - 4, bitLength >>> 0, false);
    view.setUint32(withOne.length - 8, Math.floor(bitLength / 0x100000000), false);
    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;
    const w = new Int32Array(64);
    const k = SHA256_K;
    for (let offset = 0; offset < withOne.length; offset += 64) {
        for (let i = 0; i < 16; i++) {
            w[i] = view.getInt32(offset + i * 4, false);
        }
        for (let i = 16; i < 64; i++) {
            const s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }
        let a = h0;
        let b = h1;
        let c = h2;
        let d = h3;
        let e = h4;
        let f = h5;
        let g = h6;
        let h = h7;
        for (let i = 0; i < 64; i++) {
            const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
            const ch = (e & f) ^ (~e & g);
            const temp1 = (h + S1 + ch + k[i] + w[i]) | 0;
            const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (S0 + maj) | 0;
            h = g;
            g = f;
            f = e;
            e = (d + temp1) | 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) | 0;
        }
        h0 = (h0 + a) | 0;
        h1 = (h1 + b) | 0;
        h2 = (h2 + c) | 0;
        h3 = (h3 + d) | 0;
        h4 = (h4 + e) | 0;
        h5 = (h5 + f) | 0;
        h6 = (h6 + g) | 0;
        h7 = (h7 + h) | 0;
    }
    return [ h0, h1, h2, h3, h4, h5, h6, h7 ].map(wordToHex).join('');
}

function rightRotate(value: number, amount: number): number {
    return (value >>> amount) | (value << (32 - amount));
}

function wordToHex(value: number): string {
    return (value >>> 0).toString(16).padStart(8, '0');
}

function utf8ToBytes(message: string): Uint8Array {
    if (typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(message);
    }
    const encoded = unescape(encodeURIComponent(message));
    const bytes = new Uint8Array(encoded.length);
    for (let i = 0; i < encoded.length; i++) {
        bytes[i] = encoded.charCodeAt(i);
    }
    return bytes;
}

const SHA256_K = new Int32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);
