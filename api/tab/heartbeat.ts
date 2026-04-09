import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).end()

  const { code, personId, name } = req.body
  if (!code || personId == null) return res.status(400).end()

  const raw = await redis.get(`tab:${code}`)
  if (!raw) return res.status(404).end()

  const tab: any = typeof raw === 'string' ? JSON.parse(raw) : raw

  const idx = tab.sessions?.findIndex((s: any) => s.personId === personId) ?? -1
  if (idx >= 0) tab.sessions[idx].lastSeen = Date.now()
  else tab.sessions = [...(tab.sessions ?? []), { personId, name, lastSeen: Date.now() }]
  tab.lastActive = Date.now()

  // keepTtl not available in all versions — just re-set with same TTL
  await redis.set(`tab:${code}`, JSON.stringify(tab), { ex: 604800 })

  // Return anyone else active in the last 60 seconds
  const activeSessions = (tab.sessions ?? []).filter(
    (s: any) => s.personId !== personId && Date.now() - s.lastSeen < 60000
  )

  res.status(200).json({ activeSessions })
}
