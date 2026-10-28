import { AccountNav } from '@/components/store/account-nav';
import { requireCustomerPage } from '@/server/auth/current-user';

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await requireCustomerPage('/account');
  return (
    <div className="container-x pt-12">
      <p className="eyebrow text-gold-deep">My account</p>
      <h1 className="mt-3 font-display text-[44px] font-light leading-none md:text-[54px]">Hello, {user.name.split(' ')[0]}</h1>
      <div className="mt-10 grid gap-10 lg:grid-cols-[220px_1fr] lg:gap-16">
        <AccountNav isStaff={user.role !== 'customer'} />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
