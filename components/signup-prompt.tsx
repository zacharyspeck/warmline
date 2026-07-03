"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// The signed-out shell's sign-up prompt. Anything in the demo that needs a
// real account (feed votes, the rail's nav items) opens this same dialog
// instead of navigating or bouncing to /signin.
export function SignupPrompt({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Make it your feed</DialogTitle>
          <DialogDescription>
            Thumbs teach Warmline who you actually want to meet. Create an
            account to vote on your own network.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Keep browsing
          </Button>
          <Button variant="primary" asChild>
            <Link href="/signin">Sign up</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
