import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig, Method } from 'axios';
import { afterEach, beforeEach, describe, expect, type MockInstance, test, vi } from 'vitest';
import requestManager from '../src/request-manager';

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

    test('prevents duplicate simultaneous requests', async () => {
        const [ firstResponse, secondResponse, thirdResponse ] = await Promise.all([
            requestManager.call(mockClient, 'GET', mockURL1),
            requestManager.call(mockClient, 'GET', mockURL1),
            requestManager.call(mockClient, 'GET', mockURL1)
        ]);
        expect(requestSpy).toHaveBeenCalledTimes(1);
        expect(firstResponse).toBe(secondResponse);
        expect(firstResponse).toBe(thirdResponse);
        expect(requestManager.activeRequests.has(`get:${ mockURL1 }`)).toBeFalsy();
    });

    test('handles different requests independently', async () => {
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

    test('calls onSuccess callback on successful request', async () => {
        const onSuccessCb = vi.fn();
        await requestManager.call(mockClient, 'GET', mockURL1, null, null, onSuccessCb);
        expect(onSuccessCb).toHaveBeenCalledWith(mockResponse1);
    });

    test('calls onError callback on request failure', async () => {
        const error = new Error('Request failed');
        requestSpy.mockRejectedValueOnce(error);
        const onErrorCb = vi.fn();
        await requestManager.call(mockClient, 'GET', mockURL1, null, null, null, onErrorCb);
        expect(onErrorCb).toHaveBeenCalledWith(error);
    });

    test('returns the response when no callbacks are provided', async () => {
        const result = await requestManager.call(mockClient, 'GET', mockURL1);
        expect(result).toBe(mockResponse1);
    });

    test('throws an error when the request fails and no onError callback is provided', () => {
        const error = new Error('Request failed');
        requestSpy.mockRejectedValueOnce(error);
        return expect(requestManager.call(mockClient, 'GET', mockURL1)).rejects.toThrow(error);
    });

    test('allows a new request after the previous one completes', async () => {
        await requestManager.call(mockClient, 'GET', mockURL1);
        requestSpy.mockClear();
        await requestManager.call(mockClient, 'GET', mockURL1);
        expect(requestSpy).toHaveBeenCalledTimes(1);
    });

    test('handles requests with case-insensitive method', async () => {
        const [ firstResponse, secondResponse ] = await Promise.all([
            requestManager.call(mockClient, 'gET' as Method, mockURL1),
            requestManager.call(mockClient, 'gEt' as Method, mockURL1)
        ]);
        expect(firstResponse).toBe(mockResponse1);
        expect(secondResponse).toBe(secondResponse);
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

    test('returns onSuccess callback result if defined', async () => {
        const callbackResult = { custom: 'result' };
        const onSuccessCb = vi.fn().mockReturnValue(callbackResult);
        const result = await requestManager.call(mockClient, 'GET', mockURL1, {}, {}, onSuccessCb);
        expect(result).toBe(callbackResult);
    });

    test('handles multiple concurrent requests with different methods to same URL', async () => {
        const [ getResponse, postResponse ] = await Promise.all([
            requestManager.call(mockClient, 'GET', mockURL1),
            requestManager.call(mockClient, 'POST', mockURL1)
        ]);
        expect(requestSpy).toHaveBeenCalledTimes(2);
        expect(getResponse).toBe(mockResponse1);
        expect(postResponse).toBe(mockResponse1);
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

    test('does not invoke onSuccess callback when error is thrown', async () => {
        const error = new Error('Request failed');
        requestSpy.mockRejectedValueOnce(error);
        const onSuccessCb = vi.fn();
        const onErrorCb = vi.fn();
        await requestManager.call(mockClient, 'GET', mockURL1, {}, {}, onSuccessCb, onErrorCb);
        expect(onSuccessCb).not.toHaveBeenCalled();
        expect(onErrorCb).toHaveBeenCalledWith(error);
    });

    test('handles onError callback without throwing', async () => {
        const error = new Error('Request failed');
        requestSpy.mockRejectedValueOnce(error);
        const onErrorCb = vi.fn();
        const result = await requestManager.call(mockClient, 'GET', mockURL1, {}, {}, null, onErrorCb);
        expect(result).toBeUndefined();
        expect(onErrorCb).toHaveBeenCalledWith(error);
    });

    test('removes request from activeRequests after error', async () => {
        const error = new Error('Request failed');
        requestSpy.mockRejectedValueOnce(error);
        const onErrorCb = vi.fn();
        await requestManager.call(mockClient, 'GET', mockURL1, {}, {}, null, onErrorCb);
        expect(requestManager.activeRequests.has(`get:${ mockURL1 }`)).toBeFalsy();
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
