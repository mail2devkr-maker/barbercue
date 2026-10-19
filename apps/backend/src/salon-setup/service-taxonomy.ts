import { Prisma, type PrismaClient } from '@prisma/client';

type TaxonomyDb = Prisma.TransactionClient | PrismaClient;

export interface ResolvedServiceTaxonomy {
  categoryId: string | null;
  subcategoryId: string | null;
  categoryName: string | null;
  subcategoryName: string | null;
}

export function normalizeTaxonomyName(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Resolve explicit labels to stable salon-scoped nodes. Upserts are protected by database unique
 * constraints so concurrent catalog edits/imports converge on one node without a read-then-create
 * race. Empty legacy labels remain text-only/null rather than being invented.
 */
export async function ensureServiceTaxonomy(
  tx: TaxonomyDb,
  salonId: string,
  categoryLabel: string | null | undefined,
  subcategoryLabel: string | null | undefined,
): Promise<ResolvedServiceTaxonomy> {
  const categoryName = categoryLabel?.trim() || null;
  const subcategoryName = subcategoryLabel?.trim() || null;
  if (!categoryName) {
    return { categoryId: null, subcategoryId: null, categoryName, subcategoryName };
  }

  const normalizedName = normalizeTaxonomyName(categoryName);
  const category = await tx.salonServiceCategory.upsert({
    where: { salonId_normalizedName: { salonId, normalizedName } },
    create: { salonId, name: categoryName, normalizedName },
    update: {},
    select: { id: true, name: true },
  });

  if (!subcategoryName) {
    return {
      categoryId: category.id,
      subcategoryId: null,
      categoryName: category.name,
      subcategoryName: null,
    };
  }

  const normalizedSubcategoryName = normalizeTaxonomyName(subcategoryName);
  const subcategory = await tx.salonServiceSubcategory.upsert({
    where: {
      categoryId_normalizedName: {
        categoryId: category.id,
        normalizedName: normalizedSubcategoryName,
      },
    },
    create: {
      salonId,
      categoryId: category.id,
      name: subcategoryName,
      normalizedName: normalizedSubcategoryName,
    },
    update: {},
    select: { id: true, name: true },
  });

  return {
    categoryId: category.id,
    subcategoryId: subcategory.id,
    categoryName: category.name,
    subcategoryName: subcategory.name,
  };
}
