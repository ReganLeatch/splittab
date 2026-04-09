import { useState, useEffect, useRef, CSSProperties } from 'react'
import { Analytics } from '@vercel/analytics/react'

// ─── Analytics ───────────────────────────────────────────────────────────────
const trackEvent = (name: string, params?: Record<string, string>) => {
  if (typeof window !== 'undefined' && (window as any).gtag) {
    ;(window as any).gtag('event', name, params ?? {})
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface Person { id: number; name: string; colorIdx: number }
interface ReceiptItem {
  name: string
  price: number
  quantity: number          // total units on this line (e.g. 3 for "3x Iced Tea")
  splitGroupId?: string     // set when this item has been split into individual units
  assignedTo: number[]
}
interface Extra { name: string; price: number }
interface Bill {
  id: string
  payerId: number | null
  items: ReceiptItem[]
  extras: Extra[]
  receiptTotal: number
}
interface TabSession { personId: number; name: string; lastSeen: number }
interface TabData {
  code: string
  people: Person[]
  bills: Bill[]
  createdAt: number
  lastActive: number
  lastActiveBy: string
  sessions: TabSession[]
}
type Screen = 'setup' | 'join' | 'receipt' | 'assign' | 'results'

// ─── Design Tokens ───────────────────────────────────────────────────────────
const BG = '#07070e'

const COLORS = [
  { bg: '#EF4444', glow: 'rgba(239,68,68,0.6)',   fg: '#fff', dim: 'rgba(239,68,68,0.15)' },
  { bg: '#06B6D4', glow: 'rgba(6,182,212,0.6)',   fg: '#fff', dim: 'rgba(6,182,212,0.15)' },
  { bg: '#8B5CF6', glow: 'rgba(139,92,246,0.6)',  fg: '#fff', dim: 'rgba(139,92,246,0.15)' },
  { bg: '#10B981', glow: 'rgba(16,185,129,0.6)',  fg: '#fff', dim: 'rgba(16,185,129,0.15)' },
  { bg: '#F59E0B', glow: 'rgba(245,158,11,0.6)',  fg: '#fff', dim: 'rgba(245,158,11,0.15)' },
  { bg: '#EC4899', glow: 'rgba(236,72,153,0.6)',  fg: '#fff', dim: 'rgba(236,72,153,0.15)' },
  { bg: '#3B82F6', glow: 'rgba(59,130,246,0.6)',  fg: '#fff', dim: 'rgba(59,130,246,0.15)' },
  { bg: '#F97316', glow: 'rgba(249,115,22,0.6)',  fg: '#fff', dim: 'rgba(249,115,22,0.15)' },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────
const glassCard = (extra: CSSProperties = {}): CSSProperties => ({
  background: 'rgba(255,255,255,0.05)',
  backdropFilter: 'blur(24px)',
  WebkitBackdropFilter: 'blur(24px)',
  border: '1px solid rgba(255,255,255,0.09)',
  borderRadius: 20,
  ...extra,
})

const fmt = (n: number) => `$${n.toFixed(2)}`

// Returns the shortest unambiguous abbreviation; falls back to full name if needed
function getInitials(name: string, allNames: string[]): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  for (let len = 1; len <= trimmed.length; len++) {
    const abbr = trimmed.slice(0, len).toUpperCase()
    const clash = allNames.some(n => n.trim() !== trimmed && n.trim().toUpperCase().startsWith(abbr))
    if (!clash) return abbr
  }
  // Still clashing at full length (identical names) — return full name anyway
  return trimmed
}

// Canvas rounded rect helper
function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

// Returns minimum set of transfers to settle all debts across multiple bills
function calculateSettlement(people: Person[], allBills: Bill[]): { from: string; to: string; amount: number }[] {
  const net = new Map<number, number>()
  people.forEach(p => net.set(p.id, 0))

  allBills.forEach(bill => {
    // Payer gets credited the full bill amount
    if (bill.payerId !== null) {
      net.set(bill.payerId, (net.get(bill.payerId) ?? 0) + (
        bill.receiptTotal > 0 ? bill.receiptTotal
          : bill.items.reduce((s, i) => s + i.price, 0) + bill.extras.reduce((s, e) => s + e.price, 0)
      ))
    }
    // Each person is debited their share of this bill
    const sub = bill.items.reduce((s, i) => s + i.price, 0)
    const charges = bill.receiptTotal > 0
      ? Math.max(0, bill.receiptTotal - sub)
      : bill.extras.reduce((s, e) => s + e.price, 0)
    const itemShares = new Map<number, number>()
    people.forEach(p => itemShares.set(p.id, 0))
    bill.items.forEach(item => {
      item.assignedTo.forEach(id => {
        itemShares.set(id, (itemShares.get(id) ?? 0) + item.price / item.assignedTo.length)
      })
    })
    people.forEach(p => {
      const itemT = itemShares.get(p.id) ?? 0
      const chargeShare = charges > 0.005 && sub > 0 ? (itemT / sub) * charges : 0
      net.set(p.id, (net.get(p.id) ?? 0) - (itemT + chargeShare))
    })
  })

  const creds = people.map(p => ({ name: p.name, amount: net.get(p.id) ?? 0 })).filter(x => x.amount > 0.005).sort((a, b) => b.amount - a.amount)
  const debts = people.map(p => ({ name: p.name, amount: -(net.get(p.id) ?? 0) })).filter(x => x.amount > 0.005).sort((a, b) => b.amount - a.amount)

  const transfers: { from: string; to: string; amount: number }[] = []
  const c = creds.map(x => ({ ...x }))
  const d = debts.map(x => ({ ...x }))
  let i = 0, j = 0
  while (i < c.length && j < d.length) {
    const t = Math.min(c[i].amount, d[j].amount)
    if (t > 0.005) transfers.push({ from: d[j].name, to: c[i].name, amount: t })
    c[i].amount -= t; d[j].amount -= t
    if (c[i].amount < 0.005) i++
    if (d[j].amount < 0.005) j++
  }
  return transfers
}

// ─── Background Orbs ─────────────────────────────────────────────────────────
function Orbs() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute', top: '-20%', left: '-15%', width: '65vw', height: '65vw',
        background: 'radial-gradient(circle, rgba(124,58,237,0.5) 0%, transparent 65%)',
        filter: 'blur(90px)',
      }} />
      <div style={{
        position: 'absolute', bottom: '-20%', right: '-15%', width: '70vw', height: '70vw',
        background: 'radial-gradient(circle, rgba(236,72,153,0.4) 0%, transparent 65%)',
        filter: 'blur(90px)',
      }} />
      <div style={{
        position: 'absolute', top: '40%', right: '5%', width: '40vw', height: '40vw',
        background: 'radial-gradient(circle, rgba(6,182,212,0.2) 0%, transparent 65%)',
        filter: 'blur(70px)',
      }} />
    </div>
  )
}

// ─── Logo ─────────────────────────────────────────────────────────────────────
function Logo({ size = 32 }: { size?: number }) {
  return (
    <span style={{ fontSize: size, fontWeight: 800, letterSpacing: '-1.5px', lineHeight: 1 }}>
      <span style={{
        background: 'linear-gradient(135deg, #e2e8f0 0%, #94a3b8 100%)',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
      }}>Split</span>
      <span style={{
        background: 'linear-gradient(135deg, #a78bfa 0%, #f472b6 100%)',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
      }}>Tab</span>
    </span>
  )
}

// ─── Person Avatar ────────────────────────────────────────────────────────────
function PersonAvatar({
  person, label, size = 36, active = false, onClick,
}: {
  person: Person; label?: string; size?: number; active?: boolean; onClick?: () => void
}) {
  const c = COLORS[person.colorIdx % COLORS.length]
  const displayLabel = label ?? (person.name.trim().charAt(0).toUpperCase() || '?')
  const isPill = displayLabel.length > 2
  return (
    <button
      onClick={onClick}
      style={{
        height: size,
        width: isPill ? 'auto' : size,
        minWidth: isPill ? size : undefined,
        paddingLeft: isPill ? size * 0.35 : 0,
        paddingRight: isPill ? size * 0.35 : 0,
        borderRadius: size / 2,
        background: active ? c.bg : c.dim,
        border: `2px solid ${active ? c.bg : 'rgba(255,255,255,0.1)'}`,
        boxShadow: active ? `0 0 12px 3px ${c.glow}` : 'none',
        color: c.fg,
        fontWeight: 700,
        fontSize: isPill ? Math.max(9, size * 0.28) : size * 0.38,
        letterSpacing: isPill ? '0.01em' : undefined,
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        transition: 'all 0.15s ease',
        whiteSpace: 'nowrap',
      }}
    >
      {displayLabel}
    </button>
  )
}

