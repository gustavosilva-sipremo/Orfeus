import { useEffect } from "react"
import { useLibrary } from "@/stores/library"

export function useSectionReady(ready: boolean) {
  const view = useLibrary((state) => state.view)
  useEffect(() => {
    useLibrary.setState({ sectionReady: ready })
  }, [ready, view])
}
