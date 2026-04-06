import Anthropic from '@anthropic-ai/sdk'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { base64, mediaType } = req.body

  if (!base64 || !mediaType) {
    return res.status(400).json({ error: 'Missing base64 or mediaType' })
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          {
            type: 'text',
            text: `Analyze this receipt carefully. Return ONLY a JSON object — no markdown, no code blocks, no explanation:
{"items":[{"name":"...","price":0.0,"quantity":1}],"extras":[{"name":"...","price":0.0}],"receipt_total":0.0}

Definitions:
• "items" = individual food and drink line items only
  - "name": item name only (no quantity prefix)
  - "price": the TOTAL line amount for that row (unit price × quantity — use the Amount/Total column if the receipt has one)
  - "quantity": number of units — look for "3 Iced Tea", "Iced Tea ×3", a Qty column value, etc. Default to 1.
• "extras" = any line that is NOT a food/drink item: tax, VAT, GST, service charge, gratuity, tip, cover charge, surcharges
• "receipt_total" = the single grand total printed at the bottom of the receipt — the exact amount to be paid

Rules:
• NEVER include subtotals, totals, or discounts in items or extras
• ONLY include lines you can clearly read — do not guess
• Prices are plain numbers with no currency symbols
• If no extras are visible, return an empty extras array`,
          },
        ],
      }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    res.status(200).json({ text })
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Analysis failed' })
  }
}
