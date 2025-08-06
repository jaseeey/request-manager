import { RequestManager } from '../src/request-manager';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { AxiosInstance, AxiosRequestConfig, AxiosResponse, Method } from "axios";

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
        RequestManager.activeRequests.clear();
    });

    test('prevents duplicate simultaneous requests', async () => {
        const [ firstResponse, secondResponse, thirdResponse ] = await Promise.all([
            RequestManager.call(mockClient, 'GET', mockURL1),
            RequestManager.call(mockClient, 'GET', mockURL1),
            RequestManager.call(mockClient, 'GET', mockURL1)
        ]);
        expect(mockClient.request).toHaveBeenCalledTimes(1);
        expect(firstResponse).toBe(secondResponse);
        expect(firstResponse).toBe(thirdResponse);
        expect(RequestManager.activeRequests.has(`get:${ mockURL1 }`)).toBeFalsy();
    });

    test('handles different requests independently', async () => {
        const [ firstResponse, secondResponse, thirdResponse ] = await Promise.all([
            RequestManager.call(mockClient, 'GET', mockURL1),
            RequestManager.call(mockClient, 'GET', mockURL2),
            RequestManager.call(mockClient, 'GET', mockURL2)
        ])
        expect(firstResponse).toBe(mockResponse1);
        expect(secondResponse).toBe(mockResponse2);
        expect(secondResponse).toBe(thirdResponse);
        expect(mockClient.request).toHaveBeenCalledTimes(2);
    });

    test('calls onSuccess callback on successful request', async () => {
        const onSuccessCb = jest.fn();
        await RequestManager.call(mockClient, 'GET', mockURL1, null, null, onSuccessCb);
        expect(onSuccessCb).toHaveBeenCalledWith(mockResponse1);
    });

    test('calls onError callback on request failure', async () => {
        const error = new Error('Request failed');
        mockClient.request.mockRejectedValueOnce(error);
        const onErrorCb = jest.fn();
        await RequestManager.call(mockClient, 'GET', mockURL1, null, null, null, onErrorCb);
        expect(onErrorCb).toHaveBeenCalledWith(error);
    });

    test('returns the response when no callbacks are provided', async () => {
        const result = await RequestManager.call(mockClient, 'GET', mockURL1);
        expect(result).toBe(mockResponse1);
    });

    test('throws an error when the request fails and no onError callback is provided', async () => {
        const error = new Error('Request failed');
        mockClient.request.mockRejectedValueOnce(error);
        await expect(RequestManager.call(mockClient, 'GET', mockURL1)).rejects.toThrow(error);
    });

    test('allows a new request after the previous one completes', async () => {
        await RequestManager.call(mockClient, 'GET', mockURL1);
        mockClient.request.mockClear();
        await RequestManager.call(mockClient, 'GET', mockURL1);
        expect(mockClient.request).toHaveBeenCalledTimes(1);
    });

    test('handles requests with case-insensitive method', async () => {
        const [ firstResponse, secondResponse ] = await Promise.all([
            RequestManager.call(mockClient, <Method>'gET', mockURL1),
            RequestManager.call(mockClient, <Method>'gEt', mockURL1)
        ])
        expect(firstResponse).toBe(mockResponse1);
        expect(secondResponse).toBe(secondResponse);
        expect(mockClient.request).toHaveBeenCalledTimes(1);
    });
});
