import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).end()

  const code = (req.query.code as string)?.toUpperCase().trim()
  if (!code) return res.status(400).json({ error: 'Missing code' })

  const raw = await redis.get(`tab:${code}`)
  if (!raw) return res.status(404).json({ error: 'Tab not found or expired' })

  const tab = typeof raw === 'string' ? JSON.parse(raw) : raw
  res.status(200).json(tab)
}
