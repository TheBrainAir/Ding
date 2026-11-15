import type { Allergen, Dish } from '@/api/types'

export interface DishLike {
  photo_url?: string | null
  ingredients: string[]
  allergens: Allergen[]
  may_contain: Allergen[]
}

/** Gaps that make the waiter less useful or less safe. Shown as quiet chips, never in paprika. */
export function dishFlags(d: DishLike): string[] {
  const flags: string[] = []
  if (!d.photo_url) flags.push('No photo')
  if (!d.ingredients.length) flags.push('No ingredients')
  // An empty allergen list is not flagged: plenty of dishes (tea, lemonade) truly have none,
  // and there is no "reviewed" field to tell those apart from a dish nobody checked.
  return flags
}

/** Dishes free of every allergen in `avoid`, counting traces too. */
export function isFreeOf(d: Dish, avoid: Allergen[]): boolean {
  if (!avoid.length) return true
  const has = new Set([...d.allergens, ...d.may_contain])
  return avoid.every((a) => !has.has(a))
}
