import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-3">
      <Button variant="outline" size="sm" disabled={page <= 0} onClick={() => onPage(page - 1)} aria-label="Previous page">
        <ChevronLeft className="size-4" />
        Previous
      </Button>
      <span className="min-w-16 text-center text-sm tabular-nums text-muted-foreground">{page + 1} / {pages}</span>
      <Button variant="outline" size="sm" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} aria-label="Next page">
        Next
        <ChevronRight className="size-4" />
      </Button>
    </div>
  )
}