// ─── Setup Screen ─────────────────────────────────────────────────────────────
function SetupScreen({
  onStart,
  onJoin,
}: {
  onStart: (people: Person[], myPersonId: number) => void
  onJoin: () => void
}) {
  const [nameInput, setNameInput] = useState('')
  const [people, setPeople] = useState<Person[]>([])
  const [myPersonId, setMyPersonId] = useState<number | null>(null)

  const addPerson = () => {
    const name = nameInput.trim()
    if (!name) return
    const newPerson: Person = { id: Date.now(), name, colorIdx: people.length }
    setPeople(p => [...p, newPerson])
    setNameInput('')
    if (myPersonId === null) setMyPersonId(newPerson.id)
  }

  const removePerson = (id: number) => {
    setPeople(p => p.filter(x => x.id !== id))
    if (myPersonId === id) setMyPersonId(null)
  }

  const handleStart = () => {
    if (people.length < 2 || myPersonId === null) return
    onStart(people, myPersonId)
  }

  const inputStyle: CSSProperties = {
    width: '100%',
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 12,
    padding: '12px 14px',
    color: '#fff',
    fontSize: 16,
    outline: 'none',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 32 }}>
      {/* Header */}
      <div style={{ textAlign: 'center', paddingTop: 8 }}>
        <Logo size={48} />
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, marginTop: 6 }}>
          Split Tabs, Not Friendships
        </p>
      </div>

      {/* People */}
      <div style={glassCard({ padding: 20 })}>
        <label style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Who's splitting?
        </label>

        {people.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {people.map(p => {
              const c = COLORS[p.colorIdx % COLORS.length]
              return (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: c.dim,
                  border: `1px solid ${c.bg}44`,
                  borderRadius: 100, padding: '5px 10px 5px 6px',
                }}>
                  <PersonAvatar person={p} size={24} active />
                  <span style={{ color: '#fff', fontSize: 14 }}>{p.name}</span>
                  <button onClick={() => removePerson(p.id)} style={{
                    background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
                    cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 0 0 2px',
                  }}>×</button>
                </div>
              )
            })}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input
            placeholder="Add a name…"
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addPerson()}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button onClick={addPerson} style={{
            background: 'linear-gradient(135deg, #7C3AED, #EC4899)',
            border: 'none', borderRadius: 12, color: '#fff',
            fontWeight: 700, fontSize: 18, width: 46, cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(124,58,237,0.4)',
          }}>+</button>
        </div>
      </div>

      {/* Who are you? */}
      {people.length > 0 && (
        <div style={glassCard({ padding: 20 })}>
          <label style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Who are you?
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {people.map(p => (
              <button
                key={p.id}
                onClick={() => setMyPersonId(p.id)}
                style={{
                  background: myPersonId === p.id ? COLORS[p.colorIdx % COLORS.length].bg : COLORS[p.colorIdx % COLORS.length].dim,
                  border: `2px solid ${myPersonId === p.id ? COLORS[p.colorIdx % COLORS.length].bg : 'rgba(255,255,255,0.12)'}`,
                  borderRadius: 100, padding: '7px 14px', color: '#fff',
                  fontWeight: 600, fontSize: 14, cursor: 'pointer',
                  boxShadow: myPersonId === p.id ? `0 0 12px 3px ${COLORS[p.colorIdx % COLORS.length].glow}` : 'none',
                  transition: 'all 0.15s',
                }}
              >{p.name}</button>
            ))}
          </div>
          {myPersonId === null && (
            <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 8 }}>Select your name so we know who added this tab</p>
          )}
        </div>
      )}

      {/* CTA */}
      <button
        onClick={handleStart}
        disabled={people.length < 2 || myPersonId === null}
        style={{
          background: (people.length < 2 || myPersonId === null)
            ? 'rgba(255,255,255,0.08)'
            : 'linear-gradient(135deg, #7C3AED 0%, #EC4899 100%)',
          border: 'none', borderRadius: 16, color: '#fff',
          fontWeight: 700, fontSize: 17, padding: '16px',
          cursor: (people.length < 2 || myPersonId === null) ? 'not-allowed' : 'pointer',
          boxShadow: (people.length < 2 || myPersonId === null)
            ? 'none'
            : '0 6px 28px rgba(124,58,237,0.5)',
          transition: 'all 0.2s',
          opacity: (people.length < 2 || myPersonId === null) ? 0.5 : 1,
        }}
      >
        Scan Receipt →
      </button>

      {/* Join existing tab */}
      <button
        onClick={onJoin}
        style={{
          background: 'none', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 16,
          color: 'rgba(255,255,255,0.6)', fontWeight: 600, fontSize: 15, padding: '14px',
          cursor: 'pointer', transition: 'all 0.2s',
        }}
      >
        Join existing tab →
      </button>
    </div>
  )
}

// ─── Receipt Screen ───────────────────────────────────────────────────────────
function ReceiptScreen({
  people,
  billNumber,
  onDone,
  onBack,
}: {
  people: Person[]
  billNumber: number
  onDone: (items: ReceiptItem[], extras: Extra[], receiptTotal: number, payerId: number | null) => void
  onBack: () => void
}) {
  const [image, setImage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [payerId, setPayerId] = useState<number | null>(null)
  const [manualMode, setManualMode] = useState(false)
  const [manualItemsList, setManualItemsList] = useState<{ name: string; price: number }[]>([])
  const [manualName, setManualName] = useState('')
  const [manualPrice, setManualPrice] = useState('')
  const [manualTotal, setManualTotal] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  const handleFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = e => setImage(e.target?.result as string)
    reader.readAsDataURL(file)
  }

  const addManualLineItem = () => {
    const name = manualName.trim()
    const price = parseFloat(manualPrice)
    if (!name || !price || price <= 0) return
    setManualItemsList(prev => [...prev, { name, price }])
    setManualName(''); setManualPrice('')
  }

  const submitManual = () => {
    if (manualItemsList.length === 0) return
    const items: ReceiptItem[] = manualItemsList.map(i => ({ name: i.name, price: i.price, quantity: 1, assignedTo: [] }))
    const total = parseFloat(manualTotal) || 0
    onDone(items, [], total, payerId)
  }

  const analyze = async () => {
    if (!image) return
    setLoading(true)
    setError(null)
    trackEvent('analyse_receipt')
    try {
      const base64 = image.split(',')[1]
      const mediaType = image.split(';')[0].split(':')[1]

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, mediaType }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Analysis failed')
      }

      const { text: raw } = await res.json()
      const cleaned = raw.trim()

      let rawItems: { name: string; price: number; quantity?: number }[] = []
      let rawExtras: { name: string; price: number }[] = []
      let receiptTotal = 0

      const objMatch = cleaned.match(/\{[\s\S]*\}/)
      const arrMatch = cleaned.match(/\[[\s\S]*\]/)

      if (objMatch) {
        const parsed = JSON.parse(objMatch[0])
        rawItems = parsed.items ?? []
        rawExtras = parsed.extras ?? []
        receiptTotal = parseFloat(String(parsed.receipt_total ?? 0)) || 0
      } else if (arrMatch) {
        rawItems = JSON.parse(arrMatch[0])
      }

      const items: ReceiptItem[] = rawItems
        .filter(i => parseFloat(String(i.price)) > 0)
        .map(i => ({
          name: i.name,
          price: parseFloat(String(i.price)),
          quantity: Math.max(1, Math.round(parseFloat(String(i.quantity ?? 1))) || 1),
          assignedTo: [],
        }))

      const extras: Extra[] = rawExtras
        .filter(e => parseFloat(String(e.price)) > 0)
        .map(e => ({ name: e.name, price: parseFloat(String(e.price)) }))

      if (items.length === 0) {
        setError('No items found. Try a clearer photo.')
        setLoading(false)
        return
      }

      onDone(items, extras, receiptTotal, payerId)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      const detail = (e as { status?: number; error?: { message?: string } })
      const apiMsg = detail?.error?.message
      setError(apiMsg ? `${apiMsg}` : msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} style={{
          background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 10, color: '#fff', padding: '8px 14px', cursor: 'pointer', fontSize: 14,
        }}>← Back</button>
        <Logo size={26} />
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h2 style={{ color: '#fff', fontWeight: 700, fontSize: 22, margin: 0 }}>
          {billNumber > 1 ? `Bill ${billNumber}` : 'Scan your receipt'}
        </h2>
        <button onClick={() => { setManualMode(m => !m); setImage(null); setManualItemsList([]); setManualName(''); setManualPrice('') }} style={{
          background: 'none', border: 'none', color: '#a78bfa', fontSize: 13,
          cursor: 'pointer', padding: 0, textDecoration: 'underline',
        }}>
          {manualMode ? 'Scan a receipt instead' : 'Enter manually instead'}
        </button>
      </div>

      {manualMode ? (
        /* ── Manual entry mode ── */
        <div style={glassCard({ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 })}>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, margin: 0 }}>
            Add items one by one, then assign them on the next screen.
          </p>

          {/* Added items list */}
          {manualItemsList.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {manualItemsList.map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: '8px 12px' }}>
                  <span style={{ color: '#fff', fontSize: 14 }}>{item.name}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ color: '#a78bfa', fontWeight: 700, fontSize: 14 }}>{fmt(item.price)}</span>
                    <button onClick={() => setManualItemsList(prev => prev.filter((_, j) => j !== i))} style={{
                      background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 16, padding: 0,
                    }}>×</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add item form */}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              placeholder="Item name…"
              value={manualName}
              onChange={e => setManualName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addManualLineItem()}
              style={{ flex: 2, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 14, outline: 'none' }}
            />
            <input
              placeholder="Price"
              value={manualPrice}
              onChange={e => setManualPrice(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addManualLineItem()}
              type="number" inputMode="decimal"
              style={{ flex: 1, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 14, outline: 'none' }}
            />
            <button onClick={addManualLineItem} style={{
              background: 'linear-gradient(135deg, #7C3AED, #EC4899)', border: 'none',
              borderRadius: 10, color: '#fff', fontWeight: 700, padding: '10px 14px', cursor: 'pointer', fontSize: 16,
            }}>+</button>
          </div>

          {/* Optional total */}
          <div>
            <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, margin: '0 0 6px' }}>
              Bill total (optional — include if there are taxes/charges on top)
            </p>
            <input
              placeholder="e.g. 52.50"
              value={manualTotal}
              onChange={e => setManualTotal(e.target.value)}
              type="number" inputMode="decimal"
              style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '10px 12px', color: '#fff', fontSize: 14, outline: 'none' }}
            />
          </div>
        </div>
      ) : (
        /* ── Scan mode ── */
        <>
          {image ? (
            <div style={{ position: 'relative' }}>
              <img src={image} alt="receipt" style={{
                width: '100%', borderRadius: 16, maxHeight: '50vh', objectFit: 'contain',
                border: '1px solid rgba(255,255,255,0.1)',
              }} />
              <button onClick={() => setImage(null)} style={{
                position: 'absolute', top: 10, right: 10,
                background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: 20,
                color: '#fff', width: 32, height: 32, cursor: 'pointer', fontSize: 16,
              }}>×</button>
            </div>
          ) : (
            <div style={glassCard({
              padding: 32, textAlign: 'center',
              border: '2px dashed rgba(255,255,255,0.15)',
              display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center',
            })}>
              <div style={{ fontSize: 48 }}>🧾</div>
              <p style={{ color: 'rgba(255,255,255,0.5)', margin: 0, fontSize: 15 }}>
                Take a photo or upload from your camera roll
              </p>
              <div style={{ display: 'flex', gap: 10, width: '100%' }}>
                <button onClick={() => cameraRef.current?.click()} style={{
                  flex: 1, background: 'linear-gradient(135deg, #7C3AED, #EC4899)',
                  border: 'none', borderRadius: 12, color: '#fff',
                  fontWeight: 600, fontSize: 15, padding: '13px 0', cursor: 'pointer',
                  boxShadow: '0 4px 20px rgba(124,58,237,0.4)',
                }}>📷 Camera</button>
                <button onClick={() => fileRef.current?.click()} style={{
                  flex: 1, background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 12, color: '#fff',
                  fontWeight: 600, fontSize: 15, padding: '13px 0', cursor: 'pointer',
                }}>📁 Gallery</button>
              </div>
            </div>
          )}
        </>
      )}

      <input ref={cameraRef} type="file" accept="image/*" capture="environment"
        style={{ display: 'none' }} onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
      <input ref={fileRef} type="file" accept="image/*"
        style={{ display: 'none' }} onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />

      {error && (
        <div style={glassCard({
          padding: 14, background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontSize: 14,
        })}>
          {error}
        </div>
      )}

      {/* Who paid? */}
      <div style={glassCard({ padding: 16 })}>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 12px' }}>
          Who paid this bill? <span style={{ color: 'rgba(255,255,255,0.25)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional — needed for settlement)</span>
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {people.map(p => {
            const c = COLORS[p.colorIdx % COLORS.length]
            const selected = payerId === p.id
            return (
              <button key={p.id} onClick={() => setPayerId(selected ? null : p.id)} style={{
                display: 'flex', alignItems: 'center', gap: 7,
                background: selected ? c.dim : 'rgba(255,255,255,0.05)',
                border: `1px solid ${selected ? c.bg : 'rgba(255,255,255,0.1)'}`,
                borderRadius: 100, padding: '6px 12px 6px 6px', cursor: 'pointer',
              }}>
                <PersonAvatar person={p} size={26} active={selected} />
                <span style={{ color: selected ? '#fff' : 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: selected ? 600 : 400 }}>{p.name}</span>
              </button>
            )
          })}
        </div>
      </div>

      {manualMode ? (
        <button
          onClick={submitManual}
          disabled={manualItemsList.length === 0}
          style={{
            background: manualItemsList.length === 0 ? 'rgba(255,255,255,0.08)' : 'linear-gradient(135deg, #7C3AED, #EC4899)',
            border: 'none', borderRadius: 16, color: '#fff',
            fontWeight: 700, fontSize: 17, padding: '16px',
            cursor: manualItemsList.length === 0 ? 'not-allowed' : 'pointer',
            opacity: manualItemsList.length === 0 ? 0.5 : 1,
            transition: 'all 0.2s',
          }}
        >
          {manualItemsList.length === 0 ? 'Add at least one item' : `Assign ${manualItemsList.length} item${manualItemsList.length !== 1 ? 's' : ''} →`}
        </button>
      ) : (
        <button
          onClick={analyze}
          disabled={!image || loading}
          style={{
            background: (!image || loading) ? 'rgba(255,255,255,0.08)' : 'linear-gradient(135deg, #7C3AED, #EC4899)',
            border: 'none', borderRadius: 16, color: '#fff',
            fontWeight: 700, fontSize: 17, padding: '16px',
            cursor: (!image || loading) ? 'not-allowed' : 'pointer',
            boxShadow: (!image || loading) ? 'none' : '0 6px 28px rgba(124,58,237,0.5)',
            opacity: (!image || loading) ? 0.5 : 1,
            transition: 'all 0.2s',
          }}
        >
          {loading ? 'Analysing…' : 'Extract Items →'}
        </button>
      )}
    </div>
  )
}

