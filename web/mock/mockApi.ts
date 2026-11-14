/**
 * DEV-ONLY in-memory stand-in for the backend, for looking at screens when
 * the real API on :8010 is not running. Enabled only by `DING_MOCK=1 npm run dev`
 * (see vite.config.ts); `vite build` never loads this file.
 *
 * It follows docs/API.md shapes. The "waiter" is a tiny script, not an LLM.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import type {
  Allergen,
  Dish,
  DishDraft,
  GuestAllergies,
  KnowledgeItem,
  Order,
  OrderStatus,
  Restaurant,
  SessionSummary,
  Table,
  TranscriptLine,
  WaiterCall,
} from '../src/api/types.ts'

const now = () => new Date().toISOString()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const VOICE = process.env.DING_MOCK_VOICE !== '0'

const ALLERGENS: Allergen[] = ['gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soy', 'milk', 'tree_nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs']
const label = (id: string) => (id.charAt(0).toUpperCase() + id.slice(1)).replace(/_/g, ' ')

// ---------------- state ----------------
let loggedIn = false
let ids = 100
const nextId = () => ++ids
const photos = new Map<number, { type: string; data: Buffer }>()

const restaurant: Restaurant = {
  id: 1,
  name: 'Bistro Lumière',
  currency: 'USD',
  menu_language: 'en',
  persona_name: 'Ding',
  voice_id: 'v1',
  llm_model: 'claude-opus-5-5',
  stt_model: 'scribe_v3',
  tts_model: 'eleven_v4_turbo',
}

function dish(id: number, name: string, category: string, price: number, description: string, ingredients: string[], allergens: Allergen[], may_contain: Allergen[] = [], tags: Dish['dietary_tags'] = []): Dish {
  return { id, name, category, price, description, ingredients, allergens, may_contain, dietary_tags: tags, available: true, photo_url: null, created_at: now(), updated_at: now() }
}

const dishes: Dish[] = [
  dish(1, 'Pad Thai', 'Mains', 14.5, 'Wok-fried rice noodles with tamarind, crushed peanuts and lime.', ['rice noodles', 'peanuts', 'egg', 'tamarind', 'lime'], ['peanuts', 'eggs', 'soy'], ['sesame'], ['spicy']),
  dish(2, 'Mushroom risotto', 'Mains', 16, 'Carnaroli rice, porcini, parmesan and thyme.', ['carnaroli rice', 'porcini', 'parmesan', 'butter', 'white wine'], ['milk', 'sulphites'], [], ['vegetarian', 'gluten_free']),
  dish(3, 'Burrata salad', 'Starters', 11, 'Creamy burrata, heirloom tomatoes, basil oil.', ['burrata', 'tomato', 'basil', 'olive oil'], ['milk'], [], ['vegetarian', 'gluten_free']),
  dish(4, 'Grilled sea bass', 'Mains', 22, 'Whole sea bass, lemon, capers and new potatoes.', ['sea bass', 'lemon', 'capers', 'potatoes'], ['fish'], [], ['gluten_free']),
  dish(5, 'Tiramisu', 'Desserts', 8, 'Espresso-soaked savoiardi, mascarpone, cocoa.', ['savoiardi', 'mascarpone', 'espresso', 'egg', 'cocoa'], ['gluten', 'eggs', 'milk'], ['tree_nuts']),
  dish(6, 'Pistachio gelato', 'Desserts', 6.5, 'Sicilian pistachio, two scoops.', ['pistachio', 'milk', 'sugar'], ['tree_nuts', 'milk'], ['peanuts'], ['vegetarian', 'gluten_free']),
  dish(7, 'Lemonade', 'Drinks', 4.5, 'Fresh lemons, mint, sparkling water.', ['lemon', 'mint', 'sugar'], [], [], ['vegan', 'gluten_free']),
]

const knowledge: KnowledgeItem[] = [
  { id: 1, title: 'Opening hours', content: 'Mon–Fri 12:00–23:00, weekends 11:00–00:00. Kitchen closes 30 minutes earlier.', updated_at: now() },
  { id: 2, title: 'Wi-Fi', content: 'Network: Lumiere-Guests, password: bonappetit', updated_at: now() },
]

const tables: Table[] = [
  { id: 1, label: 'Table 1', token: 'demo-table-1', url: '/t/demo-table-1', active_session_id: null, created_at: now() },
  { id: 2, label: 'Table 2', token: 'demo-table-2', url: '/t/demo-table-2', active_session_id: null, created_at: now() },
]

interface Session {
  id: number
  table_id: number
  status: 'active' | 'closed'
  language: string | null
  allergies: GuestAllergies
  transcript: TranscriptLine[]
  order: Order | null
  started_at: string
  last_activity_at: string
}
const sessions: Session[] = []
const orders: Order[] = []
const calls: WaiterCall[] = []

// seed a couple of finished orders for the dashboard
function seedOrder(table: Table, status: OrderStatus, items: [Dish, number][], allergies: Allergen[] = [], note: string | null = null, minutesAgo = 10) {
  const at = new Date(Date.now() - minutesAgo * 60_000).toISOString()
  const s: Session = {
    id: nextId(),
    table_id: table.id,
    status: 'closed',
    language: 'es',
    allergies: { confirmed: true, allergens: allergies, notes: note, none_declared: !allergies.length },
    transcript: [
      { role: 'guest', text: '¿Qué me recomiendas?', at },
      { role: 'waiter', text: 'Con gusto. Antes de nada, ¿tienes alguna alergia?', at },
    ],
    order: null,
    started_at: at,
    last_activity_at: at,
  }
  const o: Order = {
    id: nextId(),
    table_id: table.id,
    table_label: table.label,
    session_id: s.id,
    status,
    items: items.map(([d, q]) => ({ id: nextId(), dish_id: d.id, name: d.name, price: d.price, quantity: q, notes: null, allergen_flag: d.allergens.some((a) => allergies.includes(a)), photo_url: d.photo_url })),
    total: items.reduce((sum, [d, q]) => sum + d.price * q, 0),
    currency: restaurant.currency,
    allergies,
    allergy_note: note,
    language: 'es',
    placed_at: at,
    created_at: at,
  }
  s.order = o
  sessions.push(s)
  orders.unshift(o)
}
seedOrder(tables[1], 'preparing', [[dishes[1], 1], [dishes[2], 1]], ['peanuts'], 'Severe peanut allergy', 6)
seedOrder(tables[0], 'served', [[dishes[3], 2], [dishes[6], 2]], [], null, 45)

// ---------------- SSE ----------------
const streams = new Set<ServerResponse>()
function broadcast(event: string, data: unknown) {
  for (const res of streams) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

// ---------------- helpers ----------------
function send(res: ServerResponse, status: number, body?: unknown) {
  res.statusCode = status
  if (body === undefined) return res.end()
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}
const fail = (res: ServerResponse, status: number, detail: string) => send(res, status, { detail })

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}
async function readJson<T>(req: IncomingMessage): Promise<T> {
  const raw = (await readBody(req)).toString('utf8')
  return (raw ? JSON.parse(raw) : {}) as T
}
/** Minimal multipart reader: returns the first file part. */
function firstFile(body: Buffer, contentType: string): { name: string; type: string; data: Buffer } | null {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType)
  if (!m) return null
  const boundary = Buffer.from(`--${m[1] ?? m[2]}`)
  let start = body.indexOf(boundary)
  while (start !== -1) {
    const next = body.indexOf(boundary, start + boundary.length)
    if (next === -1) break
    const part = body.subarray(start + boundary.length + 2, next - 2)
    const headerEnd = part.indexOf('\r\n\r\n')
    const headers = part.subarray(0, headerEnd).toString('utf8')
    if (/filename=/.test(headers)) {
      return {
        name: /name="([^"]+)"/.exec(headers)?.[1] ?? 'file',
        type: /Content-Type:\s*([^\r\n]+)/i.exec(headers)?.[1] ?? 'application/octet-stream',
        data: part.subarray(headerEnd + 4),
      }
    }
    start = next
  }
  return null
}

