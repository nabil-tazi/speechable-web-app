export function LibraryLoader() {
  return (
    <div className="w-full flex justify-center p-4">
      <div className="max-w-7xl w-full space-y-8">
        {/* Skeleton for multiple document sections */}
        {[1, 2].map((sectionIndex) => (
          <section key={sectionIndex} className="space-y-4">
            {/* Section Header Skeleton */}
            <div className="flex items-center justify-between border-b border-gray-200 pb-2">
              <div>
                <div className="h-6 w-32 bg-gray-200 rounded animate-pulse mb-1"></div>
                <div className="h-4 w-24 bg-gray-200 rounded animate-pulse"></div>
              </div>
            </div>

            {/* Documents Grid Skeleton */}
            <div className="flex flex-wrap gap-4">
              {[1, 2, 3].map((cardIndex) => (
                <div
                  key={cardIndex}
                  className="w-80 h-32 border border-gray-200 rounded-lg overflow-hidden"
                >
                  <div className="flex h-full">
                    {/* Left section - Thumbnail skeleton */}
                    <div className="w-24 h-full flex items-center justify-center border-r bg-gray-100">
                      <div className="w-8 h-10 bg-gray-200 rounded animate-pulse"></div>
                    </div>

                    {/* Right section - File Info skeleton */}
                    <div className="flex-1 p-3 flex flex-col justify-between">
                      <div>
                        <div className="h-4 w-40 bg-gray-200 rounded animate-pulse mb-2"></div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="h-3 w-16 bg-gray-200 rounded animate-pulse"></div>
                            <div className="h-3 w-12 bg-gray-200 rounded animate-pulse"></div>
                          </div>
                          <div className="h-3 w-14 bg-gray-200 rounded animate-pulse"></div>
                        </div>
                      </div>

                      <div className="h-3 w-20 bg-gray-200 rounded animate-pulse"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
