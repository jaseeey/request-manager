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
     * A Map to store active requests, with each key being a combination of client instance, URL, and HTTP method and
     * its corresponding value being the Promise of the ongoing HTTP request.
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
     * Requests are de-duplicated only when they target the same client instance, method, and URL.
     * If `onSuccess` returns a non-`undefined` value, that value becomes the resolved result.
     *
     * @param client Axios client used to execute the request.
     * @param method HTTP method.
     * @param url Target request URL.
     * @param data Optional request payload.
     * @param config Optional Axios request configuration.
     * @param onSuccess Optional callback invoked on success. Returning a value overrides the resolved response.
     * @param onError Optional callback invoked on error. If provided, the promise resolves to `void` after handling.
     */
    async call<TResponse = T, TSuccess = never>(
        client: AxiosInstance,
        method: Method,
        url: string,
        data: any = {},
        config: AxiosRequestConfig | null = {},
        onSuccess?: ((result: AxiosResponse<TResponse>) => MaybePromise<TSuccess | undefined>) | null,
        onError?: ((error: unknown) => void) | null
    ): Promise<AxiosResponse<TResponse> | TSuccess | void> {
        data ??= {};
        config ??= {};
        const key = this.buildRequestKey(client, method, url);
        if (this.activeRequests.has(key)) {
            return this.activeRequests.get(key)!.processed as Promise<AxiosResponse<TResponse> | TSuccess | void>;
        }
        const processRequest = async (
            responsePromise: Promise<AxiosResponse<TResponse>>
        ): Promise<AxiosResponse<TResponse> | TSuccess | void> => {
            try {
                const requestResult: AxiosResponse<TResponse> = await responsePromise;
                const callbackResult = onSuccess && typeof onSuccess === 'function'
                    ? await onSuccess(requestResult)
                    : undefined;
                return callbackResult !== undefined
                    ? callbackResult
                    : requestResult;
            }
            catch (err) {
                if (onError && typeof onError === 'function') {
                    onError(err);
                    return;
                }
                throw err;
            }
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
     */
    private buildRequestKey(client: AxiosInstance, method: Method, url: string): RequestKey {
        let clientId = this.clientIds.get(client);
        if (!clientId) {
            clientId = this.nextClientId++;
            this.clientIds.set(client, clientId);
        }
        return `${clientId}:${method.toLowerCase()}:${url}`;
    }
}

const requestManager = new RequestManager();

export default requestManager;