const summary = (s: Session): SessionSummary => ({
  id: s.id,
  table_id: s.table_id,
  table_label: tables.find((t) => t.id === s.table_id)?.label ?? 'Table',
  status: s.status,
  language: s.language,
  allergies: s.allergies,
  turn_count: s.transcript.filter((l) => l.role === 'guest').length,
  order_id: s.order?.id ?? null,
  started_at: s.started_at,
  last_activity_at: s.last_activity_at,
})

function activeSession(table: Table): Session | null {
  return sessions.find((s) => s.table_id === table.id && s.status === 'active') ?? null
}

function recalc(order: Order) {
  order.total = Math.round(order.items.reduce((sum, i) => sum + i.price * i.quantity, 0) * 100) / 100
}

/** A short sine "voice" clip as base64 WAV, so the browser player has real audio to queue. */
function toneWav(seconds: number, freq: number): string {
  const rate = 16000
  const n = Math.floor(seconds * rate)
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 400, (n - i) / 400) * (0.55 + 0.45 * Math.sin((i / rate) * Math.PI * 7))
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 6000 * env), 44 + i * 2)
  }
  return buf.toString('base64')
}

// ---------------- the scripted waiter ----------------
function findDish(text: string): Dish | undefined {
  const t = text.toLowerCase()
  return dishes.find((d) => d.available && t.includes(d.name.toLowerCase().split(' ')[0]))
}

