import { notFound } from "next/navigation"

import ComponentsShowcasePage from "@/components/dev/components-showcase"

export default function ComponentsPage() {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }

  return <ComponentsShowcasePage />
}
