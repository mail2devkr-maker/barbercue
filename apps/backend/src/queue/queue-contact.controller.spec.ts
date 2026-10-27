import { NotFoundException } from '@nestjs/common';
import { QueueContactController } from './queue-contact.controller';

const USER = { id: 'customer-1' } as never;
describe('Customer -> shop business contact', () => {
  const findFirst = jest.fn();
  const controller = new QueueContactController({ queueEntry: { findFirst } } as never);
  beforeEach(() => findFirst.mockReset());

  it('returns only an opted-in business phone to the token owner', async () => {
    findFirst.mockResolvedValue({ salon: { phone: '+91 98765 43210', showPhoneToCustomers: true } });
    await expect(controller.getShopContact(USER, 'token-1')).resolves.toEqual({ shopPhone: '+919876543210' });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'token-1', customerId: 'customer-1' }),
      select: { salon: { select: { phone: true, showPhoneToCustomers: true } } },
    }));
  });

  it('never leaks a shop number after opt-out', async () => {
    findFirst.mockResolvedValue({ salon: { phone: '+919876543210', showPhoneToCustomers: false } });
    await expect(controller.getShopContact(USER, 'token-1')).resolves.toEqual({ shopPhone: null });
  });

  it('never returns malformed dial strings', async () => {
    findFirst.mockResolvedValue({ salon: { phone: 'tel:123&call=911', showPhoneToCustomers: true } });
    await expect(controller.getShopContact(USER, 'token-1')).resolves.toEqual({ shopPhone: null });
  });

  it('refuses another customer, inactive or missing token without revealing existence', async () => {
    findFirst.mockResolvedValue(null);
    await expect(controller.getShopContact(USER, 'someone-elses-token')).rejects.toBeInstanceOf(NotFoundException);
  });
});
