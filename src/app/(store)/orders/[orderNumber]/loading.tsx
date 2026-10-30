import { Skeleton } from '@/components/ui/feedback';

export default function OrderLoading() {
  return (
    <div className="container-x max-w-6xl pt-10" aria-busy="true" aria-label="Loading order">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-9 w-72" />
      <Skeleton className="mt-10 h-2 w-full" />
      <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <Skeleton className="h-[100px] w-[75px]" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
