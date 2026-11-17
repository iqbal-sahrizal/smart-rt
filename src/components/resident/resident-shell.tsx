import * as React from "react"

import { FloatingChatWidget } from "@/components/live-chat/floating-chat-widget"
import { NativeDeviceRegistrar } from "@/components/resident/native-device-registrar"
import { ResidentBottomNav } from "@/components/resident/resident-bottom-nav"
import { ResidentHeader } from "@/components/resident/resident-header"
import type { ShellUserInfo } from "@/lib/auth/types"

interface ResidentShellProps {
  children: React.ReactNode
  user?: ShellUserInfo
}

export function ResidentShell({ children, user }: ResidentShellProps) {
  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-foreground">
      <NativeDeviceRegistrar />
      <ResidentHeader user={user} />
      <main className="flex-1">{children}</main>
      <ResidentBottomNav />
      <FloatingChatWidget scope="resident" enabled={Boolean(user?.tenantId)} />
    </div>
  )
}

