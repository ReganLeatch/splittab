import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } }

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).end()

  const { code, bill, people, myPersonId } = req.body
  if (!code || !bill) return res.status(400).json({ error: 'Missing code or bill' })

  const raw = await redis.get(`tab:${code}`)
  if (!raw) return res.status(404).json({ error: 'Tab not found' })

  const tab: any = typeof raw === 'string' ? JSON.parse(raw) : raw
  const myName = people?.find((p: any) => p.id === myPersonId)?.name ?? 'Unknown'

  // Append the bill and update people list
  tab.bills = [...(tab.bills ?? []), bill]
  if (people) tab.people = people
  tab.lastActive = Date.now()
  tab.lastActiveBy = myName

  // Update session
  const idx = tab.sessions?.findIndex((s: any) => s.personId === myPersonId) ?? -1
  if (idx >= 0) tab.sessions[idx].lastSeen = Date.now()
  else tab.sessions = [...(tab.sessions ?? []), { personId: myPersonId, name: myName, lastSeen: Date.now() }]

  // Reset 7-day TTL on every save
  await redis.set(`tab:${code}`, JSON.stringify(tab), { ex: 604800 })

  res.status(200).json({ ok: true })
}
