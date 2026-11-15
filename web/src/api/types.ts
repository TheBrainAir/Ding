// Types mirroring docs/API.md. Keep this file in lockstep with the contract.

export type Allergen =
  | 'gluten'
  | 'crustaceans'
  | 'eggs'
  | 'fish'
  | 'peanuts'
  | 'soy'
  | 'milk'
  | 'tree_nuts'
  | 'celery'
  | 'mustard'
  | 'sesame'
  | 'sulphites'
  | 'lupin'
  | 'molluscs'

export type DietaryTag = 'vegan' | 'vegetarian' | 'halal' | 'kosher' | 'gluten_free' | 'spicy'

export type OrderStatus = 'draft' | 'placed' | 'preparing' | 'served' | 'cancelled'

export type ButtonState = 'idle' | 'listening' | 'thinking' | 'speaking'

export interface MetaOption<T extends string = string> {
  id: T
  label: string
}

export interface Meta {
  allergens: MetaOption<Allergen>[]
  dietary_tags: MetaOption<DietaryTag>[]
}

export interface User {
  id: number
  email: string
}

export interface Restaurant {
  id: number
  name: string
  currency: string
  menu_language: string
  persona_name: string
  voice_id: string | null
  llm_model: string
  stt_model: string
  tts_model: string
}

export interface MeResponse {
  user: User
  restaurant: Restaurant
}

export interface Voice {
  voice_id: string
  name: string
  preview_url: string | null
  labels: Record<string, string> | null
}

export interface ModelOption {
  id: string
  label: string
}

export interface ModelCatalog {
  llm: ModelOption[]
  stt: ModelOption[]
  tts: ModelOption[]
}

export interface Dish {
  id: number
  name: string
  description: string
  category: string
  price: number
  photo_url: string | null
  ingredients: string[]
  allergens: Allergen[]
  may_contain: Allergen[]
  dietary_tags: DietaryTag[]
  available: boolean
  created_at: string
  updated_at: string
  /** Table endpoints only: the name / description in the session's language, or null. */
  local_name?: string | null
  local_description?: string | null
}

/** Body for POST /api/dishes and PATCH /api/dishes/{id}: Dish fields without id/photo_url. */
export type DishInput = Omit<Dish, 'id' | 'photo_url' | 'created_at' | 'updated_at'>

export interface DishDraft {
  name: string
  description: string
  category: string
  price: number | null
  ingredients: string[]
  allergens: Allergen[]
  may_contain: Allergen[]
  dietary_tags: DietaryTag[]
}

export interface AllergenSuggestion {
  allergens: Allergen[]
  may_contain: Allergen[]
  dietary_tags: DietaryTag[]
  rationale: string
}

export interface KnowledgeItem {
  id: number
  title: string
  content: string
  updated_at: string
}

export interface Table {
  id: number
  label: string
  token: string
  url: string
  active_session_id: number | null
  created_at: string
}

export interface OrderItem {
  id: number
  dish_id: number
  name: string
  price: number
  quantity: number
  notes: string | null
  allergen_flag: boolean
  photo_url: string | null
  /** Table endpoints only: the dish name in the session's language, or null. */
  local_name?: string | null
}

export interface Order {
  id: number
  table_id: number
  table_label: string
  session_id: number
  status: OrderStatus
  items: OrderItem[]
  total: number
  currency: string
  allergies: Allergen[]
  allergy_note: string | null
  language: string | null
  placed_at: string | null
  created_at: string
}

export interface WaiterCall {
  id: number
  table_id: number
  table_label: string
  reason: string
  resolved: boolean
  created_at: string
}

export interface GuestAllergies {
  confirmed: boolean
  allergens: Allergen[]
  notes: string | null
  none_declared: boolean
}

export interface TranscriptLine {
  role: 'guest' | 'waiter'
  text: string
  at: string
}

export interface SessionSummary {
  id: number
  table_id: number
  table_label: string
  status: 'active' | 'closed'
  language: string | null
  allergies: GuestAllergies
  turn_count: number
  order_id: number | null
  started_at: string
  last_activity_at: string
}

export interface SessionDetail extends SessionSummary {
  transcript: TranscriptLine[]
  order: Order | null
}

export interface Stats {
  orders_today: number
  revenue_today: number
  currency: string
  active_tables: number
  avg_order_value: number
  open_waiter_calls: number
  top_dishes: { dish_id: number; name: string; quantity: number }[]
  languages: { language: string; sessions: number }[]
  orders_by_hour: { hour: string; orders: number }[]
}

// ---- Server-Sent Events (GET /api/events) ----

export type DashboardEvent =
  | { type: 'order.placed'; data: Order }
  | { type: 'order.updated'; data: Order }
  | { type: 'waiter.called'; data: WaiterCall }
  | { type: 'session.updated'; data: SessionSummary }

// ---- Guest table screen ----

export interface TableSessionState {
  id: number
  language: string | null
  allergies: GuestAllergies
  order: Order | null
  transcript: TranscriptLine[]
}

export interface TableInfo {
  table_label: string
  restaurant_name: string
  persona_name: string
  currency: string
  voice_enabled: boolean
  session: TableSessionState | null
}

/** One line of the NDJSON stream returned by POST /api/table/{token}/turn. */
export type TurnEvent =
  | { type: 'transcript'; text: string; language: string | null }
  | { type: 'text'; delta: string }
  | { type: 'audio'; seq: number; mime: string; b64: string }
  | { type: 'dishes'; dishes: Dish[] }
  | { type: 'state'; order: Order | null; allergies: GuestAllergies; language: string | null }
  | { type: 'waiter_called'; reason: string }
  | { type: 'done' }
  | { type: 'error'; message: string }