// ─── Assign Screen ─────────────────────────────────────────────────────────────
function AssignScreen({
  items,
  extras,
  receiptTotal,
  people,
  onDone,
  onBack,
  onAddPerson,
}: {
  items: ReceiptItem[]
  extras: Extra[]
  receiptTotal: number
  people: Person[]
  onDone: (items: ReceiptItem[]) => void
  onBack: () => void
  onAddPerson: (person: Person) => void
}) {
  const [localItems, setLocalItems] = useState(items)
  const [addingPerson, setAddingPerson] = useState(false)
  const [newPersonName, setNewPersonName] = useState('')
  const [addingManual, setAddingManual] = useState(false)
  const [manualName, setManualName] = useState('')
  const [manualPrice, setManualPrice] = useState('')

  const doAddPerson = () => {
    const name = newPersonName.trim()
    if (!name) return
    onAddPerson({ id: Date.now(), name, colorIdx: people.length })
    setNewPersonName('')
    setAddingPerson(false)
  }

  const toggle = (itemIdx: number, personId: number) => {
    setLocalItems(prev => prev.map((item, i) => {
      if (i !== itemIdx) return item
      const already = item.assignedTo.includes(personId)
      return {
        ...item,
        assignedTo: already
          ? item.assignedTo.filter(id => id !== personId)
          : [...item.assignedTo, personId],
      }
    }))
  }

  const assignAll = (itemIdx: number) => {
    setLocalItems(prev => prev.map((item, i) =>
      i === itemIdx ? { ...item, assignedTo: people.map(p => p.id) } : item
    ))
  }

  const clearAssign = (itemIdx: number) => {
    setLocalItems(prev => prev.map((item, i) =>
      i === itemIdx ? { ...item, assignedTo: [] } : item
    ))
  }

  // Split a multi-qty line item into individual units
  const splitItem = (itemIdx: number) => {
    const item = localItems[itemIdx]
    const groupId = `grp-${Date.now()}`
    const unitPrice = item.price / item.quantity
    const units: ReceiptItem[] = Array.from({ length: item.quantity }, (_, k) => ({
      name: `${item.name} (${k + 1}/${item.quantity})`,
      price: unitPrice,
      quantity: 1,
      splitGroupId: groupId,
      assignedTo: [],
    }))
    setLocalItems(prev => [...prev.slice(0, itemIdx), ...units, ...prev.slice(itemIdx + 1)])
  }

  // Merge a split group back into one line item
  const mergeGroup = (groupId: string) => {
    setLocalItems(prev => {
      const firstIdx = prev.findIndex(i => i.splitGroupId === groupId)
      const group = prev.filter(i => i.splitGroupId === groupId)
      const rest = prev.filter(i => i.splitGroupId !== groupId)
      const merged: ReceiptItem = {
        name: group[0].name.replace(/ \(\d+\/\d+\)$/, ''),
        price: group.reduce((s, i) => s + i.price, 0),
        quantity: group.length,
        assignedTo: [],
      }
      const insertAt = prev.slice(0, firstIdx).filter(i => i.splitGroupId !== groupId).length
      return [...rest.slice(0, insertAt), merged, ...rest.slice(insertAt)]
    })
  }

  const addManualItem = () => {
    const name = manualName.trim()
    const price = parseFloat(manualPrice)
    if (!name || !price || price <= 0) return
    setLocalItems(prev => [...prev, { name, price, quantity: 1, assignedTo: [] }])
    setManualName(''); setManualPrice(''); setAddingManual(false)
  }

  const allAssigned = localItems.every(item => item.assignedTo.length > 0)
  const itemsSubtotalForDisplay = localItems.reduce((s, i) => s + i.price, 0)
  // Ground-truth charges = receipt total minus all item prices
  const computedCharges = receiptTotal > 0
    ? Math.max(0, receiptTotal - itemsSubtotalForDisplay)
    : extras.reduce((s, e) => s + e.price, 0)
  const hasCharges = computedCharges > 0.005
  const personLabels = new Map(people.map(p => [p.id, getInitials(p.name, people.map(x => x.name))]))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} style={{
          background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 10, color: '#fff', padding: '8px 14px', cursor: 'pointer', fontSize: 14,
        }}>← Back</button>
        <Logo size={26} />
      </div>

      <h2 style={{ color: '#fff', fontWeight: 700, fontSize: 22, margin: 0 }}>Who had what?</h2>
      <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, margin: 0 }}>
        Tap names to assign each item
      </p>

      {/* Items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {localItems.map((item, idx) => {
          const isSplitUnit = !!item.splitGroupId
          const isFirstInGroup = isSplitUnit &&
            localItems.findIndex(i => i.splitGroupId === item.splitGroupId) === idx

          return (
            <div key={idx} style={glassCard({
              padding: 14,
              borderLeft: isSplitUnit ? '3px solid rgba(139,92,246,0.5)' : undefined,
              borderRadius: isSplitUnit ? '0 16px 16px 0' : 20,
            })}>
              {/* Header row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <span style={{ color: '#fff', fontWeight: 600, fontSize: 15 }}>{item.name}</span>
                  {item.quantity > 1 && !isSplitUnit && (
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                      background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)',
                      color: '#fbbf24',
                    }}>×{item.quantity}</span>
                  )}
                  {isSplitUnit && (
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 20,
                      background: 'rgba(139,92,246,0.15)', color: '#c4b5fd',
                    }}>split</span>
                  )}
                </div>
                <span style={{
                  color: '#fff', fontWeight: 700, fontSize: 15,
                  background: 'linear-gradient(135deg, #a78bfa, #f472b6)',
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text', flexShrink: 0,
                }}>{fmt(item.price)}</span>
              </div>

              {/* Avatar row + action buttons */}
              <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
                {people.map(p => (
                  <PersonAvatar
                    key={p.id}
                    person={p}
                    label={personLabels.get(p.id)}
                    size={36}
                    active={item.assignedTo.includes(p.id)}
                    onClick={() => toggle(idx, p.id)}
                  />
                ))}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {/* Split into units button — only on unsplit multi-qty items */}
                  {item.quantity > 1 && !isSplitUnit && (
                    <button onClick={() => splitItem(idx)} style={{
                      background: 'rgba(245,158,11,0.12)',
                      border: '1px solid rgba(245,158,11,0.3)',
                      borderRadius: 8, color: '#fbbf24',
                      fontSize: 12, fontWeight: 600, padding: '5px 9px', cursor: 'pointer',
                    }}>Assign individually</button>
                  )}
                  {/* Merge back button — only on the first unit of a split group */}
                  {isFirstInGroup && (
                    <button onClick={() => mergeGroup(item.splitGroupId!)} style={{
                      background: 'rgba(139,92,246,0.12)',
                      border: '1px solid rgba(139,92,246,0.3)',
                      borderRadius: 8, color: '#a78bfa',
                      fontSize: 12, fontWeight: 600, padding: '5px 9px', cursor: 'pointer',
                    }}>Merge back</button>
                  )}
                  <button onClick={() => assignAll(idx)} style={{
                    background: 'rgba(139,92,246,0.15)',
                    border: '1px solid rgba(139,92,246,0.3)',
                    borderRadius: 8, color: '#a78bfa',
                    fontSize: 12, fontWeight: 600, padding: '5px 9px', cursor: 'pointer',
                  }}>÷ All</button>
                  {item.assignedTo.length > 0 && (
                    <button onClick={() => clearAssign(idx)} style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8, color: 'rgba(255,255,255,0.4)',
                      fontSize: 12, fontWeight: 600, padding: '5px 9px', cursor: 'pointer',
                    }}>− None</button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Charges notice */}
      {(extras.length > 0 || hasCharges) && (
        <div style={glassCard({
          padding: 16,
          background: hasCharges ? 'rgba(139,92,246,0.08)' : 'rgba(16,185,129,0.07)',
          border: hasCharges ? '1px solid rgba(139,92,246,0.2)' : '1px solid rgba(16,185,129,0.2)',
        })}>
          <p style={{ color: hasCharges ? '#a78bfa' : '#34d399', fontWeight: 700, fontSize: 13, margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            {hasCharges ? 'Taxes & Charges' : 'Taxes & Charges — Included'}
          </p>
          {extras.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 8 }}>
              {extras.map((e, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>{e.name}</span>
                  <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>{fmt(e.price)}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
              {hasCharges ? 'Verified total charges (receipt − items)' : 'Already included in item prices'}
            </span>
            <span style={{ color: hasCharges ? '#a78bfa' : '#34d399', fontWeight: 700, fontSize: 14 }}>
              {fmt(computedCharges)}
            </span>
          </div>
          {hasCharges && (
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, margin: '8px 0 0' }}>
              Split proportionally — higher spenders pay a larger share
            </p>
          )}
        </div>
      )}

      {/* Add manual item */}
      <div style={glassCard({ padding: 12 })}>
        {addingManual ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                autoFocus
                placeholder="Item name…"
                value={manualName}
                onChange={e => setManualName(e.target.value)}
                onKeyDown={e => e.key === 'Escape' && setAddingManual(false)}
                style={{
                  flex: 2, background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10,
                  padding: '10px 12px', color: '#fff', fontSize: 15, outline: 'none',
                }}
              />
              <input
                placeholder="Price"
                value={manualPrice}
                onChange={e => setManualPrice(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addManualItem(); if (e.key === 'Escape') setAddingManual(false) }}
                type="number"
                inputMode="decimal"
                style={{
                  flex: 1, background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10,
                  padding: '10px 12px', color: '#fff', fontSize: 15, outline: 'none',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={addManualItem} style={{
                flex: 1, background: 'linear-gradient(135deg, #7C3AED, #EC4899)', border: 'none',
                borderRadius: 10, color: '#fff', fontWeight: 700, padding: '10px', cursor: 'pointer', fontSize: 14,
              }}>Add Item</button>
              <button onClick={() => { setAddingManual(false); setManualName(''); setManualPrice('') }} style={{
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10, color: 'rgba(255,255,255,0.45)', padding: '10px 14px', cursor: 'pointer', fontSize: 14,
              }}>✕</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAddingManual(true)} style={{
            width: '100%', background: 'none',
            border: '1px dashed rgba(255,255,255,0.15)', borderRadius: 10,
            color: 'rgba(255,255,255,0.4)', fontSize: 14, fontWeight: 500,
            padding: '10px', cursor: 'pointer',
          }}>+ Add item manually</button>
        )}
      </div>

      {/* Add person */}
      <div style={glassCard({ padding: 12 })}>
        {addingPerson ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              autoFocus
              placeholder="Name…"
              value={newPersonName}
              onChange={e => setNewPersonName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') doAddPerson()
                if (e.key === 'Escape') { setAddingPerson(false); setNewPersonName('') }
              }}
              style={{
                flex: 1, background: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10,
                padding: '10px 12px', color: '#fff', fontSize: 15, outline: 'none',
              }}
            />
            <button onClick={doAddPerson} style={{
              background: 'linear-gradient(135deg, #7C3AED, #EC4899)', border: 'none',
              borderRadius: 10, color: '#fff', fontWeight: 700,
              padding: '10px 16px', cursor: 'pointer', fontSize: 14,
            }}>Add</button>
            <button onClick={() => { setAddingPerson(false); setNewPersonName('') }} style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10, color: 'rgba(255,255,255,0.45)',
              padding: '10px 12px', cursor: 'pointer', fontSize: 14,
            }}>✕</button>
          </div>
        ) : (
          <button onClick={() => setAddingPerson(true)} style={{
            width: '100%', background: 'none',
            border: '1px dashed rgba(255,255,255,0.15)', borderRadius: 10,
            color: 'rgba(255,255,255,0.4)', fontSize: 14, fontWeight: 500,
            padding: '10px', cursor: 'pointer',
          }}>+ Add a person</button>
        )}
      </div>

      <button
        onClick={() => onDone(localItems)}
        disabled={!allAssigned}
        style={{
          background: !allAssigned ? 'rgba(255,255,255,0.08)' : 'linear-gradient(135deg, #7C3AED, #EC4899)',
          border: 'none', borderRadius: 16, color: '#fff',
          fontWeight: 700, fontSize: 17, padding: '16px',
          cursor: !allAssigned ? 'not-allowed' : 'pointer',
          boxShadow: !allAssigned ? 'none' : '0 6px 28px rgba(124,58,237,0.5)',
          opacity: !allAssigned ? 0.5 : 1,
          transition: 'all 0.2s',
          marginTop: 4,
        }}
      >
        {!allAssigned ? 'Assign all items first' : 'Calculate Split →'}
      </button>
    </div>
  )
}

