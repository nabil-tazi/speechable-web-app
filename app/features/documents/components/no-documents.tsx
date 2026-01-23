import Image from "next/image";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface NoDocumentsProps {
  onCreateNew?: () => void;
}

export function NoDocuments({ onCreateNew }: NoDocumentsProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="w-[280px] h-[280px] mb-0">
        <Image
          src="/doodles/DancingDoodle.svg"
          alt=""
          width={280}
          height={280}
          className="opacity-80 w-full h-full object-contain"
          priority
        />
      </div>
      <h3 className="text-2xl font-semibold text-gray-900 mb-6">
        Ready to start listening?
      </h3>
      {onCreateNew && (
        <Button
          size="lg"
          className="bg-brand-primary-dark hover:bg-brand-primary-dark/90"
          onClick={onCreateNew}
        >
          Dive in
        </Button>
      )}
    </div>
  );
}
