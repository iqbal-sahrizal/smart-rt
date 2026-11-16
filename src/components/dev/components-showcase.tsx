"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  BellIcon,
  ChevronDownIcon,
  HomeIcon,
  InfoIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  Trash2Icon,
  UserIcon,
} from "lucide-react"

import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export default function ComponentsShowcasePage() {
  const [isLoading, setIsLoading] = React.useState(false)

  const handleSimulatedLoading = () => {
    setIsLoading(true)
    setTimeout(() => {
      setIsLoading(false)
      toast.success("Action completed", {
        description: "All Smart RT design tokens and states verified.",
      })
    }, 1200)
  }

  return (
    <div className="min-h-screen bg-background px-[var(--space-4)] py-[var(--space-8)] sm:px-[var(--space-6)] lg:px-[var(--space-8)]">
      <div className="mx-auto flex w-full max-w-[var(--container-lg)] flex-col gap-[var(--space-8)]">
        {/* Header & Breadcrumb */}
        <header className="flex flex-col gap-[var(--space-3)]">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/">
                  <HomeIcon className="size-[var(--size-icon-sm)]" />
                  <span className="sr-only">Home</span>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>UI Component Library</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          <div className="flex flex-col justify-between gap-[var(--space-4)] sm:flex-row sm:items-end">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                Smart RT Design System
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Reusable component library built with shadcn/ui, Base UI, Lucide icons, and Smart RT tokens.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-[var(--space-2)]">
              <Badge variant="info">Light Theme</Badge>
              <Badge variant="accent">Inter + 4px Grid</Badge>
              <Badge variant="navy">v1.0</Badge>
            </div>
          </div>
        </header>

        <Separator />

        {/* 1. Buttons & Badges */}
        <section className="grid gap-[var(--space-6)] lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Button</CardTitle>
              <CardDescription>
                Variants, sizes, loading state, and disabled state.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-[var(--space-4)]">
              <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                <Button>Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="accent">Teal Accent</Button>
                <Button variant="navy">Deep Navy</Button>
                <Button variant="destructive">Destructive</Button>
                <Button variant="link">Link</Button>
              </div>
              <Separator />
              <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                <Button size="xs">XS</Button>
                <Button size="sm">Small</Button>
                <Button size="default">Default</Button>
                <Button size="lg">Large</Button>
                <Button size="xl">XL</Button>
                <Button size="icon" aria-label="Add item">
                  <PlusIcon />
                </Button>
              </div>
              <Separator />
              <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                <Button loading={isLoading} onClick={handleSimulatedLoading}>
                  {isLoading ? "Saving..." : "Test Loading + Toast"}
                </Button>
                <Button loading variant="outline">
                  Loading
                </Button>
                <Button disabled>Disabled</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Badge &amp; Avatar</CardTitle>
              <CardDescription>
                Semantic status badges and user avatar groups.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-[var(--space-5)]">
              <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                <Badge>Primary</Badge>
                <Badge variant="secondary">Secondary</Badge>
                <Badge variant="outline">Outline</Badge>
                <Badge variant="navy">Navy</Badge>
                <Badge variant="success">Success</Badge>
                <Badge variant="warning">Warning</Badge>
                <Badge variant="destructive">Destructive</Badge>
                <Badge variant="info">Info</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                <Badge size="sm" variant="success">Small</Badge>
                <Badge size="default" variant="info">Default</Badge>
                <Badge size="lg" variant="warning">Large</Badge>
              </div>
              <Separator />
              <div className="flex flex-wrap items-center gap-[var(--space-6)]">
                <div className="flex items-center gap-[var(--space-3)]">
                  <Avatar size="sm">
                    <AvatarFallback>SR</AvatarFallback>
                  </Avatar>
                  <Avatar size="default">
                    <AvatarFallback>RT</AvatarFallback>
                  </Avatar>
                  <Avatar size="lg">
                    <AvatarFallback>AD</AvatarFallback>
                  </Avatar>
                </div>
                <AvatarGroup>
                  <Avatar>
                    <AvatarFallback>AB</AvatarFallback>
                  </Avatar>
                  <Avatar>
                    <AvatarFallback>CD</AvatarFallback>
                  </Avatar>
                  <Avatar>
                    <AvatarFallback>EF</AvatarFallback>
                  </Avatar>
                  <AvatarGroupCount>+4</AvatarGroupCount>
                </AvatarGroup>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* 2. Form Controls */}
        <Card>
          <CardHeader>
            <CardTitle>Form Controls</CardTitle>
            <CardDescription>
              Input, Textarea, Select, Checkbox, and Radio Group with accessible focus and disabled states.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-[var(--space-6)] md:grid-cols-2">
            <div className="flex flex-col gap-[var(--space-4)]">
              <div className="flex flex-col gap-[var(--space-1-5)]">
                <label htmlFor="demo-input" className="text-sm font-medium text-foreground">
                  Input (Default &amp; Sizes)
                </label>
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-[var(--size-icon-md)] -translate-y-1/2 text-muted-foreground" />
                  <Input id="demo-input" placeholder="Search residents or invoices..." className="pl-9" />
                </div>
                <div className="grid grid-cols-2 gap-[var(--space-2)]">
                  <Input size="sm" placeholder="Small input" />
                  <Input size="lg" placeholder="Large input" />
                </div>
                <Input disabled placeholder="Disabled input" />
              </div>

              <div className="flex flex-col gap-[var(--space-1-5)]">
                <label htmlFor="demo-textarea" className="text-sm font-medium text-foreground">
                  Textarea
                </label>
                <Textarea id="demo-textarea" placeholder="Write a short note..." />
              </div>
            </div>

            <div className="flex flex-col gap-[var(--space-5)]">
              <div className="flex flex-col gap-[var(--space-1-5)]">
                <span className="text-sm font-medium text-foreground">Select</span>
                <Select defaultValue="active">
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="pending">Pending Review</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-[var(--space-2)]">
                <span className="text-sm font-medium text-foreground">Checkbox</span>
                <div className="flex flex-col gap-[var(--space-2)]">
                  <label className="flex items-center gap-[var(--space-2)] text-sm">
                    <Checkbox defaultChecked />
                    <span>Enable email notifications</span>
                  </label>
                  <label className="flex items-center gap-[var(--space-2)] text-sm text-muted-foreground">
                    <Checkbox disabled />
                    <span>Disabled option</span>
                  </label>
                </div>
              </div>

              <div className="flex flex-col gap-[var(--space-2)]">
                <span className="text-sm font-medium text-foreground">Radio Group</span>
                <RadioGroup defaultValue="monthly">
                  <label className="flex items-center gap-[var(--space-2)] text-sm">
                    <RadioGroupItem value="monthly" />
                    <span>Monthly billing</span>
                  </label>
                  <label className="flex items-center gap-[var(--space-2)] text-sm">
                    <RadioGroupItem value="annual" />
                    <span>Annual billing</span>
                  </label>
                </RadioGroup>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 3. Overlays, Tooltips & Toast */}
        <Card>
          <CardHeader>
            <CardTitle>Overlays, Menus, Tooltips &amp; Toast</CardTitle>
            <CardDescription>
              Dialog, Sheet / Drawer, Dropdown Menu, Tooltip, and Sonner toast notifications.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-[var(--space-3)]">
            <Dialog>
              <DialogTrigger render={<Button variant="outline" />}>
                Open Dialog
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Confirm Action</DialogTitle>
                  <DialogDescription>
                    This is a responsive modal dialog using Smart RT surface and radius tokens.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                  <DialogClose render={<Button />}>Confirm</DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Sheet>
              <SheetTrigger render={<Button variant="outline" />}>
                Open Sheet / Drawer
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Drawer Panel</SheetTitle>
                  <SheetDescription>
                    Slide-over drawer for secondary details or quick forms.
                  </SheetDescription>
                </SheetHeader>
                <div className="flex flex-col gap-[var(--space-3)] py-[var(--space-4)]">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-20 w-full" />
                </div>
                <SheetFooter>
                  <SheetClose render={<Button variant="outline" />}>Close</SheetClose>
                </SheetFooter>
              </SheetContent>
            </Sheet>

            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" />}>
                Dropdown Menu
                <ChevronDownIcon data-icon="inline-end" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Workspace</DropdownMenuLabel>
                  <DropdownMenuItem>
                    <UserIcon />
                    Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <SettingsIcon />
                    Settings
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive">
                  <Trash2Icon />
                  Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label="Info" />}>
                <InfoIcon />
              </TooltipTrigger>
              <TooltipContent>
                Accessible tooltip powered by Base UI
              </TooltipContent>
            </Tooltip>

            <Button
              variant="secondary"
              onClick={() =>
                toast.info("Notification", {
                  description: "Toast notifications are configured globally.",
                  icon: <BellIcon className="size-[var(--size-icon-md)] text-info" />,
                })
              }
            >
              Trigger Toast
            </Button>
          </CardContent>
        </Card>

        {/* 4. Tabs, Table, Skeleton & Pagination */}
        <Card>
          <CardHeader>
            <CardTitle>Tabs, Table, Skeleton &amp; Pagination</CardTitle>
            <CardDescription>
              Data presentation, loading placeholders, and navigation controls.
            </CardDescription>
            <CardAction>
              <Button variant="ghost" size="icon-sm" aria-label="More options">
                <MoreHorizontalIcon />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-[var(--space-6)]">
            <Tabs defaultValue="table">
              <TabsList>
                <TabsTrigger value="table">Table View</TabsTrigger>
                <TabsTrigger value="loading">Loading Skeleton</TabsTrigger>
              </TabsList>
              <TabsContent value="table" className="mt-4">
                <div className="rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reference</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-medium">INV-2026-001</TableCell>
                        <TableCell>Monthly Dues</TableCell>
                        <TableCell>
                          <Badge variant="success" size="sm">Paid</Badge>
                        </TableCell>
                        <TableCell className="text-right">Rp 150.000</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium">INV-2026-002</TableCell>
                        <TableCell>Security Fee</TableCell>
                        <TableCell>
                          <Badge variant="warning" size="sm">Pending</Badge>
                        </TableCell>
                        <TableCell className="text-right">Rp 75.000</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>
              <TabsContent value="loading" className="mt-4">
                <div className="flex flex-col gap-[var(--space-3)] rounded-lg border border-border p-[var(--space-4)]">
                  <div className="flex items-center gap-[var(--space-3)]">
                    <Skeleton className="size-10 rounded-full" />
                    <div className="flex flex-1 flex-col gap-[var(--space-2)]">
                      <Skeleton className="h-4 w-1/3" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                  <Skeleton className="h-16 w-full" />
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
          <CardFooter className="justify-between">
            <span className="text-xs text-muted-foreground">Showing 1–2 of 20 items</span>
            <Pagination className="mx-0 w-auto">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious href="#" />
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink href="#" isActive>
                    1
                  </PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink href="#">2</PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationEllipsis />
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext href="#" />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}

