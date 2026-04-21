/**
 * FAA Part 107 Airmen Lookup
 * GET /.netlify/functions/faa-lookup?cert=123456789
 * GET /.netlify/functions/faa-lookup?first=JOHN&last=DOE
 *
 * Env vars: TURSO_URL, TURSO_AUTH_TOKEN
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function resp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function tursoQuery(sql, args = []) {
  const url = `${process.env.TURSO_URL}/v2/pipeline`;
  const token = process.env.TURSO_AUTH_TOKEN;

  if (!url || !token) throw new Error('Turso not configured');

  const body = JSON.stringify({
    requests: [{
      type: 'execute',
      stmt: {
        sql,
        args: args.map(v => ({ type: 'text', value: String(v) })),
      },
    }],
  });

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!r.ok) throw new Error(`Turso HTTP ${r.status}`);
  const data = await r.json();
  return data.results?.[0]?.response?.result ?? null;
}

function rowsToObjects(result) {
  if (!result) return [];
  const cols = result.cols.map(c => c.name);
  return result.rows.map(row =>
    Object.fromEntries(cols.map((col, i) => [col, row[i]?.value ?? null]))
  );
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return resp({ error: 'GET only' }, 405);

  const url = new URL(req.url);
  const cert  = (url.searchParams.get('cert') || '').trim().replace(/\D/g, '').slice(0, 9);
  const first = (url.searchParams.get('first') || '').trim().toUpperCase().slice(0, 20);
  const last  = (url.searchParams.get('last') || '').trim().toUpperCase().slice(0, 25);

  if (!cert && !last) {
    return resp({ error: 'Provide cert= or last= (+ optional first=)' }, 400);
  }

  try {
    let result;

    if (cert) {
      // Exact cert number (unique_id) lookup
      result = await tursoQuery(
        'SELECT unique_id, first_name, last_name, city, state, loaded_at FROM airmen WHERE unique_id = ? LIMIT 1',
        [cert.padStart(9, '0')]
      );
    } else {
      // Name lookup — last required, first optional
      if (first) {
        result = await tursoQuery(
          'SELECT unique_id, first_name, last_name, city, state, loaded_at FROM airmen WHERE last_name = ? AND first_name LIKE ? LIMIT 10',
          [last, `${first}%`]
        );
      } else {
        result = await tursoQuery(
          'SELECT unique_id, first_name, last_name, city, state, loaded_at FROM airmen WHERE last_name = ? LIMIT 10',
          [last]
        );
      }
    }

    const rows = rowsToObjects(result);

    if (rows.length === 0) {
      return resp({ found: false, results: [] });
    }

    // Sanitize: don't expose street address (not in schema, but just in case)
    const clean = rows.map(r => ({
      cert_id:    r.unique_id,
      first_name: r.first_name,
      last_name:  r.last_name,
      city:       r.city,
      state:      r.state,
      cert_type:  'Part 107 Remote Pilot Certificate',
      verified:   true,
      db_date:    r.loaded_at ? r.loaded_at.slice(0, 10) : null,
    }));

    return resp({ found: true, results: clean });

  } catch (err) {
    console.error('faa-lookup error:', err);
    return resp({ error: 'Lookup unavailable', detail: err.message }, 503);
  }
};

export const config = { path: '/faa-lookup' };
