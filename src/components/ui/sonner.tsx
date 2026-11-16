"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "light" } = useTheme()

  return (
    <Sonner
      theme={(theme === "system" ? "light" : theme) as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-[var(--size-icon-md)] text-success" />
        ),
        info: (
          <InfoIcon className="size-[var(--size-icon-md)] text-info" />
        ),
        warning: (
          <TriangleAlertIcon className="size-[var(--size-icon-md)] text-warning" />
        ),
        error: (
          <OctagonXIcon className="size-[var(--size-icon-md)] text-destructive" />
        ),
        loading: (
          <Loader2Icon className="size-[var(--size-icon-md)] animate-spin text-primary" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-lg)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "cn-toast rounded-lg border border-border bg-popover text-popover-foreground shadow-md",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
