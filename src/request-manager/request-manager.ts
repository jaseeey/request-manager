import { AxiosInstance, AxiosRequestConfig, AxiosResponse, Method } from 'axios';

type RequestKey = string;

interface RequestPromise<T = any> {
    original: Promise<AxiosResponse<T, any>>;
    processed: Promise<AxiosResponse<T, any> | void>;
}

/**
 * RequestManager
 *
 * Manages and regulates HTTP requests to ensure that multiple requests to the same URL and method are not made
 * concurrently. When a request to a specific URL and method is in progress, subsequent requests to the same URL and
 * method will return the same promise, preventing duplicate requests.
 */
class RequestManager<T = any> {

    /**
     * A Map to store active requests, with each key being a combination of URL and HTTP method and its corresponding
     * value being the Promise of the ongoing HTTP request.
     */
    activeRequests: Map<RequestKey, RequestPromise<T>> = new Map();

    /**
     * Executes or retrieves an ongoing HTTP request based on the provided URL, method, payload, and configuration. It
     * de-duplicates requests to the same URL with the same method by returning a previously stored promise if available.
     * Upon completion of the request, it optionally invokes an onSuccess callback if the request is successful, or an
     * onFailure callback if the request fails.
     */
    async call(
        client: AxiosInstance,
        method: Method,
        url: string,
        data: any = {},
        config: AxiosRequestConfig | null = {},
        onSuccess?: ((result: AxiosResponse) => void) | null,
        onError?: ((error: any) => void) | null
    ): Promise<AxiosResponse | void> {
        data ??= {};
        config ??= {};
        const key = `${method.toLowerCase()}:${url}`;
        if (this.activeRequests.has(key)) {
            return this.activeRequests.get(key)!.processed;
        }
        const processRequest = async (responsePromise: Promise<AxiosResponse>): Promise<AxiosResponse | void> => {
            try {
                const requestResult: AxiosResponse = await responsePromise;
                const callbackResult = onSuccess && typeof onSuccess === 'function'
                    ? onSuccess(requestResult)
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
        const requestPromise = client.request<T>({ ...config, method, url, data }).finally(() => {
            this.activeRequests.delete(key);
        });
        const processedPromise: Promise<AxiosResponse | void> = processRequest(requestPromise);
        this.activeRequests.set(key, { original: requestPromise, processed: processedPromise });
        return processedPromise;
    }
}

export default new RequestManager();
