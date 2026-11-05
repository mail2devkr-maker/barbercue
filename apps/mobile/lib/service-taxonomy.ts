import type { SalonServiceCategoryDto, ServiceDto } from '@barbercue/shared';

export interface ServiceTaxonomySelection {
  categoryId: string | null;
  category: string;
  subcategoryId: string | null;
  subcategory: string;
}

type ServiceTaxonomySource = {
  category?: string | null;
  subcategory?: string | null;
  categoryId?: string | null;
  subcategoryId?: string | null;
};

export function serviceTaxonomySelection(
  service: ServiceTaxonomySource | null,
  tree: SalonServiceCategoryDto[],
): ServiceTaxonomySelection {
  if (!service) return { categoryId: null, category: '', subcategoryId: null, subcategory: '' };
  const category = tree.find((item) => item.id === service.categoryId);
  const subcategory = category?.subcategories.find((item) => item.id === service.subcategoryId);
  return {
    categoryId: category?.id ?? null,
    category: category ? '' : service.category ?? '',
    subcategoryId: subcategory?.id ?? null,
    subcategory: subcategory ? '' : service.subcategory ?? '',
  };
}

export function serviceTaxonomyFields(
  value: ServiceTaxonomySelection,
  mode: 'create' | 'update',
): Record<string, string | null> {
  if (value.categoryId) {
    return {
      categoryId: value.categoryId,
      ...(value.subcategoryId
        ? { subcategoryId: value.subcategoryId }
        : value.subcategory.trim()
          ? { subcategory: value.subcategory.trim() }
          : mode === 'update'
            ? { subcategoryId: null, subcategory: null }
            : {}),
    };
  }

  if (value.category.trim()) {
    return {
      category: value.category.trim(),
      ...(value.subcategory.trim()
        ? { subcategory: value.subcategory.trim() }
        : mode === 'update'
          ? { subcategory: null }
          : {}),
    };
  }

  return mode === 'update'
    ? { categoryId: null, category: null, subcategoryId: null, subcategory: null }
    : {};
}

