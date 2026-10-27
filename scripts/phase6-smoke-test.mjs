/**
 * LogiGo Phase 6 API smoke checks.
 * Uses Node's built-in fetch and does not create or modify business records.
 * Start the backend first, then run `npm run test:smoke`.
 */

const API_BASE_URL = (process.env.LOGIGO_API_BASE_URL || "http://localhost:5000/api").replace(/\/+$/, "");
const FRONTEND_ORIGIN = process.env.LOGIGO_TEST_ORIGIN || "http://localhost:5173";
const REQUEST_TIMEOUT_MS = 10_000;

const checks = [
  {
    name: "API health endpoint",
    path: "/health",
    expectedStatus: 200,
    validate: (body) => body?.success === true,
    detail: "Expected success=true.",
  },
  {
    name: "Public vehicle catalog and database connection",
    path: "/vehicles",
    expectedStatus: 200,
    validate: (body) => body?.success === true && Array.isArray(body?.vehicles),
    detail: "Expected success=true and a vehicles array. This check requires MongoDB connectivity.",
  },
  {
    name: "CORS allows the local frontend origin",
    path: "/health",
    expectedStatus: 200,
    validate: (_body, response) =>
      response.headers.get("access-control-allow-origin") === FRONTEND_ORIGIN &&
      response.headers.get("access-control-allow-credentials") === "true",
    detail: `Expected credentials-enabled CORS for ${FRONTEND_ORIGIN}. Set LOGIGO_TEST_ORIGIN if your frontend runs elsewhere.`,
  },
  {
    name: "Current-user endpoint is protected",
    path: "/auth/me",
    expectedStatus: 401,
    validate: (body) => body?.success === false,
    detail: "Unauthenticated requests must not read the current user.",
  },
  {
    name: "Customer bookings endpoint is protected",
    path: "/bookings/my",
    expectedStatus: 401,
    validate: (body) => body?.success === false,
    detail: "Unauthenticated requests must not read customer bookings.",
  },
  {
    name: "Driver jobs endpoint is protected",
    path: "/bookings/driver/jobs",
    expectedStatus: 401,
    validate: (body) => body?.success === false,
    detail: "Unauthenticated requests must not read driver jobs.",
  },
  {
    name: "Admin booking queue is protected",
    path: "/bookings/admin/queue",
    expectedStatus: 401,
    validate: (body) => body?.success === false,
    detail: "Unauthenticated requests must not read the admin booking queue.",
  },
  {
    name: "Enterprise enquiry inbox is protected",
    path: "/enterprise/admin/enquiries",
    expectedStatus: 401,
    validate: (body) => body?.success === false,
    detail: "Unauthenticated requests must not read enterprise enquiries.",
  },
];

async function request(path, init = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Origin: FRONTEND_ORIGIN,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { rawText: text.slice(0, 300) };
  }
  return { response, body };
}

let passed = 0;
let failed = 0;

console.log("\nLogiGo Phase 6 API smoke test");
console.log(`API: ${API_BASE_URL}`);
console.log(`Expected frontend origin: ${FRONTEND_ORIGIN}\n`);

for (const check of checks) {
  try {
    const { response, body } = await request(check.path);
    const statusOkay = response.status === check.expectedStatus;
    const bodyOkay = !check.validate || check.validate(body, response);
    if (statusOkay && bodyOkay) {
      passed += 1;
      console.log(`PASS  ${check.name} (${response.status})`);
    } else {
      failed += 1;
      console.error(`FAIL  ${check.name}: got HTTP ${response.status}; expected ${check.expectedStatus}. ${check.detail}`);
      if (body?.message) console.error(`      API message: ${body.message}`);
    }
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${check.name}: ${error instanceof Error ? error.message : String(error)}`);
    console.error("      Confirm the backend is running and LOGIGO_API_BASE_URL is correct.");
  }
}

// Invalid inputs are rejected by validators before database writes are attempted.
const negativeChecks = [
  {
    name: "Enterprise form rejects an empty payload before persistence",
    path: "/enterprise/enquiries",
    init: { method: "POST", body: "{}" },
    expectedStatus: 400,
  },
  {
    name: "Location autocomplete rejects an invalid search session",
    path: "/pricing/locations/suggest?q=pune&city=pune&sessionToken=invalid",
    expectedStatus: 400,
  },
  {
    name: "Location retrieve rejects an invalid search session",
    path: "/pricing/locations/retrieve?mapboxId=poi.test&city=pune&sessionToken=invalid",
    expectedStatus: 400,
  },
];

for (const check of negativeChecks) {
  try {
    const { response, body } = await request(check.path, check.init || {});
    if (response.status === check.expectedStatus && body?.success === false) {
      passed += 1;
      console.log(`PASS  ${check.name} (${response.status})`);
    } else {
      failed += 1;
      console.error(`FAIL  ${check.name}: got HTTP ${response.status}; expected ${check.expectedStatus}.`);
      if (body?.message) console.error(`      API message: ${body.message}`);
    }
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${check.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
console.log("These smoke checks do not replace authenticated multi-role, GPS, booking, dispatch, or browser tests.");
if (failed > 0) process.exitCode = 1;