// ─── Join Screen ──────────────────────────────────────────────────────────────
function JoinScreen({
  onJoined,
  onBack,
}: {
  onJoined: (tab: TabData, myPersonId: number) => void
  onBack: () => void
}) {
  const [code, setCode] = useState('')
  const [tab, setTab] = useState<TabData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [myPersonId, setMyPersonId] = useState<number | null>(null)
  const [newName, setNewName] = useState('')

  const loadTab = async () => {
    const trimmed = code.trim().toUpperCase()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    setTab(null)
    setMyPersonId(null)
    try {
      const res = await fetch(`/api/tab/load?code=${trimmed}`)
      if (!res.ok) { setError('Tab not found. Check the code and try again.'); return }
      const data: TabData = await res.json()
      setTab(data)
    } catch {
      setError('Failed to load tab. Try again.')
    } finally {
      setLoading(false)
    }
  }

  const addSelf = () => {
    const name = newName.trim()
    if (!name || !tab) return
    const newPerson: Person = { id: Date.now(), name, colorIdx: tab.people.length }
    const updated = { ...tab, people: [...tab.people, newPerson] }
    setTab(updated)
    setMyPersonId(newPerson.id)
    setNewName('')
  }

  const inputStyle: CSSProperties = {
    width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 12, padding: '12px 14px', color: '#fff', fontSize: 16, outline: 'none',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 32 }}>
      <div style={{ textAlign: 'center', paddingTop: 8 }}>
        <Logo size={48} />
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, marginTop: 6 }}>Join an existing tab</p>
      </div>

      <div style={glassCard({ padding: 20 })}>
        <label style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Enter tab code
        </label>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input
            placeholder="e.g. A3BX7K"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && loadTab()}
            style={{ ...inputStyle, flex: 1, letterSpacing: '0.15em', fontWeight: 700, fontSize: 18 }}
            maxLength={6}
          />
          <button onClick={loadTab} disabled={loading || code.trim().length === 0} style={{
            background: 'linear-gradient(135deg, #7C3AED, #EC4899)', border: 'none', borderRadius: 12,
            color: '#fff', fontWeight: 700, fontSize: 14, padding: '0 18px', cursor: 'pointer',
            opacity: loading || code.trim().length === 0 ? 0.5 : 1,
          }}>
            {loading ? '…' : 'Load'}
          </button>
        </div>
        {error && <p style={{ color: '#F87171', fontSize: 13, marginTop: 8 }}>{error}</p>}
      </div>

      {tab && (
        <>
          <div style={glassCard({ padding: 20 })}>
            <label style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Who are you?
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              {tab.people.map(p => (
                <button key={p.id} onClick={() => setMyPersonId(p.id)} style={{
                  background: myPersonId === p.id ? COLORS[p.colorIdx % COLORS.length].bg : COLORS[p.colorIdx % COLORS.length].dim,
                  border: `2px solid ${myPersonId === p.id ? COLORS[p.colorIdx % COLORS.length].bg : 'rgba(255,255,255,0.12)'}`,
                  borderRadius: 100, padding: '7px 14px', color: '#fff',
                  fontWeight: 600, fontSize: 14, cursor: 'pointer',
                  boxShadow: myPersonId === p.id ? `0 0 12px 3px ${COLORS[p.colorIdx % COLORS.length].glow}` : 'none',
                  transition: 'all 0.15s',
                }}>{p.name}</button>
              ))}
            </div>
            <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 10 }}>Not on the list?</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <input
                placeholder="Add your name…"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addSelf()}
                style={{ ...inputStyle, flex: 1 }}
              />
              <button onClick={addSelf} style={{
                background: 'linear-gradient(135deg, #7C3AED, #EC4899)', border: 'none', borderRadius: 12,
                color: '#fff', fontWeight: 700, fontSize: 18, width: 46, cursor: 'pointer',
              }}>+</button>
            </div>
          </div>

          {tab.bills.length > 0 && (
            <div style={glassCard({ padding: 16 })}>
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
                {tab.bills.length} bill{tab.bills.length !== 1 ? 's' : ''} already in this tab
              </p>
              <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>
                Last updated by {tab.lastActiveBy}
              </p>
            </div>
          )}

          <button
            onClick={() => myPersonId !== null && onJoined(tab, myPersonId)}
            disabled={myPersonId === null}
            style={{
              background: myPersonId === null ? 'rgba(255,255,255,0.08)' : 'linear-gradient(135deg, #7C3AED 0%, #EC4899 100%)',
              border: 'none', borderRadius: 16, color: '#fff', fontWeight: 700, fontSize: 17, padding: '16px',
              cursor: myPersonId === null ? 'not-allowed' : 'pointer',
              boxShadow: myPersonId === null ? 'none' : '0 6px 28px rgba(124,58,237,0.5)',
              opacity: myPersonId === null ? 0.5 : 1, transition: 'all 0.2s',
            }}
          >
            Join Tab & Add Bill →
          </button>
        </>
      )}

      <button onClick={onBack} style={{
        background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
        fontSize: 14, cursor: 'pointer', padding: '8px 0',
      }}>← Back</button>
    </div>
  )
}

