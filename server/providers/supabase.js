/**
 * Low-level Supabase PostgREST HTTP client.
 * All Nuvio API calls go through these functions.
 */

const SUPABASE_URL = process.env.NUVIO_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NUVIO_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Only throw if Nuvio features are actually needed — checked at first use
  // Log a warning at startup so operators know
  if (process.env.NODE_ENV !== 'test') {
    console.warn('Warning: NUVIO_SUPABASE_URL and/or NUVIO_SUPABASE_ANON_KEY not set. Nuvio provider will not work.')
  }
}

function ensureConfigured() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Nuvio is not configured (missing NUVIO_SUPABASE_URL or NUVIO_SUPABASE_ANON_KEY)')
  }
}

function headers(accessToken) {
  return {
    'apikey': SUPABASE_ANON_KEY,
    'authorization': `Bearer ${accessToken}`,
    'content-type': 'application/json',
    'prefer': 'return=representation'
  }
}

async function supabaseGet(table, params, accessToken) {
  ensureConfigured()
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`
  const res = await fetch(url, { headers: headers(accessToken) })
  if (!res.ok) {
    console.error(`Supabase GET ${table} failed (${res.status})`)
    const err = new Error('Provider request failed')
    err.status = res.status
    throw err
  }
  return await res.json()
}

async function supabasePost(table, rows, accessToken) {
  ensureConfigured()
  const url = `${SUPABASE_URL}/rest/v1/${table}`
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(accessToken),
    body: JSON.stringify(rows)
  })
  if (!res.ok) {
    console.error(`Supabase POST ${table} failed (${res.status})`)
    const err = new Error('Provider request failed')
    err.status = res.status
    throw err
  }
  return await res.json()
}

async function supabaseDelete(table, params, accessToken) {
  ensureConfigured()
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`
  const res = await fetch(url, {
    method: 'DELETE',
    headers: headers(accessToken)
  })
  if (!res.ok) {
    console.error(`Supabase DELETE ${table} failed (${res.status})`)
    const err = new Error('Provider request failed')
    err.status = res.status
    throw err
  }
}

async function supabaseRpc(fn, body, accessToken) {
  ensureConfigured()
  const url = `${SUPABASE_URL}/rest/v1/rpc/${fn}`
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(accessToken),
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    console.error(`Supabase RPC ${fn} failed (${res.status})`)
    const err = new Error('Provider request failed')
    err.status = res.status
    throw err
  }
  return await res.json()
}

module.exports = { supabaseGet, supabasePost, supabaseDelete, supabaseRpc, SUPABASE_URL, SUPABASE_ANON_KEY }
