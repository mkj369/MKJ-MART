'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Banknote, CreditCard, Lock, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { api, newIdempotencyKey } from '@/lib/api-client';
import { BD_DIVISIONS, DIVISION_NAMES, type Division } from '@/lib/bd-geo';
import { formatBDT } from '@/lib/money';
import type { PaymentMethod } from '@/lib/order-status';
import { checkoutSchema } from '@/lib/validation/store';
import { zodFieldErrors } from '@/lib/validation/common';
import type { CheckoutQuote, PlaceOrderResult, StockProblem } from '@/server/services/checkout';
import { cn } from '@/lib/utils';
import { useStore } from './store-provider';

type SavedAddress = {
  id: string;
  label: string;
  recipientName: string;
  phone: string;
  addressLine: string;
  area: string;
  district: string;
  division: string;
  postalCode: string | null;
  isDefault: boolean;
};

type AddressState = { addressLine: string; area: string; division: string; district: string; postalCode: string };
const EMPTY_ADDRESS: AddressState = { addressLine: '', area: '', division: '', district: '', postalCode: '' };

export function CheckoutForm({
  initialQuote,
  user,
  addresses,
}: {
  initialQuote: CheckoutQuote;
  user: { name: string; email: string; phone: string | null } | null;
  addresses: SavedAddress[];
}) {
  const router = useRouter();
  const { setCartCount } = useStore();
  const formRef = useRef<HTMLFormElement>(null);
  const idempotencyKey = useRef(newIdempotencyKey());

  const defaultAddress = addresses.find((a) => a.isDefault) ?? addresses[0];
  const [selectedAddress, setSelectedAddress] = useState<string>(defaultAddress?.id ?? 'new');
  const [contact, setContact] = useState({
    name: defaultAddress?.recipientName ?? user?.name ?? '',
    phone: defaultAddress?.phone ?? user?.phone ?? '',
    email: user?.email ?? '',
  });
  const [address, setAddress] = useState<AddressState>(
    defaultAddress
      ? {
          addressLine: defaultAddress.addressLine,
          area: defaultAddress.area,
          division: defaultAddress.division,
          district: defaultAddress.district,
          postalCode: defaultAddress.postalCode ?? '',
        }
      : EMPTY_ADDRESS,
  );
  const [saveAddress, setSaveAddress] = useState(!!user && addresses.length === 0);
  const firstAvailable = initialQuote.paymentMethods.find((m) => m.available)?.method ?? 'cod';
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(firstAvailable);
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<string | undefined>();
  const [note, setNote] = useState('');
  const [quote, setQuote] = useState(initialQuote);
  // The quote is "in flight" whenever the inputs differ from the ones it was computed for.
  const quoteKey = `${address.district}|${appliedCoupon ?? ''}`;
  const [quotedKey, setQuotedKey] = useState(`${defaultAddress?.district ?? ''}|`); // initialQuote was computed for these inputs
  const quoting = quotedKey !== quoteKey;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<StockProblem[] | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Live re-quote whenever the district or coupon changes (delivery fee, discount, payment options).
  useEffect(() => {
    const controller = new AbortController();
    const requestedKey = quoteKey;
    void api<CheckoutQuote>('/api/v1/checkout/quote', {
      body: { district: address.district || undefined, couponCode: appliedCoupon, phone: contact.phone || undefined },
      signal: controller.signal,
    }).then((result) => {
      if (result.ok) {
        setQuote(result.data);
        if (appliedCoupon && result.data.couponError) {
          setErrors((e) => ({ ...e, couponCode: result.data.couponError! }));
          setAppliedCoupon(undefined);
        }
        const current = result.data.paymentMethods.find((m) => m.method === paymentMethod);
        if (current && !current.available) {
          const fallback = result.data.paymentMethods.find((m) => m.available);
          if (fallback) setPaymentMethod(fallback.method);
        }
      }
      if (!(result.ok === false && result.error.code === 'ABORTED')) setQuotedKey(requestedKey);
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address.district, appliedCoupon]);

  const pickAddress = (id: string) => {
    setSelectedAddress(id);
    const saved = addresses.find((a) => a.id === id);
    if (saved) {
      setAddress({
        addressLine: saved.addressLine,
        area: saved.area,
        division: saved.division,
        district: saved.district,
        postalCode: saved.postalCode ?? '',
      });
      setContact((c) => ({ ...c, name: saved.recipientName, phone: saved.phone }));
    } else {
      setAddress(EMPTY_ADDRESS);
    }
  };

  const applyCoupon = () => {
    const code = couponInput.trim().toUpperCase();
    setErrors(({ couponCode: _drop, ...rest }) => rest);
    if (!code) return;
    setAppliedCoupon(code);
  };

  const focusFirstError = (fields: Record<string, string>) => {
    const first = Object.keys(fields)[0];
    if (!first) return;
    const el = formRef.current?.querySelector<HTMLElement>(`[data-field="${first}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.querySelector<HTMLElement>('input,select,textarea')?.focus({ preventScroll: true });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);
    setProblems(null);
    const payload = {
      idempotencyKey: idempotencyKey.current,
      contact,
      address: { ...address, postalCode: address.postalCode || undefined },
      saveAddress: !!user && selectedAddress === 'new' && saveAddress,
      paymentMethod,
      couponCode: appliedCoupon,
      note: note || undefined,
      expectedTotal: quote.total,
    };
    const parsed = checkoutSchema.safeParse(payload);
    if (!parsed.success) {
      const fields = zodFieldErrors(parsed.error);
      setErrors(fields);
      focusFirstError(fields);
      return;
    }
    if (paymentMethod === 'sslcommerz' && !contact.email) {
      const fields = { 'contact.email': 'An email address is required for online payment receipts.' };
      setErrors(fields);
      focusFirstError(fields);
      return;
    }
    setErrors({});
    setSubmitting(true);
    const result = await api<PlaceOrderResult>('/api/v1/checkout', { body: payload });

    if (result.ok) {
      setCartCount(0);
      if (result.data.next.type === 'redirect') {
        window.location.assign(result.data.next.url); // to the SSLCommerz payment page
        return;
      }
      const tokenParam = user ? '' : `&token=${encodeURIComponent(result.data.accessToken)}`;
      router.push(`/orders/${result.data.orderNumber}?placed=1${tokenParam}`);
      router.refresh();
      return;
    }

    setSubmitting(false);
    const { error } = result;
    // Outcome unknown only on network failure: keep the key so a retry returns the same order.
    if (error.status !== 0) idempotencyKey.current = newIdempotencyKey();
    switch (error.code) {
      case 'VALIDATION_ERROR':
      case 'COUPON_INVALID':
        setErrors(error.fields ?? {});
        if (error.code === 'COUPON_INVALID') setAppliedCoupon(undefined);
        focusFirstError(error.fields ?? {});
        break;
      case 'STOCK_UNAVAILABLE':
        setProblems((error.details as { problems?: StockProblem[] } | undefined)?.problems ?? []);
        setFormError(error.message);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
      case 'PRICE_CHANGED': {
        const refreshed = await api<CheckoutQuote>('/api/v1/checkout/quote', {
          body: { district: address.district || undefined, couponCode: appliedCoupon, phone: contact.phone || undefined },
        });
        if (refreshed.ok) setQuote(refreshed.data);
        setFormError('Prices or delivery charges changed while you were checking out. Please review the updated total and place your order again.');
        break;
      }
      case 'CART_EMPTY':
        router.push('/cart');
        break;
      default:
        setFormError(error.message);
        toast.error(error.message);
    }
  };

  const districts = address.division && address.division in BD_DIVISIONS ? BD_DIVISIONS[address.division as Division] : [];
  const err = (key: string) => errors[key];

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="mt-10 grid gap-12 lg:grid-cols-[1fr_420px]">
      <div className="space-y-12">
        {formError ? (
          <Alert tone="danger" title="We couldn't place your order">
            <p>{formError}</p>
            {problems?.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {problems.map((p) => (
                  <li key={p.variantId}>
                    {p.productName}
                    {p.variantLabel ? ` (${p.variantLabel})` : ''}: {p.available > 0 ? `only ${p.available} available` : 'sold out'}
                  </li>
                ))}
              </ul>
            ) : null}
            {problems ? (
              <Link href="/cart" className="mt-2 inline-block underline underline-offset-4">
                Update your bag
              </Link>
            ) : null}
          </Alert>
        ) : null}

        <Section number="01" title="Contact">
          <div className="grid gap-5 md:grid-cols-2">
            <div data-field="contact.name" className="md:col-span-2">
              <Field label="Full name" required error={err('contact.name')}>
                {(p) => <Input {...p} autoComplete="name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />}
              </Field>
            </div>
            <div data-field="contact.phone">
              <Field label="Mobile number" required error={err('contact.phone')} hint="For delivery updates and order confirmation calls.">
                {(p) => (
                  <Input
                    {...p}
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="01XXXXXXXXX"
                    value={contact.phone}
                    onChange={(e) => setContact({ ...contact, phone: e.target.value })}
                  />
                )}
              </Field>
            </div>
            <div data-field="contact.email">
              <Field
                label="Email"
                required={paymentMethod === 'sslcommerz'}
                error={err('contact.email')}
                hint={paymentMethod === 'sslcommerz' ? 'Required for online payment receipts.' : 'Optional — for your order receipt.'}
              >
                {(p) => <Input {...p} type="email" autoComplete="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />}
              </Field>
            </div>
          </div>
        </Section>

        <Section number="02" title="Delivery address">
          {addresses.length ? (
            <div className="mb-6 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Saved addresses">
              {addresses.map((a) => (
                <label
                  key={a.id}
                  className={cn(
                    'cursor-pointer border p-4 text-[13.5px] transition-colors',
                    selectedAddress === a.id ? 'border-ink bg-bone' : 'border-line hover:border-line-strong',
                  )}
                >
                  <input type="radio" name="saved-address" className="sr-only" checked={selectedAddress === a.id} onChange={() => pickAddress(a.id)} />
                  <span className="eyebrow">{a.label}</span>
                  <span className="mt-2 block font-medium">{a.recipientName}</span>
                  <span className="mt-1 block text-muted">
                    {a.addressLine}, {a.area}, {a.district}
                  </span>
                </label>
              ))}
              <label
                className={cn(
                  'flex cursor-pointer items-center justify-center border border-dashed p-4 text-[13.5px] transition-colors',
                  selectedAddress === 'new' ? 'border-ink bg-bone' : 'border-line-strong hover:border-ink',
                )}
              >
                <input type="radio" name="saved-address" className="sr-only" checked={selectedAddress === 'new'} onChange={() => pickAddress('new')} />+ Use a new address
              </label>
            </div>
          ) : null}
          <div className="grid gap-5 md:grid-cols-2">
            <div data-field="address.division">
              <Field label="Division" required error={err('address.division')}>
                {(p) => (
                  <Select {...p} value={address.division} onChange={(e) => setAddress({ ...address, division: e.target.value, district: '' })}>
                    <option value="">Select division</option>
                    {DIVISION_NAMES.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <div data-field="address.district">
              <Field label="District" required error={err('address.district')}>
                {(p) => (
                  <Select {...p} value={address.district} disabled={!address.division} onChange={(e) => setAddress({ ...address, district: e.target.value })}>
                    <option value="">{address.division ? 'Select district' : 'Select a division first'}</option>
                    {districts.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <div data-field="address.area">
              <Field label="Area / Thana" required error={err('address.area')}>
                {(p) => <Input {...p} placeholder="e.g. Dhanmondi" value={address.area} onChange={(e) => setAddress({ ...address, area: e.target.value })} />}
              </Field>
            </div>
            <div data-field="address.postalCode">
              <Field label="Postal code" error={err('address.postalCode')}>
                {(p) => (
                  <Input {...p} inputMode="numeric" autoComplete="postal-code" placeholder="Optional" value={address.postalCode} onChange={(e) => setAddress({ ...address, postalCode: e.target.value })} />
                )}
              </Field>
            </div>
            <div data-field="address.addressLine" className="md:col-span-2">
              <Field label="Street address" required error={err('address.addressLine')}>
                {(p) => (
                  <Input
                    {...p}
                    autoComplete="street-address"
                    placeholder="House, road, block, landmark"
                    value={address.addressLine}
                    onChange={(e) => setAddress({ ...address, addressLine: e.target.value })}
                  />
                )}
              </Field>
            </div>
          </div>
          {quote.zone ? (
            <p className="mt-4 text-[13px] text-muted">
              Delivery to {address.district}: <span className="text-ink">{quote.zone.name}</span>, {quote.zone.estimatedDays} —{' '}
              {quote.freeShipping ? <span className="text-success">free</span> : <span className="text-ink">{formatBDT(quote.shippingFee)}</span>}
            </p>
          ) : null}
          {user && selectedAddress === 'new' ? (
            <Checkbox className="mt-5" label="Save this address to my account" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} />
          ) : null}
          <div className="mt-6" data-field="note">
            <Field label="Delivery note" error={err('note')}>
              {(p) => <Textarea {...p} rows={2} placeholder="Optional — e.g. call before delivery" value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
          </div>
        </Section>

        <Section number="03" title="Payment">
          <div className="grid gap-3" role="radiogroup" aria-label="Payment method">
            {quote.paymentMethods.map((m) => {
              const meta =
                m.method === 'cod'
                  ? { title: 'Cash on Delivery', body: 'Pay in cash when your parcel arrives. We call to confirm your order before dispatch.', Icon: Banknote }
                  : { title: 'Pay online', body: 'bKash, Nagad, Rocket, Visa, Mastercard or internet banking — secured by SSLCommerz.', Icon: CreditCard };
              return (
                <label
                  key={m.method}
                  className={cn(
                    'flex gap-4 border p-5 transition-colors',
                    !m.available ? 'cursor-not-allowed border-line opacity-55' : 'cursor-pointer',
                    m.available && paymentMethod === m.method ? 'border-ink bg-bone' : m.available ? 'border-line hover:border-line-strong' : '',
                  )}
                >
                  <input
                    type="radio"
                    name="payment"
                    value={m.method}
                    className="mt-1 h-4 w-4"
                    disabled={!m.available}
                    checked={paymentMethod === m.method}
                    onChange={() => setPaymentMethod(m.method)}
                  />
                  <meta.Icon className="mt-0.5 h-5 w-5 shrink-0 text-gold-deep" strokeWidth={1.3} />
                  <span>
                    <span className="block text-[14.5px] font-medium">{meta.title}</span>
                    <span className="mt-1 block text-[13px] text-muted">{m.available ? meta.body : m.reason}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </Section>
      </div>

      {/* ── Summary ─────────────────────────────────────────────────────── */}
      <aside className="h-fit border border-line bg-bone lg:sticky lg:top-28">
        <div className="p-7">
          <h2 className="eyebrow">Your order ({quote.itemCount})</h2>
          <ul className="mt-5 max-h-[300px] space-y-4 overflow-y-auto pr-1">
            {quote.lines.map((line) => (
              <li key={line.id} className="flex gap-3.5">
                <div className="relative h-[76px] w-[57px] shrink-0 bg-linen">
                  {line.image ? <Image src={line.image} alt="" fill sizes="60px" className="object-cover" /> : null}
                  <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1 text-[10px] text-paper">{line.quantity}</span>
                </div>
                <div className="min-w-0 flex-1 text-[13.5px]">
                  <p className="line-clamp-2 leading-snug">{line.productName}</p>
                  <p className="mt-0.5 text-[12px] text-muted">{[line.colorName, line.sizeLabel].filter(Boolean).join(' · ')}</p>
                </div>
                <p className="text-[13.5px] tabular-nums">{formatBDT(line.lineTotal)}</p>
              </li>
            ))}
          </ul>

          <div className="mt-6 border-t border-line pt-5" data-field="couponCode">
            {appliedCoupon && quote.coupon ? (
              <div className="flex items-center justify-between text-[13.5px]">
                <span>
                  Coupon <span className="font-medium">{quote.coupon.code}</span> applied
                </span>
                <button
                  type="button"
                  className="text-[12.5px] text-muted underline underline-offset-4 hover:text-ink"
                  onClick={() => {
                    setAppliedCoupon(undefined);
                    setCouponInput('');
                  }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <div>
                <div className="flex gap-2">
                  <Input
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        applyCoupon();
                      }
                    }}
                    placeholder="Coupon code"
                    aria-label="Coupon code"
                    aria-invalid={err('couponCode') ? true : undefined}
                    className="h-10 uppercase placeholder:normal-case"
                  />
                  <Button variant="secondary" size="sm" className="h-10" onClick={applyCoupon} loading={quoting && !!appliedCoupon}>
                    Apply
                  </Button>
                </div>
                {err('couponCode') ? <p className="mt-1.5 text-[12.5px] text-danger">{err('couponCode')}</p> : null}
              </div>
            )}
          </div>

          <dl className="mt-6 space-y-2.5 border-t border-line pt-5 text-[14px]">
            <div className="flex justify-between">
              <dt className="text-muted">Subtotal</dt>
              <dd className="tabular-nums">{formatBDT(quote.subtotal)}</dd>
            </div>
            {quote.discount > 0 ? (
              <div className="flex justify-between text-success">
                <dt>Discount</dt>
                <dd className="tabular-nums">−{formatBDT(quote.discount)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt className="text-muted">Delivery{quote.zone ? ` (${quote.zone.name})` : ''}</dt>
              <dd className="tabular-nums">{!address.district ? <span className="text-muted">Select district</span> : quote.freeShipping ? 'Free' : formatBDT(quote.shippingFee)}</dd>
            </div>
          </dl>
          <div className="mt-5 flex items-baseline justify-between border-t border-line pt-5">
            <span className="eyebrow">Total</span>
            <span className={cn('text-2xl font-medium tabular-nums transition-opacity', quoting && 'opacity-50')} data-testid="checkout-total">
              {formatBDT(quote.total)}
            </span>
          </div>
          <Button type="submit" size="lg" className="mt-7 w-full" loading={submitting} disabled={quoting || !address.district} data-testid="place-order">
            {paymentMethod === 'sslcommerz' ? <><Lock className="h-3.5 w-3.5" /> Pay {formatBDT(quote.total)}</> : 'Place order'}
          </Button>
          <p className="mt-4 flex items-start gap-2 text-[12px] leading-relaxed text-muted">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Prices and stock are verified again when you place your order. By ordering you agree to our{' '}
              <Link href="/policies/terms" className="underline underline-offset-2">
                terms
              </Link>
              .
            </span>
          </p>
        </div>
      </aside>
    </form>
  );
}

function Section({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-6 flex items-baseline gap-4 border-b border-line pb-4">
        <span className="font-display text-xl text-gold-deep">{number}</span>
        <span className="font-display text-[28px] font-light">{title}</span>
      </h2>
      {children}
    </section>
  );
}
