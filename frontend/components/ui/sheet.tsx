"use client";

import * as React from "react";
import { Dialog as RD } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Sheet = RD.Root;
const SheetTrigger = RD.Trigger;
const SheetClose = RD.Close;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof RD.Overlay>,
  React.ComponentPropsWithoutRef<typeof RD.Overlay>
>(({ className, ...props }, ref) => (
  <RD.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm",
      "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
      className,
    )}
    {...props}
  />
));
SheetOverlay.displayName = "SheetOverlay";

interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof RD.Content> {
  side?: "left" | "right" | "top" | "bottom";
}

const sideClasses: Record<NonNullable<SheetContentProps["side"]>, string> = {
  left: "inset-y-0 left-0 h-full w-72 border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left",
  right: "inset-y-0 right-0 h-full w-80 border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
  top: "inset-x-0 top-0 w-full border-b data-[state=open]:slide-in-from-top data-[state=closed]:slide-out-to-top",
  bottom: "inset-x-0 bottom-0 w-full border-t data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
};

const SheetContent = React.forwardRef<React.ElementRef<typeof RD.Content>, SheetContentProps>(
  ({ side = "right", className, children, ...props }, ref) => (
    <RD.Portal>
      <SheetOverlay />
      <RD.Content
        ref={ref}
        className={cn(
          "fixed z-50 bg-background p-6 shadow-xl",
          "data-[state=open]:animate-in data-[state=closed]:animate-out duration-200",
          sideClasses[side],
          className,
        )}
        {...props}
      >
        {children}
        <RD.Close className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100">
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </RD.Close>
      </RD.Content>
    </RD.Portal>
  ),
);
SheetContent.displayName = "SheetContent";

export { Sheet, SheetTrigger, SheetClose, SheetContent };
