'use client'

// ============================================================
// DropdownMenu — small popover menu of links/actions
// ============================================================
// Wraps @base-ui/react/menu, same "thin styled wrapper over a base-ui
// primitive" pattern as tooltip.tsx/alert-dialog.tsx. Added for the TopBar
// "More" menu (surfacing the outbound pages pulled from main nav) — kept
// generic so any future trigger+item list can reuse it instead of hand-
// rolling another popover.
// ============================================================

import Link from 'next/link'
import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import { cn } from '@/lib/utils'

function DropdownMenu(props: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuTrigger(props: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({
  className,
  children,
  sideOffset = 6,
  align = 'end',
  ...props
}: MenuPrimitive.Popup.Props & Pick<MenuPrimitive.Positioner.Props, 'sideOffset' | 'align'>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner sideOffset={sideOffset} align={align} className="z-50 outline-none">
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            'min-w-[200px] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg',
            'transition-[transform,opacity] duration-150 ease-out',
            'data-[starting-style]:scale-95 data-[starting-style]:opacity-0',
            'data-[ending-style]:scale-95 data-[ending-style]:opacity-0',
            className
          )}
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

// Client-navigable item — composes onto next/link so navigation stays a
// client-side transition rather than a full page reload.
function DropdownMenuLinkItem({
  className,
  href,
  children,
  ...props
}: Omit<MenuPrimitive.LinkItem.Props, 'render'> & { href: string }) {
  return (
    <MenuPrimitive.LinkItem
      data-slot="dropdown-menu-link-item"
      closeOnClick
      render={<Link href={href} />}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground outline-none transition-colors',
        'data-[highlighted]:bg-accent data-[highlighted]:text-foreground',
        className
      )}
      {...props}
    >
      {children}
    </MenuPrimitive.LinkItem>
  )
}

function DropdownMenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground outline-none transition-colors',
        'data-[highlighted]:bg-accent data-[highlighted]:text-foreground',
        className
      )}
      {...props}
    />
  )
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLinkItem, DropdownMenuItem }
