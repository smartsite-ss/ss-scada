// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

// Mock date/time (for time-related tests)
beforeAll(() => {
  jest.useFakeTimers();
});

afterAll(() => {
  jest.useRealTimers();
});

// Global error handling
process.on('unhandledRejection', (error) => {
  fail(`Unhandled Promise Rejection: ${error}`);
});
