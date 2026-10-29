import { Skeleton } from '@/components/ui/feedback';

export default function ProductLoading() {
  return (
    <div className="container-x pt-8" aria-busy="true" aria-label="Loading product">
      <Skeleton className="h-3 w-56" />
      <div className="mt-8 grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
        <Skeleton className="aspect-[3/4] w-full" />
        <div className="space-y-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-6 w-32" />
          <div className="flex gap-2 pt-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-14" />
            ))}
          </div>
          <Skeleton className="h-13 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  );
}
