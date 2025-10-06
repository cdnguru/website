const fetchJSON = async (path) => {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}`);
  }
  return response.json();
};

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#039;';
      default:
        return char;
    }
  });

const EDGE_VENDOR_TARGETS = [
  { id: 'cloudflare', vendor: 'Cloudflare', url: 'https://www.cloudflare.com/' },
  { id: 'akamai', vendor: 'Akamai', url: 'https://www.akamai.com/' },
  { id: 'fastly', vendor: 'Fastly', url: 'https://www.fastly.com/' },
  { id: 'aws-amazon', vendor: 'AWS Amazon', url: 'https://aws.amazon.com/' }
];

const ensureEdgePulseWorker = (() => {
  let readinessPromise;
  return () => {
    if (!('serviceWorker' in navigator)) {
      return Promise.resolve(false);
    }

    if (!readinessPromise) {
      readinessPromise = (async () => {
        try {
          await navigator.serviceWorker.register('edge-pulse-sw.js');
          const registration = await navigator.serviceWorker.ready;

          if (navigator.serviceWorker.controller) {
            return true;
          }

          const controllerReady = await new Promise((resolve) => {
            let resolved = false;
            const timeoutId = window.setTimeout(() => {
              if (!resolved) {
                resolved = true;
                navigator.serviceWorker.removeEventListener('controllerchange', handleChange);
                resolve(false);
              }
            }, 5000);

            function handleChange() {
              if (!resolved) {
                resolved = true;
                window.clearTimeout(timeoutId);
                navigator.serviceWorker.removeEventListener('controllerchange', handleChange);
                resolve(true);
              }
            }

            navigator.serviceWorker.addEventListener('controllerchange', handleChange);

            if (registration.active && navigator.serviceWorker.controller) {
              handleChange();
            }
          });

          if (controllerReady || navigator.serviceWorker.controller) {
            return true;
          }

          readinessPromise = null;
          return false;
        } catch (error) {
          console.error('Edge Pulse worker registration failed', error);
          readinessPromise = null;
          return false;
        }
      })();
    }

    return readinessPromise;
  };
})();

let ispIdentityPromise;
const fetchIspIdentity = async () => {
  if (!ispIdentityPromise) {
    ispIdentityPromise = (async () => {
      try {
        const response = await fetch('https://ipapi.co/json/');
        if (!response.ok) {
          throw new Error(`ISP lookup failed with ${response.status}`);
        }
        const data = await response.json();
        const lat = Number.parseFloat(data.latitude ?? data.lat);
        const lon = Number.parseFloat(data.longitude ?? data.lon);
        return {
          org: data.org || data.asn_org || data.network || data.isp || null,
          ip: data.ip || null,
          city: data.city || null,
          region: data.region || data.region_code || null,
          country: data.country_name || data.country || null,
          countryCode: data.country || data.country_code || null,
          latitude: Number.isFinite(lat) ? lat : null,
          longitude: Number.isFinite(lon) ? lon : null
        };
      } catch (error) {
        console.error('Unable to resolve ISP identity', error);
        return null;
      }
    })();
  }

  return ispIdentityPromise;
};

const WORLD_SVG_URL = 'https://cdn.jsdelivr.net/npm/@svg-maps/world@1.1.0/world.json';
let worldMapPromise;

const loadWorldMap = async () => {
  if (!worldMapPromise) {
    worldMapPromise = fetch(WORLD_SVG_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`World map fetch failed with ${response.status}`);
        }
        return response.json();
      })
      .catch((error) => {
        console.error('Unable to load world outline map', error);
        worldMapPromise = null;
        throw error;
      });
  }

  return worldMapPromise;
};

const renderHeroCountryShape = async ({ container, countryCode, countryName }) => {
  if (!container || !countryCode) {
    return false;
  }

  try {
    const map = await loadWorldMap();
    if (!map || !Array.isArray(map.locations)) {
      return false;
    }

    const targetCode = String(countryCode).toUpperCase();
    const location = map.locations.find((item) => String(item.id).toUpperCase() === targetCode);
    if (!location || !location.path) {
      return false;
    }

    const svgNamespace = 'http://www.w3.org/2000/svg';
    const shell = document.createElement('div');
    shell.className = 'hero__globe-shell';

    const svg = document.createElementNS(svgNamespace, 'svg');
    svg.classList.add('hero__globe-svg');
    svg.setAttribute('viewBox', map.viewBox || '0 0 2000 1001');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('role', 'presentation');
    svg.setAttribute('aria-hidden', 'true');

    const defs = document.createElementNS(svgNamespace, 'defs');
    const gradientId = 'heroCountryFill';
    const gradient = document.createElementNS(svgNamespace, 'linearGradient');
    gradient.setAttribute('id', gradientId);
    gradient.setAttribute('x1', '15%');
    gradient.setAttribute('y1', '10%');
    gradient.setAttribute('x2', '85%');
    gradient.setAttribute('y2', '90%');

    const makeStop = (offset, color, opacity) => {
      const stop = document.createElementNS(svgNamespace, 'stop');
      stop.setAttribute('offset', offset);
      stop.setAttribute('stop-color', color);
      stop.setAttribute('stop-opacity', opacity);
      return stop;
    };

    gradient.appendChild(makeStop('0%', '#5eead4', '0.95'));
    gradient.appendChild(makeStop('55%', '#38bdf8', '0.7'));
    gradient.appendChild(makeStop('100%', '#6366f1', '0.6'));
    defs.appendChild(gradient);
    svg.appendChild(defs);

    const title = document.createElementNS(svgNamespace, 'title');
    title.textContent = `Country outline for ${countryName || targetCode}`;
    svg.appendChild(title);

    const path = document.createElementNS(svgNamespace, 'path');
    path.classList.add('hero__globe-path');
    path.setAttribute('d', location.path);
    path.setAttribute('fill', `url(#${gradientId})`);
    svg.appendChild(path);

    shell.appendChild(svg);

    container.innerHTML = '';
    container.appendChild(shell);
    container.classList.add('hero__globe--active');

    return true;
  } catch (error) {
    console.error('Unable to render country outline', error);
    return false;
  }
};

