const mockServerLocationData = {
  IAD: "Ashburn",
  LAX: "Los Angeles",
  JFK: "New York",
};

const mockCdnCgiTrace = {
  ip: "192.168.1.1",
  loc: "US",
  colo: "IAD",
  ts: "1234567890.123",
};

const mockHttpsResponse = {
  headers: {
    "server-timing": "cfRequestDuration;dur=50.0",
  },
};

const mockPerformanceTiming = [
  100, // started
  110, // dnsLookup
  120, // tcpHandshake
  130, // sslHandshake
  140, // ttfb
  200, // ended
  50.0, // server processing time
];

function getCallbackIfAny(mockObj, caller) {
  const findResult = mockObj.on.mock.calls.find((call) => call[0] === caller);
  return findResult ? findResult[1] : undefined;
}

function createMockResponse(_data) {
  const mockResponse = {
    on: jest.fn(),
    once: jest.fn(),
    headers: mockHttpsResponse.headers,
  };

  // Simulate data events
  setTimeout(() => {
    const dataCallback = getCallbackIfAny(mockResponse, "data");
    if (dataCallback) dataCallback();

    const endCallback = getCallbackIfAny(mockResponse, "end");
    if (endCallback) endCallback();

    const readableCallback = getCallbackIfAny(mockResponse, "readable");
    if (readableCallback) readableCallback();
  }, 10);

  return mockResponse;
}

function createMockRequest() {
  const mockRequest = {
    on: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
  };

  // Simulate socket events
  setTimeout(() => {
    const mockSocket = {
      on: jest.fn(),
    };

    const socketCallback = getCallbackIfAny(mockRequest, "socket");
    if (socketCallback) {
      socketCallback(mockSocket);

      // Simulate socket events
      setTimeout(() => {
        const lookupCallback = getCallbackIfAny(mockRequest, "lookup");
        if (lookupCallback) lookupCallback();

        const connectCallback = getCallbackIfAny(mockRequest, "connect");
        if (connectCallback) connectCallback();

        const secureConnectCallback = getCallbackIfAny(mockRequest, "secureConnect");
        if (secureConnectCallback) secureConnectCallback();
      }, 5);
    }
  }, 5);

  return mockRequest;
}

module.exports = {
  mockServerLocationData,
  mockCdnCgiTrace,
  mockHttpsResponse,
  mockPerformanceTiming,
  createMockResponse,
  createMockRequest,
};
