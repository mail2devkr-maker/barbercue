import type { SalonServiceCategoryDto, ServiceDto } from '@barbercue/shared';
import { serviceTaxonomyFields, serviceTaxonomySelection } from '../service-taxonomy';

const tree: SalonServiceCategoryDto[] = [{
  id: 'category-hair', name: 'Hair', subcategories: [{ id: 'subcategory-cut', name: 'Cut' }],
}];

const service: Pick<ServiceDto, 'category' | 'subcategory' | 'categoryId' | 'subcategoryId'> = {
  category: 'Hair', subcategory: 'Cut', categoryId: 'category-hair', subcategoryId: 'subcategory-cut',
};

describe('service taxonomy selection', () => {
  it('keeps linked category and subcategory IDs when they belong to the fetched tree', () => {
    expect(serviceTaxonomySelection(service, tree)).toEqual({
      categoryId: 'category-hair', category: '', subcategoryId: 'subcategory-cut', subcategory: '',
    });
  });

  it('preserves legacy free-text taxonomy when there is no matching salon tree entry', () => {
    expect(serviceTaxonomySelection({ ...service, categoryId: 'stale-category', subcategoryId: 'stale-subcategory' }, tree)).toEqual({
      categoryId: null, category: 'Hair', subcategoryId: null, subcategory: 'Cut',
    });
  });

  it('sends only stable IDs for an existing category selection', () => {
    expect(serviceTaxonomyFields({ categoryId: 'category-hair', category: '', subcategoryId: 'subcategory-cut', subcategory: '' }, 'create')).toEqual({
      categoryId: 'category-hair', subcategoryId: 'subcategory-cut',
    });
  });

  it('sends free-text labels for backward-compatible new taxonomy', () => {
    expect(serviceTaxonomyFields({ categoryId: null, category: ' Hair ', subcategoryId: null, subcategory: ' Fade ' }, 'create')).toEqual({
      category: 'Hair', subcategory: 'Fade',
    });
  });

  it('explicitly clears prior taxonomy on update when the owner chooses none', () => {
    expect(serviceTaxonomyFields({ categoryId: null, category: '', subcategoryId: null, subcategory: '' }, 'update')).toEqual({
      categoryId: null, category: null, subcategoryId: null, subcategory: null,
    });
  });
});

