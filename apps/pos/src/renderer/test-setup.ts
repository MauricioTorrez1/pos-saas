import { configure } from '@testing-library/react';

// Waiting for what the screen shows costs nothing when it shows up at once, and a runner under load needs more than the
// 1000 ms that Testing Library gives by default. The same 5000 ms that Playwright waits in the end-to-end tests.
configure({ asyncUtilTimeout: 5000 });
