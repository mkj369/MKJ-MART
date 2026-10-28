import { Skeleton } from '@/components/ui/feedback';

export default function ShopLoading() {
  return (
    <div aria-busy="true" aria-label="Loading products">
      <div className="border-b border-line bg-bone">
        <div className="container-x py-12 lg:py-16">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-10 h-12 w-72" />
        </div>
      </div>
      <div className="container-x mt-10 lg:grid lg:grid-cols-[230px_1fr] lg:gap-14">
        <div className="hidden space-y-4 lg:block">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 md:gap-x-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="aspect-[3/4] w-full" />
              <Skeleton className="mt-4 h-3 w-1/3" />
              <Skeleton className="mt-2 h-4 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
