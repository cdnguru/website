const EDGE_VENDOR_TARGETS = new Map([
  ['cloudflare', 'https://www.cloudflare.com/'],
  ['akamai', 'https://www.akamai.com/'],
  ['fastly', 'https://www.fastly.com/'],
  ['aws-amazon', 'https://aws.amazon.com/']
]);

const MEASUREMENT_TIMEOUT = 12000;

const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const attemptMeasurement = async (targetUrl, mode) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MEASUREMENT_TIMEOUT);

  try {
    const start = performance.now();
    const response = await fetch(targetUrl, {
      cache: 'no-store',
      mode,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    const latency = performance.now() - start;

    if (mode === 'cors' && !response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return { latency };
  } finally {
    clearTimeout(timeoutId);
  }
};

const handleMeasurementRequest = async (url) => {
  const vendorId = url.searchParams.get('id');
  if (!vendorId || !EDGE_VENDOR_TARGETS.has(vendorId)) {
    return jsonResponse(400, { error: 'Unknown vendor id' });
  }

  const targetUrl = EDGE_VENDOR_TARGETS.get(vendorId);

  try {
    const { latency } = await attemptMeasurement(targetUrl, 'cors');
    return jsonResponse(200, { latency, mode: 'cors' });
  } catch (error) {
    console.warn(`Edge Pulse worker CORS attempt failed for ${vendorId}`, error);
  }

  try {
    const { latency } = await attemptMeasurement(targetUrl, 'no-cors');
    return jsonResponse(200, { latency, mode: 'no-cors' });
  } catch (error) {
    console.error(`Edge Pulse worker measurement failed for ${vendorId}`, error);
    return jsonResponse(504, { error: 'Measurement failed' });
  }
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method === 'OPTIONS') {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store'
    };
    event.respondWith(new Response(null, { status: 204, headers }));
    return;
  }

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname === '/edge-pulse/measure') {
    event.respondWith(handleMeasurementRequest(url));
  }
});
