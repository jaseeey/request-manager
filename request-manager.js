/**
 * RequestManager
 *
 * Manages and regulates HTTP requests to ensure that multiple requests to the same URL and method are not made
 * concurrently. When a request to a specific URL and method is in progress, subsequent requests to the same URL and
 * method will return the same promise, preventing duplicate requests.
 */
class RequestManager {

    /**
     * A Map to store active requests, with each key being a combination of URL and HTTP method and its corresponding
     * value being the Promise of the ongoing HTTP request.
     *
     * @type {Map<string, Promise>}
     */
    activeRequests = new Map();

    /**
     * Executes or retrieves an ongoing HTTP request based on the provided URL, method, payload, and configuration. It
     * de-duplicates requests to the same URL with the same method by returning a previously stored promise if available.
     * Upon completion of the request, it optionally invokes an onSuccess callback if the request is successful, or an
     * onFailure callback if the request fails.
     *
     * @param {AxiosInstance} client
     * @param {string} method
     * @param {string} url
     * @param {Object|null} [data=null]
     * @param {Object|null} [config=null]
     * @param {Function|null} [onSuccess=null]
     * @param {Function|null} [onError=null]
     * @returns {Promise}
     */
    async call(client, method, url, data = null, config = null, onSuccess = null, onError = null) {
        data ??= {};
        config ??= {};
        const key = `${method.toLowerCase()}:${url}`;
        if (this.activeRequests.has(key)) {
            return this.activeRequests.get(key).processed;
        }
        const processRequest = async (responsePromise) => {
            try {
                const requestResult = await responsePromise;
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
        const requestPromise = client.request({ ...config, method, url, data }).finally(() => {
            this.activeRequests.delete(key);
        });
        const processedPromise = processRequest(requestPromise);
        this.activeRequests.set(key, { original: requestPromise, processed: processedPromise });
        return processedPromise;
    }
}

export default new RequestManager();
