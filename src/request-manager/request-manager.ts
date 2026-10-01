import { AxiosInstance, AxiosRequestConfig, AxiosResponse, Method } from 'axios';
import { sha256Hex } from './sha256.js';

type RequestKey = string;
type MaybePromise<T> = T | Promise<T>;

/**
 * Human-readable identity of an in-flight request (used for inspection and hash input).
 */
export interface RequestIdentity {
    clientId: number;
    method: string;
    /** URL string as passed to `call`, or resolved against the client's `baseURL` when `resolveBaseURL` is enabled. */
    url: string;
    params: unknown;
    paramsSerialized: string;
    /**
     * Backward-compatible British spelling of `paramsSerialized`.
     *
     * @deprecated Use `paramsSerialized` instead; to be removed in a future major release.
     */
    paramsSerialised: string;
}

/**
 * Configuration options for a {@link RequestManager} instance.
 */
export interface RequestManagerOptions {
    /**
     * When enabled, relative URLs are resolved against the client's `baseURL` before keying,
     * so the same logical resource de-duplicates whether callers address it relatively or
     * absolutely. Disabled by default to preserve historical exact-string keying.
     */
    resolveBaseURL?: boolean;
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
    private readonly resolveBaseURL: boolean;
    /**
     * Creates an isolated manager.
     *
     * @param {RequestManagerOptions} [options] - Optional instance configuration.
     */
    constructor(options: RequestManagerOptions = {}) {
        this.resolveBaseURL = options.resolveBaseURL === true;
    }

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
     * When constructed with `resolveBaseURL`, relative URLs are resolved against the client's `baseURL` for keying.
     * Request bodies and other config fields (headers, timeout, signal, etc.) are not part of the key.
     * If `onSuccess` returns a non-`undefined` value, that value becomes the resolved result.
     *
     * @param {AxiosInstance} client - Axios client used to execute the request.
     * @param {Method} method - HTTP method.
     * @param {string} url - Target request URL.
     * @param {any} [data] - Optional request payload.
     * @param {AxiosRequestConfig|null} [config] - Optional Axios request configuration.
     * @param {((result: AxiosResponse<TResponse>) => MaybePromise<TSuccess | undefined>) | null} [onSuccess] -
     *     Optional callback invoked on success. Returning a value overrides the resolved response.
     * @param {((error: unknown) => void) | null} [onError] - Optional callback for request failures only.
     *     If it throws, the original request error is rethrown.
     * @returns {Promise<AxiosResponse<TResponse> | TSuccess | void>} - The shared promise for
     * the in-flight request.
     * @throws {TypeError} - If the client is not an Axios-like instance, the method or URL is
     * invalid, or config.params is not serializable.
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
        if (client == null || typeof client.request !== 'function') {
            return Promise.reject(new TypeError('RequestManager.call requires an Axios client instance'));
        }
        if (typeof method !== 'string' || method.length === 0) {
            return Promise.reject(new TypeError('RequestManager.call requires a non-empty HTTP method string'));
        }
        if (typeof url !== 'string') {
            return Promise.reject(new TypeError('RequestManager.call requires a URL string'));
        }
        data ??= {};
        config ??= {};
        let identity: RequestIdentity;
        try {
            identity = this.buildRequestIdentity(client, method, url, config.params);
        } catch {
            return Promise.reject(new TypeError('RequestManager.call requires serializable config.params'));
        }
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
     * @param {AxiosInstance} client - Axios client instance used for the request.
     * @param {Method} method - HTTP method.
     * @param {string} url - Request URL string as passed to `call`.
     * @param {AxiosRequestConfig['params']} params - Axios `config.params` value, if any.
     * @returns {RequestIdentity} - Identity fields used for hashing and inspection.
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
        const normalizedMethod = method.toLowerCase();
        const urlKey = this.resolveBaseURL ? this.resolveUrlAgainstBase(url, client) : url;
        const paramsSerialized = this.serializeParams(params);
        return {
            clientId,
            method: normalizedMethod,
            url: urlKey,
            params: params ?? null,
            paramsSerialized,
            paramsSerialised: paramsSerialized
        };
    }

    /**
     * Resolves a relative URL against the client's `baseURL` for keying, mirroring Axios's
     * own `buildFullPath` and `combineURLs` semantics.
     *
     * @param {string} url - Request URL string as passed to `call`.
     * @param {AxiosInstance} client - Axios client whose `defaults.baseURL` is the resolution base.
     * @returns {string} - The URL string used as the key segment.
     */
    private resolveUrlAgainstBase(url: string, client: AxiosInstance): string {
        const baseURL = client.defaults?.baseURL;
        if (typeof baseURL !== 'string' || baseURL.length === 0 || this.isAbsoluteUrl(url)) {
            return url;
        }
        return baseURL.replace(/\/+$/, '') + '/' + url.replace(/^\/+/, '');
    }

    /**
     * Determines whether a URL is absolute, matching Axios's `isAbsoluteURL` check.
     *
     * @param {string} url - URL string to test.
     * @returns {boolean} - True when `url` has a scheme or is protocol-relative.
     */
    private isAbsoluteUrl(url: string): boolean {
        return /^([a-z][a-z\d+\-.]*:)?\/\//i.test(url);
    }

    /**
     * Hashes a request identity into a fixed-length map key.
     *
     * @param {RequestIdentity} identity - Stable request identity.
     * @returns {string} - Lowercase hex SHA-256 digest of the identity string.
     */
    private hashIdentity(identity: RequestIdentity): string {
        const material = `${identity.clientId}:${identity.method}:${identity.url}:${identity.paramsSerialized}`;
        return sha256Hex(material);
    }

    /**
     * Serializes query params into a deterministic string for request keys.
     *
     * @param {AxiosRequestConfig['params']} params - Axios params value (`undefined`, plain object, array, or `URLSearchParams`).
     * @returns {string} - A stable serialization, or an empty string when params are absent.
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
     * JSON-like serialization with sorted object keys so param order does not affect identity.
     *
     * @param {unknown} value - Value to serialize.
     * @returns {string} - Deterministic string form of `value`.
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
