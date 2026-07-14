import axios, {
    AxiosError,
    AxiosInstance,
    AxiosRequestConfig,
    AxiosResponse,
    InternalAxiosRequestConfig,
    Method
} from 'axios';
import { afterEach, beforeEach, describe, expect, type MockInstance, test, vi } from 'vitest';
import requestManager, { RequestManager } from '../src/request-manager';

describe('RequestManager', () => {

    let mockClient: AxiosInstance;
    let requestSpy: MockInstance<AxiosInstance['request']>;

    const mockURL1 = 'https://example.com';
    const mockURL2 = 'https://example2.com';
    const createMockResponse = (data: string): AxiosResponse<string> => ({
        data,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: { headers: {} } as InternalAxiosRequestConfig
    });
    const mockResponse1 = createMockResponse('response');
    const mockResponse2 = createMockResponse('response2');

    beforeEach(() => {
        const mockRequests = new Map<string, AxiosResponse<string>>([
            [ mockURL1, mockResponse1 ],
            [ mockURL2, mockResponse2 ]
        ]);
        mockClient = axios.create();
        requestSpy = vi.spyOn(mockClient, 'request').mockImplementation(
            <T = any, R = AxiosResponse<T>, D = any>(config: AxiosRequestConfig<D>): Promise<R> => {
                const url = config.url;
                if (url) {
                    const response = mockRequests.get(url);
                    if (response) {
                        return Promise.resolve(response as unknown as R);
                    }
                }
                return Promise.reject(new AxiosError('Mock URL not registered'));
            }
        );
    });

    afterEach(() => {
        requestManager.activeRequests.clear();
    });

    describe('call', () => {

        test('prevents duplicate simultaneous requests', async () => {
            const [ firstResponse, secondResponse, thirdResponse ] = await Promise.all([
                requestManager.call(mockClient, 'GET', mockURL1),
                requestManager.call(mockClient, 'GET', mockURL1),
                requestManager.call(mockClient, 'GET', mockURL1)
            ]);
            expect(requestSpy).toHaveBeenCalledTimes(1);
            expect(firstResponse).toBe(secondResponse);
            expect(firstResponse).toBe(thirdResponse);
            expect(requestManager.activeRequests.size).toBe(0);
        });

        test('returns the same promise instance for concurrent joiners', async () => {
            let resolveRequest!: (value: AxiosResponse<string>) => void;
            requestSpy.mockImplementationOnce(
                () => new Promise<AxiosResponse<string>>(resolve => {
                    resolveRequest = resolve;
                })
            );
            const firstPromise = requestManager.call(mockClient, 'GET', mockURL1);
            const secondPromise = requestManager.call(mockClient, 'GET', mockURL1);
            expect(firstPromise).toBe(secondPromise);
            expect(requestSpy).toHaveBeenCalledTimes(1);
            resolveRequest(mockResponse1);
            await expect(firstPromise).resolves.toBe(mockResponse1);
        });

        test('handles different URLs independently', async () => {
            const [ firstResponse, secondResponse, thirdResponse ] = await Promise.all([
                requestManager.call(mockClient, 'GET', mockURL1),
                requestManager.call(mockClient, 'GET', mockURL2),
                requestManager.call(mockClient, 'GET', mockURL2)
            ]);
            expect(firstResponse).toBe(mockResponse1);
            expect(secondResponse).toBe(mockResponse2);
            expect(secondResponse).toBe(thirdResponse);
            expect(requestSpy).toHaveBeenCalledTimes(2);
        });

        test('does not deduplicate identical requests across different clients', async () => {
            const secondClient = axios.create();
            const secondResponse = createMockResponse('response-from-second-client');
            const secondSpy = vi.spyOn(secondClient, 'request').mockImplementation(
                <T = any, R = AxiosResponse<T>, D = any>(_config: AxiosRequestConfig<D>): Promise<R> => {
                    return Promise.resolve(secondResponse as unknown as R);
                }
            );
            const [ firstResponse, secondClientResponse ] = await Promise.all([
                requestManager.call(mockClient, 'GET', mockURL1),
                requestManager.call(secondClient, 'GET', mockURL1)
            ]);
            expect(requestSpy).toHaveBeenCalledTimes(1);
            expect(secondSpy).toHaveBeenCalledTimes(1);
            expect(firstResponse).toBe(mockResponse1);
            expect(secondClientResponse).toBe(secondResponse);
        });

        test('does not deduplicate different methods to the same URL', async () => {
            const [ getResponse, postResponse ] = await Promise.all([
                requestManager.call(mockClient, 'GET', mockURL1),
                requestManager.call(mockClient, 'POST', mockURL1)
            ]);
            expect(requestSpy).toHaveBeenCalledTimes(2);
            expect(getResponse).toBe(mockResponse1);
            expect(postResponse).toBe(mockResponse1);
        });

        test('treats method matching as case-insensitive', async () => {
            const [ firstResponse, secondResponse ] = await Promise.all([
                requestManager.call(mockClient, 'gET' as Method, mockURL1),
                requestManager.call(mockClient, 'gEt' as Method, mockURL1)
            ]);
            expect(firstResponse).toBe(mockResponse1);
            expect(secondResponse).toBe(mockResponse1);
            expect(requestSpy).toHaveBeenCalledTimes(1);
        });

        test('treats different URL strings as different keys', async () => {
            const relativePath = '/users/me';
            const absoluteUrl = 'https://api.example.com/users/me';
            requestSpy.mockImplementation(
                <T = any, R = AxiosResponse<T>, D = any>(config: AxiosRequestConfig<D>): Promise<R> => {
                    return Promise.resolve(createMockResponse(String(config.url)) as unknown as R);
                }
            );
            const [ relativeResponse, absoluteResponse ] = await Promise.all([
                requestManager.call(mockClient, 'GET', relativePath),
                requestManager.call(mockClient, 'GET', absoluteUrl)
            ]);
            expect(requestSpy).toHaveBeenCalledTimes(2);
            expect(relativeResponse).toEqual(createMockResponse(relativePath));
            expect(absoluteResponse).toEqual(createMockResponse(absoluteUrl));
        });

        test('deduplicates concurrent requests with different bodies on the same key', async () => {
            const [ firstResponse, secondResponse ] = await Promise.all([
                requestManager.call(mockClient, 'POST', mockURL1, { id: 1 }),
                requestManager.call(mockClient, 'POST', mockURL1, { id: 2 })
            ]);
            expect(requestSpy).toHaveBeenCalledTimes(1);
            expect(requestSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'POST',
                    url: mockURL1,
                    data: { id: 1 }
                })
            );
            expect(firstResponse).toBe(secondResponse);
        });

        test('deduplicates concurrent requests with different config.params on the same URL', async () => {
            const [ firstResponse, secondResponse ] = await Promise.all([
                requestManager.call(mockClient, 'GET', mockURL1, {}, { params: { id: 1 } }),
                requestManager.call(mockClient, 'GET', mockURL1, {}, { params: { id: 2 } })
            ]);
            expect(requestSpy).toHaveBeenCalledTimes(1);
            expect(firstResponse).toBe(secondResponse);
        });

        test('allows a new request after the previous one completes', async () => {
            await requestManager.call(mockClient, 'GET', mockURL1);
            requestSpy.mockClear();
            await requestManager.call(mockClient, 'GET', mockURL1);
            expect(requestSpy).toHaveBeenCalledTimes(1);
        });

        test('passes request data to the axios client', async () => {
            const requestData = { key: 'value' };
            await requestManager.call(mockClient, 'POST', mockURL1, requestData);
            expect(requestSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'POST',
                    url: mockURL1,
                    data: requestData
                })
            );
        });

        test('passes axios config to the request', async () => {
            const axiosConfig: AxiosRequestConfig = { timeout: 5000, headers: { 'X-Custom': 'header' } };
            await requestManager.call(mockClient, 'GET', mockURL1, {}, axiosConfig);
            expect(requestSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'GET',
                    url: mockURL1,
                    timeout: 5000,
                    headers: { 'X-Custom': 'header' }
                })
            );
        });

        test('handles data and config parameters together', async () => {
            const requestData = { id: 123 };
            const axiosConfig: AxiosRequestConfig = { timeout: 3000 };
            await requestManager.call(mockClient, 'PUT', mockURL1, requestData, axiosConfig);
            expect(requestSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'PUT',
                    url: mockURL1,
                    data: requestData,
                    timeout: 3000
                })
            );
        });

        test('coerces null data and config to empty objects', async () => {
            await requestManager.call(mockClient, 'GET', mockURL1, null, null);
            expect(requestSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    method: 'GET',
                    url: mockURL1,
                    data: {}
                })
            );
        });

        test('returns the response when no callbacks are provided', async () => {
            const result = await requestManager.call(mockClient, 'GET', mockURL1);
            expect(result).toBe(mockResponse1);
        });

        test('calls onSuccess on successful request', async () => {
            const onSuccessCb = vi.fn();
            await requestManager.call(mockClient, 'GET', mockURL1, null, null, onSuccessCb);
            expect(onSuccessCb).toHaveBeenCalledWith(mockResponse1);
        });

        test('returns onSuccess result when it is defined', async () => {
            const callbackResult = { custom: 'result' };
            const onSuccessCb = vi.fn().mockReturnValue(callbackResult);
            const result = await requestManager.call(mockClient, 'GET', mockURL1, {}, {}, onSuccessCb);
            expect(result).toBe(callbackResult);
        });

        test('keeps AxiosResponse when onSuccess returns undefined', async () => {
            const onSuccessCb = vi.fn().mockReturnValue(undefined);
            const result = await requestManager.call(mockClient, 'GET', mockURL1, {}, {}, onSuccessCb);
            expect(onSuccessCb).toHaveBeenCalledWith(mockResponse1);
            expect(result).toBe(mockResponse1);
        });

        test('awaits async onSuccess results', async () => {
            const callbackResult = { async: true };
            const onSuccessCb = vi.fn().mockResolvedValue(callbackResult);
            const result = await requestManager.call(mockClient, 'GET', mockURL1, {}, {}, onSuccessCb);
            expect(result).toBe(callbackResult);
        });

        test('uses only the first caller callbacks for a joined in-flight request', async () => {
            let resolveRequest!: (value: AxiosResponse<string>) => void;
            requestSpy.mockImplementationOnce(
                () => new Promise<AxiosResponse<string>>(resolve => {
                    resolveRequest = resolve;
                })
            );
            const firstOnSuccess = vi.fn().mockReturnValue('first');
            const secondOnSuccess = vi.fn().mockReturnValue('second');
            const firstPromise = requestManager.call(
                mockClient,
                'GET',
                mockURL1,
                {},
                {},
                firstOnSuccess
            );
            const secondPromise = requestManager.call(
                mockClient,
                'GET',
                mockURL1,
                {},
                {},
                secondOnSuccess
            );
            resolveRequest(mockResponse1);
            const [ firstResult, secondResult ] = await Promise.all([ firstPromise, secondPromise ]);
            expect(requestSpy).toHaveBeenCalledTimes(1);
            expect(firstOnSuccess).toHaveBeenCalledTimes(1);
            expect(secondOnSuccess).not.toHaveBeenCalled();
            expect(firstResult).toBe('first');
            expect(secondResult).toBe('first');
        });

        test('throws when the request fails and no onError is provided', () => {
            const error = new Error('Request failed');
            requestSpy.mockRejectedValueOnce(error);
            return expect(requestManager.call(mockClient, 'GET', mockURL1)).rejects.toThrow(error);
        });

        test('calls onError on request failure', async () => {
            const error = new Error('Request failed');
            requestSpy.mockRejectedValueOnce(error);
            const onErrorCb = vi.fn();
            await requestManager.call(mockClient, 'GET', mockURL1, null, null, null, onErrorCb);
            expect(onErrorCb).toHaveBeenCalledWith(error);
        });

        test('resolves to undefined when onError handles a failure', async () => {
            const error = new Error('Request failed');
            requestSpy.mockRejectedValueOnce(error);
            const onErrorCb = vi.fn();
            const result = await requestManager.call(mockClient, 'GET', mockURL1, {}, {}, null, onErrorCb);
            expect(result).toBeUndefined();
            expect(onErrorCb).toHaveBeenCalledWith(error);
        });

        test('does not invoke onSuccess when the request fails', async () => {
            const error = new Error('Request failed');
            requestSpy.mockRejectedValueOnce(error);
            const onSuccessCb = vi.fn();
            const onErrorCb = vi.fn();
            await requestManager.call(mockClient, 'GET', mockURL1, {}, {}, onSuccessCb, onErrorCb);
            expect(onSuccessCb).not.toHaveBeenCalled();
            expect(onErrorCb).toHaveBeenCalledWith(error);
        });

        test('removes the request from activeRequests after success', async () => {
            expect(requestManager.activeRequests.size).toBe(0);
            const pending = requestManager.call(mockClient, 'GET', mockURL1);
            expect(requestManager.activeRequests.size).toBe(1);
            await pending;
            expect(requestManager.activeRequests.size).toBe(0);
        });

        test('removes the request from activeRequests after error', async () => {
            const error = new Error('Request failed');
            requestSpy.mockRejectedValueOnce(error);
            const onErrorCb = vi.fn();
            expect(requestManager.activeRequests.size).toBe(0);
            await requestManager.call(mockClient, 'GET', mockURL1, {}, {}, null, onErrorCb);
            expect(requestManager.activeRequests.size).toBe(0);
        });

        test('deduplicates when both success and error callbacks are provided', async () => {
            const [ firstResponse, secondResponse ] = await Promise.all([
                requestManager.call(
                    mockClient,
                    'GET',
                    mockURL1,
                    {},
                    {},
                    vi.fn(),
                    vi.fn()
                ),
                requestManager.call(
                    mockClient,
                    'GET',
                    mockURL1,
                    {},
                    {},
                    vi.fn(),
                    vi.fn()
                )
            ]);
            expect(requestSpy).toHaveBeenCalledTimes(1);
            expect(firstResponse).toBe(secondResponse);
        });
    });

    describe('static call', () => {

        test('delegates to the default shared instance', async () => {
            const [ firstResponse, secondResponse ] = await Promise.all([
                RequestManager.call(mockClient, 'GET', mockURL1),
                requestManager.call(mockClient, 'GET', mockURL1)
            ]);
            expect(requestSpy).toHaveBeenCalledTimes(1);
            expect(firstResponse).toBe(secondResponse);
        });
    });

    describe('isolated instances', () => {

        test('does not share in-flight requests across manager instances', async () => {
            const firstManager = new RequestManager();
            const secondManager = new RequestManager();
            let resolveFirst!: (value: AxiosResponse<string>) => void;
            let resolveSecond!: (value: AxiosResponse<string>) => void;
            let callCount = 0;
            requestSpy.mockImplementation(
                () => {
                    callCount += 1;
                    if (callCount === 1) {
                        return new Promise<AxiosResponse<string>>(resolve => {
                            resolveFirst = resolve;
                        });
                    }
                    return new Promise<AxiosResponse<string>>(resolve => {
                        resolveSecond = resolve;
                    });
                }
            );
            const firstPromise = firstManager.call(mockClient, 'GET', mockURL1);
            const secondPromise = secondManager.call(mockClient, 'GET', mockURL1);
            expect(firstPromise).not.toBe(secondPromise);
            expect(requestSpy).toHaveBeenCalledTimes(2);
            resolveFirst(mockResponse1);
            resolveSecond(mockResponse2);
            const [ firstResult, secondResult ] = await Promise.all([ firstPromise, secondPromise ]);
            expect(firstResult).toBe(mockResponse1);
            expect(secondResult).toBe(mockResponse2);
        });
    });
});
