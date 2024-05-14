export function sortBy<T>(
  arr: T[],
  key: (item: T) => string | number | Date,
  orderBy: "asc" | "desc" = "asc"
): T[] {
  return arr.sort((a: T, b: T): number => {
    const res: number = compare(key(a), key(b))
    return orderBy === "asc" ? res : -res
  })
}

function compare<T>(a: T, b: T): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}
