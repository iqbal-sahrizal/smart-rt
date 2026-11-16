import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2Icon } from "lucide-react"
import { cn } from "cn"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all duration-150 outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[var(--size-icon-md)]",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover active:bg-primary-active",
        outline:
          "border-border bg-surface text-foreground shadow-xs hover:bg-muted aria-expanded:bg-muted",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary-hover aria-expanded:bg-secondary",
        ghost:
          "text-foreground-secondary hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        destructive:
          "bg-destructive-subtle text-destructive-text border-destructive-border hover:bg-destructive/15 focus-visible:border-destructive focus-visible:ring-destructive/20",
        accent:
          "bg-accent text-accent-foreground shadow-xs hover:bg-accent-hover",
        navy:
          "bg-navy text-navy-foreground shadow-xs hover:bg-navy/90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-[var(--size-control-md)] gap-[var(--space-1-5)] px-[var(--space-3)] has-data-[icon=inline-end]:pr-[var(--space-2-5)] has-data-[icon=inline-start]:pl-[var(--space-2-5)]",
        xs: "h-[var(--size-control-xs)] gap-[var(--space-1)] rounded-sm px-[var(--space-2)] text-xs [&_svg:not([class*='size-'])]:size-[var(--size-icon-xs)]",
        sm: "h-[var(--size-control-sm)] gap-[var(--space-1-5)] rounded-sm px-[var(--space-2-5)] text-sm [&_svg:not([class*='size-'])]:size-[var(--size-icon-sm)]",
        lg: "h-[var(--size-control-lg)] gap-[var(--space-2)] px-[var(--space-4)] text-sm [&_svg:not([class*='size-'])]:size-[var(--size-icon-md)]",
        xl: "h-[var(--size-control-xl)] gap-[var(--space-2)] px-[var(--space-5)] text-base [&_svg:not([class*='size-'])]:size-[var(--size-icon-lg)]",
        icon: "size-[var(--size-control-md)]",
        "icon-xs":
          "size-[var(--size-control-xs)] rounded-sm [&_svg:not([class*='size-'])]:size-[var(--size-icon-xs)]",
        "icon-sm":
          "size-[var(--size-control-sm)] rounded-sm [&_svg:not([class*='size-'])]:size-[var(--size-icon-sm)]",
        "icon-lg":
          "size-[var(--size-control-lg)] [&_svg:not([class*='size-'])]:size-[var(--size-icon-lg)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  loading = false,
  disabled,
  children,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    loading?: boolean
  }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {loading && <Loader2Icon className="animate-spin" aria-hidden="true" />}
      {children}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
