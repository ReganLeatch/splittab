import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } }

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).end()

  const { code, bills, people, myPersonId } = req.body
  if (!code || !Array.isArray(bills)) return res.status(400).json({ error: 'Missing code or bills' })

  const raw = await redis.get(`tab:${code}`)
  if (!raw) return res.status(404).json({ error: 'Tab not found' })

  const tab: any = typeof raw === 'string' ? JSON.parse(raw) : raw
  const myName = people?.find((p: any) => p.id === myPersonId)?.name ?? 'Unknown'

  tab.bills = bills
  if (people) tab.people = people
  tab.lastActive = Date.now()
  tab.lastActiveBy = myName

  await redis.set(`tab:${code}`, JSON.stringify(tab), { ex: 604800 })

  res.status(200).json({ ok: true })
}
