import Image from 'next/image';

export function AuthShell({ eyebrow, title, subtitle, children }: { eyebrow: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="container-x grid gap-12 pt-10 lg:grid-cols-2 lg:gap-20 lg:pt-14">
      <div className="relative hidden aspect-[4/5] overflow-hidden bg-linen lg:block">
        <Image src="/images/demo/editorial/couple-portrait.webp" alt="" fill sizes="45vw" className="object-cover" loading="eager" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/55 to-transparent" />
        <p className="absolute bottom-10 left-10 right-10 font-display text-[30px] font-light leading-tight text-paper">
          “Considered clothing, made to be worn for years.”
        </p>
      </div>
      <div className="mx-auto w-full max-w-md self-center py-6">
        <p className="eyebrow text-gold-deep">{eyebrow}</p>
        <h1 className="mt-3 font-display text-[44px] font-light leading-none">{title}</h1>
        {subtitle ? <p className="mt-3 text-[14.5px] text-muted">{subtitle}</p> : null}
        <div className="mt-9">{children}</div>
      </div>
    </div>
  );
}
