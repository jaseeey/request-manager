import { AxiosInstance, AxiosRequestConfig, AxiosResponse, Method } from 'axios';

type RequestKey = string;
type MaybePromise<T> = T | Promise<T>;

interface RequestPromise {
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
     * A Map to store active requests, with each key being a combination of client instance, URL, HTTP method, and
     * serialised query params, and its corresponding value being the Promise of the ongoing HTTP request.
     */
    activeRequests: Map<RequestKey, RequestPromise> = new Map();
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
        const key = this.buildRequestKey(client, method, url, config.params);
        if (this.activeRequests.has(key)) {
            return this.activeRequests.get(key)!.processed as Promise<AxiosResponse<TResponse> | TSuccess | void>;
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
            this.activeRequests.delete(key);
        });
        const processedPromise = processRequest(requestPromise);
        this.activeRequests.set(key, { original: requestPromise, processed: processedPromise });
        return processedPromise;
    }

    /**
     * Creates a stable in-memory key for de-duplication within this manager instance.
     *
     * @param client Axios client instance used for the request.
     * @param method HTTP method.
     * @param url Request URL string as passed to `call`.
     * @param params Axios `config.params` value, if any.
     * @returns A stable key string for the active-request map.
     */
    private buildRequestKey(
        client: AxiosInstance,
        method: Method,
        url: string,
        params: AxiosRequestConfig['params']
    ): RequestKey {
        let clientId = this.clientIds.get(client);
        if (!clientId) {
            clientId = this.nextClientId++;
            this.clientIds.set(client, clientId);
        }
        return `${clientId}:${method.toLowerCase()}:${url}:${this.serializeParams(params)}`;
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
