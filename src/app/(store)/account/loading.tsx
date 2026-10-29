import { Skeleton } from '@/components/ui/feedback';

export default function AccountLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading your account">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80" />
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}
