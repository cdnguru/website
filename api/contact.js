const https = require('https');

const RESEND_API_URL = 'https://api.resend.com/emails';
const MAX_BODY_LENGTH = 1024 * 1024; // 1MB safety limit

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const formatMultilineHtml = (value) => escapeHtml(value).replace(/\r?\n/g, '<br />');

const parseRequestBody = async (req) => {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  if (req.body && typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      throw new Error('Invalid JSON payload');
    }
  }

  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');

    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY_LENGTH) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('Invalid JSON payload'));
      }
    });

    req.on('error', (error) => {
      reject(error);
    });
  });
};

const sendEmail = (payload, apiKey) =>
  new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request(
      RESEND_API_URL,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (response) => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          responseBody += chunk;
        });
        response.on('end', () => {
          let parsed = null;
          if (responseBody) {
            try {
              parsed = JSON.parse(responseBody);
            } catch (error) {
              parsed = { message: responseBody };
            }
          }

          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            resolve(parsed);
            return;
          }

          const error = new Error(parsed && parsed.message ? parsed.message : 'Email service returned an error');
          error.status = response.statusCode || 502;
          error.response = parsed;
          reject(error);
        });
      }
    );

    request.on('error', (error) => {
      reject(error);
    });

    request.write(body);
    request.end();
  });

const sendJson = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
};

module.exports = async (req, res) => {
  const allowOrigin = process.env.CONTACT_ALLOW_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST,OPTIONS');
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  let body;
  try {
    body = await parseRequestBody(req);
  } catch (error) {
    console.error('Failed to parse contact form payload', error);
    sendJson(res, 400, { error: 'Invalid request payload.' });
    return;
  }

  const rawName = typeof body.name === 'string' ? body.name.trim() : '';
  const rawEmail = typeof body.email === 'string' ? body.email.trim() : '';
  const rawCompany = typeof body.company === 'string' ? body.company.trim() : '';
  const rawWebsite = typeof body.website === 'string' ? body.website.trim() : '';
  const rawMessage = typeof body.message === 'string' ? body.message.trim() : '';

  if (!rawName || !rawEmail) {
    sendJson(res, 400, { error: 'Name and email are required.' });
    return;
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(rawEmail)) {
    sendJson(res, 400, { error: 'Please provide a valid email address.' });
    return;
  }

  const serviceValues = Array.isArray(body.services)
    ? body.services
    : typeof body.services === 'string'
      ? [body.services]
      : [];

  const sanitizedServices = serviceValues
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0);

  const apiKey = process.env.RESEND_API_KEY;
  const recipient = process.env.CONTACT_RECIPIENT;
  const sender = process.env.CONTACT_SENDER || 'CDNguru <no-reply@cdnguru.com>';

  if (!apiKey || !recipient) {
    console.error('Contact form email configuration is missing');
    sendJson(res, 500, { error: 'Email service is not configured.' });
    return;
  }

  const subject = `New contact request from ${rawName}`;
  const plainTextSections = [
    `Name: ${rawName}`,
    `Email: ${rawEmail}`,
    `Company: ${rawCompany || 'N/A'}`,
    `Website: ${rawWebsite || 'N/A'}`,
    `Services: ${sanitizedServices.length > 0 ? sanitizedServices.join(', ') : 'Not specified'}`,
    '',
    rawMessage || 'No additional comments provided.'
  ];

  const htmlSections = [
    `<p><strong>Name:</strong> ${escapeHtml(rawName)}</p>`,
    `<p><strong>Email:</strong> ${escapeHtml(rawEmail)}</p>`,
    `<p><strong>Company:</strong> ${escapeHtml(rawCompany || 'N/A')}</p>`,
    `<p><strong>Website:</strong> ${escapeHtml(rawWebsite || 'N/A')}</p>`,
    `<p><strong>Services:</strong> ${escapeHtml(
      sanitizedServices.length > 0 ? sanitizedServices.join(', ') : 'Not specified'
    )}</p>`,
    rawMessage
      ? `<p><strong>Comments:</strong><br />${formatMultilineHtml(rawMessage)}</p>`
      : '<p><strong>Comments:</strong> No additional comments provided.</p>'
  ];

  const emailPayload = {
    from: sender,
    to: [recipient],
    reply_to: rawEmail,
    subject,
    text: plainTextSections.join('\n'),
    html: htmlSections.join('\n')
  };

  try {
    await sendEmail(emailPayload, apiKey);
    sendJson(res, 200, { success: true });
  } catch (error) {
    console.error('Failed to send contact form email', error);
    const statusCode = typeof error.status === 'number' && error.status >= 400 ? error.status : 502;
    sendJson(res, statusCode, { error: 'Unable to deliver your request. Please try again later.' });
  }
};
