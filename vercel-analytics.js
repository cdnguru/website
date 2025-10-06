const DEFAULT_SCRIPT_URL = '/_vercel/insights/script.js';
const SCRIPT_ID = 'vercel-analytics-script';
const INLINE_SNIPPET_ID = 'vercel-analytics-inline';

const ensureInlineSnippet = () => {
  if (typeof document === 'undefined') return false;
  if (document.getElementById(INLINE_SNIPPET_ID)) {
    return false;
  }

  const inline = document.createElement('script');
  inline.id = INLINE_SNIPPET_ID;
  inline.type = 'text/javascript';
  inline.text =
    'window.va = window.va || function() { (window.vaq = window.vaq || []).push(arguments); };';
  document.head.appendChild(inline);
  return true;
};

const ensureExternalScript = (scriptUrl = DEFAULT_SCRIPT_URL) => {
  if (typeof document === 'undefined') return false;
  const existing = document.getElementById(SCRIPT_ID);
  if (existing) {
    if (!existing.hasAttribute('data-script-url')) {
      existing.setAttribute('data-script-url', existing.src || scriptUrl);
    }
    return false;
  }

  const script = document.createElement('script');
  script.id = SCRIPT_ID;
  script.defer = true;
  script.src = scriptUrl;
  script.setAttribute('data-script-url', scriptUrl);
  script.setAttribute('data-analytics', 'vercel-insights');
  document.head.appendChild(script);
  return true;
};

export function Analytics(options = {}) {
  const { scriptUrl = DEFAULT_SCRIPT_URL } = options ?? {};
  const insertedExternal = ensureExternalScript(scriptUrl);
  const insertedInline = ensureInlineSnippet();
  return insertedExternal || insertedInline;
}

export default Analytics;
