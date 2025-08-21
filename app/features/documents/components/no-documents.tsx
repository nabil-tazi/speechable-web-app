export function NoDocuments() {
  return (
    <div className="text-center py-12">
      <svg
        className="w-12 h-12 text-gray-400 mx-auto mb-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
        />
      </svg>
      <h3 className="text-lg font-medium text-gray-900 mb-2">
        No documents yet
      </h3>
      <p className="text-gray-500">
        Upload your first document to get started.
      </p>
    </div>
  );
}
