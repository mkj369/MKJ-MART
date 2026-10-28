import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { buttonClasses } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bone px-6 text-center">
      <Link href="/" aria-label="MKJ Store — home">
        <Logo />
      </Link>
      <p className="eyebrow mt-16 text-gold-deep">Error 404</p>
      <h1 className="mt-4 font-display text-[48px] font-light leading-none md:text-[64px]">This page has moved on.</h1>
      <p className="mt-4 max-w-md text-[15px] text-muted">The piece or page you are looking for is no longer here. Let’s get you back to the collection.</p>
      <div className="mt-10 flex flex-wrap justify-center gap-3">
        <Link href="/shop" className={buttonClasses({ variant: 'primary' })}>
          Shop the collection
        </Link>
        <Link href="/" className={buttonClasses({ variant: 'outline' })}>
          Home
        </Link>
      </div>
    </div>
  );
}
