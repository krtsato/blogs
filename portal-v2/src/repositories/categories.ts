export async function listCategories(db: D1Database) {
  return db.prepare(
    `SELECT id, slug, name, description, image_url, display_order FROM categories ORDER BY display_order ASC`
  ).all();
}

export async function getCategory(db: D1Database, slug: string) {
  return db.prepare(
    `SELECT id, slug, name, description, image_url, display_order FROM categories WHERE slug = ?`
  ).bind(slug).first();
}
