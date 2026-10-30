import type { Metadata } from 'next';
import { AddressBook } from '@/components/store/account-forms';
import { requireCustomerPage } from '@/server/auth/current-user';
import { listAddresses } from '@/server/services/account';

export const metadata: Metadata = { title: 'My addresses' };

export default async function AddressesPage() {
  const user = await requireCustomerPage('/account/addresses');
  const addresses = await listAddresses(user.id);
  return (
    <AddressBook
      addresses={addresses.map((a) => ({
        id: a.id,
        label: a.label,
        recipientName: a.recipientName,
        phone: a.phone,
        addressLine: a.addressLine,
        area: a.area,
        district: a.district,
        division: a.division,
        postalCode: a.postalCode ?? '',
        isDefault: a.isDefault,
      }))}
      defaultName={user.name}
      defaultPhone={user.phone ?? ''}
    />
  );
}