function waiterReply(table: Table, session: Session, text: string): { reply: string; shown: Dish[]; called?: string } {
  const t = text.toLowerCase()
  const persona = restaurant.persona_name
  if (/waiter|human|person|staff/.test(t)) return { reply: 'Of course. I have asked a colleague to come to your table.', shown: [], called: 'Guest asked for a person' }

  const mentioned = ALLERGENS.filter((a) => t.includes(a.replace('_', ' ').replace(/s$/, '')))
  if (/no allerg|none|nothing/.test(t)) {
    session.allergies = { confirmed: true, allergens: [], notes: null, none_declared: true }
    return { reply: 'Great, no allergies noted. What would you like?', shown: dishes.filter((d) => d.category === 'Mains').slice(0, 3) }
  }
  if (/allerg/.test(t) || (mentioned.length && !findDish(t))) {
    session.allergies = { confirmed: true, allergens: mentioned, notes: mentioned.length ? text : null, none_declared: !mentioned.length }
    return { reply: `Thank you, I noted ${mentioned.map(label).join(' and ').toLowerCase() || 'that'}. I will keep it in mind for everything I suggest.`, shown: [] }
  }

  const d = findDish(t)
  if (d && /order|have|take|like|want|please/.test(t)) {
    if (!session.allergies.confirmed) return { reply: `${d.name} is a great choice. Before I add it, do you have any allergies or dietary needs?`, shown: [d] }
    const clash = [...d.allergens, ...d.may_contain].filter((a) => session.allergies.allergens.includes(a))
    if (clash.length && !/anyway|sure|risk/.test(t)) {
      return { reply: `Careful: ${d.name} contains ${clash.map(label).join(' and ').toLowerCase()}. I would suggest the mushroom risotto instead. Or say "anyway" if you still want it.`, shown: [d, dishes[1]] }
    }
    if (!session.order) {
      session.order = { id: nextId(), table_id: table.id, table_label: table.label, session_id: session.id, status: 'draft', items: [], total: 0, currency: restaurant.currency, allergies: session.allergies.allergens, allergy_note: session.allergies.notes, language: session.language, placed_at: null, created_at: now() }
    }
    session.order.items.push({ id: nextId(), dish_id: d.id, name: d.name, price: d.price, quantity: 1, notes: null, allergen_flag: clash.length > 0, photo_url: d.photo_url })
    recalc(session.order)
    return { reply: `I added one ${d.name}. Anything else, or shall I send the order to the kitchen?`, shown: [d] }
  }
  if (session.order?.status === 'draft' && session.order.items.length && /send|yes|that's all|thats all|done/.test(t)) {
    session.order.status = 'placed'
    session.order.placed_at = now()
    session.order.allergies = session.allergies.allergens
    session.order.allergy_note = session.allergies.notes
    orders.unshift(session.order)
    broadcast('order.placed', session.order)
    return { reply: `Done. Your order is on its way to the kitchen. Enjoy your meal!`, shown: [] }
  }
  if (d) return { reply: `${d.name}: ${d.description} It costs ${d.price} dollars.`, shown: [d] }
  return { reply: `Hello, I'm ${persona}. Tonight I would recommend the mushroom risotto or the sea bass. Do you have any allergies I should know about?`, shown: [dishes[1], dishes[3]] }
}

