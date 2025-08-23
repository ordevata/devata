
export async function api(path: string, init?: RequestInit) {
  const base = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3001/v1'
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers||{}) },
    cache: 'no-store'
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json()
}
