# RequestManager

RequestManager is a TypeScript-based library designed to manage and regulate HTTP requests efficiently. It ensures that multiple requests to the same URL with the same method are not made concurrently, thus preventing duplicate requests. When a request to a specific URL and method is in progress, subsequent requests to the same URL and method will return the same promise.

## Background and Scope

The RequestManager library was specifically written to address a particular issue encountered in my projects. It was not designed or intended to serve as a comprehensive request management solution. Instead, its primary aim is to tackle the specific challenges I faced, offering a targeted approach to prevent duplicate requests and manage HTTP calls more efficiently.

Given its focused nature, there are a set of known limitations that have been accepted, as these constraints do not affect the scenarios for which the library was developed. While the library provides a solution to the identified issues, its functionality may not cover all use cases or requirements that might be expected from a full-fledged request manager.

Users are encouraged to understand these known limitations and consider how they align with their specific needs before integrating the library into their projects.

Should you wish to extend the behaviour, or modify it for your own purposes, then you are free to do so.

## Features

- Prevents duplicate simultaneous requests to the same client instance, URL, and method.
- Supports TypeScript for improved type safety and developer experience.
- Allows for optional onSuccess and onError callbacks to handle responses.
- Generates both CommonJS (CJS) and ECMAScript Module (ESM) distributions for broad compatibility.

## Installation

To install RequestManager, use the following npm command:

```bash
npm install @jaseeey/request-manager
```

## Usage

Here's a basic example of how to use the RequestManager library:

### Recommended: Default Instance

```javascript
import requestManager from '@jaseeey/request-manager';

const client = axios.create();
const url = 'https://example.com';
const method = 'GET';

const response = await requestManager.call(client, method, url);
```

### With Callbacks and Transforming Success Result

```javascript
import requestManager from '@jaseeey/request-manager';

const client = axios.create();
const url = 'https://example.com';

const result = await requestManager.call(
    client,
    'GET',
    url,
    {},
    {},
    res => res.data, // Returning a value changes the resolved result
    err => {
        // Handle your error here
    }
);
```

### Creating Isolated Managers

```javascript
import { RequestManager } from '@jaseeey/request-manager';

const client = axios.create();
const scopedRequestManager = new RequestManager();

const response = await scopedRequestManager.call(client, 'GET', 'https://example.com');
```

### Legacy Static API (Backward Compatibility)

```javascript
import { RequestManager } from '@jaseeey/request-manager';

const response = await RequestManager.call(client, 'GET', 'https://example.com');
```

`RequestManager.call(...)` is supported for backward compatibility, but the default instance API is recommended.

## API Reference

### `requestManager.call(client, method, url, data, config, onSuccess, onError)`

- `client`: The HTTP client instance used for making requests.
- `method`: The HTTP method (e.g., 'GET', 'POST').
- `url`: The URL to which the request is sent.
- `data` (optional): The data to be sent as the request body.
- `config` (optional): The configuration options for the request.
- `onSuccess` (optional): A callback function that is called when the request is successful. Returning a non-`undefined` value from this callback changes the resolved value of the `call()` promise.
- `onError` (optional): A callback function that is called when the request fails.

`RequestManager.call(...)` is also available as a static compatibility API and delegates to the shared default instance.

## Known Limitations

### Unified Callback Execution

The RequestManager executes only the `onSuccess` or `onError` callbacks of the first request in the case of identical requests made concurrently. This design choice optimises network and computational resources but may limit individual response handling flexibility. Though, you could simply bypass the use of the callbacks and handle each response independently.

### State and Error Handling

Given that only the first set of callbacks are executed, managing state updates or performing granular error handling based on different parts of the application's needs could be challenging. This approach assumes a uniform handling strategy for success and error responses.

### Request Differentiation

The system identifies duplicate requests based on client instance, URL, and method, but still overlooks differences in headers, query parameters, or POST bodies for otherwise matching requests. Applications requiring differentiation based on those fields may need to extend the key generation logic within the RequestManager.

### Lifecycle Management

The centralised management of requests might complicate the handling of component lifecycles, such as cancelling requests when components unmount, especially in scenarios where multiple components depend on the outcome of a single request.

### Singleton Design
The RequestManager is implemented as a singleton, which inherently restricts the creation of multiple instances of the class. This design choice aligns with the library's goal to centrally manage and de-duplicate HTTP requests across the application. While this meets the requirements for which the library was developed, it may pose a limitation for scenarios where multiple, isolated request managers are needed. Users should consider this design aspect when planning to integrate the library into their applications, especially if there's a potential need for managing requests in isolated contexts.

## Contributing

Contributions to the RequestManager library are welcome. If you have suggestions or improvements, feel free to fork the repository and submit a pull request.

## License

RequestManager is released under the [MIT License](LICENSE).