async function runTurn(req: IncomingMessage, res: ServerResponse, table: Table) {
  const ct = req.headers['content-type'] ?? ''
  let text: string
  let speak = VOICE
  if (ct.includes('application/json')) {
    const body = await readJson<{ text: string; speak?: boolean }>(req)
    text = body.text ?? ''
    speak = VOICE && body.speak !== false
  } else {
    const file = firstFile(await readBody(req), ct)
    // No speech recognition in the mock: tiny clips count as "nothing heard".
    text = file && file.data.length > 4000 ? 'What do you recommend?' : ''
  }

  res.statusCode = 200
  res.setHeader('Content-Type', 'application/x-ndjson')
  const line = (o: unknown) => res.write(JSON.stringify(o) + '\n')
  let closed = false
  req.on('close', () => (closed = true))

  await sleep(350)
  if (!text.trim()) {
    line({ type: 'transcript', text: '', language: null })
    line({ type: 'done' })
    return res.end()
  }
  const language = /[¿¡ñ]|hola|gracias/i.test(text) ? 'es' : /[԰-֏]/.test(text) ? 'hy' : 'en'
  line({ type: 'transcript', text, language })

  let session = activeSession(table)
  if (!session) {
    session = { id: nextId(), table_id: table.id, status: 'active', language, allergies: { confirmed: false, allergens: [], notes: null, none_declared: false }, transcript: [], order: null, started_at: now(), last_activity_at: now() }
    sessions.push(session)
    table.active_session_id = session.id
  }
  session.language = language
  session.transcript.push({ role: 'guest', text, at: now() })

  if (/error/i.test(text)) {
    await sleep(400)
    line({ type: 'error', message: 'The kitchen system is not answering. Please try again.' })
    return res.end()
  }

  await sleep(600)
  const { reply, shown, called } = waiterReply(table, session, text)
  const sentences = reply.match(/[^.!?]+[.!?]*\s*/g) ?? [reply]
  if (shown.length) line({ type: 'dishes', dishes: shown })
  let seq = 0
  for (const sentence of sentences) {
    for (const word of sentence.split(/(?<=\s)/)) {
      if (closed) return
      line({ type: 'text', delta: word })
      await sleep(45)
    }
    if (speak) line({ type: 'audio', seq: seq++, mime: 'audio/wav', b64: toneWav(Math.min(2.2, 0.35 + sentence.length * 0.035), 196 + seq * 22) })
  }
  session.transcript.push({ role: 'waiter', text: reply, at: now() })
  session.last_activity_at = now()
  if (called) {
    const call: WaiterCall = { id: nextId(), table_id: table.id, table_label: table.label, reason: called, resolved: false, created_at: now() }
    calls.unshift(call)
    broadcast('waiter.called', call)
    line({ type: 'waiter_called', reason: called })
  }
  line({ type: 'state', order: session.order, allergies: session.allergies, language })
  broadcast('session.updated', summary(session))
  line({ type: 'done' })
  res.end()
}

// ---------------- router ----------------
type Handler = (req: IncomingMessage, res: ServerResponse, m: RegExpExecArray, url: URL) => unknown | Promise<unknown>
const routes: [string, RegExp, Handler, boolean?][] = []
const route = (method: string, pattern: string, handler: Handler, open = false) =>
  routes.push([method, new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler, open])

route('GET', '/api/meta', (_q, res) => send(res, 200, {
  allergens: ALLERGENS.map((id) => ({ id, label: id === 'tree_nuts' ? 'Tree nuts' : id === 'sulphites' ? 'Sulphites' : label(id) })),
  dietary_tags: ['vegan', 'vegetarian', 'halal', 'kosher', 'gluten_free', 'spicy'].map((id) => ({ id, label: id === 'gluten_free' ? 'Gluten-free' : label(id) })),
}), true)