const measureViaDirectFetch = async ({ vendor, url }) => {
  const fetchWithMode = async (mode) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 12000);

    try {
      const start = performance.now();
      const response = await fetch(url, {
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
      window.clearTimeout(timeoutId);
    }
  };

  try {
    const { latency } = await fetchWithMode('cors');
    return { vendor, url, latency };
  } catch (error) {
    console.warn(`Direct CORS fetch failed for ${vendor}, retrying without CORS`, error);
  }

  const { latency } = await fetchWithMode('no-cors');
  return { vendor, url, latency };
};

const measureVendorLatency = async (target) => {
  const workerReady = await ensureEdgePulseWorker();

  if (workerReady && navigator.serviceWorker.controller) {
    try {
      const params = new URLSearchParams({ id: target.id, cacheBust: Date.now().toString() });
      const response = await fetch(`/edge-pulse/measure?${params.toString()}`, {
        cache: 'no-store',
        headers: {
          Accept: 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Edge Pulse worker responded with ${response.status}`);
      }

      const payload = await response.json();

      if (!Number.isFinite(payload.latency)) {
        throw new Error('Worker returned invalid latency');
      }

      return { vendor: target.vendor, url: target.url, latency: payload.latency };
    } catch (error) {
      console.warn('Edge Pulse worker measurement failed, falling back to direct fetch', error);
    }
  }

  return measureViaDirectFetch(target);
};

const initEdgePulse = () => {
  const grid = document.getElementById('edgePulseGrid');
  const ispNode = document.getElementById('edgePulseIsp');

  if (!grid || !ispNode) return;

  const renderIdentity = (identity) => {
    if (!identity) {
      ispNode.innerHTML = '<span class="edge-pulse__chip">Network lookup unavailable.</span>';
      return;
    }

    const chips = [];
    if (identity.org) {
      chips.push(`<span class="edge-pulse__chip">Network: ${escapeHtml(identity.org)}</span>`);
    }
    const locationParts = [identity.city, identity.region, identity.country].filter(Boolean);
    if (locationParts.length) {
      chips.push(`<span class="edge-pulse__chip">Location: ${escapeHtml(locationParts.join(', '))}</span>`);
    }
    if (identity.ip) {
      chips.push(`<span class="edge-pulse__chip">IP: ${escapeHtml(identity.ip)}</span>`);
    }

    ispNode.innerHTML = chips.join('') || '<span class="edge-pulse__chip">Network lookup unavailable.</span>';
  };

  fetchIspIdentity().then(renderIdentity).catch(() => renderIdentity(null));

  const formatLatency = (value) => {
    if (!Number.isFinite(value)) {
      return { label: 'Latency unavailable', className: 'edge-card__latency edge-card__latency--unknown' };
    }

    const rounded = Math.round(value);
    const isSlow = rounded > 500;
    const className = `edge-card__latency ${isSlow ? 'edge-card__latency--slow' : 'edge-card__latency--fast'}`;
    return { label: `${rounded} ms`, className };
  };

  const renderResults = (results) => {
    if (!results.length) {
      grid.innerHTML = '';
      return;
    }

    grid.innerHTML = results
      .map(({ vendor, latency, error }) => {
        const { label, className } = formatLatency(error ? Number.NaN : latency);
        return `
          <article class="edge-card">
            <span class="edge-card__vendor">${escapeHtml(vendor)}</span>
            <span class="${className}">${escapeHtml(label)}</span>
          </article>
        `;
      })
      .join('');
  };

  const runEdgePulse = async () => {
    grid.innerHTML = '<p class="edge-pulse__loading">Measuring edge performance…</p>';

    const results = await Promise.all(
      EDGE_VENDOR_TARGETS.map(async (target) => {
        try {
          const measurement = await measureVendorLatency(target);
          return { ...measurement, error: false };
        } catch (error) {
          console.error('Edge Pulse measurement failed', target.vendor, error);
          return { ...target, latency: Number.NaN, error: true };
        }
      })
    );

    renderResults(results);
  };

  runEdgePulse().catch((error) => {
    console.error('Edge Pulse failed', error);
    grid.innerHTML = '<p class="edge-pulse__loading">Edge Pulse is unavailable right now.</p>';
  });
};

const initHeroGlobe = async () => {
  const globe = document.getElementById('heroGlobe');
  if (!globe) return;

  const identity = await fetchIspIdentity();
  const countryCode = identity?.countryCode;
  const countryName = identity?.country;

  const renderedShape = await renderHeroCountryShape({
    container: globe,
    countryCode,
    countryName
  });

  if (!renderedShape) {
    globe.innerHTML = '';
    globe.classList.remove('hero__globe--active');
  }
};

const initStatsMarquee = async () => {
  try {
    const stats = await fetchJSON('data/vendor-stats.json');
    const marquee = document.getElementById('statsMarquee');
    if (!marquee) return;

    const groupStatsByVendor = (list) =>
      list.reduce((groups, item) => {
        const lastGroup = groups[groups.length - 1];
        if (!lastGroup || lastGroup.vendor !== item.vendor) {
          groups.push({ vendor: item.vendor, metrics: [item] });
        } else {
          lastGroup.metrics.push(item);
        }
        return groups;
      }, []);

    const renderGroups = (groups) =>
      groups
        .map((group, index) => {
          const metrics = group.metrics
            .map(({ metric, value }) => {
              const valuePart = value ? ` ${escapeHtml(value)}` : '';
              return `${escapeHtml(group.vendor)} ${escapeHtml(metric)}${valuePart}`;
            })
            .join(' ');

          const divider =
            index === groups.length - 1
              ? ''
              : ' <span class="stats-group__divider" aria-hidden="true">·</span> ';

          return `<span class="stats-group">${metrics}</span>${divider}`;
        })
        .join(' ');

    const grouped = groupStatsByVendor(stats);
    const loopedGroups = grouped.concat(grouped);
    marquee.innerHTML = renderGroups(loopedGroups);
  } catch (error) {
    console.error('Unable to load vendor stats', error);
  }
};

const initAnalystCarousel = async () => {
  try {
    const insights = await fetchJSON('data/analyst-insights.json');
    const carousel = document.getElementById('analystCarousel');
    const prevBtn = document.getElementById('analystPrev');
    const nextBtn = document.getElementById('analystNext');
    if (!carousel || !prevBtn || !nextBtn) return;

    let index = 0;

    const render = () => {
      const item = insights[index];
      carousel.innerHTML = `
        <div class="analyst__item">
          <h3>${item.source} · ${item.year}</h3>
          <p class="analyst__headline">${item.headline}</p>
          <p>${item.detail}</p>
        </div>
      `;
    };

    const goTo = (direction) => {
      index = (index + direction + insights.length) % insights.length;
      render();
    };

    prevBtn.addEventListener('click', () => goTo(-1));
    nextBtn.addEventListener('click', () => goTo(1));

    render();

    setInterval(() => goTo(1), 8000);
  } catch (error) {
    console.error('Unable to load analyst insights', error);
  }
};

const initBlogs = async () => {
  try {
    const posts = await fetchJSON('data/blog-posts.json');
    const grid = document.getElementById('blogGrid');
    if (!grid) return;

    const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const sorted = posts.sort((a, b) => new Date(b.date) - new Date(a.date));

    grid.innerHTML = sorted
      .map(
        ({ vendor, title, excerpt, url, date }) => `
          <article class="blog-card">
            <div class="blog-card__meta">
              <span>${vendor}</span>
              <span>${formatter.format(new Date(date))}</span>
            </div>
            <h3><a href="${url}" target="_blank" rel="noopener">${title}</a></h3>
            <p>${excerpt}</p>
          </article>
        `
      )
      .join('');
  } catch (error) {
    console.error('Unable to load blog posts', error);
  }
};

const initRetainCalculator = () => {
  const form = document.getElementById('retainForm');
  const hoursInput = document.getElementById('retainHours');
  const resultNode = document.getElementById('retainResult');
  const modeSelect = document.getElementById('retainMode');

  if (!form || !hoursInput || !resultNode || !modeSelect) return;

  const BASELINE_RATE = 300;
  const GURU_RATE = 100;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const hours = Number.parseFloat(hoursInput.value);
    if (!Number.isFinite(hours) || hours <= 0) {
      resultNode.textContent = 'Please provide a positive number of hours to calculate your savings.';
      return;
    }

    const baselineCost = hours * BASELINE_RATE;
    const guruCost = hours * GURU_RATE;
    const savings = baselineCost - guruCost;
    const isRecurring = modeSelect.value === 'recurring';

    if (isRecurring) {
      const annualSavings = savings * 12;
      resultNode.innerHTML = `<span class="number">Estimated annual savings: $${annualSavings.toLocaleString()}</span>`;
    } else {
      resultNode.innerHTML = `<span class="number">Estimated savings per engagement: $${savings.toLocaleString()}</span>`;
    }
  });
};

const metricThresholds = {
  largest_contentful_paint: 2500,
  interaction_to_next_paint: 200,
  first_input_delay: 100,
  cumulative_layout_shift: 0.1
};

const formatMetricLabel = (key) => {
  switch (key) {
    case 'largest_contentful_paint':
      return 'LCP';
    case 'interaction_to_next_paint':
      return 'INP';
    case 'first_input_delay':
      return 'FID';
    case 'cumulative_layout_shift':
      return 'CLS';
    default:
      return key;
  }
};

const evaluateMetric = (key, value) => {
  const threshold = metricThresholds[key];
  if (threshold == null) return true;
  if (key === 'cumulative_layout_shift') {
    return value <= threshold;
  }
  return value <= threshold;
};

const describeMetric = (key, value) => {
  const label = formatMetricLabel(key);
  if (key === 'largest_contentful_paint') {
    return `${label}: ${(value / 1000).toFixed(1)}s`;
  }
  if (key === 'cumulative_layout_shift') {
    return `${label}: ${value.toFixed(2)}`;
  }
  return `${label}: ${Math.round(value)}ms`;
};

const initContactForm = () => {
  const form = document.getElementById('contactForm');
  const websiteInput = document.getElementById('website');
  const websiteGroup = document.getElementById('websiteGroup');
  const statusNode = document.getElementById('cwvStatus');

  if (!form || !websiteInput || !websiteGroup || !statusNode) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    form.reset();
    websiteGroup.classList.remove('needs-fix');
    statusNode.textContent = 'Thank you! Our team will reach out shortly.';
  });

  let debounceTimer;
  websiteInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const value = websiteInput.value.trim();
    if (!value) {
      statusNode.textContent = '';
      websiteGroup.classList.remove('needs-fix');
      return;
    }

    debounceTimer = setTimeout(() => {
      runCruxLookup(value, websiteGroup, statusNode);
    }, 600);
  });
};

const runCruxLookup = async (website, group, statusNode) => {
  try {
    let normalized = website;
    try {
      const url = new URL(website);
      normalized = url.origin;
    } catch (error) {
      normalized = `https://${website.replace(/^https?:\/\//, '')}`;
    }

    if (!window.CRUX_API_KEY || window.CRUX_API_KEY === 'YOUR_CRUX_API_KEY') {
      statusNode.textContent = 'Add your Google CrUX API key to enable Core Web Vitals lookups.';
      group.classList.remove('needs-fix');
      return;
    }

    statusNode.textContent = 'Fetching Core Web Vitals…';

    const body = {
      url: normalized,
      formFactor: 'PHONE'
    };

    const response = await fetch(`https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${window.CRUX_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`CrUX API error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.record || !data.record.metrics) {
      statusNode.textContent = 'No Core Web Vitals available for this origin yet.';
      group.classList.remove('needs-fix');
      return;
    }

    const { metrics } = data.record;
    const evaluations = [];
    let hasFailures = false;

    Object.entries(metrics).forEach(([key, metric]) => {
      const p75 = metric?.percentiles?.p75;
      if (p75 == null) return;
      const passes = evaluateMetric(key, p75);
      if (!passes) hasFailures = true;
      evaluations.push({ key, p75, passes });
    });

    if (evaluations.length === 0) {
      statusNode.textContent = 'Core Web Vitals data is unavailable.';
      group.classList.remove('needs-fix');
      return;
    }

    const summary = evaluations
      .map(({ key, p75, passes }) => `${passes ? '✅' : '⚠️'} ${describeMetric(key, p75)}${passes ? '' : ' · needs fixing!'}`)
      .join('  ');

    statusNode.textContent = summary;
    group.classList.toggle('needs-fix', hasFailures);
  } catch (error) {
    console.error(error);
    statusNode.textContent = 'Unable to retrieve Core Web Vitals right now.';
    group.classList.add('needs-fix');
  }
};

const initFooterYear = () => {
  const node = document.getElementById('year');
  if (node) {
    node.textContent = new Date().getFullYear();
  }
};

(async () => {
  await Promise.all([initStatsMarquee(), initAnalystCarousel(), initBlogs(), initHeroGlobe()]);
  initEdgePulse();
  initRetainCalculator();
  initContactForm();
  initFooterYear();
})();
