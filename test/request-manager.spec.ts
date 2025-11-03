import requestManager, { RequestManager } from '../src/request-manager';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { AxiosInstance, AxiosRequestConfig, AxiosResponse, Method } from 'axios';

describe('RequestManager', () => {

    let mockClient: jest.Mocked<AxiosInstance>;

    const mockURL1 = 'https://example.com';
    const mockURL2 = 'https://example2.com';
    const mockResponse1 = { data: 'response' };
    const mockResponse2 = { data: 'response2' };

    beforeEach(() => {
        const mockRequests = new Map([
            [ mockURL1, mockResponse1 ],
            [ mockURL2, mockResponse2 ]
        ]);
        mockClient = {
            request: jest.fn((config: AxiosRequestConfig) => {
                const url = config.url;
                if (url && mockRequests.has(url)) {
                    return Promise.resolve(mockRequests.get(url));
                }
                return Promise.reject(new Error('Mock URL not registered'));
            }) as jest.MockedFunction<(config: AxiosRequestConfig) => Promise<AxiosResponse>>,
        } as jest.Mocked<AxiosInstance>;
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
        expect(mockClient.request).toHaveBeenCalledTimes(1);
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
        expect(mockClient.request).toHaveBeenCalledTimes(2);
    });

    test('calls onSuccess callback on successful request', async () => {
        const onSuccessCb = jest.fn();
        await requestManager.call(mockClient, 'GET', mockURL1, null, null, onSuccessCb);
        expect(onSuccessCb).toHaveBeenCalledWith(mockResponse1);
    });

    test('calls onError callback on request failure', async () => {
        const error = new Error('Request failed');
        mockClient.request.mockRejectedValueOnce(error);
        const onErrorCb = jest.fn();
        await requestManager.call(mockClient, 'GET', mockURL1, null, null, null, onErrorCb);
        expect(onErrorCb).toHaveBeenCalledWith(error);
    });

    test('returns the response when no callbacks are provided', async () => {
        const result = await requestManager.call(mockClient, 'GET', mockURL1);
        expect(result).toBe(mockResponse1);
    });

    test('throws an error when the request fails and no onError callback is provided', async () => {
        const error = new Error('Request failed');
        mockClient.request.mockRejectedValueOnce(error);
        await expect(requestManager.call(mockClient, 'GET', mockURL1)).rejects.toThrow(error);
    });

    test('allows a new request after the previous one completes', async () => {
        await requestManager.call(mockClient, 'GET', mockURL1);
        mockClient.request.mockClear();
        await requestManager.call(mockClient, 'GET', mockURL1);
        expect(mockClient.request).toHaveBeenCalledTimes(1);
    });

    test('handles requests with case-insensitive method', async () => {
        const [ firstResponse, secondResponse ] = await Promise.all([
            requestManager.call(mockClient, <Method>'gET', mockURL1),
            requestManager.call(mockClient, <Method>'gEt', mockURL1)
        ]);
        expect(firstResponse).toBe(mockResponse1);
        expect(secondResponse).toBe(secondResponse);
        expect(mockClient.request).toHaveBeenCalledTimes(1);
    });

    test('passes request data to the axios client', async () => {
        const requestData = { key: 'value' };
        await requestManager.call(mockClient, 'POST', mockURL1, requestData);
        expect(mockClient.request).toHaveBeenCalledWith(
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
        expect(mockClient.request).toHaveBeenCalledWith(
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
        const onSuccessCb = jest.fn().mockReturnValue(callbackResult);
        const result = await requestManager.call(mockClient, 'GET', mockURL1, {}, {}, onSuccessCb);
        expect(result).toBe(callbackResult);
    });

    test('handles multiple concurrent requests with different methods to same URL', async () => {
        const [ getResponse, postResponse ] = await Promise.all([
            requestManager.call(mockClient, 'GET', mockURL1),
            requestManager.call(mockClient, 'POST', mockURL1)
        ]);
        expect(mockClient.request).toHaveBeenCalledTimes(2);
        expect(getResponse).toBe(mockResponse1);
        expect(postResponse).toBe(mockResponse1);
    });

    test('handles data and config parameters together', async () => {
        const requestData = { id: 123 };
        const axiosConfig: AxiosRequestConfig = { timeout: 3000 };
        await requestManager.call(mockClient, 'PUT', mockURL1, requestData, axiosConfig);
        expect(mockClient.request).toHaveBeenCalledWith(
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
        mockClient.request.mockRejectedValueOnce(error);
        const onSuccessCb = jest.fn();
        const onErrorCb = jest.fn();
        await requestManager.call(mockClient, 'GET', mockURL1, {}, {}, onSuccessCb, onErrorCb);
        expect(onSuccessCb).not.toHaveBeenCalled();
        expect(onErrorCb).toHaveBeenCalledWith(error);
    });

    test('handles onError callback without throwing', async () => {
        const error = new Error('Request failed');
        mockClient.request.mockRejectedValueOnce(error);
        const onErrorCb = jest.fn();
        const result = await requestManager.call(mockClient, 'GET', mockURL1, {}, {}, null, onErrorCb);
        expect(result).toBeUndefined();
        expect(onErrorCb).toHaveBeenCalledWith(error);
    });

    test('removes request from activeRequests after error', async () => {
        const error = new Error('Request failed');
        mockClient.request.mockRejectedValueOnce(error);
        const onErrorCb = jest.fn();
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
                jest.fn(),
                jest.fn()
            ),
            requestManager.call(
                mockClient,
                'GET',
                mockURL1,
                {},
                {},
                jest.fn(),
                jest.fn()
            )
        ]);
        expect(mockClient.request).toHaveBeenCalledTimes(1);
        expect(firstResponse).toBe(secondResponse);
    });
});