const me = () => ({ user: { id: 1, email: 'owner@example.com' }, restaurant })
route('POST', '/api/auth/signup', async (req, res) => {
  const b = await readJson<{ restaurant_name: string }>(req)
  if (b.restaurant_name) restaurant.name = b.restaurant_name
  loggedIn = true
  res.setHeader('Set-Cookie', 'mock_session=1; Path=/; HttpOnly')
  send(res, 200, me())
}, true)
route('POST', '/api/auth/login', async (req, res) => {
  const b = await readJson<{ password: string }>(req)
  if (b.password === 'wrong') return fail(res, 401, 'Wrong email or password')
  loggedIn = true
  send(res, 200, me())
}, true)
route('POST', '/api/auth/logout', (_q, res) => {
  loggedIn = false
  send(res, 204)
}, true)
route('GET', '/api/me', (_q, res) => send(res, 200, me()))
route('GET', '/api/restaurant', (_q, res) => send(res, 200, restaurant))
route('PATCH', '/api/restaurant', async (req, res) => {
  Object.assign(restaurant, await readJson(req))
  send(res, 200, restaurant)
})
route('GET', '/api/voices', (_q, res) => send(res, 200, [
  { voice_id: 'v1', name: 'Aria', preview_url: null, labels: { accent: 'american', gender: 'female' } },
  { voice_id: 'v2', name: 'Roger', preview_url: null, labels: { accent: 'british', gender: 'male' } },
  { voice_id: 'v3', name: 'Lucía', preview_url: null, labels: { accent: 'spanish', gender: 'female' } },
]))
route('GET', '/api/models', (_q, res) => send(res, 200, {
  llm: [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' }],
  stt: [{ id: 'scribe_v3', label: 'Scribe v3' }, { id: 'scribe_v2', label: 'Scribe v2' }],
  tts: [{ id: 'eleven_v4_turbo', label: 'Eleven v4 Turbo' }],
}))

route('GET', '/api/dishes', (_q, res, _m, url) => {
  const q = url.searchParams.get('q')?.toLowerCase()
  const c = url.searchParams.get('category')
  send(res, 200, dishes.filter((d) => (!c || d.category === c) && (!q || d.name.toLowerCase().includes(q))))
})
route('POST', '/api/dishes', async (req, res) => {
  const d = { ...(await readJson<Dish>(req)), id: nextId(), photo_url: null, created_at: now(), updated_at: now() }
  dishes.push(d)
  send(res, 200, d)
})
route('POST', '/api/dishes/suggest-allergens', async (req, res) => {
  const b = await readJson<{ name: string; description: string; ingredients: string[] }>(req)
  await sleep(900)
  const text = [b.name, b.description, ...b.ingredients].join(' ').toLowerCase()
  const rules: [RegExp, Allergen][] = [[/flour|bread|pasta|wheat|noodle/, 'gluten'], [/egg/, 'eggs'], [/milk|cheese|cream|butter|parmesan|mozzarella/, 'milk'], [/peanut/, 'peanuts'], [/almond|pistachio|walnut|hazelnut/, 'tree_nuts'], [/soy|tofu/, 'soy'], [/shrimp|prawn|crab/, 'crustaceans'], [/fish|salmon|tuna|bass/, 'fish'], [/sesame|tahini/, 'sesame']]
  const allergens = rules.filter(([r]) => r.test(text)).map(([, a]) => a)
  send(res, 200, { allergens, may_contain: allergens.includes('peanuts') ? [] : ['sesame'], dietary_tags: allergens.length ? [] : ['vegan'], rationale: 'Based on the listed ingredients. Sesame is often handled in the same kitchen.' })
})
route('POST', '/api/dishes/bulk', async (req, res) => {
  const b = await readJson<{ dishes: DishDraft[] }>(req)
  const made = b.dishes.map((d) => ({ ...d, price: d.price ?? 0, id: nextId(), photo_url: null, available: true, created_at: now(), updated_at: now() }) as Dish)
  dishes.push(...made)
  send(res, 200, made)
})
route('POST', '/api/menu/import', async (req, res) => {
  await readBody(req)
  await sleep(1500)
  send(res, 200, { dishes: [
    { name: 'Bruschetta', description: 'Grilled bread, tomato, garlic, basil.', category: 'Starters', price: 7, ingredients: ['bread', 'tomato', 'garlic', 'basil'], allergens: ['gluten'], may_contain: [], dietary_tags: ['vegan'] },
    { name: 'Penne arrabbiata', description: 'Spicy tomato sauce.', category: 'Mains', price: null, ingredients: ['penne', 'tomato', 'chilli'], allergens: ['gluten'], may_contain: ['eggs'], dietary_tags: ['vegan', 'spicy'] },
    { name: 'Panna cotta', description: 'Vanilla, berry coulis.', category: 'Desserts', price: 7.5, ingredients: ['cream', 'vanilla', 'berries', 'gelatine'], allergens: ['milk'], may_contain: [], dietary_tags: [] },
  ] satisfies DishDraft[] })
})
route('PATCH', '/api/dishes/:id', async (req, res, m) => {
  const d = dishes.find((x) => x.id === Number(m.groups!.id))
  if (!d) return fail(res, 404, 'Dish not found')
  Object.assign(d, await readJson(req), { updated_at: now() })
  send(res, 200, d)
})
route('DELETE', '/api/dishes/:id', (_q, res, m) => {
  const i = dishes.findIndex((x) => x.id === Number(m.groups!.id))
  if (i >= 0) dishes.splice(i, 1)
  send(res, 204)
})
route('POST', '/api/dishes/:id/photo', async (req, res, m) => {
  const d = dishes.find((x) => x.id === Number(m.groups!.id))
  if (!d) return fail(res, 404, 'Dish not found')
  const file = firstFile(await readBody(req), req.headers['content-type'] ?? '')
  if (!file) return fail(res, 422, 'No file')
  photos.set(d.id, { type: file.type, data: file.data })
  d.photo_url = `/media/dishes/${d.id}.jpg?v=${Date.now()}`
  send(res, 200, d)
})
route('DELETE', '/api/dishes/:id/photo', (_q, res, m) => {
  const d = dishes.find((x) => x.id === Number(m.groups!.id))
  if (!d) return fail(res, 404, 'Dish not found')
  photos.delete(d.id)
  d.photo_url = null
  send(res, 200, d)
})
route('GET', '/media/dishes/:file', (_q, res, m) => {
  const p = photos.get(Number(m.groups!.file.split('.')[0]))
  if (!p) return fail(res, 404, 'No photo')
  res.setHeader('Content-Type', p.type)
  res.end(p.data)
}, true)

route('GET', '/api/knowledge', (_q, res) => send(res, 200, knowledge))
route('POST', '/api/knowledge', async (req, res) => {
  const k = { ...(await readJson<KnowledgeItem>(req)), id: nextId(), updated_at: now() }
  knowledge.unshift(k)
  send(res, 200, k)
})
route('PATCH', '/api/knowledge/:id', async (req, res, m) => {
  const k = knowledge.find((x) => x.id === Number(m.groups!.id))
  if (!k) return fail(res, 404, 'Not found')
  Object.assign(k, await readJson(req), { updated_at: now() })
  send(res, 200, k)
})
route('DELETE', '/api/knowledge/:id', (_q, res, m) => {
  const i = knowledge.findIndex((x) => x.id === Number(m.groups!.id))
  if (i >= 0) knowledge.splice(i, 1)
  send(res, 204)
})

route('GET', '/api/tables', (_q, res) => send(res, 200, tables))
route('POST', '/api/tables', async (req, res) => {
  const b = await readJson<{ label: string }>(req)
  const token = Math.random().toString(36).slice(2, 10)
  const t: Table = { id: nextId(), label: b.label, token, url: `/t/${token}`, active_session_id: null, created_at: now() }
  tables.push(t)
  send(res, 200, t)
})
route('PATCH', '/api/tables/:id', async (req, res, m) => {
  const t = tables.find((x) => x.id === Number(m.groups!.id))
  if (!t) return fail(res, 404, 'Not found')
  Object.assign(t, await readJson(req))
  send(res, 200, t)
})
route('DELETE', '/api/tables/:id', (_q, res, m) => {
  const i = tables.findIndex((x) => x.id === Number(m.groups!.id))
  if (i >= 0) tables.splice(i, 1)
  send(res, 204)
})

route('GET', '/api/orders', (_q, res, _m, url) => {
  const want = url.searchParams.get('status')?.split(',')
  send(res, 200, orders.filter((o) => (want ? want.includes(o.status) : o.status !== 'draft')))
})
route('PATCH', '/api/orders/:id', async (req, res, m) => {
  const o = orders.find((x) => x.id === Number(m.groups!.id))
  if (!o) return fail(res, 404, 'Not found')
  o.status = (await readJson<{ status: OrderStatus }>(req)).status
  broadcast('order.updated', o)
  send(res, 200, o)
})
route('GET', '/api/waiter-calls', (_q, res, _m, url) => {
  const r = url.searchParams.get('resolved')
  send(res, 200, calls.filter((c) => r === null || String(c.resolved) === r))
})
route('PATCH', '/api/waiter-calls/:id', async (req, res, m) => {
  const c = calls.find((x) => x.id === Number(m.groups!.id))
  if (!c) return fail(res, 404, 'Not found')
  c.resolved = (await readJson<{ resolved: boolean }>(req)).resolved
  send(res, 200, c)
})
route('GET', '/api/sessions', (_q, res) => send(res, 200, sessions.map(summary)))
route('GET', '/api/sessions/:id', (_q, res, m) => {
  const s = sessions.find((x) => x.id === Number(m.groups!.id))
  if (!s) return fail(res, 404, 'Not found')
  send(res, 200, { ...summary(s), transcript: s.transcript, order: s.order })
})
route('GET', '/api/stats', (_q, res) => {
  const placed = orders.filter((o) => o.status !== 'draft' && o.status !== 'cancelled')
  const revenue = placed.reduce((s, o) => s + o.total, 0)
  const counts = new Map<number, { dish_id: number; name: string; quantity: number }>()
  for (const o of placed) for (const i of o.items) {
    const c = counts.get(i.dish_id) ?? { dish_id: i.dish_id, name: i.name, quantity: 0 }
    c.quantity += i.quantity
    counts.set(i.dish_id, c)
  }
  const hour = new Date()
  hour.setMinutes(0, 0, 0)
  send(res, 200, {
    orders_today: placed.length,
    revenue_today: revenue,
    currency: restaurant.currency,
    active_tables: tables.filter((t) => t.active_session_id).length,
    avg_order_value: placed.length ? revenue / placed.length : 0,
    open_waiter_calls: calls.filter((c) => !c.resolved).length,
    top_dishes: [...counts.values()].sort((a, b) => b.quantity - a.quantity),
    languages: [{ language: 'es', sessions: 2 }, { language: 'en', sessions: 1 }, { language: 'hy', sessions: 1 }],
    orders_by_hour: Array.from({ length: 6 }, (_, i) => ({ hour: new Date(hour.getTime() - (5 - i) * 3600_000).toISOString(), orders: [1, 0, 3, 2, 4, placed.length][i] })),
  })
})
route('GET', '/api/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  res.write(': connected\n\n')
  streams.add(res)
  const ping = setInterval(() => res.write(': ping\n\n'), 15_000)
  req.on('close', () => {
    clearInterval(ping)
    streams.delete(res)
  })
})

