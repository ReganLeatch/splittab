import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } }

function generateCode(): string {
  // Unambiguous chars (no 0/O, 1/I/L)
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).end()

  const { people, myPersonId } = req.body
  const myName = people.find((p: any) => p.id === myPersonId)?.name ?? 'Unknown'

  // Generate a unique code (retry on collision)
  let code = generateCode()
  for (let i = 0; i < 5; i++) {
    if (!(await redis.exists(`tab:${code}`))) break
    code = generateCode()
  }

  const tab = {
    code,
    people,
    bills: [],
    createdAt: Date.now(),
    lastActive: Date.now(),
    lastActiveBy: myName,
    sessions: [{ personId: myPersonId, name: myName, lastSeen: Date.now() }],
  }

  // 7-day TTL
  await redis.set(`tab:${code}`, JSON.stringify(tab), { ex: 604800 })

  res.status(200).json({ code })
}
