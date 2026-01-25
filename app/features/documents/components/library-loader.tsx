import Image from "next/image";

function DocumentCardSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {/* Card thumbnail area */}
      <div className="w-50 h-32 rounded-xl overflow-hidden bg-gray-200 animate-pulse">
        <div className="flex h-full pt-8">
          {/* Thumbnail placeholder */}
          <div className="w-32 h-full rounded-t-sm bg-gray-300 mx-auto" />
        </div>
      </div>
      {/* Text below card */}
      <div className="flex flex-col gap-1 px-2">
        <div className="h-4 w-36 bg-gray-200 rounded animate-pulse" />
        <div className="h-3 w-20 bg-gray-200 rounded animate-pulse" />
      </div>
    </div>
  );
}

export function LibraryLoader() {
  return (
    <div className="bg-sidebar min-h-screen flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-20">
        <div className="px-4 h-12 flex items-center bg-sidebar">
          {/* Logo */}
          <div className="flex items-center gap-1">
            <Image src="/logo.svg" alt="Speechable" width={32} height={32} />
            <span className="text-lg text-gray-900 font-semibold">
              Speechable
            </span>
          </div>
        </div>
        {/* Gradient fade */}
        <div className="h-4 bg-gradient-to-b from-sidebar to-transparent" />
      </div>

      {/* Content */}
      <div className="w-full flex justify-center p-8 pt-6 flex-1">
        <div className="max-w-5xl w-full space-y-8">
          {/* All Documents Section */}
          <section className="space-y-4">
            {/* Section header - matches h2 text-lg line-height (1.75rem = h-7) */}
            <div className="h-7 flex items-center gap-1">
              <div className="h-5 w-32 bg-gray-200 rounded animate-pulse" />
              <div className="h-4 w-8 bg-gray-200 rounded animate-pulse" />
            </div>

            {/* Documents Grid */}
            <div className="flex flex-wrap gap-8">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <DocumentCardSkeleton key={i} />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
