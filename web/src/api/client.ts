// Typed client for docs/API.md. Every endpoint the web app uses lives here.
import type {
  AllergenSuggestion,
  Dish,
  DishDraft,
  DishInput,
  KnowledgeItem,
  MeResponse,
  Meta,
  ModelCatalog,
  Order,
  OrderStatus,
  Restaurant,
  SessionDetail,
  SessionSummary,
  Stats,
  Table,
  TableInfo,
  Voice,
  WaiterCall,
} from './types'

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function isUnauthorized(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401
}

/** Reads `{ detail }` from an error response, falling back to the status text. */
export async function errorFromResponse(res: Response): Promise<ApiError> {
  let message = res.statusText || `Request failed (${res.status})`
  try {
    const body = await res.json()
    if (typeof body?.detail === 'string') message = body.detail
    else if (Array.isArray(body?.detail) && body.detail[0]?.msg) message = String(body.detail[0].msg)
  } catch {
    /* not JSON */
  }
  return new ApiError(res.status, message)
}

type Query = Record<string, string | number | boolean | null | undefined>

function withQuery(path: string, query?: Query): string {
  if (!query) return path
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', signal }
  if (body instanceof FormData) {
    init.body = body
  } else if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  const res = await fetch(path, init)
  if (!res.ok) throw await errorFromResponse(res)
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

const get = <T>(path: string, query?: Query) => request<T>('GET', withQuery(path, query))
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body)
const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, body)
const del = (path: string) => request<void>('DELETE', path)

function fileForm(file: File | Blob, field = 'file'): FormData {
  const form = new FormData()
  form.append(field, file)
  return form
}

export const api = {
  meta: () => get<Meta>('/api/meta'),

  // auth
  signup: (body: { email: string; password: string; restaurant_name: string }) =>
    post<MeResponse>('/api/auth/signup', body),
  login: (body: { email: string; password: string }) => post<MeResponse>('/api/auth/login', body),
  logout: () => post<void>('/api/auth/logout'),
  me: () => get<MeResponse>('/api/me'),

  // restaurant settings
  restaurant: () => get<Restaurant>('/api/restaurant'),
  updateRestaurant: (body: Partial<Omit<Restaurant, 'id'>>) => patch<Restaurant>('/api/restaurant', body),
  voices: () => get<Voice[]>('/api/voices'),
  models: () => get<ModelCatalog>('/api/models'),

  // menu
  dishes: (query?: { category?: string; q?: string }) => get<Dish[]>('/api/dishes', query),
  createDish: (body: DishInput) => post<Dish>('/api/dishes', body),
  updateDish: (id: number, body: Partial<DishInput>) => patch<Dish>(`/api/dishes/${id}`, body),
  deleteDish: (id: number) => del(`/api/dishes/${id}`),
  uploadDishPhoto: (id: number, file: File) => post<Dish>(`/api/dishes/${id}/photo`, fileForm(file)),
  deleteDishPhoto: (id: number) => request<Dish>('DELETE', `/api/dishes/${id}/photo`),
  suggestAllergens: (body: { name: string; description: string; ingredients: string[] }) =>
    post<AllergenSuggestion>('/api/dishes/suggest-allergens', body),
  importMenu: (file: File) => post<{ dishes: DishDraft[] }>('/api/menu/import', fileForm(file)),
  bulkCreateDishes: (dishes: DishDraft[]) => post<Dish[]>('/api/dishes/bulk', { dishes }),

  // knowledge
  knowledge: () => get<KnowledgeItem[]>('/api/knowledge'),
  createKnowledge: (body: { title: string; content: string }) => post<KnowledgeItem>('/api/knowledge', body),
  updateKnowledge: (id: number, body: { title?: string; content?: string }) =>
    patch<KnowledgeItem>(`/api/knowledge/${id}`, body),
  deleteKnowledge: (id: number) => del(`/api/knowledge/${id}`),

  // tables
  tables: () => get<Table[]>('/api/tables'),
  createTable: (body: { label: string }) => post<Table>('/api/tables', body),
  updateTable: (id: number, body: { label: string }) => patch<Table>(`/api/tables/${id}`, body),
  deleteTable: (id: number) => del(`/api/tables/${id}`),

  // kitchen
  orders: (statuses?: OrderStatus[]) =>
    get<Order[]>('/api/orders', statuses?.length ? { status: statuses.join(',') } : undefined),
  updateOrder: (id: number, status: OrderStatus) => patch<Order>(`/api/orders/${id}`, { status }),
  waiterCalls: (resolved?: boolean) =>
    get<WaiterCall[]>('/api/waiter-calls', resolved === undefined ? undefined : { resolved }),
  resolveWaiterCall: (id: number) => patch<WaiterCall>(`/api/waiter-calls/${id}`, { resolved: true }),

  // conversations & stats
  sessions: () => get<SessionSummary[]>('/api/sessions'),
  session: (id: number) => get<SessionDetail>(`/api/sessions/${id}`),
  stats: () => get<Stats>('/api/stats'),

  // guest table (public, by token)
  table: (token: string) => get<TableInfo>(`/api/table/${encodeURIComponent(token)}`),
  resetTable: (token: string) => post<void>(`/api/table/${encodeURIComponent(token)}/reset`),
}

/** URL of the streaming turn endpoint; the body is sent by lib/voice/turnStream. */
export const turnUrl = (token: string) => `/api/table/${encodeURIComponent(token)}/turn`

/** SSE endpoint for live dashboard updates. */
export const EVENTS_URL = '/api/events'
