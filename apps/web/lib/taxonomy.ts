import taxonomyJson from "../../../data/curated/taxonomy.json"

/**
 * Static game / category names and colours from `data/curated/taxonomy.json`
 * (ids never change), so badges can be rendered on the client without a DB
 * round-trip. Counts live in the DB (`getGames()` / `getCategories()`).
 */
export interface GameInfo {
  readonly id: string
  readonly name: string
  readonly short: string
  readonly color: string
}

export interface CategoryInfo {
  readonly id: string
  readonly name: string
  readonly description: string
}

const taxonomy = taxonomyJson as unknown as {
  readonly games: ReadonlyArray<GameInfo>
  readonly categories: ReadonlyArray<CategoryInfo>
}

export const GAMES: ReadonlyArray<GameInfo> = taxonomy.games
export const CATEGORIES: ReadonlyArray<CategoryInfo> = taxonomy.categories

const gameMap = new Map(GAMES.map((g) => [g.id, g]))
const categoryMap = new Map(CATEGORIES.map((c) => [c.id, c]))

const titleCase = (id: string) => id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())

export function gameInfo(id: string): GameInfo {
  return gameMap.get(id) ?? { id, name: titleCase(id), short: titleCase(id), color: "#C89B3C" }
}

export function categoryInfo(id: string): CategoryInfo {
  return categoryMap.get(id) ?? { id, name: titleCase(id), description: "" }
}
