import { AdminSalonManagementService } from './admin-salon-management.service';

describe('AdminSalonManagementService — legacy hard-delete shortcut disabled', () => {
  const service = new AdminSalonManagementService();

  it.each([
    ['Co-Founder', 'cofounder-1', 'shop-empty'],
    ['Super Admin', 'admin-1', 'shop-empty'],
    ['unknown salon', 'admin-1', 'missing-shop'],
  ])('%s cannot bypass the two-person/TOTP 30-day recovery workflow', async (_label, userId, salonId) => {
    await expect(service.deleteSalon(userId, salonId)).rejects.toMatchObject({
      code: 'SHOP_DELETION_APPROVAL_REQUIRED',
    });
  });
});