route('GET', '/api/table/:token', (_q, res, m) => {
  const t = tables.find((x) => x.token === m.groups!.token)
  if (!t) return fail(res, 404, 'Unknown table')
  const s = activeSession(t)
  send(res, 200, {
    table_label: t.label,
    restaurant_name: restaurant.name,
    persona_name: restaurant.persona_name,
    currency: restaurant.currency,
    voice_enabled: VOICE,
    session: s ? { id: s.id, language: s.language, allergies: s.allergies, order: s.order, transcript: s.transcript } : null,
  })
}, true)
route('POST', '/api/table/:token/reset', (_q, res, m) => {
  const t = tables.find((x) => x.token === m.groups!.token)
  if (!t) return fail(res, 404, 'Unknown table')
  const s = activeSession(t)
  if (s) {
    s.status = 'closed'
    broadcast('session.updated', summary(s))
  }
  t.active_session_id = null
  send(res, 204)
}, true)
route('POST', '/api/table/:token/turn', (req, res, m) => {
  const t = tables.find((x) => x.token === m.groups!.token)
  if (!t) return fail(res, 404, 'Unknown table')
  return runTurn(req, res, t)
}, true)

export function mockApi(): Plugin {
  return {
    name: 'ding-mock-api',
    apply: 'serve',
    configureServer(server) {
      server.config.logger.info('\n  [mock] In-memory API enabled (DING_MOCK=1). The real backend is NOT used.\n')
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/media/')) return next()
        for (const [method, re, handler, open] of routes) {
          const m = re.exec(url.pathname)
          if (!m || method !== req.method) continue
          if (!open && !loggedIn) return fail(res, 401, 'Not logged in')
          try {
            await handler(req, res, m, url)
          } catch (err) {
            fail(res, 500, String(err))
          }
          return
        }
        fail(res, 404, `No mock route for ${req.method} ${url.pathname}`)
      })
    },
  }
}