// ─── Results Screen ────────────────────────────────────────────────────────────
function ResultsScreen({
  items,
  extras,
  receiptTotal,
  people,
  completedBills,
  currentPayerId,
  tabCode,
  conflictWarning,
  onReset,
  onBack,
  onAddBill,
  onRefresh,
}: {
  items: ReceiptItem[]
  extras: Extra[]
  receiptTotal: number
  people: Person[]
  completedBills: Bill[]
  currentPayerId: number | null
  tabCode: string | null
  conflictWarning: string | null
  onReset: () => void
  onBack: () => void
  onAddBill: () => void
  onRefresh: () => void
}) {
  const [showDonationModal, setShowDonationModal] = useState(false)
  const [expandedPersonIds, setExpandedPersonIds] = useState<number[]>([])
  const [showExplanation, setShowExplanation] = useState(false)
  const HEADLINES = [
    "You just avoided the most awkward conversation of the night.",
    "The bill is split. The developer is still hungry.",
    "Show your working. Just kidding — we did it for you.",
    "Your 10th grade math teacher would be proud.",
  ]
  const headline = HEADLINES[Math.floor(Math.random() * HEADLINES.length)]

  useEffect(() => {
    const t = setTimeout(() => setShowDonationModal(true), 4000)
    return () => clearTimeout(t)
  }, [])

  // All bills including the current one
  const allBills: Bill[] = [
    ...completedBills,
    { id: 'current', payerId: currentPayerId, items, extras, receiptTotal },
  ]
  const isMultiBill = allBills.length > 1

  // Per-bill effective total helper
  const billEffectiveTotal = (b: Bill) =>
    b.receiptTotal > 0 ? b.receiptTotal
      : b.items.reduce((s, i) => s + i.price, 0) + b.extras.reduce((s, e) => s + e.price, 0)

  const grandTotal = allBills.reduce((s, b) => s + billEffectiveTotal(b), 0)

  // Per-person share for a single bill
  const calcBillShare = (bill: Bill) => {
    const sub = bill.items.reduce((s, i) => s + i.price, 0)
    const charges = bill.receiptTotal > 0
      ? Math.max(0, bill.receiptTotal - sub)
      : bill.extras.reduce((s, e) => s + e.price, 0)
    const itemShares = new Map<number, number>()
    people.forEach(p => itemShares.set(p.id, 0))
    bill.items.forEach(item => {
      item.assignedTo.forEach(id => {
        itemShares.set(id, (itemShares.get(id) ?? 0) + item.price / item.assignedTo.length)
      })
    })
    const result = new Map<number, number>()
    people.forEach(p => {
      const itemT = itemShares.get(p.id) ?? 0
      const chargeShare = charges > 0.005 && sub > 0 ? (itemT / sub) * charges : 0
      result.set(p.id, itemT + chargeShare)
    })
    return result
  }

  // Combined per-person totals across all bills
  const combinedTotals = new Map<number, number>()
  people.forEach(p => combinedTotals.set(p.id, 0))
  allBills.forEach(bill => {
    const share = calcBillShare(bill)
    people.forEach(p => combinedTotals.set(p.id, (combinedTotals.get(p.id) ?? 0) + (share.get(p.id) ?? 0)))
  })

  // For single bill — keep detailed charge breakdown
  const itemsSubtotal = items.reduce((s, i) => s + i.price, 0)
  const totalCharges = receiptTotal > 0
    ? Math.max(0, receiptTotal - itemsSubtotal)
    : extras.reduce((s, e) => s + e.price, 0)
  const hasCharges = totalCharges > 0.005

  const totals = people.map(person => ({
    person,
    total: combinedTotals.get(person.id) ?? 0,
    // For single bill detail display
    itemTotal: (() => {
      const t = new Map<number, number>()
      people.forEach(p => t.set(p.id, 0))
      items.forEach(item => item.assignedTo.forEach(id => t.set(id, (t.get(id) ?? 0) + item.price / item.assignedTo.length)))
      return t.get(person.id) ?? 0
    })(),
    chargeShare: (() => {
      const t = new Map<number, number>()
      people.forEach(p => t.set(p.id, 0))
      items.forEach(item => item.assignedTo.forEach(id => t.set(id, (t.get(id) ?? 0) + item.price / item.assignedTo.length)))
      const itemT = t.get(person.id) ?? 0
      return hasCharges && itemsSubtotal > 0 ? (itemT / itemsSubtotal) * totalCharges : 0
    })(),
  })).sort((a, b) => b.total - a.total)

  // Settlement — only when all bills have a payer assigned
  const canSettle = isMultiBill && allBills.every(b => b.payerId !== null)
  const settlement = canSettle ? calculateSettlement(people, allBills) : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 32 }}>
      <div style={{ textAlign: 'center', paddingTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 4 }}>
          <button
            onClick={onBack}
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 10, color: 'rgba(255,255,255,0.7)',
              fontWeight: 600, fontSize: 13, padding: '6px 12px',
              cursor: 'pointer',
            }}
          >← Back</button>
          <Logo size={36} />
        </div>
        <h2 style={{ color: '#fff', fontWeight: 700, fontSize: 22, margin: '8px 0 4px' }}>Here's the split</h2>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, margin: 0 }}>
          Total: {fmt(grandTotal)}
        </p>
      </div>

      {/* Tab code card */}
      {tabCode && (
        <div style={glassCard({ padding: 16, textAlign: 'center' })}>
          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 6px' }}>
            Tab Code — share this to let others add their bills
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <span style={{
              fontWeight: 800, fontSize: 28, letterSpacing: '0.18em', color: '#fff',
              background: 'rgba(255,255,255,0.06)', borderRadius: 10, padding: '6px 18px',
            }}>{tabCode}</span>
            <button
              onClick={() => { navigator.clipboard.writeText(tabCode); trackEvent('copy_tab_code') }}
              style={{
                background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 10, color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600,
                padding: '8px 14px', cursor: 'pointer',
              }}
            >Copy</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10 }}>
            <button
              onClick={onRefresh}
              style={{
                background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)',
                borderRadius: 10, color: 'rgba(167,139,250,0.9)', fontSize: 13, fontWeight: 600,
                padding: '7px 14px', cursor: 'pointer',
              }}
            >↻ Refresh</button>
            <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>Tab expires in 7 days</span>
          </div>
        </div>
      )}

      {/* Conflict warning */}
      {conflictWarning && (
        <div style={{
          background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)',
          borderRadius: 14, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <p style={{ color: 'rgba(255,220,100,0.9)', fontSize: 13, margin: 0 }}>{conflictWarning}</p>
        </div>
      )}

      {/* Per-person cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {totals.map(({ person, itemTotal, chargeShare, total }) => {
          const c = COLORS[person.colorIdx % COLORS.length]
          const myItems = items.filter(i => i.assignedTo.includes(person.id))
          const allMyItems = allBills.flatMap(b => b.items.filter(i => i.assignedTo.includes(person.id)))
          const isExpanded = expandedPersonIds.includes(person.id)
          const toggleExpand = () => setExpandedPersonIds(prev =>
            prev.includes(person.id) ? prev.filter(id => id !== person.id) : [...prev, person.id]
          )

          return (
            <div key={person.id} style={glassCard({ padding: 18, overflow: 'hidden', position: 'relative' })}>
              {/* Color accent line */}
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: 3,
                background: `linear-gradient(90deg, ${c.bg}, transparent)`,
              }} />

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <PersonAvatar person={person} size={42} active label={getInitials(person.name, people.map(p => p.name))} />
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: 17 }}>{person.name}</div>
                  <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>{(() => { const u = allMyItems.reduce((s, i) => s + i.quantity, 0); return `${u} item${u !== 1 ? 's' : ''}` })()}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {isMultiBill && (
                    <button onClick={toggleExpand} style={{
                      background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: 8, color: 'rgba(255,255,255,0.5)', fontSize: 12,
                      padding: '4px 10px', cursor: 'pointer', fontWeight: 600,
                    }}>{isExpanded ? '▲ Hide' : '▼ Details'}</button>
                  )}
                  <div style={{
                    fontSize: 26, fontWeight: 800,
                    background: `linear-gradient(135deg, ${c.bg}, #f9a8d4)`,
                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                  }}>{fmt(total)}</div>
                </div>
              </div>

              {/* Item breakdown */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {isMultiBill ? (
                  // Multi-bill: per-bill subtotals, expandable to full detail
                  allBills.map((bill, bi) => {
                    const billShare = calcBillShare(bill)
                    const share = billShare.get(person.id) ?? 0
                    if (share < 0.005) return null
                    const billItems = bill.items.filter(i => i.assignedTo.includes(person.id))
                    const billSub = bill.items.reduce((s, i) => s + i.price, 0)
                    const billCharges = bill.receiptTotal > 0 ? Math.max(0, bill.receiptTotal - billSub) : bill.extras.reduce((s, e) => s + e.price, 0)
                    const billItemT = billItems.reduce((s, i) => s + i.price / i.assignedTo.length, 0)
                    const billChargeShare = billCharges > 0.005 && billSub > 0 ? (billItemT / billSub) * billCharges : 0
                    const payerName = bill.payerId !== null ? people.find(p => p.id === bill.payerId)?.name : null
                    return (
                      <div key={bi}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>
                            Bill {bi + 1}
                            {payerName && <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}> · paid by {payerName}</span>}
                          </span>
                          <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>{fmt(share)}</span>
                        </div>
                        {isExpanded && billItems.length > 0 && (
                          <div style={{ marginTop: 6, marginLeft: 12, display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {billItems.map((item, ii) => (
                              <div key={ii} style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'rgba(255,255,255,0.38)', fontSize: 12 }}>
                                  {item.quantity > 1 && `${item.quantity}× `}{item.name}
                                  {item.assignedTo.length > 1 && <span style={{ color: 'rgba(255,255,255,0.25)' }}> ÷{item.assignedTo.length}</span>}
                                </span>
                                <span style={{ color: 'rgba(255,255,255,0.38)', fontSize: 12 }}>{fmt(item.price / item.assignedTo.length)}</span>
                              </div>
                            ))}
                            {billChargeShare > 0.005 && (
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'rgba(167,139,250,0.6)', fontSize: 12 }}>Taxes &amp; charges</span>
                                <span style={{ color: 'rgba(167,139,250,0.6)', fontSize: 12 }}>{fmt(billChargeShare)}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })
                ) : (
                  // Single bill: detailed item breakdown
                  <>
                    {myItems.map((item, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, flex: 1 }}>
                          {item.quantity > 1 && (
                            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>{item.quantity}× </span>
                          )}
                          {item.name}
                          {item.assignedTo.length > 1 && (
                            <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}> ÷{item.assignedTo.length}</span>
                          )}
                        </span>
                        <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>
                          {fmt(item.price / item.assignedTo.length)}
                        </span>
                      </div>
                    ))}
                    {hasCharges && chargeShare > 0 && (
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', marginTop: 4, paddingTop: 5, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {extras.length > 0 ? extras.map((extra, ei) => {
                          const share = itemsSubtotal > 0 ? (itemTotal / itemsSubtotal) * extra.price : 0
                          return (
                            <div key={ei} style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span style={{ color: 'rgba(167,139,250,0.75)', fontSize: 12 }}>{extra.name}</span>
                              <span style={{ color: 'rgba(167,139,250,0.75)', fontSize: 12 }}>{fmt(share)}</span>
                            </div>
                          )
                        }) : (
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'rgba(167,139,250,0.75)', fontSize: 12 }}>Taxes &amp; charges</span>
                            <span style={{ color: 'rgba(167,139,250,0.75)', fontSize: 12 }}>{fmt(chargeShare)}</span>
                          </div>
                        )}
                      </div>
                    )}
                    {!hasCharges && extras.length > 0 && (
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 4, paddingTop: 5 }}>
                        <span style={{ color: 'rgba(52,211,153,0.65)', fontSize: 12 }}>
                          ✓ Tax &amp; service charges included in prices
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Settlement section */}
      {isMultiBill && (
        <div style={glassCard({ padding: 20, background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.2)' })}>
          <p style={{ color: '#a78bfa', fontWeight: 700, fontSize: 13, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            To Settle Up
          </p>
          {!canSettle ? (
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, margin: 0 }}>
              Select who paid each bill to see transfer instructions.
            </p>
          ) : settlement.length === 0 ? (
            <p style={{ color: 'rgba(52,211,153,0.8)', fontSize: 13, margin: 0 }}>✓ All settled — no transfers needed!</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {settlement.map((t, i) => (
                <div key={i} style={{
                  background: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: '12px 14px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span style={{ color: '#fff', fontSize: 14 }}>
                    <span style={{ fontWeight: 700 }}>{t.from}</span>
                    <span style={{ color: 'rgba(255,255,255,0.4)' }}> pays </span>
                    <span style={{ fontWeight: 700 }}>{t.to}</span>
                  </span>
                  <span style={{ color: '#a78bfa', fontWeight: 800, fontSize: 16 }}>{fmt(t.amount)}</span>
                </div>
              ))}

              {/* Explanation toggle */}
              <button onClick={() => setShowExplanation(v => !v)} style={{
                background: 'none', border: 'none', color: 'rgba(167,139,250,0.6)',
                fontSize: 12, cursor: 'pointer', padding: '4px 0', textAlign: 'left',
                textDecoration: 'underline',
              }}>
                {showExplanation ? '▲ Hide calculation' : '▼ How was this calculated?'}
              </button>

              {showExplanation && (() => {
                // Build explanation data
                const consumed = new Map<number, number>()
                const paid = new Map<number, number>()
                people.forEach(p => { consumed.set(p.id, 0); paid.set(p.id, 0) })
                allBills.forEach(bill => {
                  const share = calcBillShare(bill)
                  people.forEach(p => consumed.set(p.id, (consumed.get(p.id) ?? 0) + (share.get(p.id) ?? 0)))
                  if (bill.payerId !== null) {
                    paid.set(bill.payerId, (paid.get(bill.payerId) ?? 0) + billEffectiveTotal(bill))
                  }
                })
                const net = people.map(p => ({
                  p, consumed: consumed.get(p.id) ?? 0,
                  paid: paid.get(p.id) ?? 0,
                  net: (paid.get(p.id) ?? 0) - (consumed.get(p.id) ?? 0),
                }))
                return (
                  <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

                    {/* Step 1 */}
                    <div>
                      <p style={{ color: '#a78bfa', fontWeight: 700, fontSize: 12, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Step 1 — What each person consumed</p>
                      {net.map(({ p, consumed: c }) => (
                        <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>{p.name}</span>
                          <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>{fmt(c)}</span>
                        </div>
                      ))}
                    </div>

                    {/* Step 2 */}
                    <div>
                      <p style={{ color: '#a78bfa', fontWeight: 700, fontSize: 12, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Step 2 — What each person paid</p>
                      {net.map(({ p, paid: pd }) => {
                        const theirBills = allBills.filter(b => b.payerId === p.id)
                        return (
                          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>
                              {p.name}
                              {theirBills.length > 0 && (
                                <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
                                  {' '}(Bill {theirBills.map(b => allBills.indexOf(b) + 1).join(', Bill ')})
                                </span>
                              )}
                            </span>
                            <span style={{ color: pd > 0 ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.3)', fontSize: 13 }}>{pd > 0 ? fmt(pd) : '—'}</span>
                          </div>
                        )
                      })}
                    </div>

                    {/* Step 3 */}
                    <div>
                      <p style={{ color: '#a78bfa', fontWeight: 700, fontSize: 12, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Step 3 — Net balance (paid − consumed)</p>
                      {net.map(({ p, paid: pd, consumed: c, net: n }) => (
                        <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>
                            {p.name}
                            <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}> {fmt(pd)} − {fmt(c)}</span>
                          </span>
                          <span style={{ color: n > 0.005 ? '#34d399' : n < -0.005 ? '#f87171' : 'rgba(255,255,255,0.4)', fontWeight: 700, fontSize: 13 }}>
                            {n > 0.005 ? `+${fmt(n)} owed to them` : n < -0.005 ? `−${fmt(Math.abs(n))} they owe` : '✓ settled'}
                          </span>
                        </div>
                      ))}
                    </div>

                    <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, margin: 0 }}>
                      The transfers above settle all debts using the fewest possible payments.
                    </p>
                  </div>
                )
              })()}
            </div>
          )}
        </div>
      )}

      {/* Add another bill */}
      <button
        onClick={onAddBill}
        style={{
          background: 'rgba(255,255,255,0.07)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 16, color: '#fff',
          fontWeight: 600, fontSize: 16, padding: '14px',
          cursor: 'pointer',
        }}
      >
        + Add Another Bill
      </button>

      <button
        onClick={() => { trackEvent('save_image'); downloadImage() }}
        style={{
          background: 'linear-gradient(135deg, #7C3AED, #EC4899)',
          border: 'none', borderRadius: 16, color: '#fff',
          fontWeight: 700, fontSize: 16, padding: '15px',
          cursor: 'pointer', boxShadow: '0 4px 20px rgba(124,58,237,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}
      >
        ↓ Save as Image
      </button>

      {/* Bottom donation banner */}
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16, padding: '18px 20px',
        display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'center',
      }}>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, lineHeight: 1.6, margin: 0 }}>
          SplitTab is free to use, but not free to run — AI analyses every receipt and that costs a little each time. If SplitTab made your night easier, a small donation keeps it alive. Thank you 🙏
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          {[['$2', '2'], ['$5', '5'], ['$10', '10']].map(([label, amount]) => (
            <a
              key={amount}
              href={`https://PayPal.Me/ReganLeatch/${amount}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackEvent('donation_click_footer', { amount })}
              style={{
                flex: 1, textAlign: 'center', textDecoration: 'none',
                background: 'linear-gradient(135deg, #7C3AED, #EC4899)',
                borderRadius: 12, color: '#fff',
                fontWeight: 800, fontSize: 16, padding: '12px 0',
                boxShadow: '0 4px 16px rgba(124,58,237,0.3)',
              }}
            >
              {label}
            </a>
          ))}
          <a
            href="https://PayPal.Me/ReganLeatch"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackEvent('donation_click_footer', { amount: 'custom' })}
            style={{
              flex: 1, textAlign: 'center', textDecoration: 'none',
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 12, color: 'rgba(255,255,255,0.7)',
              fontWeight: 700, fontSize: 13, padding: '12px 0',
            }}
          >
            Other
          </a>
        </div>
      </div>

      <button
        onClick={() => { trackEvent('new_split'); onReset() }}
        style={{
          background: 'rgba(255,255,255,0.07)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 16, color: '#fff',
          fontWeight: 600, fontSize: 16, padding: '14px',
          cursor: 'pointer',
        }}
      >
        Start New Split
      </button>

      {/* Donation modal */}
      {showDonationModal && (
        <div
          onClick={() => setShowDonationModal(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.75)',
            backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 16px',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#12121f',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 24, padding: '28px 24px',
              width: '100%', maxWidth: 480,
              display: 'flex', flexDirection: 'column', gap: 20,
              textAlign: 'center', position: 'relative',
            }}
          >
            {/* Dismiss X */}
            <button
              onClick={() => setShowDonationModal(false)}
              style={{
                position: 'absolute', top: 16, right: 16,
                background: 'none', border: 'none',
                color: 'rgba(255,255,255,0.3)', fontSize: 22,
                cursor: 'pointer', lineHeight: 1, padding: 0,
              }}
            >×</button>

            <div>
              <div style={{ fontSize: 40, marginBottom: 10 }}>☕</div>
              <h3 style={{ color: '#fff', fontWeight: 800, fontSize: 20, margin: '0 0 12px', lineHeight: 1.3 }}>
                {headline}
              </h3>
              <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
                SplitTab is free to use, but not free to run — AI analyses every receipt and that costs a little each time. If SplitTab made your night easier, a small donation keeps it alive. Thank you 🙏
              </p>
            </div>

            {/* Amount buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              {[['$2', '2'], ['$5', '5'], ['$10', '10']].map(([label, amount]) => (
                <a
                  key={amount}
                  href={`https://PayPal.Me/ReganLeatch/${amount}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => { trackEvent('donation_click', { amount }); setShowDonationModal(false) }}
                  style={{
                    flex: 1, textAlign: 'center', textDecoration: 'none',
                    background: 'linear-gradient(135deg, #7C3AED, #EC4899)',
                    borderRadius: 14, color: '#fff',
                    fontWeight: 800, fontSize: 18, padding: '14px 0',
                    boxShadow: '0 4px 20px rgba(124,58,237,0.35)',
                  }}
                >
                  {label}
                </a>
              ))}
              <a
                href="https://PayPal.Me/ReganLeatch"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => { trackEvent('donation_click', { amount: 'custom' }); setShowDonationModal(false) }}
                style={{
                  flex: 1, textAlign: 'center', textDecoration: 'none',
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 14, color: 'rgba(255,255,255,0.7)',
                  fontWeight: 700, fontSize: 13, padding: '14px 0',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                Other
              </a>
            </div>

            <button
              onClick={() => { trackEvent('donation_dismissed'); setShowDonationModal(false) }}
              style={{
                background: 'none', border: 'none',
                color: 'rgba(255,255,255,0.3)', fontSize: 13,
                cursor: 'pointer', padding: 0,
              }}
            >
              No thanks
            </button>
          </div>
        </div>
      )}
    </div>
  )

  function downloadImage() {
    const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    const scale = 3
    const W = 460
    const PAD = 24
    const CW = W - PAD * 2
    const LINE = 20
    const allNames = people.map(p => p.name)

    // ── Height pre-calculation ──────────────────────────────────────
    const personCardHeights = totals.map(({ person }) => {
      const myItems = items.filter(i => i.assignedTo.includes(person.id))
      let ph = 52 + myItems.length * LINE
      if (hasCharges) ph += 12 + (extras.length > 0 ? extras.length : 1) * 18
      if (!hasCharges && extras.length > 0) ph += 18
      return ph + 16
    })

    let totalH = PAD + 38 + 6 + 22 + 4 + 18 + 20 // header
    personCardHeights.forEach(ph => { totalH += ph + 10 })
    totalH += PAD + 30 // footer

    // ── Canvas ──────────────────────────────────────────────────────
    const canvas = document.createElement('canvas')
    canvas.width = W * scale
    canvas.height = totalH * scale
    const ctx = canvas.getContext('2d')!
    ctx.scale(scale, scale)

    // Background
    ctx.fillStyle = '#0b0b18'
    ctx.fillRect(0, 0, W, totalH)
    const topGrad = ctx.createLinearGradient(0, 0, W, 100)
    topGrad.addColorStop(0, 'rgba(124,58,237,0.2)')
    topGrad.addColorStop(1, 'rgba(236,72,153,0.06)')
    ctx.fillStyle = topGrad
    ctx.fillRect(0, 0, W, 100)

    const textR = (text: string, x: number, y: number) => {
      ctx.textAlign = 'right'; ctx.fillText(text, x, y); ctx.textAlign = 'left'
    }
    const trunc = (text: string, maxW: number) => {
      if (ctx.measureText(text).width <= maxW) return text
      let t = text
      while (ctx.measureText(t + '…').width > maxW && t.length > 1) t = t.slice(0, -1)
      return t + '…'
    }

    let cy = PAD
    ctx.textBaseline = 'alphabetic'

    // Logo
    ctx.font = `800 26px ${FONT}`
    ctx.fillStyle = '#e2e8f0'
    ctx.fillText('Split', PAD, cy + 26)
    const sw = ctx.measureText('Split').width
    ctx.fillStyle = '#a78bfa'
    ctx.fillText('Tab', PAD + sw, cy + 26)
    cy += 38 + 6

    // Title
    ctx.font = `700 16px ${FONT}`
    ctx.fillStyle = '#fff'
    ctx.fillText("Here's the split", PAD, cy + 16)
    cy += 22 + 4

    // Grand total
    ctx.font = `400 12px ${FONT}`
    ctx.fillStyle = 'rgba(255,255,255,0.38)'
    ctx.fillText(`Total: ${fmt(grandTotal)}`, PAD, cy + 12)
    cy += 18 + 20

    // Per-person cards
    totals.forEach(({ person, itemTotal, chargeShare, total: personTotal }, pidx) => {
      const c = COLORS[person.colorIdx % COLORS.length]
      const myItems = items.filter(i => i.assignedTo.includes(person.id))
      const cardH = personCardHeights[pidx]
      const initials = getInitials(person.name, allNames)

      // Card bg
      rrect(ctx, PAD, cy, CW, cardH, 12)
      ctx.fillStyle = 'rgba(255,255,255,0.05)'
      ctx.fill()
      // Left bar
      rrect(ctx, PAD, cy, 4, cardH, 2)
      ctx.fillStyle = c.bg
      ctx.fill()

      // Avatar
      ctx.beginPath()
      ctx.arc(PAD + 20, cy + 24, 14, 0, Math.PI * 2)
      ctx.fillStyle = c.bg + '44'
      ctx.fill()
      ctx.strokeStyle = c.bg
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.font = `700 9px ${FONT}`
      ctx.fillStyle = '#fff'
      ctx.textAlign = 'center'
      ctx.fillText(initials, PAD + 20, cy + 28)
      ctx.textAlign = 'left'

      // Name + item count
      ctx.font = `700 13px ${FONT}`
      ctx.fillStyle = '#fff'
      ctx.fillText(person.name, PAD + 40, cy + 20)
      const unitCount = myItems.reduce((s, i) => s + i.quantity, 0)
      ctx.font = `400 10px ${FONT}`
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.fillText(`${unitCount} item${unitCount !== 1 ? 's' : ''}`, PAD + 40, cy + 33)

      // Total
      ctx.font = `800 18px ${FONT}`
      ctx.fillStyle = c.bg
      textR(fmt(personTotal), PAD + CW - 12, cy + 26)

      cy += 52

      // Items
      myItems.forEach(item => {
        const share = item.price / item.assignedTo.length
        const qtyPrefix = item.quantity > 1 ? `${item.quantity}× ` : ''
        const suffix = item.assignedTo.length > 1 ? ` ÷${item.assignedTo.length}` : ''
        ctx.font = `400 11px ${FONT}`
        ctx.fillStyle = 'rgba(255,255,255,0.52)'
        ctx.fillText(trunc(qtyPrefix + item.name + suffix, CW - 70), PAD + 14, cy + 12)
        textR(fmt(share), PAD + CW - 12, cy + 12)
        cy += LINE
      })

      // Charges breakdown
      if (hasCharges && chargeShare > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.07)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(PAD + 10, cy + 4)
        ctx.lineTo(PAD + CW - 10, cy + 4)
        ctx.stroke()
        cy += 12
        if (extras.length > 0) {
          extras.forEach(extra => {
            const share = itemsSubtotal > 0 ? (itemTotal / itemsSubtotal) * extra.price : 0
            ctx.font = `400 10px ${FONT}`
            ctx.fillStyle = 'rgba(167,139,250,0.7)'
            ctx.fillText(trunc(extra.name, CW - 70), PAD + 14, cy + 11)
            textR(fmt(share), PAD + CW - 12, cy + 11)
            cy += 18
          })
        } else {
          ctx.font = `400 10px ${FONT}`
          ctx.fillStyle = 'rgba(167,139,250,0.7)'
          ctx.fillText('Taxes & charges', PAD + 14, cy + 11)
          textR(fmt(chargeShare), PAD + CW - 12, cy + 11)
          cy += 18
        }
      }

      // Included note
      if (!hasCharges && extras.length > 0) {
        ctx.font = `400 10px ${FONT}`
        ctx.fillStyle = 'rgba(52,211,153,0.6)'
        ctx.fillText('✓  Taxes & charges included in prices', PAD + 14, cy + 12)
        cy += 18
      }

      cy += 16 + 10
    })

    // Footer
    ctx.font = `400 10px ${FONT}`
    ctx.fillStyle = 'rgba(255,255,255,0.15)'
    ctx.textAlign = 'center'
    ctx.fillText('Generated by SplitTab', W / 2, cy + 14)

    const link = document.createElement('a')
    link.download = 'splittab.png'
    link.href = canvas.toDataURL('image/png')
    link.click()
  }
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState<Screen>('setup')
  const [people, setPeople] = useState<Person[]>([])
  const [items, setItems] = useState<ReceiptItem[]>([])
  const [extras, setExtras] = useState<Extra[]>([])
  const [receiptTotal, setReceiptTotal] = useState(0)
  const [completedBills, setCompletedBills] = useState<Bill[]>([])
  const [currentPayerId, setCurrentPayerId] = useState<number | null>(null)
  const [tabCode, setTabCode] = useState<string | null>(null)
  const [myPersonId, setMyPersonId] = useState<number | null>(null)
  const [conflictWarning, setConflictWarning] = useState<string | null>(null)

  // Heartbeat — keep session alive and detect conflicts
  useEffect(() => {
    if (!tabCode || !myPersonId || screen === 'setup' || screen === 'join') return
    const myName = people.find(p => p.id === myPersonId)?.name ?? 'Unknown'
    const beat = async () => {
      try {
        const res = await fetch('/api/tab/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: tabCode, personId: myPersonId, name: myName }),
        })
        if (!res.ok) return
        const { activeSessions } = await res.json()
        if (activeSessions.length > 0) {
          const names = activeSessions.map((s: { name: string }) => s.name).join(', ')
          setConflictWarning(`${names} is also active on this tab right now. Hit Refresh to see their latest bills.`)
        } else {
          setConflictWarning(null)
        }
      } catch { /* silent */ }
    }
    beat()
    const interval = setInterval(beat, 30000)
    return () => clearInterval(interval)
  }, [tabCode, myPersonId, screen, people])

  const handleSetupDone = async (ppl: Person[], pid: number) => {
    setPeople(ppl)
    setMyPersonId(pid)
    try {
      const res = await fetch('/api/tab/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ people: ppl, myPersonId: pid }),
      })
      if (res.ok) {
        const { code } = await res.json()
        setTabCode(code)
        trackEvent('tab_created')
      }
    } catch { /* non-fatal — tab just won't sync */ }
    setScreen('receipt')
  }

  const handleJoined = (tab: TabData, pid: number) => {
    setPeople(tab.people)
    setMyPersonId(pid)
    setTabCode(tab.code)
    setCompletedBills(tab.bills)
    trackEvent('tab_joined')
    setScreen('receipt')
  }

  const handleReceiptDone = (newItems: ReceiptItem[], newExtras: Extra[], total: number, payerId: number | null) => {
    setItems(newItems)
    setExtras(newExtras)
    setReceiptTotal(total)
    setCurrentPayerId(payerId)
    setScreen('assign')
  }

  const handleAssignDone = async (assignedItems: ReceiptItem[]) => {
    setItems(assignedItems)
    if (tabCode && myPersonId !== null) {
      const bill: Bill = {
        id: `bill-${Date.now()}`,
        payerId: currentPayerId,
        items: assignedItems,
        extras,
        receiptTotal,
      }
      try {
        await fetch('/api/tab/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: tabCode, bill, people, myPersonId }),
        })
        trackEvent('bill_saved_to_tab')
      } catch { /* non-fatal */ }
    }
    setScreen('results')
  }

  const handleAddPerson = (person: Person) => {
    setPeople(prev => [...prev, person])
  }

  const handleAddAnotherBill = () => {
    setCompletedBills(prev => [...prev, {
      id: `bill-${Date.now()}`,
      payerId: currentPayerId,
      items,
      extras,
      receiptTotal,
    }])
    setItems([])
    setExtras([])
    setReceiptTotal(0)
    setCurrentPayerId(null)
    setScreen('receipt')
  }

  const handleRefresh = async () => {
    if (!tabCode) return
    try {
      const res = await fetch(`/api/tab/load?code=${tabCode}`)
      if (!res.ok) return
      const tab: TabData = await res.json()
      setPeople(tab.people)
      setCompletedBills(tab.bills.slice(0, -1)) // all but last become completedBills
      const last = tab.bills[tab.bills.length - 1]
      if (last) {
        setItems(last.items)
        setExtras(last.extras)
        setReceiptTotal(last.receiptTotal)
        setCurrentPayerId(last.payerId)
      }
      trackEvent('tab_refreshed')
    } catch { /* silent */ }
  }

  const handleReset = () => {
    setItems([])
    setExtras([])
    setReceiptTotal(0)
    setCompletedBills([])
    setCurrentPayerId(null)
    setTabCode(null)
    setMyPersonId(null)
    setConflictWarning(null)
    setScreen('setup')
  }

  return (
    <div style={{ background: BG, minHeight: '100dvh', position: 'relative' }}>
      <Orbs />
      <div style={{
        position: 'relative', zIndex: 1,
        maxWidth: 480, margin: '0 auto',
        padding: '20px 16px',
      }}>
        {screen === 'setup' && (
          <SetupScreen onStart={handleSetupDone} onJoin={() => setScreen('join')} />
        )}
        {screen === 'join' && (
          <JoinScreen onJoined={handleJoined} onBack={() => setScreen('setup')} />
        )}
        {screen === 'receipt' && (
          <ReceiptScreen
            people={people}
            billNumber={completedBills.length + 1}
            onDone={handleReceiptDone}
            onBack={() => completedBills.length > 0 ? setScreen('results') : setScreen('setup')}
          />
        )}
        {screen === 'assign' && (
          <AssignScreen
            items={items}
            extras={extras}
            receiptTotal={receiptTotal}
            people={people}
            onDone={handleAssignDone}
            onBack={() => setScreen('receipt')}
            onAddPerson={handleAddPerson}
          />
        )}
        {screen === 'results' && (
          <ResultsScreen
            items={items}
            extras={extras}
            receiptTotal={receiptTotal}
            people={people}
            completedBills={completedBills}
            currentPayerId={currentPayerId}
            tabCode={tabCode}
            conflictWarning={conflictWarning}
            onReset={handleReset}
            onBack={() => setScreen('assign')}
            onAddBill={handleAddAnotherBill}
            onRefresh={handleRefresh}
          />
        )}
      </div>
      <Analytics />
    </div>
  )
}
