import { useState, useRef, CSSProperties } from 'react'
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
type Screen = 'setup' | 'receipt' | 'assign' | 'results'

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
}: {
  onStart: (people: Person[]) => void
}) {
  const [nameInput, setNameInput] = useState('')
  const [people, setPeople] = useState<Person[]>([])

  const addPerson = () => {
    const name = nameInput.trim()
    if (!name) return
    setPeople(p => [...p, { id: Date.now(), name, colorIdx: p.length }])
    setNameInput('')
  }

  const removePerson = (id: number) => setPeople(p => p.filter(x => x.id !== id))

  const handleStart = () => {
    if (people.length < 2) return
    onStart(people)
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

      {/* CTA */}
      <button
        onClick={handleStart}
        disabled={people.length < 2}
        style={{
          background: people.length < 2
            ? 'rgba(255,255,255,0.08)'
            : 'linear-gradient(135deg, #7C3AED 0%, #EC4899 100%)',
          border: 'none', borderRadius: 16, color: '#fff',
          fontWeight: 700, fontSize: 17, padding: '16px',
          cursor: people.length < 2 ? 'not-allowed' : 'pointer',
          boxShadow: people.length < 2
            ? 'none'
            : '0 6px 28px rgba(124,58,237,0.5)',
          transition: 'all 0.2s',
          opacity: people.length < 2 ? 0.5 : 1,
        }}
      >
        Scan Receipt →
      </button>
    </div>
  )
}

// ─── Receipt Screen ───────────────────────────────────────────────────────────
function ReceiptScreen({
  onDone,
  onBack,
}: {
  onDone: (items: ReceiptItem[], extras: Extra[], receiptTotal: number) => void
  onBack: () => void
}) {
  const [image, setImage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  const handleFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = e => setImage(e.target?.result as string)
    reader.readAsDataURL(file)
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

      onDone(items, extras, receiptTotal)
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

      <h2 style={{ color: '#fff', fontWeight: 700, fontSize: 22, margin: 0 }}>Scan your receipt</h2>

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
              flex: 1,
              background: 'linear-gradient(135deg, #7C3AED, #EC4899)',
              border: 'none', borderRadius: 12, color: '#fff',
              fontWeight: 600, fontSize: 15, padding: '13px 0', cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(124,58,237,0.4)',
            }}>📷 Camera</button>
            <button onClick={() => fileRef.current?.click()} style={{
              flex: 1,
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 12, color: '#fff',
              fontWeight: 600, fontSize: 15, padding: '13px 0', cursor: 'pointer',
            }}>📁 Gallery</button>
          </div>
        </div>
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

// ─── Results Screen ────────────────────────────────────────────────────────────
function ResultsScreen({
  items,
  extras,
  receiptTotal,
  people,
  onReset,
  onBack,
}: {
  items: ReceiptItem[]
  extras: Extra[]
  receiptTotal: number
  people: Person[]
  onReset: () => void
  onBack: () => void
}) {
  const itemsSubtotal = items.reduce((s, i) => s + i.price, 0)

  // Ground-truth: total charges = receipt total minus all item prices
  // Falls back to sum of extracted extras if receipt_total wasn't captured
  const totalCharges = receiptTotal > 0
    ? Math.max(0, receiptTotal - itemsSubtotal)
    : extras.reduce((s, e) => s + e.price, 0)
  const hasCharges = totalCharges > 0.005
  const grandTotal = itemsSubtotal + totalCharges

  // Per-person item subtotals
  const personItemTotals = new Map<number, number>()
  people.forEach(p => personItemTotals.set(p.id, 0))
  items.forEach(item => {
    item.assignedTo.forEach(id => {
      personItemTotals.set(id, (personItemTotals.get(id) ?? 0) + item.price / item.assignedTo.length)
    })
  })

  const totals = people.map(person => {
    const itemTotal = personItemTotals.get(person.id) ?? 0
    // Proportional share of verified charges
    const chargeShare = hasCharges && itemsSubtotal > 0
      ? (itemTotal / itemsSubtotal) * totalCharges
      : 0
    return { person, itemTotal, chargeShare, total: itemTotal + chargeShare }
  }).sort((a, b) => b.total - a.total)

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

      {/* Per-person cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {totals.map(({ person, itemTotal, chargeShare, total }) => {
          const c = COLORS[person.colorIdx % COLORS.length]
          const myItems = items.filter(i => i.assignedTo.includes(person.id))

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
                  <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>{(() => { const u = myItems.reduce((s, i) => s + i.quantity, 0); return `${u} item${u !== 1 ? 's' : ''}` })()}</div>
                </div>
                <div style={{
                  fontSize: 26, fontWeight: 800,
                  background: `linear-gradient(135deg, ${c.bg}, #f9a8d4)`,
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}>{fmt(total)}</div>
              </div>

              {/* Item breakdown */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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
                {/* Charges row */}
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
              </div>
            </div>
          )
        })}
      </div>

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

      {/* Donation banner */}
      <div style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.09)',
        borderRadius: 16, padding: '18px 20px',
        display: 'flex', flexDirection: 'column', gap: 12,
        textAlign: 'center',
      }}>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, lineHeight: 1.6, margin: 0 }}>
          SplitTab is free to use, but not free to run — AI analyses every receipt and that costs a little each time. If SplitTab made your night easier, a small donation keeps it alive. Thank you 🙏
        </p>
        <a
          href="https://PayPal.Me/ReganLeatch"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackEvent('donation_click')}
          style={{
            display: 'inline-block',
            background: 'linear-gradient(135deg, #0070BA, #003087)',
            border: 'none', borderRadius: 12, color: '#fff',
            fontWeight: 700, fontSize: 15, padding: '12px 24px',
            cursor: 'pointer', textDecoration: 'none',
            boxShadow: '0 4px 16px rgba(0,112,186,0.4)',
          }}
        >
          ☕ Buy me a coffee
        </a>
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

  const handleSetupDone = (ppl: Person[]) => {
    setPeople(ppl)
    setScreen('receipt')
  }

  const handleReceiptDone = (newItems: ReceiptItem[], newExtras: Extra[], total: number) => {
    setItems(newItems)
    setExtras(newExtras)
    setReceiptTotal(total)
    setScreen('assign')
  }

  const handleAssignDone = (assignedItems: ReceiptItem[]) => {
    setItems(assignedItems)
    setScreen('results')
  }

  const handleAddPerson = (person: Person) => {
    setPeople(prev => [...prev, person])
  }

  const handleReset = () => {
    setItems([])
    setExtras([])
    setReceiptTotal(0)
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
          <SetupScreen onStart={handleSetupDone} />
        )}
        {screen === 'receipt' && (
          <ReceiptScreen
            onDone={handleReceiptDone}
            onBack={() => setScreen('setup')}
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
            onReset={handleReset}
            onBack={() => setScreen('assign')}
          />
        )}
      </div>
      <Analytics />
    </div>
  )
}
